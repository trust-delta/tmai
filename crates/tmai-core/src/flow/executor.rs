//! Executor trait — abstraction over MCP tool calls for resolve and action steps.
//!
//! The real implementation delegates to `github::*` functions and `TmaiCore` methods.
//! Tests use a mock implementation with canned responses.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

/// Abstraction over MCP tool queries (resolve) and actions (route).
///
/// Query names map to tmai MCP tool names (e.g., "list_prs", "get_ci_status").
/// Action names map to route actions (e.g., "send_prompt", "spawn", "merge_pr").
///
/// Both take JSON params and return JSON results.
///
/// Methods return boxed futures for dyn-compatibility (no async_trait dependency).
pub trait FlowExecutor: Send + Sync {
    /// Execute a query (for resolve steps).
    fn query(
        &self,
        name: &str,
        params: &HashMap<String, serde_json::Value>,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send + '_>>;

    /// Execute an action (for route steps).
    fn action(
        &self,
        name: &str,
        params: &HashMap<String, serde_json::Value>,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send + '_>>;
}

/// Mock executor for testing — returns pre-configured responses.
#[cfg(test)]
pub struct MockExecutor {
    /// query name → response
    pub query_responses: HashMap<String, serde_json::Value>,
    /// action name → response
    pub action_responses: HashMap<String, serde_json::Value>,
    /// Recorded action calls for assertion
    pub action_calls: std::sync::Mutex<Vec<(String, HashMap<String, serde_json::Value>)>>,
}

#[cfg(test)]
impl MockExecutor {
    pub fn new() -> Self {
        Self {
            query_responses: HashMap::new(),
            action_responses: HashMap::new(),
            action_calls: std::sync::Mutex::new(Vec::new()),
        }
    }

    /// Get recorded action calls
    pub fn recorded_actions(&self) -> Vec<(String, HashMap<String, serde_json::Value>)> {
        self.action_calls.lock().unwrap().clone()
    }
}

#[cfg(test)]
impl FlowExecutor for MockExecutor {
    fn query(
        &self,
        name: &str,
        _params: &HashMap<String, serde_json::Value>,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send + '_>> {
        let result = self
            .query_responses
            .get(name)
            .cloned()
            .ok_or_else(|| format!("mock: no response for query '{name}'"));
        Box::pin(async move { result })
    }

    fn action(
        &self,
        name: &str,
        params: &HashMap<String, serde_json::Value>,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send + '_>> {
        self.action_calls
            .lock()
            .unwrap()
            .push((name.to_string(), params.clone()));

        let result = self
            .action_responses
            .get(name)
            .cloned()
            .ok_or_else(|| format!("mock: no response for action '{name}'"));
        Box::pin(async move { result })
    }
}
