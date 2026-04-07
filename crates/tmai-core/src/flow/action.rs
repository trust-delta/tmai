//! Action executor — executes route actions after condition evaluation.
//!
//! Handles target resolution (role name → agent) and dispatches
//! to the appropriate MCP tool via the FlowExecutor trait.

use std::collections::HashMap;

use tracing::{debug, info};

use super::executor::FlowExecutor;
use super::template;
use super::types::{FlowContext, FlowNodeConfig, RouteStepConfig};

/// Result of executing a route action
#[derive(Debug, Clone)]
pub enum ActionResult {
    /// Prompt sent to an existing agent
    PromptSent {
        agent_id: String,
        target_role: String,
    },
    /// New agent spawned
    Spawned {
        agent_id: String,
        target_role: String,
    },
    /// Direct action executed (merge_pr, review_pr, etc.)
    DirectAction {
        action: String,
        result: serde_json::Value,
    },
    /// No-op (condition matched but no action needed)
    Noop,
}

/// Errors from action execution
#[derive(Debug)]
pub enum ActionError {
    /// Unknown action name
    UnknownAction(String),
    /// Target role required but not specified
    MissingTarget { action: String },
    /// Target role has no node definition
    UnknownTargetRole { role: String },
    /// Prompt template required but not specified
    MissingPrompt { action: String },
    /// Executor returned an error
    ExecutionFailed { action: String, error: String },
}

impl std::fmt::Display for ActionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownAction(a) => write!(f, "unknown action: '{a}'"),
            Self::MissingTarget { action } => {
                write!(f, "action '{action}' requires a target role")
            }
            Self::UnknownTargetRole { role } => {
                write!(f, "target role '{role}' not found in flow")
            }
            Self::MissingPrompt { action } => {
                write!(f, "action '{action}' requires a prompt template")
            }
            Self::ExecutionFailed { action, error } => {
                write!(f, "action '{action}' failed: {error}")
            }
        }
    }
}

impl std::error::Error for ActionError {}

/// Evaluate routes and execute the first matching action.
///
/// Returns the action result, or None if no route matched (should not happen
/// if a catch-all `when = "true"` route is present).
pub async fn evaluate_and_execute(
    routes: &[RouteStepConfig],
    context: &FlowContext,
    node_defs: &HashMap<String, FlowNodeConfig>,
    executor: &dyn FlowExecutor,
) -> Result<Option<ActionResult>, ActionError> {
    for route in routes {
        let matched = super::condition::evaluate(&route.condition, context).map_err(|e| {
            ActionError::ExecutionFailed {
                action: route.action.clone(),
                error: format!("condition evaluation failed: {e}"),
            }
        })?;

        if !matched {
            continue;
        }

        debug!(
            condition = %route.condition,
            action = %route.action,
            target = ?route.target,
            "Route matched"
        );

        let result = execute_action(route, context, node_defs, executor).await?;
        return Ok(Some(result));
    }

    // No route matched
    Ok(None)
}

/// Execute a single route's action
async fn execute_action(
    route: &RouteStepConfig,
    context: &FlowContext,
    node_defs: &HashMap<String, FlowNodeConfig>,
    executor: &dyn FlowExecutor,
) -> Result<ActionResult, ActionError> {
    match route.action.as_str() {
        "send_prompt" => execute_send_prompt(route, context, node_defs, executor).await,
        "spawn" => execute_spawn(route, context, node_defs, executor).await,
        "merge_pr" => execute_direct(route, context, executor).await,
        "review_pr" => execute_direct(route, context, executor).await,
        "rerun_ci" => execute_direct(route, context, executor).await,
        "kill" => execute_direct(route, context, executor).await,
        "noop" => Ok(ActionResult::Noop),
        other => Err(ActionError::UnknownAction(other.to_string())),
    }
}

