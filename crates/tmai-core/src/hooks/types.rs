//! Hook event types for Claude Code HTTP hook integration.
//!
//! Defines the payload structure received from Claude Code hooks
//! and the internal state tracked per agent.

use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};

/// Hook event name — typed enum replacing stringly-typed constants.
///
/// Variant names match the PascalCase wire format sent by Claude Code,
/// so serde default (de)serialization works without `rename_all`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HookEventName {
    SessionStart,
    UserPromptSubmit,
    PreToolUse,
    PostToolUse,
    PostToolUseFailure,
    Notification,
    PermissionRequest,
    PermissionDenied,
    Stop,
    SubagentStart,
    SubagentStop,
    TeammateIdle,
    TaskCreated,
    TaskCompleted,
    SessionEnd,
    ConfigChange,
    WorktreeCreate,
    WorktreeRemove,
    PreCompact,
    InstructionsLoaded,
}

impl fmt::Display for HookEventName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SessionStart => write!(f, "SessionStart"),
            Self::UserPromptSubmit => write!(f, "UserPromptSubmit"),
            Self::PreToolUse => write!(f, "PreToolUse"),
            Self::PostToolUse => write!(f, "PostToolUse"),
            Self::PostToolUseFailure => write!(f, "PostToolUseFailure"),
            Self::Notification => write!(f, "Notification"),
            Self::PermissionRequest => write!(f, "PermissionRequest"),
            Self::PermissionDenied => write!(f, "PermissionDenied"),
            Self::Stop => write!(f, "Stop"),
            Self::SubagentStart => write!(f, "SubagentStart"),
            Self::SubagentStop => write!(f, "SubagentStop"),
            Self::TeammateIdle => write!(f, "TeammateIdle"),
            Self::TaskCreated => write!(f, "TaskCreated"),
            Self::TaskCompleted => write!(f, "TaskCompleted"),
            Self::SessionEnd => write!(f, "SessionEnd"),
            Self::ConfigChange => write!(f, "ConfigChange"),
            Self::WorktreeCreate => write!(f, "WorktreeCreate"),
            Self::WorktreeRemove => write!(f, "WorktreeRemove"),
            Self::PreCompact => write!(f, "PreCompact"),
            Self::InstructionsLoaded => write!(f, "InstructionsLoaded"),
        }
    }
}

/// Permission mode reported by Claude Code in hook payloads.
///
/// Maps to the session's current permission level (e.g., "default", "plan",
/// "dontAsk", "acceptEdits").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    /// Normal interactive mode — prompts for each tool use
    Default,
    /// Plan mode — requires plan approval before execution
    Plan,
    /// Auto-approve all tool uses without prompting
    DontAsk,
    /// Auto-approve file edits only (introduced in Claude Code 2.1.x)
    AcceptEdits,
}

/// Notification type for the Notification hook event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationType {
    /// Agent is waiting for a permission prompt response
    PermissionPrompt,
    /// Agent is idle and waiting for user prompt (added in later Claude Code versions)
    IdlePrompt,
}

/// Worktree information attached to hook events in `--worktree` sessions
///
/// Contains name, path, branch, and the original repo directory.
/// Added in Claude Code v2.1.69.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(export, export_to = "../../tmai-app/web/src/types/generated/")
)]
pub struct WorktreeInfo {
    /// Worktree name (e.g., "feat-auth")
    #[serde(default)]
    pub name: Option<String>,
    /// Worktree filesystem path
    #[serde(default)]
    pub path: Option<String>,
    /// Branch checked out in the worktree
    #[serde(default)]
    pub branch: Option<String>,
    /// Original (main) repository directory
    #[serde(default)]
    pub original_repo: Option<String>,
}

/// POST body from a Claude Code HTTP hook
///
/// Claude Code sends a JSON payload in snake_case with `hook_event_name`
/// as the event identifier. We use a flat structure with optional fields
/// to support all event types.
#[derive(Debug, Clone, Deserialize)]
pub struct HookEventPayload {
    /// Event name (e.g., PreToolUse, Stop, Notification)
    pub hook_event_name: HookEventName,

