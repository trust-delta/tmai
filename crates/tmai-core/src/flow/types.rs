//! Type definitions for the node-based flow orchestration system.
//!
//! ## Config types (deserialized from config.toml)
//!
//! - `FlowConfig` — a named flow definition with nodes and edges
//! - `FlowNodeConfig` — agent role within a flow
//! - `FlowEdgeConfig` — stop-to-kick connection between nodes
//! - `ResolveStepConfig` — MCP tool query → variable binding
//! - `RouteStepConfig` — conditional branch → action execution
//!
//! ## Runtime types (in-memory execution state)
//!
//! - `FlowRun` — one execution instance of a flow definition
//! - `FlowStep` — completed step in a flow run's history
//! - `FlowContext` — variable store for template expansion and condition evaluation

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ============================================================
// Config types (from config.toml)
// ============================================================

/// A named flow definition.
///
/// Corresponds to `[flow.<name>]` in config.toml.
/// The flow name is the key in the `HashMap<String, FlowConfig>` on Settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowConfig {
    /// Human-readable description (shown in UI and orchestrator prompt)
    #[serde(default)]
    pub description: String,

    /// Parameters required to kick this flow (e.g., ["issue_number"])
    #[serde(default)]
    pub entry_params: Vec<String>,

    /// Node definitions within this flow
    #[serde(default)]
    pub nodes: Vec<FlowNodeConfig>,

    /// Edge definitions (stop-to-kick connections)
    #[serde(default)]
    pub edges: Vec<FlowEdgeConfig>,
}

/// An agent role within a flow.
///
/// Corresponds to `[[flow.<name>.nodes]]` in config.toml.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowNodeConfig {
    /// Role name, referenced by edges' `from` and `target` fields
    pub role: String,

    /// Lifecycle mode: spawn a new agent per trigger, or reuse a persistent one
    #[serde(default)]
    pub mode: NodeMode,

    /// Initial prompt template for this role (supports `{{placeholders}}`)
    #[serde(default)]
    pub prompt_template: String,

    /// MCP tools this role is allowed to use
    #[serde(default)]
    pub tools: ToolAccess,

    /// Agent type (defaults to "claude")
    #[serde(default)]
    pub agent_type: AgentTypeName,
}

/// Node lifecycle mode
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeMode {
    /// Spawn a new worktree agent per trigger; can be killed after completion
    #[default]
    Spawn,
    /// Reuse a single persistent agent; queue prompts when busy
    Persistent,
}

/// MCP tool access control for a node
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ToolAccess {
    /// Wildcard: all tools allowed (serialized as `"*"`)
    All(AllTools),
    /// Explicit list of allowed tool names
    List(Vec<String>),
}

/// Marker for `tools = "*"` (all tools)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AllTools(#[serde(deserialize_with = "deserialize_star")] pub String);

/// Deserialize only the literal `"*"`
fn deserialize_star<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    if s == "*" {
        Ok(s)
    } else {
        Err(serde::de::Error::custom(
            "expected \"*\" for all-tools access",
        ))
    }
}

impl Default for ToolAccess {
    fn default() -> Self {
        Self::List(Vec::new())
    }
}

impl ToolAccess {
    /// Check if all tools are allowed
    pub fn is_all(&self) -> bool {
        matches!(self, Self::All(_))
    }

    /// Check if a specific tool is allowed
    pub fn allows(&self, tool_name: &str) -> bool {
        match self {
            Self::All(_) => true,
            Self::List(list) => list.iter().any(|t| t == tool_name),
        }
    }
}

/// Agent type name (for multi-vendor support)
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentTypeName {
    #[default]
    Claude,
    Codex,
    Gemini,
}

/// A stop-to-kick edge connecting two nodes.
///
/// Corresponds to `[[flow.<name>.edges]]` in config.toml.
/// Contains resolve steps (context queries) and route steps (conditional actions).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowEdgeConfig {
    /// Source node role name
    pub from: String,

    /// Trigger event type (default: "stop")
    #[serde(default = "default_event_stop")]
    pub event: String,

    /// Resolve steps: MCP tool queries that bind context variables.
    /// Executed sequentially (later resolves can reference earlier results).
    #[serde(default)]
    pub resolve: Vec<ResolveStepConfig>,

    /// Route steps: conditional branches evaluated top-to-bottom.
    /// First matching route's action is executed.
    #[serde(default)]
    pub route: Vec<RouteStepConfig>,
}

