//! Resolver — executes resolve steps to bind context variables from MCP tool queries.

use std::collections::HashMap;

use tracing::debug;

use super::condition;
use super::executor::FlowExecutor;
use super::template;
use super::types::{FlowContext, PickMode, ResolveStep};

/// Execute a list of resolve steps sequentially, binding results into the context.
///
/// Each step calls an MCP tool query, optionally filters the result,
/// picks element(s), and binds the result to a named variable in the context.
/// Later steps can reference variables bound by earlier steps.
///
/// On query failure, the variable is bound to `null`.
pub async fn resolve_all(
    steps: &[ResolveStep],
    context: &mut FlowContext,
    executor: &dyn FlowExecutor,
) -> Result<(), ResolveError> {
    for step in steps {
        let value = resolve_one(step, context, executor).await;
        match value {
            Ok(v) => {
                debug!(name = %step.name, query = %step.query, "Resolved variable");
                context.set(step.name.clone(), v);
            }
            Err(e) => {
                debug!(
                    name = %step.name,
                    query = %step.query,
                    error = %e,
                    "Resolve failed, binding null"
                );
                context.set(step.name.clone(), serde_json::Value::Null);
            }
        }
    }
    Ok(())
}

/// Execute a single resolve step
async fn resolve_one(
    step: &ResolveStep,
    context: &FlowContext,
    executor: &dyn FlowExecutor,
) -> Result<serde_json::Value, ResolveError> {
    // Expand template placeholders in params
    let params: HashMap<String, serde_json::Value> = step
        .params
        .iter()
        .map(|(k, v)| {
            let expanded = template::expand(v, context);
            (k.clone(), serde_json::Value::String(expanded))
        })
        .collect();

    // Call the MCP tool query
    let result =
        executor
            .query(&step.query, &params)
            .await
            .map_err(|e| ResolveError::QueryFailed {
                query: step.query.clone(),
                error: e,
            })?;

    // Apply filter if specified
    let filtered = if let Some(ref filter_expr) = step.filter {
        apply_filter(&result, filter_expr, context)?
    } else {
        // No filter — use result as-is
        match &result {
            serde_json::Value::Array(arr) => arr.clone(),
            other => vec![other.clone()],
        }
    };

    // Pick from filtered results
    let picked = pick(&filtered, &step.pick);
    Ok(picked)
}

/// Apply a filter expression to an array of items.
///
/// The filter expression uses `item` to reference the current element being tested,
/// and can reference context variables (e.g., `item.branch == agent.git_branch`).
fn apply_filter(
    result: &serde_json::Value,
    filter_expr: &str,
    context: &FlowContext,
) -> Result<Vec<serde_json::Value>, ResolveError> {
    let items = match result {
        serde_json::Value::Array(arr) => arr.clone(),
        // Single value wraps into a one-element array
        other => vec![other.clone()],
    };

    let mut filtered = Vec::new();
    for item in &items {
        // Create a temporary context with `item` bound to the current element
        let mut filter_ctx = context.clone();
        filter_ctx.set("item".to_string(), item.clone());

        match condition::evaluate(filter_expr, &filter_ctx) {
            Ok(true) => filtered.push(item.clone()),
            Ok(false) => {}
            Err(e) => {
                return Err(ResolveError::FilterFailed {
                    filter: filter_expr.to_string(),
                    error: e.to_string(),
                })
            }
        }
    }

    Ok(filtered)
}

/// Pick element(s) from a filtered array based on pick mode
fn pick(items: &[serde_json::Value], mode: &PickMode) -> serde_json::Value {
    match mode {
        PickMode::First => items.first().cloned().unwrap_or(serde_json::Value::Null),
        PickMode::Last => items.last().cloned().unwrap_or(serde_json::Value::Null),
        PickMode::Count => serde_json::json!(items.len()),
        PickMode::All => serde_json::Value::Array(items.to_vec()),
    }
}

/// Errors from resolve step execution
#[derive(Debug)]
pub enum ResolveError {
    /// MCP tool query failed
    QueryFailed { query: String, error: String },
    /// Filter expression evaluation failed
    FilterFailed { filter: String, error: String },
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::QueryFailed { query, error } => {
                write!(f, "query '{query}' failed: {error}")
            }
            Self::FilterFailed { filter, error } => {
                write!(f, "filter '{filter}' failed: {error}")
            }
        }
    }
}

