//! Hand-written API types mirroring the tmai-api-spec shapes that this
//! client consumes. Only fields read by the UI are declared; all other
//! fields are dropped on deserialization (serde default).
//!
//! Forward-compat rule: never fail on unknown fields, never fail on
//! unknown enum variants — see `AgentType::Unknown` and
//! `AgentStatus::Unknown`.

use serde::Deserialize;

/// A single agent, as returned by `GET /api/agents` and the `agents`
/// SSE event. Fields the UI does not display are omitted here.
#[derive(Debug, Clone, Deserialize)]
pub struct Agent {
    pub id: String,
    pub target: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub session: String,
    #[serde(default)]
    pub display_cwd: String,
    pub agent_type: AgentType,
    pub status: AgentStatus,
    #[serde(default)]
    pub is_virtual: bool,
    #[serde(default)]
    pub is_orchestrator: bool,
    #[serde(default)]
    pub phase: Option<Phase>,
    #[serde(default)]
    pub session_name: Option<String>,
}

impl Agent {
    /// Human-friendly name for list display: prefer the `/rename` name,
    /// then the pane title, then the target.
    pub fn friendly_name(&self) -> &str {
        if let Some(n) = self.session_name.as_deref() {
            if !n.is_empty() {
                return n;
            }
        }
        if !self.display_name.is_empty() {
            return &self.display_name;
        }
        &self.target
    }

    pub fn status_label(&self) -> &'static str {
        match &self.status {
            AgentStatus::Idle => "idle",
            AgentStatus::Processing { .. } => "working",
            AgentStatus::AwaitingApproval { .. } => "approval",
            AgentStatus::Error { .. } => "error",
            AgentStatus::Offline => "offline",
            AgentStatus::Unknown => "?",
        }
    }
}

/// Agent type — tolerates unknown values from newer tmai-core.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum AgentType {
    Named(NamedAgentType),
    Custom {
        #[serde(rename = "Custom")]
        custom: String,
    },
    /// Any string the client does not yet know about.
    Unknown(serde_json::Value),
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub enum NamedAgentType {
    ClaudeCode,
    OpenCode,
    CodexCli,
    GeminiCli,
}

/// Agent status, mirroring `tmai_core::agents::AgentStatus`.
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

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub enum Phase {
    Working,
    Blocked,
    Idle,
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
    fn deserialize_minimal_agent() {
        // Only the required fields. Anything else must default.
        let json = r#"{
            "id": "main:0.0",
            "target": "main:0.0",
            "agent_type": "ClaudeCode",
            "status": {"type": "Idle"}
        }"#;
        let agent: Agent = serde_json::from_str(json).unwrap();
        assert_eq!(agent.id, "main:0.0");
        assert!(matches!(
            agent.agent_type,
            AgentType::Named(NamedAgentType::ClaudeCode)
        ));
        assert!(matches!(agent.status, AgentStatus::Idle));
    }

    #[test]
    fn unknown_status_variant_does_not_fail() {
        // Forward-compat: tmai-core adds a new AgentStatus variant.
        let json = r#"{
            "id": "x",
            "target": "x",
            "agent_type": "ClaudeCode",
            "status": {"type": "WatchingPaint", "details": "."}
        }"#;
        let agent: Agent = serde_json::from_str(json).unwrap();
        assert!(matches!(agent.status, AgentStatus::Unknown));
    }

    #[test]
    fn unknown_agent_type_falls_through() {
        // Forward-compat: a new named AgentType value still deserialises.
        let json = r#"{
            "id": "x",
            "target": "x",
            "agent_type": "ZedAgent",
            "status": {"type": "Idle"}
        }"#;
        let agent: Agent = serde_json::from_str(json).unwrap();
        assert!(matches!(agent.agent_type, AgentType::Unknown(_)));
    }

    #[test]
    fn extra_fields_are_tolerated() {
        // Forward-compat: future snapshot fields must not crash the client.
        let json = r#"{
            "id": "x",
            "target": "x",
            "agent_type": "ClaudeCode",
            "status": {"type": "Idle"},
            "some_future_field": 42,
            "another_one": {"nested": true}
        }"#;
        let _: Agent = serde_json::from_str(json).unwrap();
    }

    #[test]
    fn friendly_name_prefers_session_name() {
        let agent = Agent {
            id: "x".into(),
            target: "main:0.0".into(),
            display_name: "main:0.0".into(),
            title: String::new(),
            session: "main".into(),
            display_cwd: String::new(),
            agent_type: AgentType::Named(NamedAgentType::ClaudeCode),
            status: AgentStatus::Idle,
            is_virtual: false,
            is_orchestrator: false,
            phase: None,
            session_name: Some("refactor-tui".into()),
        };
        assert_eq!(agent.friendly_name(), "refactor-tui");
    }
}
