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

    /// Create a thread/start request to begin a new conversation thread
    pub fn thread_start(id: u64) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            method: "thread/start".to_string(),
            params: Some(serde_json::json!({})),
        }
    }

    /// Create a turn/start request to send a prompt to the agent
    pub fn turn_start(id: u64, thread_id: &str, text: &str) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            method: "turn/start".to_string(),
            params: Some(serde_json::json!({
                "threadId": thread_id,
                "input": [{ "type": "text", "text": text }]
            })),
        }
    }

    /// Create a turn/interrupt request to cancel the active turn
    pub fn turn_interrupt(id: u64, thread_id: &str) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            method: "turn/interrupt".to_string(),
            params: Some(serde_json::json!({
                "threadId": thread_id
            })),
        }
    }
}

/// JSON-RPC 2.0 response to send back (for approval requests from server)
#[derive(Debug, Serialize)]
pub struct JsonRpcResponseOut {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub result: serde_json::Value,
}

impl JsonRpcResponseOut {
    /// Create an approval response (accept/deny a command or file change)
    pub fn approval(id: u64, decision: &str) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: serde_json::json!({ "decision": decision }),
        }
    }
}

/// JSON-RPC 2.0 response message (received from Codex app-server)
#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    /// Some Codex versions omit this field
    #[allow(dead_code)]
    #[serde(default)]
    pub jsonrpc: Option<String>,
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
    /// Some Codex versions omit this field
    #[allow(dead_code)]
    #[serde(default)]
    pub jsonrpc: Option<String>,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

/// Incoming WebSocket message — response, notification, or server request (approval)
#[derive(Debug)]
pub enum CodexWsMessage {
    Response(JsonRpcResponse),
    Notification(JsonRpcNotification),
    /// Server-initiated request requiring a response (e.g., approval requests with `id`)
    Request {
        id: u64,
        notification: JsonRpcNotification,
    },
}