/// Execute send_prompt action — send a message to a persistent or existing agent
async fn execute_send_prompt(
    route: &RouteStepConfig,
    context: &FlowContext,
    node_defs: &HashMap<String, FlowNodeConfig>,
    executor: &dyn FlowExecutor,
) -> Result<ActionResult, ActionError> {
    let target_role = route.target.as_ref().ok_or(ActionError::MissingTarget {
        action: "send_prompt".to_string(),
    })?;

    let _node_def = node_defs
        .get(target_role)
        .ok_or(ActionError::UnknownTargetRole {
            role: target_role.clone(),
        })?;

    let prompt = route.prompt.as_ref().ok_or(ActionError::MissingPrompt {
        action: "send_prompt".to_string(),
    })?;
    let expanded_prompt = template::expand(prompt, context);

    let mut params = template::expand_params(&route.params, context);
    params.insert(
        "target_role".to_string(),
        serde_json::Value::String(target_role.clone()),
    );
    params.insert(
        "prompt".to_string(),
        serde_json::Value::String(expanded_prompt),
    );

    let result = executor.action("send_prompt", &params).await.map_err(|e| {
        ActionError::ExecutionFailed {
            action: "send_prompt".to_string(),
            error: e,
        }
    })?;

    let agent_id = result
        .get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    info!(
        target_role = %target_role,
        agent_id = %agent_id,
        "Sent prompt to agent"
    );

    Ok(ActionResult::PromptSent {
        agent_id,
        target_role: target_role.clone(),
    })
}

