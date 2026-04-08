//! Type definitions for the node-based flow orchestration system (v2).
//!
//! ## Two node types
//!
//! - **Agent Node**: LLM execution unit with typed input ports (initial/queue)
//!   and hook output ports (stop/error)
//! - **Gate Node** (tmai node): deterministic judgment — 1 resolve + 1 condition → 2 branches
//!
//! ## Typed wires
//!
//! Connections between ports are type-checked:
//! - Agent.stop/error → Gate.input
//! - Gate.then/else (send_message) → Agent.queue
//! - Gate.then/else (spawn_agent) → Agent.initial
//! - Gate.then/else (passthrough) → Gate.input
//! - Gate.then/else (merge_pr etc.) → terminal (no connection)
//!
//! ## Runtime types (reused from v1)
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FlowConfig {
    /// Human-readable description
    #[serde(default)]
    pub description: String,

    /// Parameters required to kick this flow (e.g., ["issue_number"])
    #[serde(default)]
    pub entry_params: Vec<String>,

    /// First agent node to kick when the flow starts
    #[serde(default)]
    pub entry_node: String,

    /// Agent nodes (LLM execution units)
    #[serde(default)]
    pub agents: Vec<AgentNodeConfig>,

    /// Gate nodes (tmai judgment/routing nodes)
    #[serde(default)]
    pub gates: Vec<GateNodeConfig>,

    /// Typed connections between ports
    #[serde(default)]
    pub wires: Vec<Wire>,
}

// ---- Agent Node ----

/// An agent node — LLM execution unit. Always spawned fresh.
///
/// Has two input ports (initial prompt, queue prompt) and
/// hook output ports (stop, error).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentNodeConfig {
    /// Unique node ID within the flow
    pub id: String,

    /// Agent type
    #[serde(default)]
    pub agent_type: AgentTypeName,

    /// Default prompt template for the initial port (supports {{placeholders}})
    #[serde(default)]
    pub prompt_template: String,

    /// MCP tools this agent is allowed to use
    #[serde(default)]
    pub tools: ToolAccess,

    /// Legacy mode field (ignored, kept for config backward compat)
    #[serde(default, skip_serializing)]
    pub mode: Option<String>,
}

impl AgentNodeConfig {
    /// Human-readable agent type string
    pub fn agent_type_str(&self) -> &str {
        match self.agent_type {
            AgentTypeName::Claude => "claude",
            AgentTypeName::Codex => "codex",
            AgentTypeName::Gemini => "gemini",
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

// ---- Gate Node (tmai node) ----

/// A gate node — deterministic judgment with 1 condition and max 2 branches.
///
/// 1 resolve (optional) + 1 condition → then/else actions.
/// Complex logic is built by chaining multiple gates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GateNodeConfig {
    /// Unique node ID within the flow
    pub id: String,

    /// Optional: query to resolve a variable before condition evaluation
    #[serde(default)]
    pub resolve: Option<ResolveStep>,

    /// Condition expression (e.g., "pr != null", "ci.status == 'success'")
    /// If omitted, always takes the `then` branch (unconditional gate).
    #[serde(default = "default_true_condition")]
    pub condition: String,

    /// Action when condition is true (required)
    pub then_action: GateAction,

    /// Action when condition is false (optional — if omitted, no-op on false)
    #[serde(default)]
    pub else_action: Option<GateAction>,
}

fn default_true_condition() -> String {
    "true".to_string()
}

/// A single resolve step — query an MCP tool and bind the result to a variable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResolveStep {
    /// Variable name to bind
    pub name: String,

    /// MCP tool name to call
    pub query: String,

    /// Parameters for the tool call (values support {{placeholders}})
    #[serde(default)]
    pub params: HashMap<String, String>,

    /// Filter expression for list results
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
    #[default]
    First,
    Last,
    Count,
    All,
}

/// Action to execute from a gate's then/else branch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GateAction {
    /// Action type
    pub action: ActionType,

    /// Target node ID (for send_message, spawn_agent, passthrough)
    #[serde(default)]
    pub target: Option<String>,

    /// Prompt template (for send_message, spawn_agent)
    #[serde(default)]
    pub prompt: Option<String>,

    /// Additional parameters (for merge_pr, review_pr, etc.)
    #[serde(default)]
    pub params: HashMap<String, serde_json::Value>,
}

