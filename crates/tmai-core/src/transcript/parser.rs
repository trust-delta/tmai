//! JSONL line parser for Claude Code transcripts.
//!
//! Each line in the transcript is a JSON object with a `type` field
//! indicating whether it's a user or assistant message.

use super::types::TranscriptRecord;

/// Parse a single JSONL line into TranscriptRecords.
///
/// Returns a Vec because one JSONL line (e.g. a user message with tool_result
/// blocks) can produce multiple records.
pub fn parse_jsonl_line(line: &str) -> Vec<TranscriptRecord> {
    let line = line.trim();
    if line.is_empty() {
        return Vec::new();
    }

    let value: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    // Extract top-level uuid and timestamp present on all records
    let uuid = value.get("uuid").and_then(|v| v.as_str()).map(String::from);
    let timestamp = value
        .get("timestamp")
        .and_then(|v| v.as_str())
        .map(String::from);

    let msg_type = match value.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return Vec::new(),
    };

    match msg_type {
        "user" => parse_user_message(&value, uuid, timestamp),
        "assistant" => parse_assistant_message(&value, uuid, timestamp),
        _ => Vec::new(),
    }
}

/// Parse a user message record.
///
/// User messages contain text content and may also contain tool_result blocks
/// (tool execution results are sent back as part of user messages in the API).
fn parse_user_message(
    value: &serde_json::Value,
    uuid: Option<String>,
    timestamp: Option<String>,
) -> Vec<TranscriptRecord> {
    let message = match value.get("message") {
        Some(m) => m,
        None => return Vec::new(),
    };
    let content = match message.get("content") {
        Some(c) => c,
        None => return Vec::new(),
    };

    // Simple string content
    if let Some(s) = content.as_str() {
        if s.is_empty() {
            return Vec::new();
        }
        return vec![TranscriptRecord::User {
            text: s.to_string(),
            uuid,
            timestamp,
        }];
    }

    // Array content: extract text blocks and tool_result blocks
    let arr = match content.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };

    let mut records = Vec::new();
    let mut text_parts = Vec::new();

    for block in arr {
        let block_type = match block.get("type").and_then(|t| t.as_str()) {
            Some(t) => t,
            None => continue,
        };

        match block_type {
            "text" => {
                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        text_parts.push(text.to_string());
                    }
                }
            }
            "tool_result" => {
                let output = extract_tool_result_content(block);
                if !output.is_empty() {
                    let is_error = block.get("is_error").and_then(|v| v.as_bool());
                    records.push(TranscriptRecord::ToolResult {
                        output_summary: truncate_for_preview(&output, 200),
                        is_error,
                        uuid: uuid.clone(),
                        timestamp: timestamp.clone(),
                    });
                }
            }
            _ => {}
        }
    }

    if !text_parts.is_empty() {
        // Insert user text before tool results
        records.insert(
            0,
            TranscriptRecord::User {
                text: text_parts.join("\n"),
                uuid: uuid.clone(),
                timestamp: timestamp.clone(),
            },
        );
    }

    records
}

/// Extract text content from a tool_result block
fn extract_tool_result_content(block: &serde_json::Value) -> String {
    let content = match block.get("content") {
        Some(c) => c,
        None => return String::new(),
    };

    if let Some(s) = content.as_str() {
        return s.to_string();
    }

    if let Some(arr) = content.as_array() {
        return arr
            .iter()
            .filter_map(|b| {
                if b.get("type")?.as_str()? == "text" {
                    b.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    String::new()
}

/// Parse an assistant message record.
///
/// Each content block becomes a separate TranscriptRecord:
/// - "text" → AssistantText
/// - "thinking" → Thinking
/// - "tool_use" → ToolUse (with input_summary and input_full)
fn parse_assistant_message(
    value: &serde_json::Value,
    uuid: Option<String>,
    timestamp: Option<String>,
) -> Vec<TranscriptRecord> {
    let message = match value.get("message") {
        Some(m) => m,
        None => return Vec::new(),
    };
    let content = match message.get("content").and_then(|c| c.as_array()) {
        Some(a) => a,
        None => return Vec::new(),
    };

    let mut records = Vec::new();

    for block in content {
        let block_type = match block.get("type").and_then(|t| t.as_str()) {
            Some(t) => t,
            None => continue,
        };

        match block_type {
            "text" => {
                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        records.push(TranscriptRecord::AssistantText {
                            text: text.to_string(),
                            uuid: uuid.clone(),
                            timestamp: timestamp.clone(),
                        });
                    }
                }
            }
            "thinking" => {
                if let Some(text) = block.get("thinking").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        records.push(TranscriptRecord::Thinking {
                            text: text.to_string(),
                            uuid: uuid.clone(),
                            timestamp: timestamp.clone(),
                        });
                    }
                }
            }
            "tool_use" => {
                let tool_name = block
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let input = block.get("input");
                let input_summary = summarize_tool_input_json(&tool_name, input);
                let input_full = input.cloned();
                records.push(TranscriptRecord::ToolUse {
                    tool_name,
                    input_summary,
                    input_full,
                    uuid: uuid.clone(),
                    timestamp: timestamp.clone(),
                });
            }
            _ => {}
        }
    }

    records
}

