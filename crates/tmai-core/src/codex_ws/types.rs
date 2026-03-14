//! JSON-RPC message types and Codex CLI app-server event definitions.

use serde::{Deserialize, Serialize};

/// JSON-RPC 2.0 request message (sent to Codex app-server)
#[derive(Debug, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl JsonRpcRequest {
    /// Create an initialize request
    pub fn initialize(id: u64) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            method: "initialize".to_string(),
            params: Some(serde_json::json!({
                "protocolVersion": "2025-01-01",
                "capabilities": {},
                "clientInfo": {
                    "name": "tmai",
                    "version": env!("CARGO_PKG_VERSION")
                }
            })),
        }
    }
}

/// JSON-RPC 2.0 response message (received from Codex app-server)
#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    #[allow(dead_code)]
    pub jsonrpc: String,
    #[allow(dead_code)]
    pub id: Option<u64>,
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC error object
#[derive(Debug, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}

/// JSON-RPC 2.0 notification (no id field)
#[derive(Debug, Deserialize)]
pub struct JsonRpcNotification {
    #[allow(dead_code)]
    pub jsonrpc: String,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

/// Incoming WebSocket message — either a response or a notification
#[derive(Debug)]
pub enum CodexWsMessage {
    Response(JsonRpcResponse),
    Notification(JsonRpcNotification),
}

impl CodexWsMessage {
    /// Parse a JSON string into a CodexWsMessage
    pub fn parse(text: &str) -> Result<Self, serde_json::Error> {
        // If it has an "id" field, it's a response; otherwise a notification
        let value: serde_json::Value = serde_json::from_str(text)?;
        if value.get("id").is_some() && !value.get("id").unwrap().is_null() {
            let resp: JsonRpcResponse = serde_json::from_value(value)?;
            Ok(CodexWsMessage::Response(resp))
        } else if value.get("method").is_some() {
            let notif: JsonRpcNotification = serde_json::from_value(value)?;
            Ok(CodexWsMessage::Notification(notif))
        } else {
            // Response with null id (shouldn't happen, but handle gracefully)
            let resp: JsonRpcResponse = serde_json::from_value(value)?;
            Ok(CodexWsMessage::Response(resp))
        }
    }
}

/// Codex app-server event types extracted from notifications
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexEvent {
    /// A new turn started (user prompt submitted)
    TurnStarted,

    /// An item started processing
    ItemStarted {
        /// Item type (e.g., "message", "function_call", "function_call_output")
        item_type: String,
        /// For function_call items, the function/command name
        name: Option<String>,
    },

    /// A command execution approval is requested
    CommandApprovalRequested {
        /// The command being requested
        command: String,
    },

    /// A file change approval is requested
    FileChangeApprovalRequested {
        /// The file path
        file_path: String,
    },

    /// An item completed
    ItemCompleted {
        /// Item type
        item_type: String,
    },

    /// A turn completed
    TurnCompleted {
        /// Whether the turn completed successfully or failed
        status: TurnStatus,
    },

    /// Token usage updated
    TokenUsageUpdated {
        /// Total input tokens used
        input_tokens: u64,
        /// Total output tokens used
        output_tokens: u64,
    },

    /// Thread started (provides cwd)
    ThreadStarted {
        /// Working directory
        cwd: Option<String>,
    },

    /// Unknown/unrecognized event
    Unknown { method: String },
}

/// Status of a completed turn
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnStatus {
    Completed,
    Failed,
    Other(String),
}

/// Parse a JSON-RPC notification into a CodexEvent
pub fn parse_codex_event(notification: &JsonRpcNotification) -> CodexEvent {
    let method = notification.method.as_str();
    let params = notification.params.as_ref();

    match method {
        "turn/started" => CodexEvent::TurnStarted,

        "item/started" => {
            let item_type = params
                .and_then(|p| p.get("item"))
                .and_then(|item| item.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string();
            let name = params
                .and_then(|p| p.get("item"))
                .and_then(|item| item.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string());
            CodexEvent::ItemStarted { item_type, name }
        }

        "item/commandExecution/requestApproval" => {
            let command = params
                .and_then(|p| p.get("command"))
                .and_then(|c| c.as_str())
                .or_else(|| {
                    params
                        .and_then(|p| p.get("item"))
                        .and_then(|item| item.get("name"))
                        .and_then(|n| n.as_str())
                })
                .unwrap_or("unknown")
                .to_string();
            CodexEvent::CommandApprovalRequested { command }
        }

        "item/fileChange/requestApproval" => {
            let file_path = params
                .and_then(|p| p.get("file_path"))
                .or_else(|| params.and_then(|p| p.get("filePath")))
                .and_then(|f| f.as_str())
                .unwrap_or("unknown")
                .to_string();
            CodexEvent::FileChangeApprovalRequested { file_path }
        }

        "item/completed" => {
            let item_type = params
                .and_then(|p| p.get("item"))
                .and_then(|item| item.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string();
            CodexEvent::ItemCompleted { item_type }
        }

        "turn/completed" => {
            let status_str = params
                .and_then(|p| p.get("status"))
                .and_then(|s| s.as_str())
                .unwrap_or("completed");
            let status = match status_str {
                "completed" => TurnStatus::Completed,
                "failed" => TurnStatus::Failed,
                other => TurnStatus::Other(other.to_string()),
            };
            CodexEvent::TurnCompleted { status }
        }

        "thread/tokenUsage/updated" => {
            let input_tokens = params
                .and_then(|p| p.get("input_tokens"))
                .or_else(|| params.and_then(|p| p.get("inputTokens")))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let output_tokens = params
                .and_then(|p| p.get("output_tokens"))
                .or_else(|| params.and_then(|p| p.get("outputTokens")))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            CodexEvent::TokenUsageUpdated {
                input_tokens,
                output_tokens,
            }
        }

        "thread/started" => {
            let cwd = params
                .and_then(|p| p.get("cwd"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string());
            CodexEvent::ThreadStarted { cwd }
        }

        _ => CodexEvent::Unknown {
            method: method.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_request_serialization() {
        let req = JsonRpcRequest::initialize(1);
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"jsonrpc\":\"2.0\""));
        assert!(json.contains("\"method\":\"initialize\""));
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("tmai"));
    }

    #[test]
    fn test_parse_response() {
        let json = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-01-01"}}"#;
        let msg = CodexWsMessage::parse(json).unwrap();
        assert!(matches!(msg, CodexWsMessage::Response(_)));
    }

    #[test]
    fn test_parse_notification() {
        let json = r#"{"jsonrpc":"2.0","method":"turn/started","params":{}}"#;
        let msg = CodexWsMessage::parse(json).unwrap();
        assert!(matches!(msg, CodexWsMessage::Notification(_)));
    }

    #[test]
    fn test_parse_error_response() {
        let json =
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"Invalid request"}}"#;
        let msg = CodexWsMessage::parse(json).unwrap();
        if let CodexWsMessage::Response(resp) = msg {
            assert!(resp.error.is_some());
            assert_eq!(resp.error.unwrap().code, -32600);
        } else {
            panic!("Expected Response");
        }
    }

    #[test]
    fn test_parse_turn_started() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "turn/started".to_string(),
            params: Some(serde_json::json!({})),
        };
        assert_eq!(parse_codex_event(&notif), CodexEvent::TurnStarted);
    }

    #[test]
    fn test_parse_item_started_function_call() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "item/started".to_string(),
            params: Some(serde_json::json!({
                "item": {
                    "type": "function_call",
                    "name": "shell"
                }
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ItemStarted {
                item_type: "function_call".to_string(),
                name: Some("shell".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_command_approval() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "item/commandExecution/requestApproval".to_string(),
            params: Some(serde_json::json!({
                "command": "rm -rf /tmp/test"
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::CommandApprovalRequested {
                command: "rm -rf /tmp/test".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_file_change_approval() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "item/fileChange/requestApproval".to_string(),
            params: Some(serde_json::json!({
                "file_path": "/tmp/test.rs"
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::FileChangeApprovalRequested {
                file_path: "/tmp/test.rs".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_turn_completed() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "turn/completed".to_string(),
            params: Some(serde_json::json!({
                "status": "completed"
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::TurnCompleted {
                status: TurnStatus::Completed,
            }
        );
    }

    #[test]
    fn test_parse_turn_completed_failed() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "turn/completed".to_string(),
            params: Some(serde_json::json!({
                "status": "failed"
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::TurnCompleted {
                status: TurnStatus::Failed,
            }
        );
    }

    #[test]
    fn test_parse_token_usage() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "thread/tokenUsage/updated".to_string(),
            params: Some(serde_json::json!({
                "input_tokens": 1500,
                "output_tokens": 300
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::TokenUsageUpdated {
                input_tokens: 1500,
                output_tokens: 300,
            }
        );
    }

    #[test]
    fn test_parse_thread_started() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "thread/started".to_string(),
            params: Some(serde_json::json!({
                "cwd": "/home/user/project"
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ThreadStarted {
                cwd: Some("/home/user/project".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_unknown_event() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "some/future/event".to_string(),
            params: None,
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::Unknown {
                method: "some/future/event".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_item_completed() {
        let notif = JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "item/completed".to_string(),
            params: Some(serde_json::json!({
                "item": {
                    "type": "function_call_output"
                }
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ItemCompleted {
                item_type: "function_call_output".to_string(),
            }
        );
    }
}
