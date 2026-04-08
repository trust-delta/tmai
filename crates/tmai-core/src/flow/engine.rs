//! Flow engine v2 — background service processing agent events
//! and executing gate pipelines via typed wire connections.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::{broadcast, mpsc, oneshot};
use tracing::{debug, error, info, warn};

use super::action::{self, GateResult};
use super::executor::FlowExecutor;
use super::registry::FlowRegistry;
use super::types::{ActionType, FlowContext, FlowKickResult, FlowRun, PortType};
use crate::api::CoreEvent;
use crate::state::SharedState;

/// Handle for interacting with the flow engine from outside.
#[derive(Clone)]
pub struct FlowEngineHandle {
    cmd_tx: mpsc::Sender<FlowCommand>,
    active_runs: Arc<RwLock<HashMap<String, FlowRun>>>,
    registry: Arc<FlowRegistry>,
}

impl FlowEngineHandle {
    /// Start a new flow run.
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

    /// Get a snapshot of active flow runs.
    pub fn active_runs(&self) -> HashMap<String, FlowRun> {
        self.active_runs.read().clone()
    }

    /// Get the flow registry.
    pub fn registry(&self) -> &FlowRegistry {
        &self.registry
    }
}

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

        let runs = active_runs.clone();
        let map = agent_run_map.clone();
        let reg = registry.clone();
        let exec = executor.clone();
        let tx = event_tx.clone();
        let st = state;

        tokio::spawn(async move {
            info!("Flow engine v2 started with {} flow(s)", reg.len());

            loop {
                tokio::select! {
                    event = event_rx.recv() => {
                        match event {
                            Ok(CoreEvent::AgentStopped { target, cwd, last_assistant_message }) => {
                                Self::handle_agent_stopped(
                                    &target, &cwd, last_assistant_message.as_deref(),
                                    &runs, &map, &reg, &exec, &tx, &st,
                                ).await;
                            }
                            Err(broadcast::error::RecvError::Lagged(n)) => {
                                debug!(skipped = n, "Flow engine lagged");
                            }
                            Err(broadcast::error::RecvError::Closed) => {
                                info!("Event channel closed, stopping flow engine");
                                break;
                            }
                            _ => {}
                        }
                    }
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
                            None => break,
                        }
                    }
                }
            }
        });

        handle
    }

    /// Handle an agent stop event — find FlowRun, follow wire to gate, execute gate chain.
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
            let map_r = agent_map.read();
            if let Some(id) = map_r.get(target) {
                Some(id.clone())
            } else {
                drop(map_r);
                // Fallback: scan by current_agent_id
                let runs_r = runs.read();
                runs_r
                    .iter()
                    .find(|(_, run)| {
                        run.is_running() && run.current_agent_id.as_deref() == Some(target)
                    })
                    .map(|(id, _)| id.clone())
                    .or_else(|| {
                        // Try session_name/stable_id from state
                        let ids = state.as_ref().and_then(|s| {
                            let s = s.read();
                            let a = s.agents.get(target)?;
                            Some((
                                a.session_name.clone().unwrap_or_default(),
                                a.stable_id.clone(),
                            ))
                        });
                        if let Some((session, stable)) = ids {
                            let map_r = agent_map.read();
                            map_r.get(&session).or_else(|| map_r.get(&stable)).cloned()
                        } else {
                            None
                        }
                    })
            }
        };

        let Some(run_id) = run_id else {
            debug!(agent = %target, "Agent stopped but not part of any flow run");
            return;
        };

        // Cache target in agent_map
        {
            let mut map_w = agent_map.write();
            if !map_w.contains_key(target) {
                map_w.insert(target.to_string(), run_id.clone());
            }
        }

        let (current_node, flow_name, accumulated_context) = {
            let runs_r = runs.read();
            let Some(run) = runs_r.get(&run_id) else {
                return;
            };
            if !run.is_running() {
                return;
            }
            (
                run.current_node.clone(),
                run.flow_name.clone(),
                run.context.clone(),
            )
        };

        let Some(flow_def) = registry.get(&flow_name) else {
            error!(flow = %flow_name, "Flow definition not found");
            return;
        };

        // Build agent context
        let agent_json = if let Some(ref shared_state) = state {
            let s = shared_state.read();
            if let Some(agent) = s.agents.get(target) {
                serde_json::json!({
                    "target": target,
                    "cwd": cwd,
                    "last_message": last_assistant_message,
                    "git_branch": agent.git_branch,
                    "worktree_name": agent.worktree_name,
                    "display_name": agent.display_name(),
                })
            } else {
                serde_json::json!({"target": target, "cwd": cwd, "last_message": last_assistant_message})
            }
        } else {
            serde_json::json!({"target": target, "cwd": cwd, "last_message": last_assistant_message})
        };

        let mut context = FlowContext::with_accumulated(
            HashMap::from([("agent".to_string(), agent_json)]),
            accumulated_context,
        );

        // Follow wire from (current_node, Stop) → gate → execute gate chain
        let wire = flow_def
            .wires_from
            .get(&(current_node.clone(), PortType::Stop));

        let Some(wire) = wire else {
            info!(run_id = %run_id, node = %current_node, "No wire from stop — flow complete");
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

        // Execute gate chain (follow passthrough wires)
        let mut current_gate_id = wire.to.node.clone();
        let max_chain = 10; // prevent infinite loops
        let mut chain_depth = 0;

        loop {
            if chain_depth >= max_chain {
                error!(run_id = %run_id, "Gate chain exceeded max depth");
                let mut runs_w = runs.write();
                if let Some(run) = runs_w.get_mut(&run_id) {
                    run.fail("Gate chain exceeded max depth".to_string());
                }
                return;
            }
            chain_depth += 1;

            let Some(gate_config) = flow_def.gates.get(&current_gate_id) else {
                error!(gate = %current_gate_id, "Gate not found in flow definition");
                return;
            };

            let gate_result =
                action::execute_gate(gate_config, &mut context, executor.as_ref()).await;

            match gate_result {
                Ok(GateResult::AgentAction {
                    action,
                    target_node,
                    prompt,
                    params,
                }) => {
                    let resolved = context.drain_resolved();

                    // Advance the flow run
                    {
                        let mut runs_w = runs.write();
                        if let Some(run) = runs_w.get_mut(&run_id) {
                            run.advance(target.to_string(), target_node.clone(), resolved);
                        }
                    }

                    // Execute the agent action
                    let action_name = match action {
                        ActionType::SpawnAgent => "spawn",
                        ActionType::SendMessage => "send_prompt",
                        _ => "send_prompt",
                    };
                    let mut action_params = params;
                    action_params.insert("target_role".to_string(), serde_json::json!(target_node));
                    action_params.insert("prompt".to_string(), serde_json::json!(prompt));

                    match executor.action(action_name, &action_params).await {
                        Ok(result) => {
                            let agent_id = result
                                .get("agent_id")
                                .or_else(|| result.get("session_id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();

                            let mut runs_w = runs.write();
                            if let Some(run) = runs_w.get_mut(&run_id) {
                                run.current_agent_id = Some(agent_id.clone());
                            }
                            let mut map_w = agent_map.write();
                            map_w.remove(target);
                            map_w.insert(agent_id.clone(), run_id.clone());

                            info!(run_id = %run_id, agent = %agent_id, node = %target_node, "Flow advanced");
                        }
                        Err(e) => {
                            error!(run_id = %run_id, error = %e, "Agent action failed");
                            let mut runs_w = runs.write();
                            if let Some(run) = runs_w.get_mut(&run_id) {
                                run.fail(format!("Agent action failed: {e}"));
                            }
                        }
                    }

                    let _ = event_tx.send(CoreEvent::FlowStepCompleted {
                        run_id: run_id.clone(),
                        flow_name: flow_name.clone(),
                        node: current_gate_id.clone(),
                        outcome: "completed".to_string(),
                    });
                    break;
                }
                Ok(GateResult::Passthrough { target_node }) => {
                    debug!(from = %current_gate_id, to = %target_node, "Gate passthrough");
                    current_gate_id = target_node;
                    // Continue the loop to execute the next gate
                }
                Ok(GateResult::TerminalAction { action, params }) => {
                    // Execute terminal action and complete flow
                    let action_name = match action {
                        ActionType::MergePr => "merge_pr",
                        ActionType::ReviewPr => "review_pr",
                        ActionType::RerunCi => "rerun_ci",
                        _ => "noop",
                    };

                    if action_name != "noop" {
                        if let Err(e) = executor.action(action_name, &params).await {
                            warn!(run_id = %run_id, error = %e, "Terminal action failed");
                        }
                    }

                    let resolved = context.drain_resolved();
                    let mut runs_w = runs.write();
                    if let Some(run) = runs_w.get_mut(&run_id) {
                        run.complete(target.to_string(), resolved);
                    }
                    let mut map_w = agent_map.write();
                    map_w.remove(target);

                    let _ = event_tx.send(CoreEvent::FlowCompleted {
                        run_id: run_id.clone(),
                        flow_name: flow_name.clone(),
                    });
                    info!(run_id = %run_id, action = %action_name, "Flow completed with terminal action");
                    break;
                }
                Ok(GateResult::Noop) => {
                    debug!(run_id = %run_id, gate = %current_gate_id, "Gate returned noop");
                    break;
                }
                Err(e) => {
                    error!(run_id = %run_id, gate = %current_gate_id, error = %e, "Gate execution failed");
                    let mut runs_w = runs.write();
                    if let Some(run) = runs_w.get_mut(&run_id) {
                        run.fail(format!("Gate '{current_gate_id}' failed: {e}"));
                    }
                    let _ = event_tx.send(CoreEvent::FlowError {
                        run_id: Some(run_id.clone()),
                        flow_name: Some(flow_name.clone()),
                        message: e.to_string(),
                    });
                    break;
                }
            }
        }
    }

    /// Handle start_flow command
    #[allow(clippy::too_many_arguments)]
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

        let entry_node = &flow_def.config.entry_node;
        let agent_config = flow_def
            .config
            .agents
            .iter()
            .find(|a| a.id == *entry_node)
            .ok_or_else(|| format!("entry agent '{entry_node}' not found"))?;

        let run_id = generate_run_id();
        let trigger = params
            .get("issue_number")
            .and_then(|v| v.as_u64())
            .map(|n| format!("issue #{n}"))
            .unwrap_or_else(|| "manual".to_string());

        // Build initial context
        let mut context = FlowContext::new(HashMap::new());
        for (k, v) in &params {
            context.set(k.clone(), v.clone());
        }

        // Expand initial prompt
        let prompt = super::template::expand(&agent_config.prompt_template, &context);

        // Spawn the first agent
        let mut action_params = HashMap::new();
        action_params.insert(
            "target_role".to_string(),
            serde_json::Value::String(entry_node.clone()),
        );
        action_params.insert("prompt".to_string(), serde_json::Value::String(prompt));

        let result = executor
            .action("spawn", &action_params)
            .await
            .map_err(|e| format!("failed to spawn entry agent: {e}"))?;

        let agent_id = result
            .get("agent_id")
            .or_else(|| result.get("session_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let mut run = FlowRun::new(
            run_id.clone(),
            flow_name.to_string(),
            trigger,
            entry_node.clone(),
        );
        run.current_agent_id = Some(agent_id.clone());
        for (k, v) in &params {
            run.context.insert(k.clone(), v.clone());
        }

        {
            let mut runs_w = runs.write();
            runs_w.insert(run_id.clone(), run);
        }
        {
            let mut map_w = agent_map.write();
            map_w.insert(agent_id.clone(), run_id.clone());
        }

        info!(run_id = %run_id, flow = %flow_name, agent = %agent_id, "Flow v2 started");

        Ok(FlowKickResult {
            run_id,
            flow_name: flow_name.to_string(),
            first_node: entry_node.clone(),
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

    fn feature_flow_config() -> HashMap<String, FlowConfig> {
        let mut configs = HashMap::new();
        configs.insert(
            "feature".to_string(),
            FlowConfig {
                description: "test".to_string(),
                entry_params: vec!["issue_number".to_string()],
                entry_node: "impl".to_string(),
                agents: vec![
                    AgentNodeConfig {
                        id: "impl".to_string(),
                        agent_type: AgentTypeName::default(),
                        mode: NodeMode::Spawn,
                        prompt_template: "Fix #{{issue_number}}".to_string(),
                        tools: ToolAccess::default(),
                    },
                    AgentNodeConfig {
                        id: "review".to_string(),
                        agent_type: AgentTypeName::default(),
                        mode: NodeMode::Spawn,
                        prompt_template: "Review".to_string(),
                        tools: ToolAccess::default(),
                    },
                ],
                gates: vec![GateNodeConfig {
                    id: "check_pr".to_string(),
                    resolve: None,
                    condition: "true".to_string(), // always true for test
                    then_action: GateAction {
                        action: ActionType::SpawnAgent,
                        target: Some("review".to_string()),
                        prompt: Some("Review please".to_string()),
                        params: HashMap::new(),
                    },
                    else_action: None,
                }],
                wires: vec![Wire {
                    from: PortRef {
                        node: "impl".to_string(),
                        port: PortType::Stop,
                    },
                    to: PortRef {
                        node: "check_pr".to_string(),
                        port: PortType::Input,
                    },
                }],
            },
        );
        configs
    }

    #[tokio::test]
    async fn test_start_flow_v2() {
        let configs = feature_flow_config();
        let registry = FlowRegistry::from_config(&configs).unwrap();
        let (event_tx, _) = broadcast::channel(16);

        let mut executor = MockExecutor::new();
        executor
            .action_responses
            .insert("spawn".to_string(), serde_json::json!({"agent_id": "a1"}));
        let executor = Arc::new(executor);

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

        assert_eq!(kick.flow_name, "feature");
        assert_eq!(kick.first_node, "impl");
        assert_eq!(kick.agent_id, "a1");

        let runs = handle.active_runs();
        assert_eq!(runs.len(), 1);
    }

    #[tokio::test]
    async fn test_agent_stop_executes_gate() {
        let configs = feature_flow_config();
        let registry = FlowRegistry::from_config(&configs).unwrap();
        let (event_tx, _) = broadcast::channel(16);

        let mut executor = MockExecutor::new();
        executor
            .action_responses
            .insert("spawn".to_string(), serde_json::json!({"agent_id": "a1"}));
        let executor = Arc::new(executor);

        let handle = FlowEngine::spawn(
            registry,
            event_tx.subscribe(),
            event_tx.clone(),
            executor,
            None,
        );

        handle
            .start_flow(
                "feature".to_string(),
                HashMap::from([("issue_number".to_string(), serde_json::json!(42))]),
            )
            .await
            .unwrap();

        // Simulate agent stop
        let _ = event_tx.send(CoreEvent::AgentStopped {
            target: "a1".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: Some("Done".to_string()),
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let runs = handle.active_runs();
        let run = runs.values().next().unwrap();
        assert_eq!(run.current_node, "review");
        assert_eq!(run.steps_completed(), 1);
    }
}
