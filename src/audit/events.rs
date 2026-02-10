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
    /// User sent input while agent was detected as Processing or Idle
    /// (possible false negative — detection may have missed an approval prompt)
    UserInputDuringProcessing {
        ts: u64,
        pane_id: String,
        agent_type: String,
        /// What action the user took: "input_text", "passthrough_key"
        action: String,
        /// Source of input: "tui_input_mode", "tui_passthrough", "web_api_input"
        input_source: String,
        /// Current detected status: "processing" or "idle"
        current_status: String,
        /// Detection reason at the time of input
        detection_reason: Option<DetectionReason>,
        /// Detection source: "ipc_socket" or "capture_pane"
        detection_source: String,
        /// Last ~20 lines of pane content for post-hoc analysis
        screen_context: Option<String>,
    },
}
