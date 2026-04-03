use serde::{Deserialize, Serialize};

use crate::auto_approve::types::JudgmentUsage;
use crate::detectors::DetectionReason;

/// Audit event types for detection logging
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event")]
pub enum AuditEvent {
    /// Agent status changed
    StateChanged {
        ts: u64,
        pane_id: String,
        agent_type: String,
        source: String,
        prev_status: String,
        new_status: String,
        reason: DetectionReason,
        screen_context: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prev_state_duration_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        approval_type: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        approval_details: Option<String>,
    },
    /// IPC and capture-pane disagree on status
    SourceDisagreement {
        ts: u64,
        pane_id: String,
        agent_type: String,
        ipc_status: String,
        capture_status: String,
        capture_reason: DetectionReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        screen_context: Option<String>,
    },
    /// New agent appeared
    AgentAppeared {
        ts: u64,
        pane_id: String,
        agent_type: String,
        source: String,
        initial_status: String,
    },
    /// Agent disappeared
    AgentDisappeared {
        ts: u64,
        pane_id: String,
        agent_type: String,
        last_status: String,
    },
    /// Auto-approve AI judgment result
    AutoApproveJudgment {
        ts: u64,
        pane_id: String,
        agent_type: String,
        /// Approval type (e.g., "file_edit", "shell_command")
        approval_type: String,
        /// Details of the approval request
        approval_details: String,
        /// Decision: "approve", "reject", "uncertain", or "error"
        decision: String,
        /// AI reasoning or error message
        reasoning: String,
        /// Model used for judgment
        model: String,
        /// Time taken for judgment in milliseconds
        elapsed_ms: u64,
        /// Whether approval keys were actually sent
        approval_sent: bool,
        /// Token usage and cost (if available from claude CLI)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<JudgmentUsage>,
        /// Screen context (included for approve/reject decisions)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        screen_context: Option<String>,
    },
    /// Hook vs IPC/capture-pane detection accuracy validation
    /// Logged only on disagreement (when IPC or capture-pane differ from hook ground truth)
    DetectionValidation {
        ts: u64,
        pane_id: String,
        agent_type: String,
        /// Hook ground truth status
        hook_status: String,
        /// Hook event name that produced the status
        hook_event: String,
        /// IPC detection result (None if no IPC connection)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ipc_status: Option<String>,
        /// capture-pane detection result
        capture_status: String,
        /// capture-pane detection reason
        capture_reason: DetectionReason,
        /// Whether IPC result agrees with hook (None if no IPC)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ipc_agrees: Option<bool>,
        /// Whether capture-pane result agrees with hook
        capture_agrees: bool,
        /// Tool input from hook (included on disagreement, max 500 chars)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hook_tool_input: Option<serde_json::Value>,
        /// Permission mode from hook
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hook_permission_mode: Option<String>,
        /// Last N lines of screen content (included on disagreement, max 1000 chars)
        #[serde(default, skip_serializing_if = "Option::is_none")]
        screen_context: Option<String>,
    },
    /// User denied a permission request from Claude Code
    PermissionDenied {
        ts: u64,
        pane_id: String,
        agent_type: String,
        /// Tool that was denied (e.g., "Bash", "Edit")
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        /// Tool input parameters at the time of denial
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_input: Option<serde_json::Value>,
        /// Permission mode (e.g., "default", "plan")
        #[serde(default, skip_serializing_if = "Option::is_none")]
        permission_mode: Option<String>,
    },
    /// User sent input while agent was detected as Processing
    /// (possible false negative — detection may have missed an approval prompt)
    UserInputDuringProcessing {
        ts: u64,
        pane_id: String,
        agent_type: String,
        /// What action the user took: "input_text", "passthrough_key"
        action: String,
        /// Source of input: "tui_input_mode", "tui_passthrough", "web_api_input"
        input_source: String,
        /// Current detected status at the time of input (always "processing")
        current_status: String,
        /// Detection reason at the time of input
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detection_reason: Option<DetectionReason>,
        /// Detection source: "ipc_socket" or "capture_pane"
        detection_source: String,
        /// Last ~20 lines of pane content for post-hoc analysis
        #[serde(default, skip_serializing_if = "Option::is_none")]
        screen_context: Option<String>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detectors::DetectionConfidence;

    #[test]
    fn test_detection_validation_serde_roundtrip() {
        let event = AuditEvent::DetectionValidation {
            ts: 1234567890,
            pane_id: "5".to_string(),
            agent_type: "ClaudeCode".to_string(),
            hook_status: "processing".to_string(),
            hook_event: "PreToolUse".to_string(),
            ipc_status: Some("idle".to_string()),
            capture_status: "idle".to_string(),
            capture_reason: DetectionReason {
                rule: "no_spinner".to_string(),
                confidence: DetectionConfidence::Medium,
                matched_text: None,
            },
            ipc_agrees: Some(false),
            capture_agrees: false,
            hook_tool_input: Some(serde_json::json!({"command": "cargo test"})),
            hook_permission_mode: Some("default".to_string()),
            screen_context: Some("last few lines".to_string()),
        };

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: AuditEvent = serde_json::from_str(&json).unwrap();

        if let AuditEvent::DetectionValidation {
            ts,
            pane_id,
            hook_status,
            hook_event,
            ipc_status,
            capture_status,
            ipc_agrees,
            capture_agrees,
            hook_tool_input,
            hook_permission_mode,
            screen_context,
            ..
        } = deserialized
        {
            assert_eq!(ts, 1234567890);
            assert_eq!(pane_id, "5");
            assert_eq!(hook_status, "processing");
            assert_eq!(hook_event, "PreToolUse");
            assert_eq!(ipc_status.as_deref(), Some("idle"));
            assert_eq!(capture_status, "idle");
            assert_eq!(ipc_agrees, Some(false));
            assert!(!capture_agrees);
            assert!(hook_tool_input.is_some());
            assert_eq!(hook_permission_mode.as_deref(), Some("default"));
            assert_eq!(screen_context.as_deref(), Some("last few lines"));
        } else {
            panic!("Expected DetectionValidation");
        }
    }

    #[test]
    fn test_detection_validation_serde_minimal() {
        // No optional fields
        let event = AuditEvent::DetectionValidation {
            ts: 100,
            pane_id: "1".to_string(),
            agent_type: "ClaudeCode".to_string(),
            hook_status: "idle".to_string(),
            hook_event: "Stop".to_string(),
            ipc_status: None,
            capture_status: "processing".to_string(),
            capture_reason: DetectionReason {
                rule: "spinner_verb".to_string(),
                confidence: DetectionConfidence::High,
                matched_text: Some("Analyzing".to_string()),
            },
            ipc_agrees: None,
            capture_agrees: false,
            hook_tool_input: None,
            hook_permission_mode: None,
            screen_context: None,
        };

        let json = serde_json::to_string(&event).unwrap();
        // Optional None fields should be omitted
        assert!(!json.contains("ipc_status"));
        assert!(!json.contains("ipc_agrees"));
        assert!(!json.contains("hook_tool_input"));
        assert!(!json.contains("hook_permission_mode"));
        assert!(!json.contains("screen_context"));

        let deserialized: AuditEvent = serde_json::from_str(&json).unwrap();
        if let AuditEvent::DetectionValidation {
            capture_agrees,
            capture_status,
            ..
        } = deserialized
        {
            assert!(!capture_agrees);
            assert_eq!(capture_status, "processing");
        } else {
            panic!("Expected DetectionValidation");
        }
    }

    #[test]
    fn test_permission_denied_serde_roundtrip() {
        let event = AuditEvent::PermissionDenied {
            ts: 1234567890,
            pane_id: "5".to_string(),
            agent_type: "ClaudeCode".to_string(),
            tool_name: Some("Bash".to_string()),
            tool_input: Some(serde_json::json!({"command": "rm -rf /"})),
            permission_mode: Some("default".to_string()),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"event\":\"PermissionDenied\""));

        let deserialized: AuditEvent = serde_json::from_str(&json).unwrap();
        if let AuditEvent::PermissionDenied {
            ts,
            pane_id,
            agent_type,
            tool_name,
            tool_input,
            permission_mode,
        } = deserialized
        {
            assert_eq!(ts, 1234567890);
            assert_eq!(pane_id, "5");
            assert_eq!(agent_type, "ClaudeCode");
            assert_eq!(tool_name.as_deref(), Some("Bash"));
            assert!(tool_input.is_some());
            assert_eq!(permission_mode.as_deref(), Some("default"));
        } else {
            panic!("Expected PermissionDenied");
        }
    }

    #[test]
    fn test_permission_denied_serde_minimal() {
        let event = AuditEvent::PermissionDenied {
            ts: 100,
            pane_id: "1".to_string(),
            agent_type: "ClaudeCode".to_string(),
            tool_name: None,
            tool_input: None,
            permission_mode: None,
        };

        let json = serde_json::to_string(&event).unwrap();
        // Optional None fields should be omitted
        assert!(!json.contains("tool_name"));
        assert!(!json.contains("tool_input"));
        assert!(!json.contains("permission_mode"));

        let deserialized: AuditEvent = serde_json::from_str(&json).unwrap();
        if let AuditEvent::PermissionDenied {
            tool_name,
            tool_input,
            permission_mode,
            ..
        } = deserialized
        {
            assert!(tool_name.is_none());
            assert!(tool_input.is_none());
            assert!(permission_mode.is_none());
        } else {
            panic!("Expected PermissionDenied");
        }
    }
}
