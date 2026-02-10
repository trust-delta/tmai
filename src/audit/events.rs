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
}
