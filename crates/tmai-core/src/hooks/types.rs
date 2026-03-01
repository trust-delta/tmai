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
/// Claude Code sends a JSON payload with the event name, session ID,
/// and event-specific data. We use a flat structure with optional fields
/// to support all event types.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEventPayload {
    /// Event name (e.g., "PreToolUse", "Stop", "Notification")
    pub event: String,

    /// Claude Code session ID (unique per session)
    #[serde(default)]
    pub session_id: String,

    /// Working directory of the Claude Code session
    #[serde(default)]
    pub cwd: Option<String>,

    /// Tool name (for PreToolUse / PostToolUse)
    #[serde(default)]
    pub tool_name: Option<String>,

    /// Tool input parameters (for PreToolUse / PostToolUse)
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,

    /// Stop reason (for Stop event)
    #[serde(default)]
    pub stop_reason: Option<String>,

    /// Notification type (for Notification event, e.g., "permission_prompt")
    #[serde(default)]
    pub notification_type: Option<String>,

    /// Subagent/teammate info (for SubagentStart/Stop, TeammateIdle)
    #[serde(default)]
    pub agent_name: Option<String>,

    /// Task info (for TaskCompleted)
    #[serde(default)]
    pub task_id: Option<String>,

    /// Task subject (for TaskCompleted)
    #[serde(default)]
    pub task_subject: Option<String>,

    /// Team name (for team-related events)
    #[serde(default)]
    pub team_name: Option<String>,

    /// Member name (for TeammateIdle)
    #[serde(default)]
    pub member_name: Option<String>,

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
            "event": "PreToolUse",
            "sessionId": "sess-123",
            "cwd": "/home/user/project",
            "toolName": "Bash"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.event, "PreToolUse");
        assert_eq!(payload.session_id, "sess-123");
        assert_eq!(payload.tool_name.as_deref(), Some("Bash"));
        assert_eq!(payload.cwd.as_deref(), Some("/home/user/project"));
    }

    #[test]
    fn test_hook_event_payload_deserialize_stop() {
        let json = r#"{
            "event": "Stop",
            "sessionId": "sess-123",
            "stopReason": "end_turn"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.event, "Stop");
        assert_eq!(payload.stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn test_hook_event_payload_deserialize_notification() {
        let json = r#"{
            "event": "Notification",
            "sessionId": "sess-456",
            "notificationType": "permission_prompt"
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.event, "Notification");
        assert_eq!(
            payload.notification_type.as_deref(),
            Some("permission_prompt")
        );
    }

    #[test]
    fn test_hook_event_payload_extra_fields() {
        let json = r#"{
            "event": "PreToolUse",
            "sessionId": "s1",
            "unknownField": "value",
            "anotherField": 42
        }"#;
        let payload: HookEventPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.event, "PreToolUse");
        assert!(payload.extra.contains_key("unknownField"));
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
}
