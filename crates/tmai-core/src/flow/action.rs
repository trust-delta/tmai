//! Gate action executor — executes a gate node's resolve + condition + action.
//!
//! In v2, each gate has exactly 1 condition and max 2 branches (then/else).

use std::collections::HashMap;

use tracing::{debug, info};

use super::condition;
use super::executor::FlowExecutor;
use super::resolver;
use super::template;
use super::types::{ActionType, FlowContext, GateAction, GateNodeConfig};

/// Result of executing a gate node
#[derive(Debug, Clone)]
pub enum GateResult {
    /// Action targets an agent (send_message or spawn_agent)
    AgentAction {
        action: ActionType,
        target_node: String,
        prompt: String,
        params: HashMap<String, serde_json::Value>,
    },
    /// Terminal action (merge_pr, review_pr, etc.)
    TerminalAction {
        action: ActionType,
        params: HashMap<String, serde_json::Value>,
    },
    /// Passthrough to next gate
    Passthrough { target_node: String },
    /// No-op (condition false with no else_action)
    Noop,
}

/// Errors from gate execution
#[derive(Debug)]
pub enum GateError {
    ResolveFailed(String),
    ConditionFailed(String),
    ActionFailed(String),
}

impl std::fmt::Display for GateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ResolveFailed(e) => write!(f, "resolve failed: {e}"),
            Self::ConditionFailed(e) => write!(f, "condition failed: {e}"),
            Self::ActionFailed(e) => write!(f, "action failed: {e}"),
        }
    }
}

impl std::error::Error for GateError {}

/// Execute a gate node: resolve → condition → select then/else → return action
pub async fn execute_gate(
    gate: &GateNodeConfig,
    context: &mut FlowContext,
    executor: &dyn FlowExecutor,
) -> Result<GateResult, GateError> {
    // Step 1: Resolve (optional)
    if let Some(ref resolve) = gate.resolve {
        let steps = [resolve.clone()];
        resolver::resolve_all(&steps, context, executor)
            .await
            .map_err(|e| GateError::ResolveFailed(e.to_string()))?;
    }

    // Step 2: Evaluate condition
    let condition_met = condition::evaluate(&gate.condition, context)
        .map_err(|e| GateError::ConditionFailed(e.to_string()))?;

    debug!(
        gate = %gate.id,
        condition = %gate.condition,
        result = condition_met,
        "Gate condition evaluated"
    );

    // Step 3: Select action based on condition
    let selected_action = if condition_met {
        Some(&gate.then_action)
    } else {
        gate.else_action.as_ref()
    };

    let Some(action) = selected_action else {
        // Condition false, no else_action → noop
        debug!(gate = %gate.id, "No else_action, returning noop");
        return Ok(GateResult::Noop);
    };

    // Step 4: Build result from selected action
    execute_action(action, context)
}