    /// Claude Code session ID (unique per session)
    #[serde(default)]
    pub session_id: String,

    /// Working directory of the Claude Code session
    #[serde(default)]
    pub cwd: Option<String>,

    /// Path to conversation transcript JSON
    #[serde(default)]
    pub transcript_path: Option<String>,

    /// Current permission mode (e.g., Default, Plan, DontAsk)
    #[serde(default)]
    pub permission_mode: Option<PermissionMode>,

    /// Tool name (for PreToolUse / PostToolUse / PermissionRequest)
    #[serde(default)]
    pub tool_name: Option<String>,

    /// Tool input parameters (for PreToolUse / PostToolUse / PermissionRequest)
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,

    /// Tool response/output (for PostToolUse)
    /// Claude Code v2.1.87+ sends this as an object (e.g., {"stdout":"...","exitCode":0}),
    /// not a plain string.
    #[serde(default)]
    pub tool_response: Option<serde_json::Value>,

    /// Whether a stop hook is already active (for Stop / SubagentStop)
    #[serde(default)]
    pub stop_hook_active: Option<bool>,

    /// Last assistant message text (for Stop / SubagentStop)
    #[serde(default)]
    pub last_assistant_message: Option<String>,

    /// Notification type (for Notification event)
    #[serde(default)]
    pub notification_type: Option<NotificationType>,

    /// Notification message text (for Notification)
    #[serde(default)]
    pub message: Option<String>,

    /// Notification title (for Notification)
    #[serde(default)]
    pub title: Option<String>,

    /// Subagent unique ID (for SubagentStart/Stop)
    #[serde(default)]
    pub agent_id: Option<String>,

    /// Subagent type name (for SubagentStart/Stop, e.g., "Explore", "Bash")
    #[serde(default)]
    pub agent_type: Option<String>,

    /// Teammate name (for TeammateIdle / TaskCompleted)
    #[serde(default)]
    pub teammate_name: Option<String>,

    /// Task ID (for TaskCompleted)
    #[serde(default)]
    pub task_id: Option<String>,

    /// Task subject (for TaskCompleted)
    #[serde(default)]
    pub task_subject: Option<String>,

    /// Task description (for TaskCompleted)
    #[serde(default)]
    pub task_description: Option<String>,

    /// Team name (for TeammateIdle / TaskCompleted)
    #[serde(default)]
    pub team_name: Option<String>,

    /// Config change source (for ConfigChange, e.g., "user_settings", "project_settings")
    #[serde(default)]
    pub source: Option<String>,

    /// Changed file path (for ConfigChange)
    #[serde(default)]
    pub file_path: Option<String>,

    /// Worktree information (present when running in `--worktree` session)
    /// Added in Claude Code v2.1.69.
    #[serde(default)]
    pub worktree: Option<WorktreeInfo>,

    /// Additional fields not explicitly modeled
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Statusline data received from Claude Code's statusline hook.
///
/// This data is sent periodically (after each assistant message, permission
/// changes, and vim mode toggle) and provides reliable access to model info,
/// cost metrics, context window usage, and session metadata.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct StatuslineData {
    /// Current working directory
    #[serde(default)]
    pub cwd: Option<String>,
    /// Claude Code session ID
    #[serde(default)]
    pub session_id: Option<String>,
    /// Human-readable session name (set via /rename)
    #[serde(default)]
    pub session_name: Option<String>,
    /// Path to conversation transcript JSONL
    #[serde(default)]
    pub transcript_path: Option<String>,
    /// Claude Code version string (e.g., "2.1.59")
    #[serde(default)]
    pub version: Option<String>,
    /// Whether total tokens exceed 200k threshold
    #[serde(default)]
    pub exceeds_200k_tokens: Option<bool>,
    /// Model information
    #[serde(default)]
    pub model: Option<StatuslineModel>,
    /// Workspace information
    #[serde(default)]
    pub workspace: Option<StatuslineWorkspace>,
    /// Cost and duration metrics
    #[serde(default)]
    pub cost: Option<StatuslineCost>,
    /// Context window usage
    #[serde(default)]
    pub context_window: Option<StatuslineContextWindow>,
    /// Output style
    #[serde(default)]
    pub output_style: Option<StatuslineOutputStyle>,
    /// Vim mode info (only when vim mode is enabled)
    #[serde(default)]
    pub vim: Option<StatuslineVim>,
    /// Agent info (only when running with --agent flag)
    #[serde(default)]
    pub agent: Option<StatuslineAgent>,
}

