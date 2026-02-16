use serde::Serialize;

use crate::detectors::DetectionReason;

/// Audit event types for detection logging
#[derive(Debug, Clone, Serialize)]
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
        #[serde(skip_serializing_if = "Option::is_none")]
        prev_state_duration_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        approval_type: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
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
        /// Screen context (included for approve/reject decisions)
        #[serde(skip_serializing_if = "Option::is_none")]
        screen_context: Option<String>,
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
        detection_reason: Option<DetectionReason>,
        /// Detection source: "ipc_socket" or "capture_pane"
        detection_source: String,
        /// Last ~20 lines of pane content for post-hoc analysis
        screen_context: Option<String>,
    },
}