/// Gate output action types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    /// Send a prompt to an existing agent's queue port
    SendMessage,
    /// Spawn a new agent (connects to initial port)
    SpawnAgent,
    /// Merge a PR (terminal action)
    MergePr,
    /// Review a PR (terminal action)
    ReviewPr,
    /// Rerun CI checks (terminal action)
    RerunCi,
    /// Pass context to the next gate (chaining)
    Passthrough,
    /// Do nothing
    Noop,
}

impl ActionType {
    /// Whether this action terminates the flow (no downstream connection)
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::MergePr | Self::ReviewPr | Self::RerunCi | Self::Noop
        )
    }

    /// Whether this action targets an agent node
    pub fn targets_agent(&self) -> bool {
        matches!(self, Self::SendMessage | Self::SpawnAgent)
    }
}

// ---- Wire (typed connection) ----

/// A typed connection between two ports.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Wire {
    /// Source port
    pub from: PortRef,
    /// Destination port
    pub to: PortRef,
}

/// Reference to a specific port on a node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PortRef {
    /// Node ID
    pub node: String,
    /// Port name
    pub port: PortType,
}

/// Port types for agent and gate nodes.
#[derive(Debug, Clone, Hash, Eq, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PortType {
    // Agent input ports
    /// Initial prompt (from spawn_agent)
    Initial,
    /// Queue prompt (from send_message to running agent)
    Queue,

    // Agent output ports
    /// Agent stopped (hook)
    Stop,
    /// Agent error (hook)
    Error,

    // Gate I/O ports
    /// Gate input (from agent hook or previous gate passthrough)
    Input,
    /// Gate output: condition was true
    Then,
    /// Gate output: condition was false
    Else,
}

impl PortType {
    /// Whether this is an output port
    pub fn is_output(&self) -> bool {
        matches!(self, Self::Stop | Self::Error | Self::Then | Self::Else)
    }

    /// Whether this is an input port
    pub fn is_input(&self) -> bool {
        matches!(self, Self::Initial | Self::Queue | Self::Input)
    }
}

// ============================================================
// Runtime types (reused from v1, minimal changes)
// ============================================================

/// One execution instance of a flow definition.
#[derive(Debug, Clone, Serialize)]
pub struct FlowRun {
    /// Unique run identifier
    pub run_id: String,
    /// Flow definition name
    pub flow_name: String,
    /// Human-readable trigger description
    pub trigger: String,
    /// Currently active node ID
    pub current_node: String,
    /// Agent executing the current node (if agent node)
    pub current_agent_id: Option<String>,
    /// Completed steps history
    pub history: Vec<FlowStep>,
    /// Accumulated context variables (propagated across nodes)
    pub context: HashMap<String, serde_json::Value>,
    /// Run status
    pub status: FlowRunStatus,
    /// When this run started
    pub started_at: DateTime<Utc>,
}

/// A completed step in a flow run's history
#[derive(Debug, Clone, Serialize)]
pub struct FlowStep {
    /// Node ID that was executed
    pub node: String,
    /// Agent that executed this step (empty for gate nodes)
    pub agent_id: String,
    /// When this step started
    pub started_at: DateTime<Utc>,
    /// When this step finished
    pub finished_at: Option<DateTime<Utc>>,
    /// Step outcome
    pub outcome: StepOutcome,
    /// Variables resolved during this step
    pub resolved: HashMap<String, serde_json::Value>,
}

/// Outcome of a completed flow step
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StepOutcome {
    Completed,
    Error(String),
}

/// Status of a flow run
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FlowRunStatus {
    Running,
    Completed,
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
            started_at: self.started_at,
            finished_at: Some(Utc::now()),
            outcome: StepOutcome::Completed,
            resolved: resolved.clone(),
        };
        self.history.push(step);
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