fn default_event_stop() -> String {
    "stop".to_string()
}

/// A resolve step that queries an MCP tool and binds the result to a variable.
///
/// Corresponds to `[[flow.<name>.edges.resolve]]` in config.toml.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResolveStepConfig {
    /// Variable name to bind the result to
    pub name: String,

    /// MCP tool name to call (e.g., "list_prs", "get_ci_status")
    pub query: String,

    /// Parameters for the MCP tool call (values support `{{placeholders}}`)
    #[serde(default)]
    pub params: HashMap<String, String>,

    /// Filter expression for list results (e.g., "item.branch == agent.git_branch")
    #[serde(default)]
    pub filter: Option<String>,

    /// How to pick from filtered results
    #[serde(default)]
    pub pick: PickMode,
}

/// How to select results after filtering
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PickMode {
    /// First element, or null if empty
    #[default]
    First,
    /// Last element, or null if empty
    Last,
    /// Count of matching elements (number)
    Count,
    /// All matching elements (array)
    All,
}

/// A conditional route that maps a condition to an action.
///
/// Corresponds to `[[flow.<name>.edges.route]]` in config.toml.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RouteStepConfig {
    /// Condition expression (e.g., "pr != null", "ci.status == 'success'")
    /// Use "true" for catch-all default.
    #[serde(rename = "when")]
    pub condition: String,

    /// Action to execute: MCP tool name or builtin
    /// (send_prompt, spawn, merge_pr, review_pr, rerun_ci, kill, noop)
    pub action: String,

    /// Target node role name (required for send_prompt, spawn)
    #[serde(default)]
    pub target: Option<String>,

    /// Prompt template for send_prompt/spawn actions (supports `{{placeholders}}`)
    #[serde(default)]
    pub prompt: Option<String>,

    /// Additional action parameters (supports `{{placeholders}}` in string values)
    #[serde(default)]
    pub params: HashMap<String, serde_json::Value>,
}

// ============================================================
// Runtime types (in-memory execution state)
// ============================================================

/// One execution instance of a flow definition.
///
/// Tracks progress through nodes, accumulates context variables across edges,
/// and provides state for orchestrator prompt injection.
#[derive(Debug, Clone, Serialize)]
pub struct FlowRun {
    /// Unique run identifier (short hash)
    pub run_id: String,

    /// Flow definition name (e.g., "feature")
    pub flow_name: String,

    /// Human-readable trigger description (e.g., "issue #42")
    pub trigger: String,

    /// Currently active node role
    pub current_node: String,

    /// Agent executing the current node (if spawned/assigned)
    pub current_agent_id: Option<String>,

    /// Completed steps history
    pub history: Vec<FlowStep>,

    /// Accumulated context variables (propagated across edges)
    pub context: HashMap<String, serde_json::Value>,

    /// Run status
    pub status: FlowRunStatus,

    /// When this run started
    pub started_at: DateTime<Utc>,
}

/// A completed step in a flow run's history
#[derive(Debug, Clone, Serialize)]
pub struct FlowStep {
    /// Node role that was executed
    pub node: String,

    /// Agent that executed this step
    pub agent_id: String,

    /// When this step started
    pub started_at: DateTime<Utc>,

    /// When this step finished (None if still running)
    pub finished_at: Option<DateTime<Utc>>,

    /// Step outcome
    pub outcome: StepOutcome,

    /// Variables resolved during this step's edge evaluation
    pub resolved: HashMap<String, serde_json::Value>,
}

/// Outcome of a completed flow step
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StepOutcome {
    /// Step completed successfully
    Completed,
    /// Step encountered an error
    Error(String),
}

/// Status of a flow run
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FlowRunStatus {
    /// Flow is actively running (some node is executing)
    Running,
    /// Flow completed all steps successfully
    Completed,
    /// Flow terminated due to an error
    Error(String),
}