/// Summarize tool input JSON for display
fn summarize_tool_input_json(tool_name: &str, input: Option<&serde_json::Value>) -> String {
    let input = match input {
        Some(v) => v,
        None => return String::new(),
    };

    let key = match tool_name {
        "Bash" => "command",
        "Edit" | "Read" | "Write" => "file_path",
        "Grep" => "pattern",
        "Glob" => "pattern",
        "Agent" => "description",
        _ => "command",
    };

    input
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| truncate_for_preview(s, 80))
        .unwrap_or_default()
}

/// Truncate text for preview, keeping first line.
/// Uses char-based counting to avoid panicking on multi-byte UTF-8 boundaries.
fn truncate_for_preview(s: &str, max_len: usize) -> String {
    let first_line = s.lines().next().unwrap_or(s);
    let char_count = first_line.chars().count();
    if char_count > max_len {
        let truncated: String = first_line.chars().take(max_len).collect();
        format!("{}...", truncated)
    } else {
        first_line.to_string()
    }
}

/// Extract model ID from a transcript JSONL file.
///
/// Reads the first few lines looking for an assistant message with `message.model`.
/// Returns the model ID string (e.g., "claude-opus-4-6").
pub fn extract_model_id(path: &str) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    // Only scan first 20 lines — model appears in first assistant message
    for line in std::io::BufRead::lines(reader).take(20) {
        let line = line.ok()?;
        let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
        if value.get("type")?.as_str()? == "assistant" {
            if let Some(model) = value
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(|m| m.as_str())
            {
                return Some(model.to_string());
            }
        }
    }
    None
}

