//! Audit helper for emitting UserInputDuringProcessing events

use crate::agents::{AgentStatus, DetectionSource};
use crate::audit::{AuditEvent, AuditEventSender};
use crate::detectors::DetectionReason;
use crate::state::SharedState;

/// Pre-extracted agent info for audit (avoids holding state lock during emit)
pub struct AgentAuditSnapshot {
    pub status: AgentStatus,
    pub detection_reason: Option<DetectionReason>,
    pub detection_source: DetectionSource,
    pub agent_type_name: String,
    pub last_content: String,
}

/// Helper for emitting audit events from UI and Web API
pub struct AuditHelper {
    tx: Option<AuditEventSender>,
    app_state: SharedState,
}

impl AuditHelper {
    /// Create a new AuditHelper
    pub fn new(tx: Option<AuditEventSender>, app_state: SharedState) -> Self {
        Self { tx, app_state }
    }

    /// Whether audit logging is enabled
    pub fn is_enabled(&self) -> bool {
        self.tx.is_some()
    }

    /// Take a snapshot of agent info for audit purposes (acquires read lock briefly)
    pub fn snapshot_agent(&self, target: &str) -> Option<AgentAuditSnapshot> {
        let state = self.app_state.read();
        state.agents.get(target).map(|a| AgentAuditSnapshot {
            status: a.status.clone(),
            detection_reason: a.detection_reason.clone(),
            detection_source: a.detection_source,
            agent_type_name: a.agent_type.short_name().to_string(),
            last_content: a.last_content.clone(),
        })
    }

    /// Emit a UserInputDuringProcessing audit event if the agent is Processing.
    ///
    /// If `snapshot` is None, acquires state lock to get agent info.
    /// If `snapshot` is Some, uses pre-extracted info (avoids double lock).
    pub fn maybe_emit_input(
        &self,
        target: &str,
        action: &str,
        input_source: &str,
        snapshot: Option<&AgentAuditSnapshot>,
    ) {
        let Some(ref tx) = self.tx else {
            return;
        };

        // Use provided snapshot or fetch fresh one
        let owned_snapshot;
        let snap = match snapshot {
            Some(s) => s,
            None => {
                owned_snapshot = match self.snapshot_agent(target) {
                    Some(s) => s,
                    None => return,
                };
                &owned_snapshot
            }
        };

        let status_name = match &snap.status {
            AgentStatus::Processing { .. } => "processing",
            _ => return, // Idle/AwaitingApproval are normal — only Processing is suspicious
        };

        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let screen_context = if !snap.last_content.is_empty() {
            let lines: Vec<&str> = snap.last_content.lines().collect();
            let start = lines.len().saturating_sub(20);
            let tail = lines[start..].join("\n");
            Some(if tail.len() > 2000 {
                tail[..tail.floor_char_boundary(2000)].to_string()
            } else {
                tail
            })
        } else {
            None
        };

        let pane_id = self.resolve_pane_id(target);

        let _ = tx.send(AuditEvent::UserInputDuringProcessing {
            ts,
            pane_id,
            agent_type: snap.agent_type_name.clone(),
            action: action.to_string(),
            input_source: input_source.to_string(),
            current_status: status_name.to_string(),
            detection_reason: snap.detection_reason.clone(),
            detection_source: snap.detection_source.label().to_string(),
            screen_context,
        });
    }

    /// Resolve pane_id from target using AppState mapping
    fn resolve_pane_id(&self, target: &str) -> String {
        let state = self.app_state.read();
        state
            .target_to_pane_id
            .get(target)
            .cloned()
            .unwrap_or_else(|| target.to_string())
    }
}