impl FlowRun {
    /// Create a new flow run
    pub fn new(run_id: String, flow_name: String, trigger: String, first_node: String) -> Self {
        Self {
            run_id,
            flow_name,
            trigger,
            current_node: first_node,
            current_agent_id: None,
            history: Vec::new(),
            context: HashMap::new(),
            status: FlowRunStatus::Running,
            started_at: Utc::now(),
        }
    }

    /// Record completion of the current step and advance to the next node
    pub fn advance(
        &mut self,
        agent_id: String,
        next_node: String,
        resolved: HashMap<String, serde_json::Value>,
    ) {
        let step = FlowStep {
            node: self.current_node.clone(),
            agent_id,
            started_at: self.started_at, // TODO: track per-step start
            finished_at: Some(Utc::now()),
            outcome: StepOutcome::Completed,
            resolved: resolved.clone(),
        };
        self.history.push(step);

        // Merge resolved variables into accumulated context
        for (k, v) in resolved {
            self.context.insert(k, v);
        }

        self.current_node = next_node;
        self.current_agent_id = None;
    }

    /// Mark the run as completed
    pub fn complete(&mut self, agent_id: String, resolved: HashMap<String, serde_json::Value>) {
        let step = FlowStep {
            node: self.current_node.clone(),
            agent_id,
            started_at: self.started_at,
            finished_at: Some(Utc::now()),
            outcome: StepOutcome::Completed,
            resolved,
        };
        self.history.push(step);
        self.status = FlowRunStatus::Completed;
    }

    /// Mark the run as errored
    pub fn fail(&mut self, message: String) {
        self.status = FlowRunStatus::Error(message);
    }

    /// Total number of completed steps
    pub fn steps_completed(&self) -> usize {
        self.history.len()
    }

    /// Check if this run is still active
    pub fn is_running(&self) -> bool {
        self.status == FlowRunStatus::Running
    }
}

/// Variable store for template expansion and condition evaluation within an edge pipeline.
///
/// Lookup order: resolved (current step) → accumulated (from FlowRun.context) → implicit (agent/hook/event/run).
#[derive(Debug, Clone)]
pub struct FlowContext {
    /// Variables from implicit sources (agent snapshot, hook state, event payload, run metadata)
    pub implicit: HashMap<String, serde_json::Value>,

    /// Variables resolved in the current edge's resolve steps
    pub resolved: HashMap<String, serde_json::Value>,

    /// Variables accumulated from previous steps (FlowRun.context)
    pub accumulated: HashMap<String, serde_json::Value>,
}

impl FlowContext {
    /// Create a new context with implicit variables
    pub fn new(implicit: HashMap<String, serde_json::Value>) -> Self {
        Self {
            implicit,
            resolved: HashMap::new(),
            accumulated: HashMap::new(),
        }
    }

    /// Create a context with both implicit and accumulated variables
    pub fn with_accumulated(
        implicit: HashMap<String, serde_json::Value>,
        accumulated: HashMap<String, serde_json::Value>,
    ) -> Self {
        Self {
            implicit,
            resolved: HashMap::new(),
            accumulated,
        }
    }

    /// Set a resolved variable
    pub fn set(&mut self, name: String, value: serde_json::Value) {
        self.resolved.insert(name, value);
    }

    /// Get a value by dot-path (e.g., "pr.number", "agent.git_branch").
    ///
    /// Lookup order: resolved → accumulated → implicit.
    pub fn get(&self, path: &str) -> Option<&serde_json::Value> {
        let (root, rest) = path.split_once('.').unwrap_or((path, ""));

        // Search in order: resolved → accumulated → implicit
        let root_value = self
            .resolved
            .get(root)
            .or_else(|| self.accumulated.get(root))
            .or_else(|| self.implicit.get(root))?;

        if rest.is_empty() {
            return Some(root_value);
        }

        // Navigate nested JSON with remaining path segments
        let mut current = root_value;
        for segment in rest.split('.') {
            current = current.get(segment)?;
        }
        Some(current)
    }