/// Model identification from statusline
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct StatuslineModel {
    /// Model API ID (e.g., "claude-opus-4-6")
    #[serde(default)]
    pub id: Option<String>,
    /// Human-readable display name (e.g., "Opus")
    #[serde(default)]
    pub display_name: Option<String>,
}

/// Workspace information from statusline
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct StatuslineWorkspace {
    /// Current working directory
    #[serde(default)]
    pub current_dir: Option<String>,
    /// Project directory (where Claude Code was launched)
    #[serde(default)]
    pub project_dir: Option<String>,
    /// Additional directories added via /add-dir
    #[serde(default)]
    pub added_dirs: Option<Vec<String>>,
}

/// Cost and duration metrics from statusline
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct StatuslineCost {
    /// Session total cost in USD
    #[serde(default)]
    pub total_cost_usd: Option<f64>,
    /// Session uptime in milliseconds
    #[serde(default)]
    pub total_duration_ms: Option<u64>,
    /// Cumulative API response wait time in milliseconds
    #[serde(default)]
    pub total_api_duration_ms: Option<u64>,
    /// Total lines of code added
    #[serde(default)]
    pub total_lines_added: Option<u64>,
    /// Total lines of code removed
    #[serde(default)]
    pub total_lines_removed: Option<u64>,
}

/// Context window usage from statusline
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct StatuslineContextWindow {
    /// Cumulative input tokens across the session
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    /// Cumulative output tokens across the session
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    /// Model's context window size (e.g., 200000)
    #[serde(default)]
    pub context_window_size: Option<u64>,
    /// Percentage of context window used (0-100, null early in session)
    #[serde(default)]
    pub used_percentage: Option<u8>,
    /// Percentage of context window remaining (0-100, null early in session)
    #[serde(default)]
    pub remaining_percentage: Option<u8>,
    /// Current API call token usage (null before first API call)
    #[serde(default)]
    pub current_usage: Option<StatuslineCurrentUsage>,
}

/// Current API call token usage breakdown
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct StatuslineCurrentUsage {
    /// Input tokens in current context
    #[serde(default)]
    pub input_tokens: Option<u64>,
    /// Generated output tokens
    #[serde(default)]
    pub output_tokens: Option<u64>,
    /// Tokens written to cache
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
    /// Tokens read from cache
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,
}

/// Output style from statusline
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct StatuslineOutputStyle {
    /// Style name (e.g., "default", "Explanatory")
    #[serde(default)]
    pub name: Option<String>,
}

/// Vim mode info from statusline
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct StatuslineVim {
    /// Current vim mode ("NORMAL" or "INSERT")
    #[serde(default)]
    pub mode: Option<String>,
}

/// Agent info from statusline (when running with --agent)
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct StatuslineAgent {
    /// Agent name (e.g., "security-reviewer")
    #[serde(default)]
    pub name: Option<String>,
    /// Agent type identifier
    #[serde(default, rename = "type")]
    pub agent_type: Option<String>,
}

/// Internal status tracked per agent from hook events
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HookStatus {
    /// Agent is processing (after UserPromptSubmit or tool use)
    Processing,
    /// Agent is idle (after Stop)
    Idle,
    /// Agent is awaiting user approval (permission prompt)
    AwaitingApproval,
    /// Agent is compacting context (after PreCompact)
    Compacting,
}