/// Execute spawn action — create a new worktree agent
async fn execute_spawn(
    route: &RouteStepConfig,
    context: &FlowContext,
    node_defs: &HashMap<String, FlowNodeConfig>,
    executor: &dyn FlowExecutor,
) -> Result<ActionResult, ActionError> {
    let target_role = route.target.as_ref().ok_or(ActionError::MissingTarget {
        action: "spawn".to_string(),
    })?;

    let node_def = node_defs
        .get(target_role)
        .ok_or(ActionError::UnknownTargetRole {
            role: target_role.clone(),
        })?;

    // Determine prompt: route prompt takes precedence, then node's prompt_template
    let prompt = if let Some(ref route_prompt) = route.prompt {
        template::expand(route_prompt, context)
    } else if !node_def.prompt_template.is_empty() {
        template::expand(&node_def.prompt_template, context)
    } else {
        return Err(ActionError::MissingPrompt {
            action: "spawn".to_string(),
        });
    };

    let mut params = template::expand_params(&route.params, context);
    params.insert(
        "target_role".to_string(),
        serde_json::Value::String(target_role.clone()),
    );
    params.insert("prompt".to_string(), serde_json::Value::String(prompt));
    params.insert(
        "mode".to_string(),
        serde_json::Value::String(format!("{:?}", node_def.mode)),
    );

    let result =
        executor
            .action("spawn", &params)
            .await
            .map_err(|e| ActionError::ExecutionFailed {
                action: "spawn".to_string(),
                error: e,
            })?;

    let agent_id = result
        .get("agent_id")
        .or_else(|| result.get("session_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    info!(
        target_role = %target_role,
        agent_id = %agent_id,
        mode = ?node_def.mode,
        "Spawned agent for flow"
    );

    Ok(ActionResult::Spawned {
        agent_id,
        target_role: target_role.clone(),
    })
}

/// Execute a direct action (merge_pr, review_pr, rerun_ci, kill)
async fn execute_direct(
    route: &RouteStepConfig,
    context: &FlowContext,
    executor: &dyn FlowExecutor,
) -> Result<ActionResult, ActionError> {
    let params = template::expand_params(&route.params, context);

    let result = executor.action(&route.action, &params).await.map_err(|e| {
        ActionError::ExecutionFailed {
            action: route.action.clone(),
            error: e,
        }
    })?;

    info!(action = %route.action, "Executed direct action");

    Ok(ActionResult::DirectAction {
        action: route.action.clone(),
        result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow::executor::MockExecutor;
    use crate::flow::types::*;

    fn test_context() -> FlowContext {
        let mut ctx = FlowContext::new(HashMap::from([(
            "agent".to_string(),
            serde_json::json!({
                "git_branch": "feat/42",
                "display_name": "wt-42",
            }),
        )]));
        ctx.set(
            "pr".to_string(),
            serde_json::json!({"number": 123, "title": "Add auth"}),
        );
        ctx.set("ci".to_string(), serde_json::json!({"status": "success"}));
        ctx
    }

    fn test_node_defs() -> HashMap<String, FlowNodeConfig> {
        HashMap::from([
            (
                "review".to_string(),
                FlowNodeConfig {
                    role: "review".to_string(),
                    mode: NodeMode::Spawn,
                    prompt_template: "Default review prompt".to_string(),
                    tools: ToolAccess::default(),
                    agent_type: AgentTypeName::default(),
                },
            ),
            (
                "orchestrator".to_string(),
                FlowNodeConfig {
                    role: "orchestrator".to_string(),
                    mode: NodeMode::Persistent,
                    prompt_template: String::new(),
                    tools: ToolAccess::All(AllTools("*".to_string())),
                    agent_type: AgentTypeName::default(),
                },
            ),
        ])
    }

    #[tokio::test]
    async fn test_first_matching_route_executes() {
        let ctx = test_context();
        let nodes = test_node_defs();
        let mut executor = MockExecutor::new();
        executor.action_responses.insert(
            "spawn".to_string(),
            serde_json::json!({"agent_id": "new-agent-1"}),
        );

        let routes = vec![
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
                prompt: Some("Fallback".to_string()),
                params: HashMap::new(),
            },
        ];

        let result = evaluate_and_execute(&routes, &ctx, &nodes, &executor)
            .await
            .unwrap();

        assert!(matches!(
            result,
            Some(ActionResult::Spawned { ref target_role, .. }) if target_role == "review"
        ));

        // Verify the spawn action was called with expanded prompt
        let calls = executor.recorded_actions();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "spawn");
        assert_eq!(calls[0].1["prompt"], "Review PR #123");
    }

    #[tokio::test]
    async fn test_fallback_route() {
        let mut ctx = FlowContext::new(HashMap::from([(
            "agent".to_string(),
            serde_json::json!({"git_branch": "feat/42"}),
        )]));
        // pr is null (not set)
        let nodes = test_node_defs();
        let mut executor = MockExecutor::new();
        executor.action_responses.insert(
            "send_prompt".to_string(),
            serde_json::json!({"agent_id": "orch-1"}),
        );

        let routes = vec![
            RouteStepConfig {
                condition: "pr != null".to_string(),
                action: "spawn".to_string(),
                target: Some("review".to_string()),
                prompt: Some("Review".to_string()),
                params: HashMap::new(),
            },
            RouteStepConfig {
                condition: "true".to_string(),
                action: "send_prompt".to_string(),
                target: Some("orchestrator".to_string()),
                prompt: Some("No PR found for {{agent.git_branch}}".to_string()),
                params: HashMap::new(),
            },
        ];

        let result = evaluate_and_execute(&routes, &ctx, &nodes, &executor)
            .await
            .unwrap();

        assert!(matches!(
            result,
            Some(ActionResult::PromptSent { ref target_role, .. }) if target_role == "orchestrator"
        ));

        let calls = executor.recorded_actions();
        assert_eq!(calls[0].1["prompt"], "No PR found for feat/42");
    }

    #[tokio::test]
    async fn test_noop_action() {
        let ctx = test_context();
        let nodes = test_node_defs();
        let executor = MockExecutor::new();

        let routes = vec![RouteStepConfig {
            condition: "true".to_string(),
            action: "noop".to_string(),
            target: None,
            prompt: None,
            params: HashMap::new(),
        }];

        let result = evaluate_and_execute(&routes, &ctx, &nodes, &executor)
            .await
            .unwrap();

        assert!(matches!(result, Some(ActionResult::Noop)));
    }

    #[tokio::test]
    async fn test_direct_action_merge() {
        let ctx = test_context();
        let nodes = test_node_defs();
        let mut executor = MockExecutor::new();
        executor
            .action_responses
            .insert("merge_pr".to_string(), serde_json::json!({"merged": true}));

        let routes = vec![RouteStepConfig {
            condition: "true".to_string(),
            action: "merge_pr".to_string(),
            target: None,
            prompt: None,
            params: HashMap::from([
                (
                    "pr_number".to_string(),
                    serde_json::Value::String("{{pr.number}}".to_string()),
                ),
                (
                    "method".to_string(),
                    serde_json::Value::String("squash".to_string()),
                ),
            ]),
        }];

        let result = evaluate_and_execute(&routes, &ctx, &nodes, &executor)
            .await
            .unwrap();

        assert!(matches!(result, Some(ActionResult::DirectAction { .. })));

        let calls = executor.recorded_actions();
        assert_eq!(calls[0].0, "merge_pr");
        // pr_number should be expanded from "{{pr.number}}" to 123
        assert_eq!(calls[0].1["pr_number"], serde_json::json!(123));
    }

    #[tokio::test]
    async fn test_no_route_matches() {
        let ctx = FlowContext::new(HashMap::new());
        let nodes = test_node_defs();
        let executor = MockExecutor::new();

        let routes = vec![RouteStepConfig {
            condition: "nonexistent != null".to_string(),
            action: "spawn".to_string(),
            target: Some("review".to_string()),
            prompt: Some("test".to_string()),
            params: HashMap::new(),
        }];

        let result = evaluate_and_execute(&routes, &ctx, &nodes, &executor)
            .await
            .unwrap();

        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_unknown_action_rejected() {
        let ctx = test_context();
        let nodes = test_node_defs();
        let executor = MockExecutor::new();

        let routes = vec![RouteStepConfig {
            condition: "true".to_string(),
            action: "teleport".to_string(),
            target: None,
            prompt: None,
            params: HashMap::new(),
        }];

        let result = evaluate_and_execute(&routes, &ctx, &nodes, &executor).await;
        assert!(matches!(result, Err(ActionError::UnknownAction(_))));
    }

    #[tokio::test]
    async fn test_missing_target_rejected() {
        let ctx = test_context();
        let nodes = test_node_defs();
        let mut executor = MockExecutor::new();
        executor
            .action_responses
            .insert("send_prompt".to_string(), serde_json::json!({}));

        let routes = vec![RouteStepConfig {
            condition: "true".to_string(),
            action: "send_prompt".to_string(),
            target: None, // missing!
            prompt: Some("hello".to_string()),
            params: HashMap::new(),
        }];

        let result = evaluate_and_execute(&routes, &ctx, &nodes, &executor).await;
        assert!(matches!(result, Err(ActionError::MissingTarget { .. })));
    }

    #[tokio::test]
    async fn test_spawn_uses_node_prompt_template_as_fallback() {
        let ctx = test_context();
        let nodes = test_node_defs();
        let mut executor = MockExecutor::new();
        executor.action_responses.insert(
            "spawn".to_string(),
            serde_json::json!({"agent_id": "new-1"}),
        );

        let routes = vec![RouteStepConfig {
            condition: "true".to_string(),
            action: "spawn".to_string(),
            target: Some("review".to_string()),
            prompt: None, // no route prompt → use node's prompt_template
            params: HashMap::new(),
        }];

        let result = evaluate_and_execute(&routes, &ctx, &nodes, &executor)
            .await
            .unwrap();

        assert!(matches!(result, Some(ActionResult::Spawned { .. })));

        let calls = executor.recorded_actions();
        assert_eq!(calls[0].1["prompt"], "Default review prompt");
    }
}
