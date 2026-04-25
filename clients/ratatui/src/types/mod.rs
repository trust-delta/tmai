#[allow(nonstandard_style)]
pub mod generated;

pub use generated::{
    ApprovalSnapshot, DispatchSnapshot, Phase, QueueSnapshot, RuntimeSnapshot, TaskMetaSnapshot,
    TeamSnapshot, WorkflowSnapshot, WorktreeSnapshot,
};

use serde::Deserialize;

/// Agent snapshot returned by `GET /api/agents` and the `agents` SSE event.
///
/// `display_label` is pre-computed by tmai-core (mirrors `QueueAgentEntry.agent_display_label`).
/// `phase` captures the agent's operational state; UI styling reads from this field directly.
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
    #[serde(default)]
    pub phase: Option<Phase>,
    pub status: AgentStatus,
}

/// Forward-compat agent status — tolerates unknown variants from newer tmai-core.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum AgentStatus {
    Idle,
    Processing {
        #[serde(default)]
        activity: serde_json::Value,
    },
    AwaitingApproval {
        #[serde(default)]
        approval_type: serde_json::Value,
        #[serde(default)]
        details: String,
    },
    Error {
        #[serde(default)]
        message: String,
    },
    Offline,
    #[serde(other)]
    Unknown,
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
            "agent_type": "ClaudeCode",
            "status": {"type": "Idle"}
        }"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(a.id, "main:0.0");
        assert!(matches!(a.status, AgentStatus::Idle));
    }

    #[test]
    fn display_label_defaults_to_empty_when_absent() {
        let json = r#"{"id":"x","target":"x","status":{"type":"Idle"}}"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(a.display_label, "");
    }

    #[test]
    fn display_label_populated_when_present() {
        let json = r#"{"id":"x","target":"x","display_label":"my-agent","status":{"type":"Idle"}}"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(a.display_label, "my-agent");
    }

    #[test]
    fn unknown_status_variant_does_not_fail() {
        // Forward-compat: tmai-core adds a new AgentStatus variant.
        let json = r#"{
            "id": "x",
            "target": "x",
            "status": {"type": "WatchingPaint", "details": "."}
        }"#;
        let a: AgentSnapshot = serde_json::from_str(json).unwrap();
        assert!(matches!(a.status, AgentStatus::Unknown));
    }

    #[test]
    fn extra_fields_are_tolerated() {
        // Forward-compat: future snapshot fields must not crash the client.
        let json = r#"{
            "id": "x",
            "target": "x",
            "status": {"type": "Idle"},
            "agent_type": "ClaudeCode",
            "some_future_field": 42,
            "another_one": {"nested": true}
        }"#;
        let _: AgentSnapshot = serde_json::from_str(json).unwrap();
    }
}
