//! Hook event types for Claude Code HTTP hook integration.
//!
//! Defines the payload structure received from Claude Code hooks
//! and the internal state tracked per agent.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Hook event name constants
pub mod event_names {
    pub const SESSION_START: &str = "SessionStart";
    pub const USER_PROMPT_SUBMIT: &str = "UserPromptSubmit";
    pub const PRE_TOOL_USE: &str = "PreToolUse";
    pub const POST_TOOL_USE: &str = "PostToolUse";
    pub const NOTIFICATION: &str = "Notification";
    pub const PERMISSION_REQUEST: &str = "PermissionRequest";
    pub const STOP: &str = "Stop";
    pub const SUBAGENT_START: &str = "SubagentStart";
    pub const SUBAGENT_STOP: &str = "SubagentStop";
    pub const TEAMMATE_IDLE: &str = "TeammateIdle";
    pub const TASK_COMPLETED: &str = "TaskCompleted";
    pub const SESSION_END: &str = "SessionEnd";
}

/// POST body from a Claude Code HTTP hook
///
/// Claude Code sends a JSON payload in snake_case with `hook_event_name`
/// as the event identifier. We use a flat structure with optional fields
/// to support all event types.
#[derive(Debug, Clone, Deserialize)]
pub struct HookEventPayload {
    /// Event name (e.g., "PreToolUse", "Stop", "Notification")
    pub hook_event_name: String,

    /// Claude Code session ID (unique per session)
    #[serde(default)]
    pub session_id: String,

    /// Working directory of the Claude Code session
    #[serde(default)]
    pub cwd: Option<String>,

    /// Path to conversation transcript JSON
    #[serde(default)]
    pub transcript_path: Option<String>,

    /// Current permission mode (e.g., "default", "plan", "dontAsk")
    #[serde(default)]
    pub permission_mode: Option<String>,

    /// Tool name (for PreToolUse / PostToolUse / PermissionRequest)
    #[serde(default)]
    pub tool_name: Option<String>,

    /// Tool input parameters (for PreToolUse / PostToolUse / PermissionRequest)
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,

    /// Whether a stop hook is already active (for Stop / SubagentStop)
    #[serde(default)]
    pub stop_hook_active: Option<bool>,

    /// Last assistant message text (for Stop / SubagentStop)
    #[serde(default)]
    pub last_assistant_message: Option<String>,

    /// Notification type (for Notification event, e.g., "permission_prompt")
    #[serde(default)]
    pub notification_type: Option<String>,

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

    /// Additional fields not explicitly modeled
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
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
fn current_time_millis() -> u64 {
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
        assert_eq!(payload.hook_event_name, "PreToolUse");
        assert_eq!(payload.session_id, "sess-123");
        assert_eq!(payload.tool_name.as_deref(), Some("Bash"));
        assert_eq!(payload.cwd.as_deref(), Some("/home/user/project"));
        assert_eq!(payload.permission_mode.as_deref(), Some("default"));
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
        assert_eq!(payload.hook_event_name, "Stop");
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
        assert_eq!(payload.hook_event_name, "Notification");
        assert_eq!(
            payload.notification_type.as_deref(),
            Some("permission_prompt")
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
        assert_eq!(payload.hook_event_name, "PreToolUse");
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
        assert_eq!(payload.hook_event_name, "PreToolUse");
        assert_eq!(payload.session_id, "abc123");
        assert_eq!(
            payload.transcript_path.as_deref(),
            Some("/home/user/.claude/projects/proj/transcript.jsonl")
        );
        assert_eq!(payload.cwd.as_deref(), Some("/home/user/project"));
        assert_eq!(payload.permission_mode.as_deref(), Some("default"));
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
        assert_eq!(payload.hook_event_name, "SubagentStart");
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
        assert_eq!(payload.hook_event_name, "TeammateIdle");
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
        assert_eq!(payload.hook_event_name, "TaskCompleted");
        assert_eq!(payload.task_id.as_deref(), Some("task-001"));
        assert_eq!(payload.task_subject.as_deref(), Some("Implement auth"));
        assert_eq!(
            payload.task_description.as_deref(),
            Some("Add login and signup endpoints")
        );
        assert_eq!(payload.teammate_name.as_deref(), Some("implementer"));
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
        assert_eq!(payload.hook_event_name, "SessionStart");
        assert_eq!(payload.session_id, "new-session");
        assert_eq!(payload.permission_mode.as_deref(), Some("plan"));
        // All optional event-specific fields should be None
        assert!(payload.tool_name.is_none());
        assert!(payload.stop_hook_active.is_none());
        assert!(payload.teammate_name.is_none());
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
        assert_eq!(payload.hook_event_name, "PermissionRequest");
        assert_eq!(payload.tool_name.as_deref(), Some("Bash"));
        let tool_input = payload.tool_input.unwrap();
        assert_eq!(tool_input["command"], "rm -rf /tmp/build");
    }
}
