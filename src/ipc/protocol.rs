//! IPC protocol definitions for tmai wrapper ↔ parent communication
//!
//! Uses newline-delimited JSON (ndjson) for bidirectional messaging
//! over Unix domain sockets.

use std::path::PathBuf;

use anyhow::Result;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// Get the base state directory, preferring XDG_RUNTIME_DIR for security
pub fn state_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_RUNTIME_DIR") {
        PathBuf::from(xdg).join("tmai")
    } else {
        let uid = unsafe { libc::getuid() };
        PathBuf::from(format!("/tmp/tmai-{}", uid))
    }
}

/// Get the IPC socket path
pub fn socket_path() -> PathBuf {
    state_dir().join("control.sock")
}

/// Status of a wrapped agent
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WrapStatus {
    /// Agent is actively outputting (last output within 200ms)
    Processing,
    /// Agent is idle (output stopped, no approval detected)
    #[default]
    Idle,
    /// Agent is awaiting approval (output stopped with approval pattern)
    AwaitingApproval,
}

/// Type of approval being requested (for wrapped agents)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WrapApprovalType {
    /// File edit/create/delete
    FileEdit,
    /// Shell command execution
    ShellCommand,
    /// MCP tool invocation
    McpTool,
    /// User question with selectable choices
    UserQuestion,
    /// Yes/No confirmation
    YesNo,
    /// Other/unknown
    Other,
}

/// State data for a wrapped agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrapState {
    /// Current status
    pub status: WrapStatus,
    /// Type of approval (if awaiting approval)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_type: Option<WrapApprovalType>,
    /// Details about the current state
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// Available choices (for UserQuestion)
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub choices: Vec<String>,
    /// Whether multiple selections are allowed
    #[serde(default)]
    pub multi_select: bool,
    /// Current cursor position (1-indexed, for UserQuestion)
    #[serde(default)]
    pub cursor_position: usize,
    /// Timestamp of last output (Unix millis)
    pub last_output: u64,
    /// Timestamp of last input (Unix millis)
    pub last_input: u64,
    /// Process ID of the wrapped command
    pub pid: u32,
    /// Tmux pane ID (if known)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
    /// Team name (if this agent is part of a team)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub team_name: Option<String>,
    /// Team member name
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub team_member_name: Option<String>,
    /// Whether this agent is the team lead
    #[serde(default)]
    pub is_team_lead: bool,
}

impl Default for WrapState {
    fn default() -> Self {
        let now = current_time_millis();
        Self {
            status: WrapStatus::Idle,
            approval_type: None,
            details: None,
            choices: Vec::new(),
            multi_select: false,
            cursor_position: 0,
            last_output: now,
            last_input: now,
            pid: 0,
            pane_id: None,
            team_name: None,
            team_member_name: None,
            is_team_lead: false,
        }
    }
}

impl WrapState {
    /// Create a new state for processing
    pub fn processing(pid: u32) -> Self {
        Self {
            status: WrapStatus::Processing,
            pid,
            ..Default::default()
        }
    }

    /// Create a new state for idle
    pub fn idle(pid: u32) -> Self {
        Self {
            status: WrapStatus::Idle,
            pid,
            ..Default::default()
        }
    }

    /// Create a new state for awaiting approval
    pub fn awaiting_approval(
        pid: u32,
        approval_type: WrapApprovalType,
        details: Option<String>,
    ) -> Self {
        Self {
            status: WrapStatus::AwaitingApproval,
            approval_type: Some(approval_type),
            details,
            pid,
            ..Default::default()
        }
    }

    /// Create a state for user question
    pub fn user_question(
        pid: u32,
        choices: Vec<String>,
        multi_select: bool,
        cursor_position: usize,
    ) -> Self {
        Self {
            status: WrapStatus::AwaitingApproval,
            approval_type: Some(WrapApprovalType::UserQuestion),
            choices,
            multi_select,
            cursor_position,
            pid,
            ..Default::default()
        }
    }

    /// Update last output timestamp
    pub fn touch_output(&mut self) {
        self.last_output = current_time_millis();
    }

    /// Update last input timestamp
    pub fn touch_input(&mut self) {
        self.last_input = current_time_millis();
    }

    /// Set pane ID
    pub fn with_pane_id(mut self, pane_id: String) -> Self {
        self.pane_id = Some(pane_id);
        self
    }
}

/// Message from wrapper to tmai parent (upstream)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    /// Initial registration message
    Register {
        pane_id: String,
        pid: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        team_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        team_member_name: Option<String>,
        #[serde(default)]
        is_team_lead: bool,
    },
    /// State update from wrapper
    StateUpdate { state: WrapState },
}