    /// Collect all resolved variables (for committing to FlowRun.context)
    pub fn drain_resolved(&mut self) -> HashMap<String, serde_json::Value> {
        std::mem::take(&mut self.resolved)
    }
}

// ============================================================
// FlowEngine handle types
// ============================================================

/// Result of starting a new flow run
#[derive(Debug, Clone, Serialize)]
pub struct FlowKickResult {
    /// Unique run ID
    pub run_id: String,
    /// Flow definition name
    pub flow_name: String,
    /// First node that was kicked
    pub first_node: String,
    /// Agent ID of the first node's agent
    pub agent_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- TOML deserialization tests ----

    /// Test that a complete flow config round-trips through TOML
    #[test]
    fn test_flow_config_toml_roundtrip() {
        let toml_str = r#"
[feature]
description = "Issue実装 → レビュー → マージ"
entry_params = ["issue_number"]

[[feature.nodes]]
role = "implement"
mode = "spawn"
prompt_template = "Resolve #{{issue_number}}"
tools = ["list_agents", "get_ci_status"]
agent_type = "claude"

[[feature.nodes]]
role = "orchestrator"
mode = "persistent"
tools = "*"

[[feature.edges]]
from = "implement"
event = "stop"

[[feature.edges.resolve]]
name = "pr"
query = "list_prs"
filter = "item.branch == agent.git_branch"
pick = "first"

[feature.edges.resolve.params]
repo = "{{agent.cwd}}"

[[feature.edges.route]]
when = "pr != null"
action = "spawn"
target = "review"
prompt = "PR #{{pr.number}} をレビューしてください"

[[feature.edges.route]]
when = "pr == null"
action = "send_prompt"
target = "orchestrator"
prompt = "PR未作成。確認してください。"
"#;

        let flows: HashMap<String, FlowConfig> =
            toml::from_str(toml_str).expect("Failed to parse flow config TOML");

        assert!(flows.contains_key("feature"));
        let feature = &flows["feature"];
        assert_eq!(feature.description, "Issue実装 → レビュー → マージ");
        assert_eq!(feature.entry_params, vec!["issue_number"]);

        // Nodes
        assert_eq!(feature.nodes.len(), 2);
        assert_eq!(feature.nodes[0].role, "implement");
        assert_eq!(feature.nodes[0].mode, NodeMode::Spawn);
        assert!(matches!(feature.nodes[0].tools, ToolAccess::List(ref l) if l.len() == 2));

        assert_eq!(feature.nodes[1].role, "orchestrator");
        assert_eq!(feature.nodes[1].mode, NodeMode::Persistent);
        assert!(feature.nodes[1].tools.is_all());

        // Edges
        assert_eq!(feature.edges.len(), 1);
        let edge = &feature.edges[0];
        assert_eq!(edge.from, "implement");
        assert_eq!(edge.event, "stop");

        // Resolve
        assert_eq!(edge.resolve.len(), 1);
        assert_eq!(edge.resolve[0].name, "pr");
        assert_eq!(edge.resolve[0].query, "list_prs");
        assert_eq!(
            edge.resolve[0].filter.as_deref(),
            Some("item.branch == agent.git_branch")
        );
        assert_eq!(edge.resolve[0].pick, PickMode::First);
        assert_eq!(edge.resolve[0].params.get("repo").unwrap(), "{{agent.cwd}}");

        // Routes
        assert_eq!(edge.route.len(), 2);
        assert_eq!(edge.route[0].condition, "pr != null");
        assert_eq!(edge.route[0].action, "spawn");
        assert_eq!(edge.route[0].target.as_deref(), Some("review"));
        assert_eq!(edge.route[1].condition, "pr == null");
        assert_eq!(edge.route[1].action, "send_prompt");
    }

    /// Test minimal flow config (most fields optional)
    #[test]
    fn test_minimal_flow_config() {
        let toml_str = r#"
[simple]
description = "Simple flow"

[[simple.nodes]]
role = "worker"

[[simple.edges]]
from = "worker"

[[simple.edges.route]]
when = "true"
action = "noop"
"#;
        let flows: HashMap<String, FlowConfig> =
            toml::from_str(toml_str).expect("Failed to parse minimal flow config");

        let simple = &flows["simple"];
        assert_eq!(simple.nodes.len(), 1);
        assert_eq!(simple.nodes[0].mode, NodeMode::Spawn); // default
        assert_eq!(simple.nodes[0].agent_type, AgentTypeName::Claude); // default

        assert_eq!(simple.edges[0].event, "stop"); // default
        assert!(simple.edges[0].resolve.is_empty()); // no resolve steps
    }

