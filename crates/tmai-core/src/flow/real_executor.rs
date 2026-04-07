//! Real FlowExecutor implementation — delegates to github::* and TmaiCore.
//!
//! This is the production implementation used when the flow engine runs in main.rs.
//! It maps MCP tool names to actual function calls.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use tracing::{debug, warn};

use super::executor::FlowExecutor;
use crate::github;

/// Callback type for action execution (spawn, send_prompt, merge, etc.)
pub type ActionHandler = Arc<
    dyn Fn(
            String,
            HashMap<String, serde_json::Value>,
        ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send>>
        + Send
        + Sync,
>;

/// Real executor backed by github functions and a spawn callback.
///
/// Query operations call `github::*` directly.
/// Action operations are delegated to a callback that has access to
/// the full web/API context (TmaiCore, CommandSender, etc.).
pub struct RealFlowExecutor {
    /// Default repo directory for github operations
    default_repo: String,
    /// Callback for action execution
    action_handler: ActionHandler,
}

impl RealFlowExecutor {
    /// Create a new real executor.
    ///
    /// `default_repo` is used as fallback when query params don't specify a repo.
    /// `action_handler` receives (action_name, params) and should execute the
    /// corresponding MCP tool action (spawn_worktree, send_prompt, merge_pr, etc.).
    pub fn new<F>(default_repo: String, action_handler: F) -> Self
    where
        F: Fn(
                String,
                HashMap<String, serde_json::Value>,
            )
                -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send>>
            + Send
            + Sync
            + 'static,
    {
        Self {
            default_repo,
            action_handler: Arc::new(action_handler),
        }
    }

    /// Extract repo dir from params, falling back to default
    fn repo_dir(&self, params: &HashMap<String, serde_json::Value>) -> String {
        params
            .get("repo")
            .and_then(|v| v.as_str())
            .unwrap_or(&self.default_repo)
            .to_string()
    }
}

impl FlowExecutor for RealFlowExecutor {
    fn query(
        &self,
        name: &str,
        params: &HashMap<String, serde_json::Value>,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send + '_>> {
        let name = name.to_string();
        let repo_dir = self.repo_dir(params);
        let branch = params
            .get("branch")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let pr_number = params
            .get("pr_number")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| params.get("pr_number").and_then(|v| v.as_u64()));

        Box::pin(async move {
            match name.as_str() {
                "list_prs" => {
                    let prs = github::list_open_prs(&repo_dir)
                        .await
                        .ok_or("failed to list PRs")?;
                    // Convert HashMap<String, PrInfo> to Vec<PrInfo> for filtering
                    let pr_list: Vec<_> = prs.into_values().collect();
                    serde_json::to_value(pr_list).map_err(|e| e.to_string())
                }
                "get_ci_status" => {
                    let ci = github::list_checks(&repo_dir, &branch)
                        .await
                        .ok_or("failed to get CI status")?;
                    serde_json::to_value(ci).map_err(|e| e.to_string())
                }
                "get_pr_merge_status" => {
                    let pr_num = pr_number.ok_or("pr_number required")?;
                    let status = github::get_pr_merge_status(&repo_dir, pr_num)
                        .await
                        .ok_or("failed to get merge status")?;
                    serde_json::to_value(status).map_err(|e| e.to_string())
                }
                other => {
                    warn!(query = %other, "Unknown flow query, returning null");
                    Ok(serde_json::Value::Null)
                }
            }
        })
    }

    fn action(
        &self,
        name: &str,
        params: &HashMap<String, serde_json::Value>,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send + '_>> {
        let name = name.to_string();
        let params = params.clone();
        let handler = self.action_handler.clone();

        debug!(action = %name, "Executing flow action");

        Box::pin(async move { (handler)(name, params).await })
    }
}
