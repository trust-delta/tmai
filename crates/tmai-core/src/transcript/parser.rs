//! JSONL line parser for Claude Code transcripts.
//!
//! Each line in the transcript is a JSON object with a `type` field
//! indicating whether it's a user or assistant message.

use super::types::TranscriptRecord;

/// Parse a single JSONL line into a TranscriptRecord
pub fn parse_jsonl_line(line: &str) -> Option<TranscriptRecord> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let msg_type = value.get("type")?.as_str()?;

    match msg_type {
        "user" => parse_user_message(&value),
        "assistant" => parse_assistant_message(&value),
        "result" => parse_result_message(&value),
        _ => None,
    }
}

/// Parse a user message record
fn parse_user_message(value: &serde_json::Value) -> Option<TranscriptRecord> {
    // User messages have message.content as a string or array
    let message = value.get("message")?;
    let content = message.get("content")?;

    let text = if let Some(s) = content.as_str() {
        s.to_string()
    } else if let Some(arr) = content.as_array() {
        // Extract text from content blocks
        arr.iter()
            .filter_map(|block| {
                if block.get("type")?.as_str()? == "text" {
                    block.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        return None;
    };

    if text.is_empty() {
        return None;
    }

    Some(TranscriptRecord::User { text })
}

/// Parse an assistant message record
///
/// Returns multiple records: text blocks and tool_use blocks
fn parse_assistant_message(value: &serde_json::Value) -> Option<TranscriptRecord> {
    let message = value.get("message")?;
    let content = message.get("content")?;

    if let Some(arr) = content.as_array() {
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
                "tool_use" => {
                    // We could emit ToolUse records here but for simplicity
                    // we'll capture them in the text representation
                    let tool_name = block
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("Unknown");
                    let input_summary = summarize_tool_input_json(tool_name, block.get("input"));
                    text_parts.push(format!("[⚙ {}: {}]", tool_name, input_summary));
                }
                "thinking" => {
                    // Skip thinking blocks
                }
                _ => {}
            }
        }

        if text_parts.is_empty() {
            return None;
        }

        Some(TranscriptRecord::AssistantText {
            text: text_parts.join("\n"),
        })
    } else {
        None
    }
}

/// Parse a result message (tool result)
fn parse_result_message(value: &serde_json::Value) -> Option<TranscriptRecord> {
    let result = value.get("result")?;
    let output = if let Some(s) = result.as_str() {
        s.to_string()
    } else if let Some(arr) = result.as_array() {
        arr.iter()
            .filter_map(|block| {
                if block.get("type")?.as_str()? == "text" {
                    block.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        return None;
    };

    if output.is_empty() {
        return None;
    }

    Some(TranscriptRecord::ToolResult {
        output_summary: truncate_for_preview(&output, 200),
    })
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
        let line = r#"{"type":"user","message":{"content":"Hello world"}}"#;
        let record = parse_jsonl_line(line).unwrap();
        match record {
            TranscriptRecord::User { text } => assert_eq!(text, "Hello world"),
            _ => panic!("Expected User record"),
        }
    }

    #[test]
    fn test_parse_user_message_array() {
        let line = r#"{"type":"user","message":{"content":[{"type":"text","text":"Hello"},{"type":"text","text":"World"}]}}"#;
        let record = parse_jsonl_line(line).unwrap();
        match record {
            TranscriptRecord::User { text } => assert_eq!(text, "Hello\nWorld"),
            _ => panic!("Expected User record"),
        }
    }

    #[test]
    fn test_parse_assistant_text() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"I'll help you."}]}}"#;
        let record = parse_jsonl_line(line).unwrap();
        match record {
            TranscriptRecord::AssistantText { text } => assert_eq!(text, "I'll help you."),
            _ => panic!("Expected AssistantText record"),
        }
    }

    #[test]
    fn test_parse_assistant_with_tool_use() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Let me check."},{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}"#;
        let record = parse_jsonl_line(line).unwrap();
        match record {
            TranscriptRecord::AssistantText { text } => {
                assert!(text.contains("Let me check."));
                assert!(text.contains("⚙ Bash: ls"));
            }
            _ => panic!("Expected AssistantText record"),
        }
    }

    #[test]
    fn test_parse_thinking_skipped() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"thinking","text":"Hmm..."},{"type":"text","text":"Result"}]}}"#;
        let record = parse_jsonl_line(line).unwrap();
        match record {
            TranscriptRecord::AssistantText { text } => {
                assert!(!text.contains("Hmm"));
                assert_eq!(text, "Result");
            }
            _ => panic!("Expected AssistantText record"),
        }
    }

    #[test]
    fn test_parse_result_message() {
        let line = r#"{"type":"result","result":"test output here"}"#;
        let record = parse_jsonl_line(line).unwrap();
        match record {
            TranscriptRecord::ToolResult { output_summary } => {
                assert_eq!(output_summary, "test output here");
            }
            _ => panic!("Expected ToolResult record"),
        }
    }

    #[test]
    fn test_parse_empty_line() {
        assert!(parse_jsonl_line("").is_none());
        assert!(parse_jsonl_line("  ").is_none());
    }

    #[test]
    fn test_parse_invalid_json() {
        assert!(parse_jsonl_line("not json").is_none());
    }

    #[test]
    fn test_parse_unknown_type() {
        let line = r#"{"type":"system","data":"info"}"#;
        assert!(parse_jsonl_line(line).is_none());
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
