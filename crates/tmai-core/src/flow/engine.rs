//! Flow engine — the main background service that processes agent events
//! and executes edge pipelines for active flow runs.
//!
//! Replaces `OrchestratorNotifier` when flow definitions are present.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::{broadcast, mpsc, oneshot};
use tracing::{debug, error, info, warn};

use super::action::{self, ActionResult};
use super::executor::FlowExecutor;
use super::registry::FlowRegistry;
use super::resolver;
use super::types::{FlowContext, FlowKickResult, FlowRun};
use crate::api::CoreEvent;
use crate::state::SharedState;

/// Handle for interacting with the flow engine from outside (MCP tools, API, prompt composer).
#[derive(Clone)]
pub struct FlowEngineHandle {
    /// Send commands to the engine
    cmd_tx: mpsc::Sender<FlowCommand>,
    /// Read-only access to active flow runs (for prompt composition, UI)
    active_runs: Arc<RwLock<HashMap<String, FlowRun>>>,
    /// Read-only access to flow registry (for prompt composition, UI)
    registry: Arc<FlowRegistry>,
}

impl FlowEngineHandle {
    /// Start a new flow run. Called from `run_flow` MCP tool.
    pub async fn start_flow(
        &self,
        flow_name: String,
        params: HashMap<String, serde_json::Value>,
    ) -> Result<FlowKickResult, String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(FlowCommand::StartFlow {
                flow_name,
                params,
                response_tx: tx,
            })
            .await
            .map_err(|_| "flow engine not running".to_string())?;

        rx.await
            .map_err(|_| "flow engine dropped response".to_string())?
    }

    /// Cancel an active flow run.
    pub async fn cancel_flow(&self, run_id: String) -> Result<(), String> {
        self.cmd_tx
            .send(FlowCommand::CancelFlow { run_id })
            .await
            .map_err(|_| "flow engine not running".to_string())
    }

    /// Get a snapshot of active flow runs (for prompt composition).
    pub fn active_runs(&self) -> HashMap<String, FlowRun> {
        self.active_runs.read().clone()
    }

    /// Get the flow registry (for prompt composition, list_flows).
    pub fn registry(&self) -> &FlowRegistry {
        &self.registry
    }
}

/// Commands sent to the engine via the handle
enum FlowCommand {
    StartFlow {
        flow_name: String,
        params: HashMap<String, serde_json::Value>,
        response_tx: oneshot::Sender<Result<FlowKickResult, String>>,
    },
    CancelFlow {
        run_id: String,
    },
}

/// The flow engine background service.
pub struct FlowEngine;

