#[allow(nonstandard_style)]
pub mod generated;

pub use generated::{
    AgentAttention, DispatchSnapshot, QueueSnapshot, RuntimeSnapshot, WorkflowSnapshot,
    WorktreeSnapshot,
};

use serde::Deserialize;

/// Agent snapshot returned by `GET /api/agents` and the `agents` SSE event.
///
/// Decision tmai-core@2026-05-09 (agent detection canonicalization, Phase 4):
/// the `attention` field is now a flat string enum
/// (`"started" | "halted" | "completed"` + `null`). The three variants are
/// the only states that require user intervention; `null` (`Option::None`)
/// means the agent is running normally — UI should render no special pill.
/// The legacy `{ required, reason? }` shape and `AttentionReason` type are
/// retired.
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
    /// Attention enum (decision 2026-05-09 Phase 4 wire shape).
    /// `None` / absent = running normally; no UI pill.
    #[serde(default)]
    pub attention: Option<AgentAttention>,
}

/// Map an [`AgentAttention`] reading to a single-word label matching the
/// React WebUI pill vocabulary. `None` = "running normally"; rendered as
/// `"Running"` so the column reads consistently with the WebUI muted
/// chip (dogfood feedback 2026-05-10 — ambient state still wants a
/// marker, blank felt off).
pub fn attention_label(a: Option<&AgentAttention>) -> &'static str {
    match a {
        Some(AgentAttention::started) => "Started",
        Some(AgentAttention::halted) => "Halted",
        Some(AgentAttention::completed) => "Done",
        None => "Running",
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
        assert_eq!(attention_label(None), "Running");
        assert_eq!(attention_label(Some(&AgentAttention::started)), "Started");
        assert_eq!(attention_label(Some(&AgentAttention::halted)), "Halted");
        assert_eq!(attention_label(Some(&AgentAttention::completed)), "Done");
    }

    #[test]
    fn attention_field_round_trips_with_completed() {
        let json = r#"{
            "id": "x",
            "target": "x",
            "attention": "completed"
        }"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert!(matches!(a.attention, Some(AgentAttention::completed)));
    }

    #[test]
    fn attention_field_round_trips_with_halted() {
        let json = r#"{"id":"x","target":"x","attention":"halted"}"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert!(matches!(a.attention, Some(AgentAttention::halted)));
    }

    #[test]
    fn attention_field_round_trips_with_started() {
        let json = r#"{"id":"x","target":"x","attention":"started"}"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert!(matches!(a.attention, Some(AgentAttention::started)));
    }
}