/// Rich context from a hook event (for audit validation)
#[derive(Debug, Clone, Default)]
pub struct HookContext {
    /// Hook event name that produced this context
    pub event_name: String,
    /// Tool input parameters (from PreToolUse/PostToolUse/PermissionRequest)
    pub tool_input: Option<serde_json::Value>,
    /// Current permission mode
    pub permission_mode: Option<PermissionMode>,
    /// Pending JSON-RPC request ID for Codex WS approval requests.
    /// Set when an approval request arrives; consumed when approve/deny is sent.
    pub pending_request_id: Option<u64>,
}

/// Maximum number of tool activities retained per agent
pub const MAX_ACTIVITY_LOG: usize = 20;

/// A single tool execution record for activity log display
#[derive(Debug, Clone)]
pub struct ToolActivity {
    /// Structured activity type
    pub tool: crate::agents::Activity,
    /// Summarized input (e.g., "cargo test", "src/main.rs")
    pub input_summary: String,
    /// Summarized response/output
    pub response_summary: String,
    /// Outcome of the tool execution
    pub outcome: crate::agents::ToolOutcome,
    /// Timestamp (Unix millis)
    pub timestamp: u64,
}

/// Internal state tracked per agent based on hook events
#[derive(Debug, Clone)]
pub struct HookState {
    /// Current status derived from hook events
    pub status: HookStatus,
    /// Last tool being used (from PreToolUse)
    pub last_tool: Option<String>,
    /// Claude Code session ID
    pub session_id: String,
    /// Working directory
    pub cwd: Option<String>,
    /// Timestamp of last hook event (Unix millis)
    pub last_event_at: u64,
    /// Rich context from the last hook event (for audit validation)
    pub last_context: HookContext,
    /// Worktree information (if running in `--worktree` session)
    pub worktree: Option<WorktreeInfo>,
    /// Number of active subagents (incremented on SubagentStart, decremented on SubagentStop)
    pub active_subagents: u32,
    /// Number of context compactions in this session (incremented on PreCompact)
    pub compaction_count: u32,
    /// Path to conversation transcript JSONL file
    pub transcript_path: Option<String>,
    /// Recent tool activity log for preview display
    pub activity_log: Vec<ToolActivity>,
    /// Process ID of the Claude Code instance (for PTY injection)
    pub pid: Option<u32>,
    /// Model ID extracted from transcript (cached after first read)
    pub model_id: Option<String>,
    /// Token usage from WS-connected agents (input_tokens, output_tokens)
    pub token_usage: Option<(u64, u64)>,
    /// Source agent type (set by WS translators to override default Claude detection)
    pub source_agent: Option<crate::agents::AgentType>,
    /// Statusline data (updated periodically from statusline hook)
    pub statusline: Option<StatuslineData>,
}

impl HookState {
    /// Create a new HookState from an initial session start
    pub fn new(session_id: String, cwd: Option<String>) -> Self {
        Self {
            status: HookStatus::Idle,
            last_tool: None,
            session_id,
            cwd,
            last_event_at: current_time_millis(),
            last_context: HookContext::default(),
            worktree: None,
            active_subagents: 0,
            compaction_count: 0,
            transcript_path: None,
            activity_log: Vec::new(),
            pid: None,
            model_id: None,
            token_usage: None,
            source_agent: None,
            statusline: None,
        }
    }

    /// Check if this hook state is still fresh (within threshold)
    pub fn is_fresh(&self, threshold_ms: u64) -> bool {
        let now = current_time_millis();
        now.saturating_sub(self.last_event_at) < threshold_ms
    }

    /// Update the timestamp to now
    pub fn touch(&mut self) {
        self.last_event_at = current_time_millis();
    }
}