impl FlowEngine {
    /// Spawn the flow engine as a background tokio task.
    ///
    /// Returns a handle for interacting with the engine.
    pub fn spawn(
        registry: FlowRegistry,
        mut event_rx: broadcast::Receiver<CoreEvent>,
        event_tx: broadcast::Sender<CoreEvent>,
        executor: Arc<dyn FlowExecutor>,
        state: Option<SharedState>,
    ) -> FlowEngineHandle {
        let active_runs: Arc<RwLock<HashMap<String, FlowRun>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let agent_run_map: Arc<RwLock<HashMap<String, String>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let registry = Arc::new(registry);

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<FlowCommand>(32);

        let handle = FlowEngineHandle {
            cmd_tx,
            active_runs: active_runs.clone(),
            registry: registry.clone(),
        };

        // Spawn the event loop
        let runs = active_runs.clone();
        let map = agent_run_map.clone();
        let reg = registry.clone();
        let exec = executor.clone();
        let tx = event_tx.clone();
        let st = state;

        tokio::spawn(async move {
            info!("Flow engine started with {} flow(s)", reg.len());

            loop {
                tokio::select! {
                    // Process CoreEvents
                    event = event_rx.recv() => {
                        match event {
                            Ok(CoreEvent::AgentStopped { target, cwd, last_assistant_message }) => {
                                Self::handle_agent_stopped(
                                    &target, &cwd, last_assistant_message.as_deref(),
                                    &runs, &map, &reg, &exec, &tx, &st,
                                ).await;
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                debug!(skipped = n, "Flow engine lagged, skipping events");
                            }
                            Err(broadcast::error::RecvError::Closed) => {
                                info!("Event channel closed, stopping flow engine");
                                break;
                            }
                            _ => {} // Ignore other events for now
                        }
                    }
                    // Process commands from handle
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(FlowCommand::StartFlow { flow_name, params, response_tx }) => {
                                let result = Self::handle_start_flow(
                                    &flow_name, params,
                                    &runs, &map, &reg, &exec, &tx,
                                ).await;
                                let _ = response_tx.send(result);
                            }
                            Some(FlowCommand::CancelFlow { run_id }) => {
                                Self::handle_cancel_flow(&run_id, &runs, &map);
                            }
                            None => {
                                info!("Command channel closed, stopping flow engine");
                                break;
                            }
                        }
                    }
                }
            }
        });

        handle
    }

    /// Handle an agent stop event — find the matching FlowRun and execute the edge pipeline.
    #[allow(clippy::too_many_arguments)]
    async fn handle_agent_stopped(
        target: &str,
        cwd: &str,
        last_assistant_message: Option<&str>,
        runs: &Arc<RwLock<HashMap<String, FlowRun>>>,
        agent_map: &Arc<RwLock<HashMap<String, String>>>,
        registry: &Arc<FlowRegistry>,
        executor: &Arc<dyn FlowExecutor>,
        event_tx: &broadcast::Sender<CoreEvent>,
        state: &Option<SharedState>,
    ) {
        // Find the FlowRun this agent belongs to
        let run_id = {
            let map = agent_map.read();
            map.get(target).cloned()
        };

        let Some(run_id) = run_id else {
            debug!(agent = %target, "Agent stopped but not part of any flow run");
            return;
        };

        // Get run state and flow definition
        let (current_node, flow_name, accumulated_context) = {
            let runs_r = runs.read();
            let Some(run) = runs_r.get(&run_id) else {
                warn!(run_id = %run_id, "FlowRun not found for stopped agent");
                return;
            };
            if !run.is_running() {
                debug!(run_id = %run_id, "FlowRun already completed, ignoring stop");
                return;
            }
            (
                run.current_node.clone(),
                run.flow_name.clone(),
                run.context.clone(),
            )
        };

        let Some(flow_def) = registry.get(&flow_name) else {
            error!(flow = %flow_name, "Flow definition not found in registry");
            return;
        };

        // Find matching edge: from == current_node, event == "stop"
        let matching_edge = flow_def
            .config
            .edges
            .iter()
            .find(|e| e.from == current_node && e.event == "stop");

        let Some(edge) = matching_edge else {
            info!(
                run_id = %run_id,
                flow = %flow_name,
                node = %current_node,
                "No edge defined for this node's stop — flow complete"
            );
            // Mark run as completed
            let mut runs_w = runs.write();
            if let Some(run) = runs_w.get_mut(&run_id) {
                run.complete(target.to_string(), HashMap::new());
            }
            let _ = event_tx.send(CoreEvent::FlowCompleted {
                run_id: run_id.clone(),
                flow_name: flow_name.clone(),
            });
            return;
        };

        // Build agent context from state if available, otherwise from event fields
        let agent_json = if let Some(ref shared_state) = state {
            let s = shared_state.read();
            if let Some(agent) = s.agents.get(target) {
                serde_json::json!({
                    "target": target,
                    "cwd": cwd,
                    "last_message": last_assistant_message,
                    "git_branch": agent.git_branch,
                    "git_dirty": agent.git_dirty,
                    "worktree_name": agent.worktree_name,
                    "display_name": agent.display_name(),
                    "is_worktree": agent.is_worktree,
                    "session": agent.session,
                })
            } else {
                serde_json::json!({
                    "target": target,
                    "cwd": cwd,
                    "last_message": last_assistant_message,
                })
            }
        } else {
            serde_json::json!({
                "target": target,
                "cwd": cwd,
                "last_message": last_assistant_message,
            })
        };

        // Build context
        let mut context = FlowContext::with_accumulated(
            HashMap::from([
                ("agent".to_string(), agent_json),
                (
                    "run".to_string(),
                    serde_json::json!({
                        "run_id": run_id,
                        "flow_name": flow_name,
                        "current_node": current_node,
                    }),
                ),
            ]),
            accumulated_context,
        );

        // Execute resolve steps
        if let Err(e) = resolver::resolve_all(&edge.resolve, &mut context, executor.as_ref()).await
        {
            error!(run_id = %run_id, error = %e, "Resolve failed");
            let mut runs_w = runs.write();
            if let Some(run) = runs_w.get_mut(&run_id) {
                run.fail(format!("Resolve failed: {e}"));
            }
            return;
        }

        // Execute route evaluation and action
        let result =
            action::evaluate_and_execute(&edge.route, &context, &flow_def.nodes, executor.as_ref())
                .await;

        match result {
            Ok(Some(action_result)) => {
                Self::apply_action_result(
                    &run_id,
                    target,
                    &action_result,
                    &mut context,
                    runs,
                    agent_map,
                    event_tx,
                    &flow_name,
                    &current_node,
                );
            }
            Ok(None) => {
                warn!(
                    run_id = %run_id,
                    node = %current_node,
                    "No route matched — consider adding a catch-all when='true' route"
                );
                // Notify orchestrator if present
                let _ = event_tx.send(CoreEvent::FlowError {
                    run_id: Some(run_id.clone()),
                    flow_name: Some(flow_name.clone()),
                    message: format!("No route matched for node '{current_node}' stop event"),
                });
            }
            Err(e) => {
                error!(
                    run_id = %run_id,
                    node = %current_node,
                    error = %e,
                    "Action execution failed"
                );
                let mut runs_w = runs.write();
                if let Some(run) = runs_w.get_mut(&run_id) {
                    run.fail(format!("Action failed: {e}"));
                }
            }
        }
    }

    /// Apply the result of an action to the FlowRun state
    #[allow(clippy::too_many_arguments)]
    fn apply_action_result(
        run_id: &str,
        source_agent: &str,
        action_result: &ActionResult,
        context: &mut FlowContext,
        runs: &Arc<RwLock<HashMap<String, FlowRun>>>,
        agent_map: &Arc<RwLock<HashMap<String, String>>>,
        event_tx: &broadcast::Sender<CoreEvent>,
        flow_name: &str,
        current_node: &str,
    ) {
        let resolved = context.drain_resolved();

        match action_result {
            ActionResult::Spawned {
                agent_id,
                target_role,
            }
            | ActionResult::PromptSent {
                agent_id,
                target_role,
            } => {
                // Advance the flow to the next node
                let mut runs_w = runs.write();
                if let Some(run) = runs_w.get_mut(run_id) {
                    run.advance(source_agent.to_string(), target_role.clone(), resolved);
                    run.current_agent_id = Some(agent_id.clone());
                }

                // Update agent→run mapping
                let mut map_w = agent_map.write();
                map_w.remove(source_agent);
                map_w.insert(agent_id.clone(), run_id.to_string());

                let _ = event_tx.send(CoreEvent::FlowStepCompleted {
                    run_id: run_id.to_string(),
                    flow_name: flow_name.to_string(),
                    node: current_node.to_string(),
                    outcome: "completed".to_string(),
                });

                info!(
                    run_id = %run_id,
                    from = %current_node,
                    to = %target_role,
                    agent = %agent_id,
                    "Flow advanced to next node"
                );
            }
            ActionResult::DirectAction { action, .. } => {
                // Direct action (merge, review, etc.) — flow completes
                let mut runs_w = runs.write();
                if let Some(run) = runs_w.get_mut(run_id) {
                    run.complete(source_agent.to_string(), resolved);
                }

                let mut map_w = agent_map.write();
                map_w.remove(source_agent);

                let _ = event_tx.send(CoreEvent::FlowCompleted {
                    run_id: run_id.to_string(),
                    flow_name: flow_name.to_string(),
                });

                info!(
                    run_id = %run_id,
                    action = %action,
                    "Flow completed with direct action"
                );
            }
            ActionResult::Noop => {
                // Noop — flow continues without advancing
                debug!(run_id = %run_id, "Noop action, flow state unchanged");
            }
        }
    }

    /// Handle a start_flow command from the handle
    async fn handle_start_flow(
        flow_name: &str,
        params: HashMap<String, serde_json::Value>,
        runs: &Arc<RwLock<HashMap<String, FlowRun>>>,
        agent_map: &Arc<RwLock<HashMap<String, String>>>,
        registry: &Arc<FlowRegistry>,
        executor: &Arc<dyn FlowExecutor>,
        _event_tx: &broadcast::Sender<CoreEvent>,
    ) -> Result<FlowKickResult, String> {
        let flow_def = registry
            .get(flow_name)
            .ok_or_else(|| format!("flow '{flow_name}' not found"))?;

        let run_id = generate_run_id();
        let first_node = &flow_def.first_node;

        // Build trigger description from params
        let trigger = params
            .get("issue_number")
            .and_then(|v| v.as_u64())
            .map(|n| format!("issue #{n}"))
            .unwrap_or_else(|| "manual".to_string());

        // Build initial context from entry params
        let mut context = FlowContext::new(HashMap::new());
        for (k, v) in &params {
            context.set(k.clone(), v.clone());
        }

        // Get the first node's definition
        let node_def = flow_def
            .nodes
            .get(first_node)
            .ok_or_else(|| format!("first node '{first_node}' not found in flow"))?;

        // Expand the node's prompt template
        let prompt = super::template::expand(&node_def.prompt_template, &context);

        // Spawn/send to the first node
        let mut action_params = HashMap::new();
        action_params.insert(
            "target_role".to_string(),
            serde_json::Value::String(first_node.clone()),
        );
        action_params.insert("prompt".to_string(), serde_json::Value::String(prompt));

        let action_name = match node_def.mode {
            super::types::NodeMode::Spawn => "spawn",
            super::types::NodeMode::Persistent => "send_prompt",
        };

        let result = executor
            .action(action_name, &action_params)
            .await
            .map_err(|e| format!("failed to kick first node: {e}"))?;

        let agent_id = result
            .get("agent_id")
            .or_else(|| result.get("session_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        // Create FlowRun
        let mut run = FlowRun::new(
            run_id.clone(),
            flow_name.to_string(),
            trigger,
            first_node.clone(),
        );
        run.current_agent_id = Some(agent_id.clone());

        // Store entry params in context for propagation
        for (k, v) in &params {
            run.context.insert(k.clone(), v.clone());
        }

        // Register
        {
            let mut runs_w = runs.write();
            runs_w.insert(run_id.clone(), run);
        }
        {
            let mut map_w = agent_map.write();
            map_w.insert(agent_id.clone(), run_id.clone());
        }

        info!(
            run_id = %run_id,
            flow = %flow_name,
            first_node = %first_node,
            agent = %agent_id,
            "Flow started"
        );

        Ok(FlowKickResult {
            run_id,
            flow_name: flow_name.to_string(),
            first_node: first_node.clone(),
            agent_id,
        })
    }

    /// Cancel a flow run
    fn handle_cancel_flow(
        run_id: &str,
        runs: &Arc<RwLock<HashMap<String, FlowRun>>>,
        agent_map: &Arc<RwLock<HashMap<String, String>>>,
    ) {
        let mut runs_w = runs.write();
        if let Some(run) = runs_w.get_mut(run_id) {
            run.fail("Cancelled by user".to_string());

            // Remove agent mapping
            if let Some(ref agent_id) = run.current_agent_id {
                let mut map_w = agent_map.write();
                map_w.remove(agent_id);
            }

            info!(run_id = %run_id, "Flow run cancelled");
        }
    }
}

/// Generate a short random run ID
fn generate_run_id() -> String {
    use std::time::SystemTime;
    let ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("run-{:x}", ts & 0xFFFFFF)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow::executor::MockExecutor;
    use crate::flow::registry::FlowRegistry;
    use crate::flow::types::*;

    /// Build a complete "feature" flow config for testing
    fn feature_flow_config() -> HashMap<String, FlowConfig> {
        let mut configs = HashMap::new();
        configs.insert(
            "feature".to_string(),
            FlowConfig {
                description: "implement → review".to_string(),
                entry_params: vec!["issue_number".to_string()],
                nodes: vec![
                    FlowNodeConfig {
                        role: "implement".to_string(),
                        mode: NodeMode::Spawn,
                        prompt_template: "Fix #{{issue_number}}".to_string(),
                        tools: ToolAccess::default(),
                        agent_type: AgentTypeName::default(),
                    },
                    FlowNodeConfig {
                        role: "review".to_string(),
                        mode: NodeMode::Spawn,
                        prompt_template: "Review PR".to_string(),
                        tools: ToolAccess::default(),
                        agent_type: AgentTypeName::default(),
                    },
                    FlowNodeConfig {
                        role: "orchestrator".to_string(),
                        mode: NodeMode::Persistent,
                        prompt_template: String::new(),
                        tools: ToolAccess::All(AllTools("*".to_string())),
                        agent_type: AgentTypeName::default(),
                    },
                ],
                edges: vec![FlowEdgeConfig {
                    from: "implement".to_string(),
                    event: "stop".to_string(),
                    resolve: vec![ResolveStepConfig {
                        name: "pr".to_string(),
                        query: "list_prs".to_string(),
                        params: HashMap::new(),
                        filter: None, // No filter in test — real impl uses agent.git_branch
                        pick: PickMode::First,
                    }],
                    route: vec![
                        RouteStepConfig {
                            condition: "pr != null".to_string(),
                            action: "spawn".to_string(),
                            target: Some("review".to_string()),
                            prompt: Some("Review PR #{{pr.number}}".to_string()),
                            params: HashMap::new(),
                        },
                        RouteStepConfig {
                            condition: "true".to_string(),
                            action: "send_prompt".to_string(),
                            target: Some("orchestrator".to_string()),
                            prompt: Some("No PR for {{agent.git_branch}}".to_string()),
                            params: HashMap::new(),
                        },
                    ],
                }],
            },
        );
        configs
    }

    fn mock_executor_with_pr() -> Arc<MockExecutor> {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([
                {"number": 123, "branch": "feat/42-auth", "title": "Add auth"},
            ]),
        );
        executor.action_responses.insert(
            "spawn".to_string(),
            serde_json::json!({"agent_id": "agent-impl-1"}),
        );
        Arc::new(executor)
    }

    #[tokio::test]
    async fn test_start_flow() {
        let configs = feature_flow_config();
        let registry = FlowRegistry::from_config(&configs).unwrap();
        let (event_tx, _event_rx) = broadcast::channel(16);
        let executor = mock_executor_with_pr();

        let handle = FlowEngine::spawn(
            registry,
            event_tx.subscribe(),
            event_tx.clone(),
            executor.clone(),
            None,
        );

        // Start a flow
        let result = handle
            .start_flow(
                "feature".to_string(),
                HashMap::from([("issue_number".to_string(), serde_json::json!(42))]),
            )
            .await;

        assert!(result.is_ok());
        let kick = result.unwrap();
        assert_eq!(kick.flow_name, "feature");
        assert_eq!(kick.first_node, "implement");
        assert_eq!(kick.agent_id, "agent-impl-1");

        // Verify flow run exists
        let runs = handle.active_runs();
        assert_eq!(runs.len(), 1);
        let run = runs.values().next().unwrap();
        assert_eq!(run.current_node, "implement");
        assert!(run.is_running());
    }

    #[tokio::test]
    async fn test_start_flow_unknown_flow() {
        let configs = feature_flow_config();
        let registry = FlowRegistry::from_config(&configs).unwrap();
        let (event_tx, _event_rx) = broadcast::channel(16);
        let executor = mock_executor_with_pr();

        let handle = FlowEngine::spawn(
            registry,
            event_tx.subscribe(),
            event_tx.clone(),
            executor,
            None,
        );

        let result = handle
            .start_flow("nonexistent".to_string(), HashMap::new())
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[tokio::test]
    async fn test_agent_stop_triggers_edge_pipeline() {
        let configs = feature_flow_config();
        let registry = FlowRegistry::from_config(&configs).unwrap();
        let (event_tx, _event_rx) = broadcast::channel(16);

        let mut executor = MockExecutor::new();
        // For start_flow
        executor.action_responses.insert(
            "spawn".to_string(),
            serde_json::json!({"agent_id": "agent-impl-1"}),
        );
        // For resolve: list_prs returns a matching PR
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([
                {"number": 123, "branch": "feat/42-auth", "title": "Add auth"},
            ]),
        );
        let executor = Arc::new(executor);

        let handle = FlowEngine::spawn(
            registry,
            event_tx.subscribe(),
            event_tx.clone(),
            executor.clone(),
            None,
        );

        // Start a flow
        let kick = handle
            .start_flow(
                "feature".to_string(),
                HashMap::from([("issue_number".to_string(), serde_json::json!(42))]),
            )
            .await
            .unwrap();

        assert_eq!(kick.first_node, "implement");

        // Simulate agent stop
        let _ = event_tx.send(CoreEvent::AgentStopped {
            target: "agent-impl-1".to_string(),
            cwd: "/home/user/project".to_string(),
            last_assistant_message: Some("Done implementing".to_string()),
        });

        // Give the engine a moment to process
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Check that the flow advanced to "review"
        let runs = handle.active_runs();
        let run = runs.values().next().unwrap();
        assert_eq!(run.current_node, "review");
        assert_eq!(run.steps_completed(), 1);
        assert!(run.is_running());

        // PR should be in accumulated context
        assert!(run.context.contains_key("pr"));
    }

    #[tokio::test]
    async fn test_cancel_flow() {
        let configs = feature_flow_config();
        let registry = FlowRegistry::from_config(&configs).unwrap();
        let (event_tx, _event_rx) = broadcast::channel(16);
        let executor = mock_executor_with_pr();

        let handle = FlowEngine::spawn(
            registry,
            event_tx.subscribe(),
            event_tx.clone(),
            executor,
            None,
        );

        let kick = handle
            .start_flow(
                "feature".to_string(),
                HashMap::from([("issue_number".to_string(), serde_json::json!(42))]),
            )
            .await
            .unwrap();

        handle.cancel_flow(kick.run_id.clone()).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        let runs = handle.active_runs();
        let run = runs.get(&kick.run_id).unwrap();
        assert!(!run.is_running());
        assert!(matches!(run.status, FlowRunStatus::Error(ref msg) if msg.contains("Cancelled")));
    }
}