/// Convert a GateAction into a GateResult
fn execute_action(action: &GateAction, context: &FlowContext) -> Result<GateResult, GateError> {
    let expanded_prompt = action
        .prompt
        .as_deref()
        .map(|p| template::expand(p, context))
        .unwrap_or_default();

    let expanded_params = template::expand_params(&action.params, context);

    match &action.action {
        ActionType::SendMessage | ActionType::SpawnAgent => {
            let target = action.target.as_ref().ok_or_else(|| {
                GateError::ActionFailed(format!("{:?} requires a target", action.action))
            })?;

            info!(
                action = ?action.action,
                target = %target,
                "Gate action → agent"
            );

            Ok(GateResult::AgentAction {
                action: action.action.clone(),
                target_node: target.clone(),
                prompt: expanded_prompt,
                params: expanded_params,
            })
        }
        ActionType::Passthrough => {
            let target = action.target.as_ref().ok_or_else(|| {
                GateError::ActionFailed("passthrough requires a target".to_string())
            })?;

            debug!(target = %target, "Gate action → passthrough");

            Ok(GateResult::Passthrough {
                target_node: target.clone(),
            })
        }
        ActionType::MergePr | ActionType::ReviewPr | ActionType::RerunCi => {
            info!(action = ?action.action, "Gate action → terminal");

            Ok(GateResult::TerminalAction {
                action: action.action.clone(),
                params: expanded_params,
            })
        }
        ActionType::Noop => Ok(GateResult::Noop),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow::executor::MockExecutor;
    use crate::flow::types::*;

    fn test_context() -> FlowContext {
        let mut ctx = FlowContext::new(HashMap::from([(
            "agent".to_string(),
            serde_json::json!({"git_branch": "feat/42"}),
        )]));
        ctx.set(
            "pr".to_string(),
            serde_json::json!({"number": 123, "title": "Add auth"}),
        );
        ctx
    }

    fn gate_with_pr_check() -> GateNodeConfig {
        GateNodeConfig {
            id: "check_pr".to_string(),
            resolve: None,
            condition: "pr != null".to_string(),
            then_action: GateAction {
                action: ActionType::SpawnAgent,
                target: Some("review".to_string()),
                prompt: Some("Review PR #{{pr.number}}".to_string()),
                params: HashMap::new(),
            },
            else_action: Some(GateAction {
                action: ActionType::SendMessage,
                target: Some("orch".to_string()),
                prompt: Some("No PR found".to_string()),
                params: HashMap::new(),
            }),
        }
    }

    #[tokio::test]
    async fn test_gate_then_branch() {
        let gate = gate_with_pr_check();
        let mut ctx = test_context();
        let executor = MockExecutor::new();

        let result = execute_gate(&gate, &mut ctx, &executor).await.unwrap();

        match result {
            GateResult::AgentAction {
                action,
                target_node,
                prompt,
                ..
            } => {
                assert_eq!(action, ActionType::SpawnAgent);
                assert_eq!(target_node, "review");
                assert_eq!(prompt, "Review PR #123");
            }
            other => panic!("Expected AgentAction, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_gate_else_branch() {
        let gate = gate_with_pr_check();
        let mut ctx = FlowContext::new(HashMap::new()); // no pr
        let executor = MockExecutor::new();

        let result = execute_gate(&gate, &mut ctx, &executor).await.unwrap();

        match result {
            GateResult::AgentAction {
                action,
                target_node,
                ..
            } => {
                assert_eq!(action, ActionType::SendMessage);
                assert_eq!(target_node, "orch");
            }
            other => panic!("Expected AgentAction (else), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_gate_noop_when_no_else() {
        let gate = GateNodeConfig {
            id: "simple".to_string(),
            resolve: None,
            condition: "nonexistent != null".to_string(),
            then_action: GateAction {
                action: ActionType::SpawnAgent,
                target: Some("worker".to_string()),
                prompt: None,
                params: HashMap::new(),
            },
            else_action: None,
        };
        let mut ctx = FlowContext::new(HashMap::new());
        let executor = MockExecutor::new();

        let result = execute_gate(&gate, &mut ctx, &executor).await.unwrap();
        assert!(matches!(result, GateResult::Noop));
    }

    #[tokio::test]
    async fn test_gate_terminal_action() {
        let gate = GateNodeConfig {
            id: "merge".to_string(),
            resolve: None,
            condition: "true".to_string(),
            then_action: GateAction {
                action: ActionType::MergePr,
                target: None,
                prompt: None,
                params: HashMap::from([(
                    "pr_number".to_string(),
                    serde_json::Value::String("{{pr.number}}".to_string()),
                )]),
            },
            else_action: None,
        };
        let mut ctx = test_context();
        let executor = MockExecutor::new();

        let result = execute_gate(&gate, &mut ctx, &executor).await.unwrap();

        match result {
            GateResult::TerminalAction { action, params } => {
                assert_eq!(action, ActionType::MergePr);
                assert_eq!(params["pr_number"], serde_json::json!(123));
            }
            other => panic!("Expected TerminalAction, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_gate_passthrough() {
        let gate = GateNodeConfig {
            id: "route".to_string(),
            resolve: None,
            condition: "true".to_string(),
            then_action: GateAction {
                action: ActionType::Passthrough,
                target: Some("next_gate".to_string()),
                prompt: None,
                params: HashMap::new(),
            },
            else_action: None,
        };
        let mut ctx = FlowContext::new(HashMap::new());
        let executor = MockExecutor::new();

        let result = execute_gate(&gate, &mut ctx, &executor).await.unwrap();
        assert!(
            matches!(result, GateResult::Passthrough { target_node } if target_node == "next_gate")
        );
    }

    #[tokio::test]
    async fn test_gate_with_resolve() {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([{"number": 42, "branch": "feat/42"}]),
        );

        let gate = GateNodeConfig {
            id: "resolve_gate".to_string(),
            resolve: Some(ResolveStep {
                name: "pr".to_string(),
                query: "list_prs".to_string(),
                params: HashMap::new(),
                filter: Some("item.branch == agent.git_branch".to_string()),
                pick: PickMode::First,
            }),
            condition: "pr != null".to_string(),
            then_action: GateAction {
                action: ActionType::SpawnAgent,
                target: Some("review".to_string()),
                prompt: Some("PR #{{pr.number}}".to_string()),
                params: HashMap::new(),
            },
            else_action: None,
        };

        let mut ctx = FlowContext::new(HashMap::from([(
            "agent".to_string(),
            serde_json::json!({"git_branch": "feat/42"}),
        )]));

        let result = execute_gate(&gate, &mut ctx, &executor).await.unwrap();

        match result {
            GateResult::AgentAction { prompt, .. } => {
                assert_eq!(prompt, "PR #42");
            }
            other => panic!("Expected AgentAction, got {other:?}"),
        }
    }
}
