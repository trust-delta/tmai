#[allow(nonstandard_style)]
pub mod generated;

pub use generated::{
    AgentAttention, ApprovalSnapshot, AttentionReason, DispatchSnapshot, QueueSnapshot,
    RuntimeSnapshot, TaskMetaSnapshot, TeamSnapshot, WorkflowSnapshot, WorktreeSnapshot,
};

use serde::Deserialize;

/// Agent snapshot returned by `GET /api/agents` and the `agents` SSE event.
///
/// `display_label` is pre-computed by tmai-core (mirrors `QueueAgentEntry.agent_display_label`).
///
/// Step 6 of the agent-state attention rebuild (decision tmai-core@2026-05-07):
/// the legacy `status` (`AgentStatus` enum) and `phase` fields were retired
/// from the wire surface. The new `attention?: AgentAttention | null`
/// axis (decision Step 4 / 6b) is the only dynamic-state field. UI styling
/// reads from it via [`attention_label`].
#[derive(Debug, Clone, Deserialize)]
pub struct AgentSnapshot {
    pub id: String,
    pub target: String,
    #[serde(default)]
    pub display_label: String,
    #[serde(default)]
    pub is_virtual: bool,
    #[serde(default)]
    pub is_orchestrator: bool,
    /// New attention axis (decision tmai-core@2026-05-07 Steps 4 / 6).
    /// `None` / absent on the wire encodes the sampler bootstrap window
    /// per Δ6 (UI renders "Bootstrap" / "—").
    #[serde(default)]
    pub attention: Option<AgentAttention>,
}

/// Map an [`AgentAttention`] reading to a single-word label matching the
/// React WebUI badge vocabulary (`Done` / `Halted` / `Wait` / `Active`).
/// `None` (sampler bootstrap window per Δ6) renders as `"—"` so the
/// status column never blanks during the brief bootstrap interval.
pub fn attention_label(a: Option<&AgentAttention>) -> &'static str {
    match a {
        Some(att) if att.required => match att.reason {
            Some(AttentionReason::completed) => "Done",
            Some(AttentionReason::halted) => "Halted",
            None => "Wait",
        },
        Some(_) => "Active",
        None => "—",
    }
}

/// Payload for `POST /api/agents/{id}/input`.
#[derive(Debug, serde::Serialize)]
pub struct TextInputRequest<'a> {
    pub text: &'a str,
}

/// Payload for `POST /api/agents/{id}/key`.
#[derive(Debug, serde::Serialize)]
pub struct KeyRequest<'a> {
    pub key: &'a str,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_minimal_agent_snapshot() {
        let json = r#"{
            "id": "main:0.0",
            "target": "main:0.0",
            "agent_type": "ClaudeCode"
        }"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(a.id, "main:0.0");
        // Bootstrap state — no attention emitted yet.
        assert!(a.attention.is_none());
    }

    #[test]
    fn display_label_defaults_to_empty_when_absent() {
        let json = r#"{"id":"x","target":"x"}"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(a.display_label, "");
    }

    #[test]
    fn display_label_populated_when_present() {
        let json = r#"{"id":"x","target":"x","display_label":"my-agent"}"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(a.display_label, "my-agent");
    }

    #[test]
    fn extra_fields_are_tolerated() {
        // Forward-compat: future snapshot fields must not crash the client.
        // Also tolerates legacy `status` / `phase` from older tmai-core that
        // hasn't merged the Step 6a wire-pentad drop yet — they're ignored.
        let json = r#"{
            "id": "x",
            "target": "x",
            "agent_type": "ClaudeCode",
            "status": {"type": "Idle"},
            "phase": "Idle",
            "some_future_field": 42,
            "another_one": {"nested": true}
        }"#;
        let _: AgentSnapshot = serde_json::from_str(json).unwrap();
    }

    #[test]
    fn attention_label_maps_variants() {
        assert_eq!(attention_label(None), "—");
        assert_eq!(
            attention_label(Some(&AgentAttention {
                required: false,
                reason: None
            })),
            "Active"
        );
        assert_eq!(
            attention_label(Some(&AgentAttention {
                required: true,
                reason: Some(AttentionReason::completed)
            })),
            "Done"
        );
        assert_eq!(
            attention_label(Some(&AgentAttention {
                required: true,
                reason: Some(AttentionReason::halted)
            })),
            "Halted"
        );
        assert_eq!(
            attention_label(Some(&AgentAttention {
                required: true,
                reason: None
            })),
            "Wait"
        );
    }

    #[test]
    fn attention_field_round_trips_with_reason() {
        let json = r#"{
            "id": "x",
            "target": "x",
            "attention": {"required": true, "reason": "completed"}
        }"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        let att = a.attention.expect("attention populated");
        assert!(att.required);
        assert!(matches!(att.reason, Some(AttentionReason::completed)));
    }
}