/// Convert a model ID to a short display name (e.g., "claude-opus-4-6" → "Opus 4.6")
pub fn model_display_name(model_id: &str) -> String {
    // Common model ID patterns
    if model_id.contains("opus") {
        if model_id.contains("4-6") {
            "Opus 4.6".to_string()
        } else if model_id.contains("4-5") {
            "Opus 4.5".to_string()
        } else {
            "Opus".to_string()
        }
    } else if model_id.contains("sonnet") {
        if model_id.contains("4-6") {
            "Sonnet 4.6".to_string()
        } else if model_id.contains("4-5") {
            "Sonnet 4.5".to_string()
        } else if model_id.contains("3-5") || model_id.contains("3.5") {
            "Sonnet 3.5".to_string()
        } else {
            "Sonnet".to_string()
        }
    } else if model_id.contains("haiku") {
        if model_id.contains("4-5") {
            "Haiku 4.5".to_string()
        } else {
            "Haiku".to_string()
        }
    } else {
        // Fallback: use last meaningful segment
        model_id
            .split(['/', '-'])
            .next_back()
            .unwrap_or(model_id)
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_user_message_string() {
        let line = r#"{"type":"user","uuid":"abc-123","timestamp":"2026-04-02T12:00:00Z","message":{"content":"Hello world"}}"#;
        let records = parse_jsonl_line(line);
        assert_eq!(records.len(), 1);
        match &records[0] {
            TranscriptRecord::User {
                text,
                uuid,
                timestamp,
            } => {
                assert_eq!(text, "Hello world");
                assert_eq!(uuid.as_deref(), Some("abc-123"));
                assert_eq!(timestamp.as_deref(), Some("2026-04-02T12:00:00Z"));
            }
            _ => panic!("Expected User record"),
        }
    }

    #[test]
    fn test_parse_user_message_array() {
        let line = r#"{"type":"user","message":{"content":[{"type":"text","text":"Hello"},{"type":"text","text":"World"}]}}"#;
        let records = parse_jsonl_line(line);
        assert_eq!(records.len(), 1);
        match &records[0] {
            TranscriptRecord::User { text, .. } => assert_eq!(text, "Hello\nWorld"),
            _ => panic!("Expected User record"),
        }
    }

    #[test]
    fn test_parse_user_message_with_tool_result() {
        let line = r#"{"type":"user","uuid":"u1","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"test output","is_error":false}]}}"#;
        let records = parse_jsonl_line(line);
        assert_eq!(records.len(), 1);
        match &records[0] {
            TranscriptRecord::ToolResult {
                output_summary,
                is_error,
                ..
            } => {
                assert_eq!(output_summary, "test output");
                assert_eq!(*is_error, Some(false));
            }
            _ => panic!("Expected ToolResult record"),
        }
    }

    #[test]
    fn test_parse_assistant_text() {
        let line = r#"{"type":"assistant","uuid":"a1","timestamp":"2026-04-02T12:01:00Z","message":{"content":[{"type":"text","text":"I'll help you."}]}}"#;
        let records = parse_jsonl_line(line);
        assert_eq!(records.len(), 1);
        match &records[0] {
            TranscriptRecord::AssistantText {
                text,
                uuid,
                timestamp,
            } => {
                assert_eq!(text, "I'll help you.");
                assert_eq!(uuid.as_deref(), Some("a1"));
                assert_eq!(timestamp.as_deref(), Some("2026-04-02T12:01:00Z"));
            }
            _ => panic!("Expected AssistantText record"),
        }
    }

    #[test]
    fn test_parse_assistant_tool_use() {
        let line = r#"{"type":"assistant","uuid":"a2","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls -la"}}]}}"#;
        let records = parse_jsonl_line(line);
        assert_eq!(records.len(), 1);
        match &records[0] {
            TranscriptRecord::ToolUse {
                tool_name,
                input_summary,
                input_full,
                ..
            } => {
                assert_eq!(tool_name, "Bash");
                assert_eq!(input_summary, "ls -la");
                assert!(input_full.is_some());
                assert_eq!(
                    input_full.as_ref().unwrap().get("command").unwrap(),
                    "ls -la"
                );
            }
            _ => panic!("Expected ToolUse record"),
        }
    }

    #[test]
    fn test_parse_thinking() {
        let line = r#"{"type":"assistant","uuid":"a3","message":{"content":[{"type":"thinking","thinking":"Let me analyze this..."}]}}"#;
        let records = parse_jsonl_line(line);
        assert_eq!(records.len(), 1);
        match &records[0] {
            TranscriptRecord::Thinking { text, uuid, .. } => {
                assert_eq!(text, "Let me analyze this...");
                assert_eq!(uuid.as_deref(), Some("a3"));
            }
            _ => panic!("Expected Thinking record"),
        }
    }

    #[test]
    fn test_parse_empty_line() {
        assert!(parse_jsonl_line("").is_empty());
        assert!(parse_jsonl_line("  ").is_empty());
    }

    #[test]
    fn test_parse_invalid_json() {
        assert!(parse_jsonl_line("not json").is_empty());
    }

    #[test]
    fn test_parse_unknown_type() {
        let line = r#"{"type":"system","data":"info"}"#;
        assert!(parse_jsonl_line(line).is_empty());
    }

    #[test]
    fn test_parse_no_uuid_timestamp() {
        let line = r#"{"type":"user","message":{"content":"Hi"}}"#;
        let records = parse_jsonl_line(line);
        assert_eq!(records.len(), 1);
        match &records[0] {
            TranscriptRecord::User {
                uuid, timestamp, ..
            } => {
                assert!(uuid.is_none());
                assert!(timestamp.is_none());
            }
            _ => panic!("Expected User record"),
        }
    }

    #[test]
    fn test_model_display_name() {
        assert_eq!(model_display_name("claude-opus-4-6"), "Opus 4.6");
        assert_eq!(model_display_name("claude-sonnet-4-6"), "Sonnet 4.6");
        assert_eq!(
            model_display_name("claude-sonnet-4-5-20250514"),
            "Sonnet 4.5"
        );
        assert_eq!(model_display_name("claude-haiku-4-5-20251001"), "Haiku 4.5");
        assert_eq!(model_display_name("claude-opus-4-5-20250918"), "Opus 4.5");
        assert_eq!(
            model_display_name("claude-3-5-sonnet-20241022"),
            "Sonnet 3.5"
        );
        assert_eq!(model_display_name("gpt-4o"), "4o");
    }

    #[test]
    fn test_extract_model_id_from_file() {
        use std::io::Write;
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();
        {
            let mut f = std::fs::File::create(&path).unwrap();
            writeln!(f, r#"{{"type":"user","message":{{"content":"hi"}}}}"#).unwrap();
            writeln!(f, r#"{{"type":"assistant","message":{{"model":"claude-opus-4-6","content":[{{"type":"text","text":"hello"}}]}}}}"#).unwrap();
        }
        assert_eq!(extract_model_id(&path), Some("claude-opus-4-6".to_string()));
    }
}