impl std::error::Error for ResolveError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow::executor::MockExecutor;
    use crate::flow::types::FlowContext;

    fn base_context() -> FlowContext {
        FlowContext::new(HashMap::from([(
            "agent".to_string(),
            serde_json::json!({
                "git_branch": "feat/42-auth",
                "cwd": "/home/user/project",
            }),
        )]))
    }

    #[tokio::test]
    async fn test_resolve_list_prs_with_filter() {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([
                {"number": 100, "branch": "feat/other"},
                {"number": 123, "branch": "feat/42-auth"},
                {"number": 200, "branch": "feat/42-auth"},
            ]),
        );

        let steps = vec![ResolveStep {
            name: "pr".to_string(),
            query: "list_prs".to_string(),
            params: HashMap::from([("repo".to_string(), "{{agent.cwd}}".to_string())]),
            filter: Some("item.branch == agent.git_branch".to_string()),
            pick: PickMode::First,
        }];

        let mut ctx = base_context();
        resolve_all(&steps, &mut ctx, &executor).await.unwrap();

        // Should have filtered to branch == "feat/42-auth" and picked first
        let pr = ctx.get("pr").unwrap();
        assert_eq!(pr["number"], 123);
        assert_eq!(pr["branch"], "feat/42-auth");
    }

    #[tokio::test]
    async fn test_resolve_no_match_returns_null() {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([
                {"number": 100, "branch": "feat/other"},
            ]),
        );

        let steps = vec![ResolveStep {
            name: "pr".to_string(),
            query: "list_prs".to_string(),
            params: HashMap::new(),
            filter: Some("item.branch == agent.git_branch".to_string()),
            pick: PickMode::First,
        }];

        let mut ctx = base_context();
        resolve_all(&steps, &mut ctx, &executor).await.unwrap();

        assert_eq!(ctx.get("pr"), Some(&serde_json::Value::Null));
    }

    #[tokio::test]
    async fn test_resolve_pick_count() {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([
                {"number": 123, "branch": "feat/42-auth"},
                {"number": 200, "branch": "feat/42-auth"},
            ]),
        );

        let steps = vec![ResolveStep {
            name: "pr_count".to_string(),
            query: "list_prs".to_string(),
            params: HashMap::new(),
            filter: Some("item.branch == agent.git_branch".to_string()),
            pick: PickMode::Count,
        }];

        let mut ctx = base_context();
        resolve_all(&steps, &mut ctx, &executor).await.unwrap();

        assert_eq!(ctx.get("pr_count"), Some(&serde_json::json!(2)));
    }

    #[tokio::test]
    async fn test_resolve_pick_all() {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([
                {"number": 123, "branch": "feat/42-auth"},
                {"number": 200, "branch": "feat/42-auth"},
            ]),
        );

        let steps = vec![ResolveStep {
            name: "prs".to_string(),
            query: "list_prs".to_string(),
            params: HashMap::new(),
            filter: Some("item.branch == agent.git_branch".to_string()),
            pick: PickMode::All,
        }];

        let mut ctx = base_context();
        resolve_all(&steps, &mut ctx, &executor).await.unwrap();

        let prs = ctx.get("prs").unwrap();
        assert!(prs.is_array());
        assert_eq!(prs.as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_resolve_query_failure_binds_null() {
        let executor = MockExecutor::new(); // no responses configured

        let steps = vec![ResolveStep {
            name: "pr".to_string(),
            query: "list_prs".to_string(),
            params: HashMap::new(),
            filter: None,
            pick: PickMode::First,
        }];

        let mut ctx = base_context();
        resolve_all(&steps, &mut ctx, &executor).await.unwrap();

        // Failed query → null
        assert_eq!(ctx.get("pr"), Some(&serde_json::Value::Null));
    }

    #[tokio::test]
    async fn test_resolve_no_filter() {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "get_ci_status".to_string(),
            serde_json::json!({"status": "success", "total_checks": 5}),
        );

        let steps = vec![ResolveStep {
            name: "ci".to_string(),
            query: "get_ci_status".to_string(),
            params: HashMap::from([("branch".to_string(), "{{agent.git_branch}}".to_string())]),
            filter: None,
            pick: PickMode::First,
        }];

        let mut ctx = base_context();
        resolve_all(&steps, &mut ctx, &executor).await.unwrap();

        assert_eq!(ctx.get("ci.status"), Some(&serde_json::json!("success")));
    }

    #[tokio::test]
    async fn test_resolve_sequential_dependency() {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([{"number": 123, "branch": "feat/42-auth"}]),
        );
        executor.query_responses.insert(
            "get_pr_merge_status".to_string(),
            serde_json::json!({"review_decision": "approved", "ci_status": "success"}),
        );

        let steps = vec![
            ResolveStep {
                name: "pr".to_string(),
                query: "list_prs".to_string(),
                params: HashMap::new(),
                filter: Some("item.branch == agent.git_branch".to_string()),
                pick: PickMode::First,
            },
            ResolveStep {
                name: "merge_status".to_string(),
                query: "get_pr_merge_status".to_string(),
                params: HashMap::from([("pr_number".to_string(), "{{pr.number}}".to_string())]),
                filter: None,
                pick: PickMode::First,
            },
        ];

        let mut ctx = base_context();
        resolve_all(&steps, &mut ctx, &executor).await.unwrap();

        // First resolve: pr
        assert_eq!(ctx.get("pr.number"), Some(&serde_json::json!(123)));
        // Second resolve: merge_status (depends on pr.number from first)
        assert_eq!(
            ctx.get("merge_status.review_decision"),
            Some(&serde_json::json!("approved"))
        );
    }

    #[tokio::test]
    async fn test_resolve_pick_last() {
        let mut executor = MockExecutor::new();
        executor.query_responses.insert(
            "list_prs".to_string(),
            serde_json::json!([
                {"number": 100, "branch": "feat/42-auth"},
                {"number": 200, "branch": "feat/42-auth"},
            ]),
        );

        let steps = vec![ResolveStep {
            name: "pr".to_string(),
            query: "list_prs".to_string(),
            params: HashMap::new(),
            filter: Some("item.branch == agent.git_branch".to_string()),
            pick: PickMode::Last,
        }];

        let mut ctx = base_context();
        resolve_all(&steps, &mut ctx, &executor).await.unwrap();

        assert_eq!(ctx.get("pr.number"), Some(&serde_json::json!(200)));
    }
}