/// Message from tmai parent to wrapper (downstream)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    /// Registration acknowledgement
    Registered { connection_id: String },
    /// Send keys to the wrapped process
    SendKeys { keys: String, literal: bool },
    /// Send text followed by Enter
    SendKeysAndEnter { text: String },
}

/// Encode a message as ndjson (JSON + newline)
pub fn encode<T: Serialize>(msg: &T) -> Result<Vec<u8>> {
    let mut json = serde_json::to_vec(msg)?;
    json.push(b'\n');
    Ok(json)
}

/// Decode a message from a JSON line
pub fn decode<T: DeserializeOwned>(line: &[u8]) -> Result<T> {
    Ok(serde_json::from_slice(line)?)
}

/// Get current time in milliseconds
pub fn current_time_millis() -> u64 {
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
    fn test_wrap_state_serialization() {
        let state = WrapState::processing(1234);
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"status\":\"processing\""));
        assert!(json.contains("\"pid\":1234"));
    }

    #[test]
    fn test_wrap_state_deserialization() {
        let json = r#"{
            "status": "awaiting_approval",
            "approval_type": "user_question",
            "choices": ["Yes", "No"],
            "multi_select": false,
            "cursor_position": 1,
            "last_output": 1234567890,
            "last_input": 1234567890,
            "pid": 5678
        }"#;

        let state: WrapState = serde_json::from_str(json).unwrap();
        assert_eq!(state.status, WrapStatus::AwaitingApproval);
        assert_eq!(state.approval_type, Some(WrapApprovalType::UserQuestion));
        assert_eq!(state.choices, vec!["Yes", "No"]);
        assert_eq!(state.cursor_position, 1);
        assert_eq!(state.pid, 5678);
    }

    #[test]
    fn test_current_time_millis() {
        let t1 = current_time_millis();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let t2 = current_time_millis();
        assert!(t2 > t1);
    }

    #[test]
    fn test_client_message_register_serialization() {
        let msg = ClientMessage::Register {
            pane_id: "5".to_string(),
            pid: 1234,
            team_name: Some("my-team".to_string()),
            team_member_name: Some("dev".to_string()),
            is_team_lead: false,
        };
        let encoded = encode(&msg).unwrap();
        let decoded: ClientMessage = decode(encoded.trim_ascii_end()).unwrap();
        match decoded {
            ClientMessage::Register { pane_id, pid, .. } => {
                assert_eq!(pane_id, "5");
                assert_eq!(pid, 1234);
            }
            _ => panic!("Expected Register"),
        }
    }

    #[test]
    fn test_server_message_send_keys_serialization() {
        let msg = ServerMessage::SendKeys {
            keys: "y".to_string(),
            literal: true,
        };
        let encoded = encode(&msg).unwrap();
        let decoded: ServerMessage = decode(encoded.trim_ascii_end()).unwrap();
        match decoded {
            ServerMessage::SendKeys { keys, literal } => {
                assert_eq!(keys, "y");
                assert!(literal);
            }
            _ => panic!("Expected SendKeys"),
        }
    }

    #[test]
    fn test_state_dir_default() {
        // Without XDG_RUNTIME_DIR, should use /tmp/tmai-UID
        temp_env::with_var_unset("XDG_RUNTIME_DIR", || {
            let dir = state_dir();
            let uid = unsafe { libc::getuid() };
            assert_eq!(dir, PathBuf::from(format!("/tmp/tmai-{}", uid)));
        });
    }

    #[test]
    fn test_state_dir_with_xdg() {
        temp_env::with_var("XDG_RUNTIME_DIR", Some("/run/user/1000"), || {
            let dir = state_dir();
            assert_eq!(dir, PathBuf::from("/run/user/1000/tmai"));
        });
    }

    #[test]
    fn test_socket_path_contains_control_sock() {
        let path = socket_path();
        assert!(path.ends_with("control.sock"));
    }

    #[test]
    fn test_encode_decode_roundtrip() {
        let state = WrapState::user_question(42, vec!["A".into(), "B".into()], true, 1);
        let msg = ClientMessage::StateUpdate { state };
        let encoded = encode(&msg).unwrap();
        assert!(encoded.ends_with(b"\n"));
        let decoded: ClientMessage = decode(encoded.trim_ascii_end()).unwrap();
        match decoded {
            ClientMessage::StateUpdate { state } => {
                assert_eq!(state.pid, 42);
                assert_eq!(state.choices, vec!["A", "B"]);
                assert!(state.multi_select);
            }
            _ => panic!("Expected StateUpdate"),
        }
    }
}