    /// Test multi-flow config
    #[test]
    fn test_multi_flow_config() {
        let toml_str = r#"
[feature]
description = "Feature flow"
entry_params = ["issue_number"]

[[feature.nodes]]
role = "implement"

[[feature.edges]]
from = "implement"

[[feature.edges.route]]
when = "true"
action = "noop"

[hotfix]
description = "Hotfix flow"
entry_params = ["issue_number"]

[[hotfix.nodes]]
role = "implement"

[[hotfix.edges]]
from = "implement"

[[hotfix.edges.route]]
when = "true"
action = "merge_pr"

[hotfix.edges.route.params]
method = "squash"
"#;
        let flows: HashMap<String, FlowConfig> =
            toml::from_str(toml_str).expect("Failed to parse multi-flow config");

        assert_eq!(flows.len(), 2);
        assert!(flows.contains_key("feature"));
        assert!(flows.contains_key("hotfix"));

        let hotfix_route = &flows["hotfix"].edges[0].route[0];
        assert_eq!(hotfix_route.action, "merge_pr");
        assert_eq!(
            hotfix_route.params.get("method"),
            Some(&serde_json::Value::String("squash".to_string()))
        );
    }

    /// Test route params with template placeholders
    #[test]
    fn test_route_params_with_templates() {
        let toml_str = r#"
[merge_flow]
description = "Auto-merge"

[[merge_flow.nodes]]
role = "worker"

[[merge_flow.edges]]
from = "worker"

[[merge_flow.edges.route]]
when = "true"
action = "merge_pr"

[merge_flow.edges.route.params]
pr_number = "{{pr.number}}"
method = "squash"
delete_worktree = true
"#;
        let flows: HashMap<String, FlowConfig> = toml::from_str(toml_str).expect("Failed to parse");

        let params = &flows["merge_flow"].edges[0].route[0].params;
        assert_eq!(
            params.get("pr_number"),
            Some(&serde_json::Value::String("{{pr.number}}".to_string()))
        );
        assert_eq!(
            params.get("delete_worktree"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    // ---- FlowContext tests ----

    #[test]
    fn test_flow_context_lookup_order() {
        let mut ctx = FlowContext::new(HashMap::from([(
            "agent".to_string(),
            serde_json::json!({"git_branch": "feat/42"}),
        )]));

        // Implicit lookup
        assert_eq!(
            ctx.get("agent.git_branch"),
            Some(&serde_json::json!("feat/42"))
        );

        // Add accumulated (from prior step)
        ctx.accumulated
            .insert("pr".to_string(), serde_json::json!({"number": 123}));
        assert_eq!(ctx.get("pr.number"), Some(&serde_json::json!(123)));

        // Resolved takes precedence over accumulated
        ctx.set("pr".to_string(), serde_json::json!({"number": 456}));
        assert_eq!(ctx.get("pr.number"), Some(&serde_json::json!(456)));
    }

    #[test]
    fn test_flow_context_missing_path() {
        let ctx = FlowContext::new(HashMap::new());
        assert_eq!(ctx.get("nonexistent"), None);
        assert_eq!(ctx.get("agent.foo.bar"), None);
    }

    #[test]
    fn test_flow_context_drain_resolved() {
        let mut ctx = FlowContext::new(HashMap::new());
        ctx.set("pr".to_string(), serde_json::json!({"number": 123}));
        ctx.set("ci".to_string(), serde_json::json!({"status": "success"}));

        let drained = ctx.drain_resolved();
        assert_eq!(drained.len(), 2);
        assert!(ctx.resolved.is_empty());
    }

    // ---- FlowRun tests ----

    #[test]
    fn test_flow_run_lifecycle() {
        let mut run = FlowRun::new(
            "run-abc".to_string(),
            "feature".to_string(),
            "issue #42".to_string(),
            "implement".to_string(),
        );

        assert!(run.is_running());
        assert_eq!(run.current_node, "implement");
        assert_eq!(run.steps_completed(), 0);

        // Advance from implement to review
        let resolved = HashMap::from([("pr".to_string(), serde_json::json!({"number": 123}))]);
        run.advance("agent-1".to_string(), "review".to_string(), resolved);

        assert_eq!(run.current_node, "review");
        assert_eq!(run.steps_completed(), 1);
        assert!(run.is_running());
        // Context should have pr accumulated
        assert_eq!(
            run.context.get("pr"),
            Some(&serde_json::json!({"number": 123}))
        );

        // Complete the flow
        run.complete("agent-2".to_string(), HashMap::new());
        assert!(!run.is_running());
        assert_eq!(run.steps_completed(), 2);
    }

    #[test]
    fn test_flow_run_fail() {
        let mut run = FlowRun::new(
            "run-xyz".to_string(),
            "feature".to_string(),
            "issue #99".to_string(),
            "implement".to_string(),
        );

        run.fail("Resolve failed: API timeout".to_string());
        assert!(!run.is_running());
        assert!(matches!(run.status, FlowRunStatus::Error(ref msg) if msg.contains("API timeout")));
    }

    // ---- ToolAccess tests ----

    #[test]
    fn test_tool_access_allows() {
        let all = ToolAccess::All(AllTools("*".to_string()));
        assert!(all.allows("anything"));
        assert!(all.is_all());

        let list = ToolAccess::List(vec!["list_agents".to_string(), "approve".to_string()]);
        assert!(list.allows("list_agents"));
        assert!(list.allows("approve"));
        assert!(!list.allows("kill_agent"));
        assert!(!list.is_all());
    }

    // ---- Settings integration test ----

    /// Test that flow config is correctly parsed as part of full Settings TOML
    #[test]
    fn test_flow_in_settings_toml() {
        let toml_str = r#"
poll_interval_ms = 500

[flow.feature]
description = "Feature development"
entry_params = ["issue_number"]

[[flow.feature.nodes]]
role = "implement"
mode = "spawn"
prompt_template = "Fix #{{issue_number}}"

[[flow.feature.nodes]]
role = "orchestrator"
mode = "persistent"
tools = "*"

[[flow.feature.edges]]
from = "implement"

[[flow.feature.edges.resolve]]
name = "pr"
query = "list_prs"
filter = "item.branch == agent.git_branch"

[[flow.feature.edges.route]]
when = "pr != null"
action = "spawn"
target = "review"
prompt = "Review PR #{{pr.number}}"

[[flow.feature.edges.route]]
when = "true"
action = "send_prompt"
target = "orchestrator"
prompt = "No PR found"

[flow.hotfix]
description = "Quick hotfix"

[[flow.hotfix.nodes]]
role = "implement"

[[flow.hotfix.edges]]
from = "implement"

[[flow.hotfix.edges.route]]
when = "true"
action = "noop"
"#;
        let settings: crate::config::Settings =
            toml::from_str(toml_str).expect("Failed to parse settings with flow config");

        assert_eq!(settings.flow.len(), 2);

        let feature = &settings.flow["feature"];
        assert_eq!(feature.description, "Feature development");
        assert_eq!(feature.nodes.len(), 2);
        assert_eq!(feature.edges.len(), 1);
        assert_eq!(feature.edges[0].resolve.len(), 1);
        assert_eq!(feature.edges[0].route.len(), 2);

        let hotfix = &settings.flow["hotfix"];
        assert_eq!(hotfix.description, "Quick hotfix");
        assert_eq!(hotfix.nodes.len(), 1);
    }

    /// Test that empty flow config (no [flow] section) works
    #[test]
    fn test_settings_without_flow() {
        let toml_str = r#"
poll_interval_ms = 500
"#;
        let settings: crate::config::Settings =
            toml::from_str(toml_str).expect("Failed to parse settings without flow");

        assert!(settings.flow.is_empty());
    }
}