/// Get current time in milliseconds (reuses ipc::protocol pattern)
pub fn current_time_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hook_event_payload_deserialize_pre_tool_use() {
        let json = r#"{
            "hook_event_name": "PreToolUse",
            "session_id": "sess-123",
            "cwd": "/home/user/project",
            "permission_mode": "default",
            "tool_name": "Bash",
            "tool_input": {"command": "npm test"}
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::PreToolUse);
        assert_eq!(payload.session_id, "sess-123");
        assert_eq!(payload.tool_name.as_deref(), Some("Bash"));
        assert_eq!(payload.cwd.as_deref(), Some("/home/user/project"));
        assert_eq!(payload.permission_mode, Some(PermissionMode::Default));
    }

    #[test]
    fn test_hook_event_payload_deserialize_stop() {
        let json = r#"{
            "hook_event_name": "Stop",
            "session_id": "sess-123",
            "stop_hook_active": true,
            "last_assistant_message": "Done."
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::Stop);
        assert_eq!(payload.stop_hook_active, Some(true));
        assert_eq!(payload.last_assistant_message.as_deref(), Some("Done."));
    }

    #[test]
    fn test_hook_event_payload_deserialize_notification() {
        let json = r#"{
            "hook_event_name": "Notification",
            "session_id": "sess-456",
            "notification_type": "permission_prompt",
            "message": "Claude needs permission",
            "title": "Permission needed"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::Notification);
        assert_eq!(
            payload.notification_type,
            Some(NotificationType::PermissionPrompt)
        );
        assert_eq!(payload.message.as_deref(), Some("Claude needs permission"));
    }

    #[test]
    fn test_hook_event_payload_extra_fields() {
        let json = r#"{
            "hook_event_name": "PreToolUse",
            "session_id": "s1",
            "unknown_field": "value",
            "another_field": 42
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::PreToolUse);
        assert!(payload.extra.contains_key("unknown_field"));
    }

    #[test]
    fn test_hook_state_new() {
        let state = HookState::new("s1".into(), Some("/tmp".into()));
        assert_eq!(state.status, HookStatus::Idle);
        assert_eq!(state.session_id, "s1");
        assert!(state.last_tool.is_none());
        assert!(state.is_fresh(1000));
    }

    #[test]
    fn test_hook_state_freshness() {
        let mut state = HookState::new("s1".into(), None);
        // Just created, should be fresh
        assert!(state.is_fresh(1000));

        // Simulate old timestamp
        state.last_event_at = 0;
        assert!(!state.is_fresh(1000));
    }

    /// Claude Code sends payloads with all common fields in snake_case
    #[test]
    fn test_hook_event_payload_deserialize_full_common_fields() {
        let json = r#"{
            "hook_event_name": "PreToolUse",
            "session_id": "abc123",
            "transcript_path": "/home/user/.claude/projects/proj/transcript.jsonl",
            "cwd": "/home/user/project",
            "permission_mode": "default",
            "tool_name": "Bash",
            "tool_input": {"command": "cargo test"}
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::PreToolUse);
        assert_eq!(payload.session_id, "abc123");
        assert_eq!(
            payload.transcript_path.as_deref(),
            Some("/home/user/.claude/projects/proj/transcript.jsonl")
        );
        assert_eq!(payload.cwd.as_deref(), Some("/home/user/project"));
        assert_eq!(payload.permission_mode, Some(PermissionMode::Default));
        assert_eq!(payload.tool_name.as_deref(), Some("Bash"));
        assert!(payload.tool_input.is_some());
    }

    /// Old camelCase format must fail deserialization (missing required field)
    #[test]
    fn test_hook_event_payload_rejects_camel_case() {
        let json = r#"{
            "event": "PreToolUse",
            "sessionId": "sess-123",
            "toolName": "Bash"
        }"#;
        let result = serde_json::from_str::<HookEventPayload>(json);
        assert!(
            result.is_err(),
            "camelCase format should fail: hook_event_name is required"
        );
    }

    /// SubagentStart payload with agent_id and agent_type
    #[test]
    fn test_hook_event_payload_deserialize_subagent_start() {
        let json = r#"{
            "hook_event_name": "SubagentStart",
            "session_id": "sess-1",
            "cwd": "/tmp",
            "permission_mode": "default",
            "agent_id": "agent-abc123",
            "agent_type": "Explore"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::SubagentStart);
        assert_eq!(payload.agent_id.as_deref(), Some("agent-abc123"));
        assert_eq!(payload.agent_type.as_deref(), Some("Explore"));
    }

    /// TeammateIdle payload with teammate_name and team_name
    #[test]
    fn test_hook_event_payload_deserialize_teammate_idle() {
        let json = r#"{
            "hook_event_name": "TeammateIdle",
            "session_id": "sess-1",
            "cwd": "/tmp",
            "permission_mode": "default",
            "teammate_name": "researcher",
            "team_name": "my-project"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::TeammateIdle);
        assert_eq!(payload.teammate_name.as_deref(), Some("researcher"));
        assert_eq!(payload.team_name.as_deref(), Some("my-project"));
    }

    /// TaskCompleted payload with task_description
    #[test]
    fn test_hook_event_payload_deserialize_task_completed() {
        let json = r#"{
            "hook_event_name": "TaskCompleted",
            "session_id": "sess-1",
            "cwd": "/tmp",
            "permission_mode": "default",
            "task_id": "task-001",
            "task_subject": "Implement auth",
            "task_description": "Add login and signup endpoints",
            "teammate_name": "implementer",
            "team_name": "my-project"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::TaskCompleted);
        assert_eq!(payload.task_id.as_deref(), Some("task-001"));
        assert_eq!(payload.task_subject.as_deref(), Some("Implement auth"));
        assert_eq!(
            payload.task_description.as_deref(),
            Some("Add login and signup endpoints")
        );
        assert_eq!(payload.teammate_name.as_deref(), Some("implementer"));
    }

    /// TaskCreated payload — fires when a background task is created
    #[test]
    fn test_hook_event_payload_deserialize_task_created() {
        let json = r#"{
            "hook_event_name": "TaskCreated",
            "session_id": "sess-1",
            "cwd": "/tmp",
            "permission_mode": "default",
            "task_id": "task-001",
            "task_subject": "Implement feature",
            "task_description": "Add login functionality",
            "teammate_name": "implementer",
            "team_name": "my-project"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::TaskCreated);
        assert_eq!(payload.task_id.as_deref(), Some("task-001"));
        assert_eq!(payload.task_subject.as_deref(), Some("Implement feature"));
        assert_eq!(
            payload.task_description.as_deref(),
            Some("Add login functionality")
        );
        assert_eq!(payload.teammate_name.as_deref(), Some("implementer"));
        assert_eq!(payload.team_name.as_deref(), Some("my-project"));
    }

    /// SessionStart payload (minimal — only common fields)
    #[test]
    fn test_hook_event_payload_deserialize_session_start() {
        let json = r#"{
            "hook_event_name": "SessionStart",
            "session_id": "new-session",
            "cwd": "/home/user/project",
            "permission_mode": "plan"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::SessionStart);
        assert_eq!(payload.session_id, "new-session");
        assert_eq!(payload.permission_mode, Some(PermissionMode::Plan));
        // All optional event-specific fields should be None
        assert!(payload.tool_name.is_none());
        assert!(payload.stop_hook_active.is_none());
        assert!(payload.teammate_name.is_none());
    }

    /// PermissionMode variants added in later Claude Code versions
    #[test]
    fn test_permission_mode_accept_edits() {
        let json = r#"{
            "hook_event_name": "SessionStart",
            "session_id": "s",
            "permission_mode": "acceptEdits"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.permission_mode, Some(PermissionMode::AcceptEdits));
    }

    /// NotificationType::IdlePrompt added in later Claude Code versions
    #[test]
    fn test_notification_type_idle_prompt() {
        let json = r#"{
            "hook_event_name": "Notification",
            "session_id": "s",
            "notification_type": "idle_prompt"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(
            payload.notification_type,
            Some(NotificationType::IdlePrompt)
        );
    }

    /// InstructionsLoaded payload (fires when CLAUDE.md or rules files are loaded)
    #[test]
    fn test_hook_event_payload_deserialize_instructions_loaded() {
        let json = r#"{
            "hook_event_name": "InstructionsLoaded",
            "session_id": "sess-1",
            "cwd": "/home/user/project"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::InstructionsLoaded);
        assert_eq!(payload.cwd.as_deref(), Some("/home/user/project"));
    }

    /// Payload with worktree info (present in --worktree sessions)
    #[test]
    fn test_hook_event_payload_deserialize_with_worktree() {
        let json = r#"{
            "hook_event_name": "PreToolUse",
            "session_id": "sess-1",
            "cwd": "/home/user/worktrees/feat-auth",
            "tool_name": "Bash",
            "worktree": {
                "name": "feat-auth",
                "path": "/home/user/worktrees/feat-auth",
                "branch": "feat/auth",
                "original_repo": "/home/user/project"
            }
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::PreToolUse);
        let wt = payload.worktree.as_ref().unwrap();
        assert_eq!(wt.name.as_deref(), Some("feat-auth"));
        assert_eq!(wt.path.as_deref(), Some("/home/user/worktrees/feat-auth"));
        assert_eq!(wt.branch.as_deref(), Some("feat/auth"));
        assert_eq!(wt.original_repo.as_deref(), Some("/home/user/project"));
    }

    /// Payload without worktree field (non-worktree session)
    #[test]
    fn test_hook_event_payload_deserialize_without_worktree() {
        let json = r#"{
            "hook_event_name": "PreToolUse",
            "session_id": "sess-1",
            "tool_name": "Bash"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert!(payload.worktree.is_none());
    }

    /// PermissionRequest payload with tool_name and tool_input
    #[test]
    fn test_hook_event_payload_deserialize_permission_request() {
        let json = r#"{
            "hook_event_name": "PermissionRequest",
            "session_id": "sess-1",
            "cwd": "/tmp",
            "permission_mode": "default",
            "tool_name": "Bash",
            "tool_input": {"command": "rm -rf /tmp/build"}
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::PermissionRequest);
        assert_eq!(payload.tool_name.as_deref(), Some("Bash"));
        let tool_input = payload.tool_input.unwrap();
        assert_eq!(tool_input["command"], "rm -rf /tmp/build");
    }

    /// PermissionDenied payload with tool_name and tool_input
    #[test]
    fn test_hook_event_payload_deserialize_permission_denied() {
        let json = r#"{
            "hook_event_name": "PermissionDenied",
            "session_id": "sess-1",
            "cwd": "/tmp",
            "permission_mode": "default",
            "tool_name": "Bash",
            "tool_input": {"command": "rm -rf /tmp/build"}
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.hook_event_name, HookEventName::PermissionDenied);
        assert_eq!(payload.tool_name.as_deref(), Some("Bash"));
        assert_eq!(payload.permission_mode, Some(PermissionMode::Default));
        let tool_input = payload.tool_input.unwrap();
        assert_eq!(tool_input["command"], "rm -rf /tmp/build");
    }

    /// Full statusline JSON deserialization
    #[test]
    fn test_statusline_data_deserialize_full() {
        let json = r#"{
            "cwd": "/home/user/project",
            "session_id": "abc123",
            "session_name": "my-session",
            "transcript_path": "/path/to/transcript.jsonl",
            "version": "2.1.59",
            "exceeds_200k_tokens": false,
            "model": {
                "id": "claude-opus-4-6",
                "display_name": "Opus"
            },
            "workspace": {
                "current_dir": "/home/user/project",
                "project_dir": "/home/user/project",
                "added_dirs": ["/tmp/extra"]
            },
            "cost": {
                "total_cost_usd": 0.01234,
                "total_duration_ms": 45000,
                "total_api_duration_ms": 2300,
                "total_lines_added": 156,
                "total_lines_removed": 23
            },
            "context_window": {
                "total_input_tokens": 15234,
                "total_output_tokens": 4521,
                "context_window_size": 200000,
                "used_percentage": 8,
                "remaining_percentage": 92,
                "current_usage": {
                    "input_tokens": 8500,
                    "output_tokens": 1200,
                    "cache_creation_input_tokens": 5000,
                    "cache_read_input_tokens": 2000
                }
            },
            "output_style": { "name": "default" },
            "vim": { "mode": "NORMAL" },
            "agent": { "name": "security-reviewer", "type": "custom" }
        }"#;
        let data: StatuslineData = serde_json::from_str(json).unwrap();
        assert_eq!(data.cwd.as_deref(), Some("/home/user/project"));
        assert_eq!(data.session_id.as_deref(), Some("abc123"));
        assert_eq!(data.session_name.as_deref(), Some("my-session"));
        assert_eq!(data.version.as_deref(), Some("2.1.59"));
        assert_eq!(data.exceeds_200k_tokens, Some(false));

        let model = data.model.as_ref().unwrap();
        assert_eq!(model.id.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(model.display_name.as_deref(), Some("Opus"));

        let cost = data.cost.as_ref().unwrap();
        assert_eq!(cost.total_cost_usd, Some(0.01234));
        assert_eq!(cost.total_duration_ms, Some(45000));
        assert_eq!(cost.total_lines_added, Some(156));
        assert_eq!(cost.total_lines_removed, Some(23));

        let cw = data.context_window.as_ref().unwrap();
        assert_eq!(cw.used_percentage, Some(8));
        assert_eq!(cw.context_window_size, Some(200000));
        let usage = cw.current_usage.as_ref().unwrap();
        assert_eq!(usage.input_tokens, Some(8500));
        assert_eq!(usage.cache_read_input_tokens, Some(2000));

        let agent = data.agent.as_ref().unwrap();
        assert_eq!(agent.name.as_deref(), Some("security-reviewer"));
        assert_eq!(agent.agent_type.as_deref(), Some("custom"));

        let vim = data.vim.as_ref().unwrap();
        assert_eq!(vim.mode.as_deref(), Some("NORMAL"));
    }

    /// Minimal statusline JSON (only required fields)
    #[test]
    fn test_statusline_data_deserialize_minimal() {
        let json = r#"{
            "cwd": "/tmp",
            "session_id": "s1"
        }"#;
        let data: StatuslineData = serde_json::from_str(json).unwrap();
        assert_eq!(data.cwd.as_deref(), Some("/tmp"));
        assert!(data.model.is_none());
        assert!(data.cost.is_none());
        assert!(data.context_window.is_none());
        assert!(data.vim.is_none());
        assert!(data.agent.is_none());
    }

    /// Statusline with null context_window percentages (early in session)
    #[test]
    fn test_statusline_data_null_context_percentages() {
        let json = r#"{
            "cwd": "/tmp",
            "session_id": "s1",
            "context_window": {
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "context_window_size": 200000,
                "used_percentage": null,
                "remaining_percentage": null,
                "current_usage": null
            }
        }"#;
        let data: StatuslineData = serde_json::from_str(json).unwrap();
        let cw = data.context_window.as_ref().unwrap();
        assert_eq!(cw.used_percentage, None);
        assert_eq!(cw.remaining_percentage, None);
        assert_eq!(cw.current_usage, None);
    }

    /// Statusline serialization round-trip
    #[test]
    fn test_statusline_data_roundtrip() {
        let data = StatuslineData {
            cwd: Some("/tmp".to_string()),
            session_id: Some("s1".to_string()),
            model: Some(StatuslineModel {
                id: Some("claude-opus-4-6".to_string()),
                display_name: Some("Opus".to_string()),
            }),
            cost: Some(StatuslineCost {
                total_cost_usd: Some(1.5),
                ..Default::default()
            }),
            ..Default::default()
        };
        let json = serde_json::to_string(&data).unwrap();
        let parsed: StatuslineData = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.cwd, data.cwd);
        assert_eq!(
            parsed.model.as_ref().unwrap().id,
            data.model.as_ref().unwrap().id
        );
        assert_eq!(
            parsed.cost.as_ref().unwrap().total_cost_usd,
            data.cost.as_ref().unwrap().total_cost_usd
        );
    }

    /// HookState with statusline field
    #[test]
    fn test_hook_state_with_statusline() {
        let mut state = HookState::new("s1".into(), Some("/tmp".into()));
        assert!(state.statusline.is_none());

        state.statusline = Some(StatuslineData {
            version: Some("2.1.59".to_string()),
            ..Default::default()
        });
        assert_eq!(
            state.statusline.as_ref().unwrap().version.as_deref(),
            Some("2.1.59")
        );
    }
}