/// Variable store for template expansion and condition evaluation.
///
/// Lookup order: resolved (current step) → accumulated (from FlowRun.context) → implicit.
#[derive(Debug, Clone)]
pub struct FlowContext {
    /// Variables from implicit sources (agent snapshot, hook state, etc.)
    pub implicit: HashMap<String, serde_json::Value>,
    /// Variables resolved in the current gate's resolve step
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
    pub fn get(&self, path: &str) -> Option<&serde_json::Value> {
        let (root, rest) = path.split_once('.').unwrap_or((path, ""));

        let root_value = self
            .resolved
            .get(root)
            .or_else(|| self.accumulated.get(root))
            .or_else(|| self.implicit.get(root))?;

        if rest.is_empty() {
            return Some(root_value);
        }

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

/// Result of starting a new flow run
#[derive(Debug, Clone, Serialize)]
pub struct FlowKickResult {
    pub run_id: String,
    pub flow_name: String,
    pub first_node: String,
    pub agent_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- TOML deserialization tests ----

    #[test]
    fn test_flow_config_v2_toml() {
        let toml_str = r#"
[feature]
description = "Issue実装 → レビュー → マージ"
entry_params = ["issue_number"]
entry_node = "impl"

[[feature.agents]]
id = "impl"
agent_type = "claude"
prompt_template = "Resolve #{{issue_number}}"

[[feature.agents]]
id = "review"
agent_type = "claude"

[[feature.agents]]
id = "orch"
mode = "persistent"
tools = "*"

[[feature.gates]]
id = "check_pr"
condition = "pr != null"

[feature.gates.resolve]
name = "pr"
query = "list_prs"
filter = "item.branch == agent.git_branch"

[feature.gates.then_action]
action = "spawn_agent"
target = "review"
prompt = "Review PR #{{pr.number}}"

[feature.gates.else_action]
action = "send_message"
target = "orch"
prompt = "No PR found"

[[feature.wires]]
from = { node = "impl", port = "stop" }
to = { node = "check_pr", port = "input" }

[[feature.wires]]
from = { node = "check_pr", port = "then" }
to = { node = "review", port = "initial" }

[[feature.wires]]
from = { node = "check_pr", port = "else" }
to = { node = "orch", port = "queue" }
"#;

        let flows: HashMap<String, FlowConfig> =
            toml::from_str(toml_str).expect("Failed to parse v2 flow config");

        let f = &flows["feature"];
        assert_eq!(f.entry_node, "impl");
        assert_eq!(f.agents.len(), 3);
        assert_eq!(f.gates.len(), 1);
        assert_eq!(f.wires.len(), 3);

        // Agent
        assert_eq!(f.agents[0].id, "impl");
        assert!(f.agents[2].tools.is_all());

        // Gate
        let gate = &f.gates[0];
        assert_eq!(gate.id, "check_pr");
        assert_eq!(gate.condition, "pr != null");
        assert!(gate.resolve.is_some());
        assert_eq!(gate.then_action.action, ActionType::SpawnAgent);
        assert_eq!(gate.then_action.target.as_deref(), Some("review"));
        assert!(gate.else_action.is_some());

        // Wires
        assert_eq!(f.wires[0].from.node, "impl");
        assert_eq!(f.wires[0].from.port, PortType::Stop);
        assert_eq!(f.wires[0].to.node, "check_pr");
        assert_eq!(f.wires[0].to.port, PortType::Input);
    }

    #[test]
    fn test_minimal_flow() {
        let toml_str = r#"
[simple]
entry_node = "worker"

[[simple.agents]]
id = "worker"

[[simple.gates]]
id = "done"
condition = "true"

[simple.gates.then_action]
action = "noop"

[[simple.wires]]
from = { node = "worker", port = "stop" }
to = { node = "done", port = "input" }
"#;

        let flows: HashMap<String, FlowConfig> =
            toml::from_str(toml_str).expect("Failed to parse minimal flow");

        let f = &flows["simple"];
        assert_eq!(f.agents[0].agent_type, AgentTypeName::Claude);
        assert_eq!(f.gates[0].then_action.action, ActionType::Noop);
    }

    #[test]
    fn test_gate_chain_toml() {
        let toml_str = r#"
[chain]
entry_node = "impl"

[[chain.agents]]
id = "impl"

[[chain.agents]]
id = "orch"
mode = "persistent"

[[chain.gates]]
id = "check_pr"
condition = "pr != null"

[chain.gates.then_action]
action = "passthrough"
target = "check_ci"

[chain.gates.else_action]
action = "send_message"
target = "orch"
prompt = "No PR"

[[chain.gates]]
id = "check_ci"
condition = "ci.status == 'success'"

[chain.gates.then_action]
action = "merge_pr"

[chain.gates.then_action.params]
method = "squash"

[chain.gates.else_action]
action = "send_message"
target = "orch"
prompt = "CI failed"

[[chain.wires]]
from = { node = "impl", port = "stop" }
to = { node = "check_pr", port = "input" }

[[chain.wires]]
from = { node = "check_pr", port = "then" }
to = { node = "check_ci", port = "input" }

[[chain.wires]]
from = { node = "check_pr", port = "else" }
to = { node = "orch", port = "queue" }

[[chain.wires]]
from = { node = "check_ci", port = "else" }
to = { node = "orch", port = "queue" }
"#;

        let flows: HashMap<String, FlowConfig> =
            toml::from_str(toml_str).expect("Failed to parse gate chain");

        let f = &flows["chain"];
        assert_eq!(f.gates.len(), 2);
        assert_eq!(f.gates[0].then_action.action, ActionType::Passthrough);
        assert_eq!(f.gates[1].then_action.action, ActionType::MergePr);
        assert_eq!(f.wires.len(), 4);
    }

    #[test]
    fn test_action_type_properties() {
        assert!(ActionType::MergePr.is_terminal());
        assert!(ActionType::ReviewPr.is_terminal());
        assert!(ActionType::Noop.is_terminal());
        assert!(!ActionType::SendMessage.is_terminal());
        assert!(!ActionType::SpawnAgent.is_terminal());
        assert!(!ActionType::Passthrough.is_terminal());

        assert!(ActionType::SendMessage.targets_agent());
        assert!(ActionType::SpawnAgent.targets_agent());
        assert!(!ActionType::Passthrough.targets_agent());
        assert!(!ActionType::MergePr.targets_agent());
    }

    #[test]
    fn test_port_type_properties() {
        assert!(PortType::Stop.is_output());
        assert!(PortType::Then.is_output());
        assert!(!PortType::Initial.is_output());

        assert!(PortType::Initial.is_input());
        assert!(PortType::Queue.is_input());
        assert!(PortType::Input.is_input());
        assert!(!PortType::Stop.is_input());
    }

    #[test]
    fn test_settings_integration() {
        let toml_str = r#"
poll_interval_ms = 500

[flow.test]
entry_node = "worker"

[[flow.test.agents]]
id = "worker"

[[flow.test.gates]]
id = "gate1"

[flow.test.gates.then_action]
action = "noop"

[[flow.test.wires]]
from = { node = "worker", port = "stop" }
to = { node = "gate1", port = "input" }
"#;
        let settings: crate::config::Settings =
            toml::from_str(toml_str).expect("Failed to parse settings with v2 flow");

        assert_eq!(settings.flow.len(), 1);
        let f = &settings.flow["test"];
        assert_eq!(f.agents.len(), 1);
        assert_eq!(f.gates.len(), 1);
    }

    // ---- FlowContext tests (unchanged from v1) ----

    #[test]
    fn test_flow_context_lookup_order() {
        let mut ctx = FlowContext::new(HashMap::from([(
            "agent".to_string(),
            serde_json::json!({"git_branch": "feat/42"}),
        )]));

        assert_eq!(
            ctx.get("agent.git_branch"),
            Some(&serde_json::json!("feat/42"))
        );

        ctx.accumulated
            .insert("pr".to_string(), serde_json::json!({"number": 123}));
        assert_eq!(ctx.get("pr.number"), Some(&serde_json::json!(123)));

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
    fn test_flow_run_lifecycle() {
        let mut run = FlowRun::new(
            "run-abc".to_string(),
            "feature".to_string(),
            "issue #42".to_string(),
            "impl".to_string(),
        );

        assert!(run.is_running());
        assert_eq!(run.current_node, "impl");

        let resolved = HashMap::from([("pr".to_string(), serde_json::json!({"number": 123}))]);
        run.advance("agent-1".to_string(), "check_pr".to_string(), resolved);

        assert_eq!(run.current_node, "check_pr");
        assert_eq!(run.steps_completed(), 1);
        assert_eq!(
            run.context.get("pr"),
            Some(&serde_json::json!({"number": 123}))
        );

        run.complete("".to_string(), HashMap::new());
        assert!(!run.is_running());
    }
}