impl CodexWsMessage {
    /// Parse a JSON string into a CodexWsMessage
    pub fn parse(text: &str) -> Result<Self, serde_json::Error> {
        let value: serde_json::Value = serde_json::from_str(text)?;
        let has_id = value.get("id").is_some_and(|id| !id.is_null());
        let has_method = value.get("method").is_some();

        if has_id && has_method {
            // Server request: has both id and method (e.g., approval requests)
            let id = value["id"].as_u64().unwrap_or(0);
            let notif: JsonRpcNotification = serde_json::from_value(value)?;
            Ok(CodexWsMessage::Request {
                id,
                notification: notif,
            })
        } else if has_id {
            // Response to our request (has id, no method)
            let resp: JsonRpcResponse = serde_json::from_value(value)?;
            Ok(CodexWsMessage::Response(resp))
        } else if has_method {
            // Notification (no id, has method)
            let notif: JsonRpcNotification = serde_json::from_value(value)?;
            Ok(CodexWsMessage::Notification(notif))
        } else {
            // Fallback: treat as response
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

    /// An item started processing.
    /// Item types: "commandExecution", "fileChange", "agentMessage",
    /// "userMessage", "plan", "reasoning"
    ItemStarted {
        /// Item type (e.g., "commandExecution", "fileChange", "agentMessage")
        item_type: String,
        /// For commandExecution items: the command string
        command: Option<String>,
        /// For fileChange items: the file path
        file_path: Option<String>,
        /// Generic name fallback
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
        /// Output/result text (for activity log)
        output: Option<String>,
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

    /// Thread started (provides cwd and thread_id)
    ThreadStarted {
        /// Working directory
        cwd: Option<String>,
        /// Thread ID for subsequent turn/start calls
        thread_id: Option<String>,
    },

    /// Streaming delta (content being generated)
    StreamingDelta {
        /// The full method name (e.g., "item/agentMessage/delta")
        method: String,
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
            let item = params.and_then(|p| p.get("item"));
            let item_type = item
                .and_then(|i| i.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string();
            // Extract fields based on item type
            let command = if item_type == "commandExecution" {
                item.and_then(|i| i.get("command"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            };
            let file_path = if item_type == "fileChange" {
                item.and_then(|i| i.get("filePath"))
                    .or_else(|| item.and_then(|i| i.get("file_path")))
                    .and_then(|f| f.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            };
            let name = item
                .and_then(|i| i.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string());
            CodexEvent::ItemStarted {
                item_type,
                command,
                file_path,
                name,
            }
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
            let item = params.and_then(|p| p.get("item"));
            let item_type = item
                .and_then(|i| i.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string();
            let output = item
                .and_then(|i| i.get("output"))
                .or_else(|| item.and_then(|i| i.get("result")))
                .and_then(|o| o.as_str())
                .map(|s| s.to_string());
            CodexEvent::ItemCompleted { item_type, output }
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
            let thread_id = params
                .and_then(|p| p.get("threadId"))
                .or_else(|| params.and_then(|p| p.get("thread_id")))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());
            CodexEvent::ThreadStarted { cwd, thread_id }
        }

        // Streaming delta events — content being generated
        "item/agentMessage/delta"
        | "item/plan/delta"
        | "item/reasoning/summaryTextDelta"
        | "item/reasoning/textDelta"
        | "item/commandExecution/outputDelta"
        | "item/fileChange/outputDelta" => CodexEvent::StreamingDelta {
            method: method.to_string(),
        },

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
            jsonrpc: Some("2.0".to_string()),
            method: "turn/started".to_string(),
            params: Some(serde_json::json!({})),
        };
        assert_eq!(parse_codex_event(&notif), CodexEvent::TurnStarted);
    }

    #[test]
    fn test_parse_item_started_command_execution() {
        let notif = JsonRpcNotification {
            jsonrpc: Some("2.0".to_string()),
            method: "item/started".to_string(),
            params: Some(serde_json::json!({
                "item": {
                    "type": "commandExecution",
                    "command": "git status",
                    "cwd": "/home/user/project"
                }
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ItemStarted {
                item_type: "commandExecution".to_string(),
                command: Some("git status".to_string()),
                file_path: None,
                name: None,
            }
        );
    }

    #[test]
    fn test_parse_item_started_file_change() {
        let notif = JsonRpcNotification {
            jsonrpc: Some("2.0".to_string()),
            method: "item/started".to_string(),
            params: Some(serde_json::json!({
                "item": {
                    "type": "fileChange",
                    "filePath": "src/main.rs"
                }
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ItemStarted {
                item_type: "fileChange".to_string(),
                command: None,
                file_path: Some("src/main.rs".to_string()),
                name: None,
            }
        );
    }

    #[test]
    fn test_parse_item_started_agent_message() {
        let notif = JsonRpcNotification {
            jsonrpc: Some("2.0".to_string()),
            method: "item/started".to_string(),
            params: Some(serde_json::json!({
                "item": {
                    "type": "agentMessage"
                }
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ItemStarted {
                item_type: "agentMessage".to_string(),
                command: None,
                file_path: None,
                name: None,
            }
        );
    }

    #[test]
    fn test_parse_command_approval() {
        let notif = JsonRpcNotification {
            jsonrpc: Some("2.0".to_string()),
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
            jsonrpc: Some("2.0".to_string()),
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
            jsonrpc: Some("2.0".to_string()),
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
            jsonrpc: Some("2.0".to_string()),
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
            jsonrpc: Some("2.0".to_string()),
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
            jsonrpc: Some("2.0".to_string()),
            method: "thread/started".to_string(),
            params: Some(serde_json::json!({
                "cwd": "/home/user/project",
                "threadId": "thread-abc-123"
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ThreadStarted {
                cwd: Some("/home/user/project".to_string()),
                thread_id: Some("thread-abc-123".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_server_request_with_id_and_method() {
        // Approval requests have both id and method — parsed as Request
        let json = r#"{"jsonrpc":"2.0","id":42,"method":"item/commandExecution/requestApproval","params":{"command":"rm -rf /tmp"}}"#;
        let msg = CodexWsMessage::parse(json).unwrap();
        match msg {
            CodexWsMessage::Request { id, notification } => {
                assert_eq!(id, 42);
                assert_eq!(notification.method, "item/commandExecution/requestApproval");
            }
            _ => panic!("Expected Request variant"),
        }
    }

    #[test]
    fn test_parse_thread_started_without_thread_id() {
        let notif = JsonRpcNotification {
            jsonrpc: Some("2.0".to_string()),
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
                thread_id: None,
            }
        );
    }

    #[test]
    fn test_outbound_thread_start_format() {
        let req = JsonRpcRequest::thread_start(10);
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["method"], "thread/start");
        assert_eq!(json["id"], 10);
    }

    #[test]
    fn test_outbound_turn_start_format() {
        let req = JsonRpcRequest::turn_start(11, "thread-abc", "fix the bug");
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["method"], "turn/start");
        assert_eq!(json["params"]["threadId"], "thread-abc");
        assert_eq!(json["params"]["input"][0]["type"], "text");
        assert_eq!(json["params"]["input"][0]["text"], "fix the bug");
    }

    #[test]
    fn test_outbound_turn_interrupt_format() {
        let req = JsonRpcRequest::turn_interrupt(12, "thread-abc");
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["method"], "turn/interrupt");
        assert_eq!(json["params"]["threadId"], "thread-abc");
    }

    #[test]
    fn test_outbound_approval_response_format() {
        let resp = JsonRpcResponseOut::approval(42, "accept");
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], 42);
        assert_eq!(json["result"]["decision"], "accept");
    }

    #[test]
    fn test_parse_unknown_event() {
        let notif = JsonRpcNotification {
            jsonrpc: Some("2.0".to_string()),
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
            jsonrpc: Some("2.0".to_string()),
            method: "item/completed".to_string(),
            params: Some(serde_json::json!({
                "item": {
                    "type": "commandExecution",
                    "output": "On branch main\nnothing to commit"
                }
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ItemCompleted {
                item_type: "commandExecution".to_string(),
                output: Some("On branch main\nnothing to commit".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_item_completed_no_output() {
        let notif = JsonRpcNotification {
            jsonrpc: Some("2.0".to_string()),
            method: "item/completed".to_string(),
            params: Some(serde_json::json!({
                "item": {
                    "type": "agentMessage"
                }
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::ItemCompleted {
                item_type: "agentMessage".to_string(),
                output: None,
            }
        );
    }

    #[test]
    fn test_parse_streaming_delta() {
        let notif = JsonRpcNotification {
            jsonrpc: Some("2.0".to_string()),
            method: "item/agentMessage/delta".to_string(),
            params: Some(serde_json::json!({
                "itemId": "msg_001",
                "delta": "Hello"
            })),
        };
        let event = parse_codex_event(&notif);
        assert_eq!(
            event,
            CodexEvent::StreamingDelta {
                method: "item/agentMessage/delta".to_string(),
            }
        );
    }
}
