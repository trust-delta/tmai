//! Preview text renderer for transcript records.

use super::types::TranscriptRecord;

/// Truncate a string at a char boundary, respecting UTF-8
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let truncated: String = s.chars().take(max_chars).collect();
    if truncated.len() < s.len() {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

/// Render transcript records into human-readable preview text
pub fn render_preview(records: &[TranscriptRecord], max_lines: usize) -> String {
    let mut lines = Vec::new();

    for record in records {
        match record {
            TranscriptRecord::User { text, .. } => {
                let first_line = text.lines().next().unwrap_or(text);
                lines.push(format!("▶ User: {}", truncate_chars(first_line, 120)));
            }
            TranscriptRecord::AssistantText { text, .. } => {
                // Show first few lines of assistant text
                for (i, line) in text.lines().enumerate() {
                    if i >= 5 {
                        lines.push("  ...".to_string());
                        break;
                    }
                    let truncated = truncate_chars(line, 120);
                    if i == 0 {
                        lines.push(format!("◀ {}", truncated));
                    } else {
                        lines.push(format!("  {}", truncated));
                    }
                }
            }
            TranscriptRecord::Thinking { text, .. } => {
                let first_line = text.lines().next().unwrap_or(text);
                lines.push(format!("  💭 {}", truncate_chars(first_line, 100)));
            }
            TranscriptRecord::ToolUse {
                tool_name,
                input_summary,
                ..
            } => {
                if input_summary.is_empty() {
                    lines.push(format!("  ⚙ {}", tool_name));
                } else {
                    lines.push(format!("  ⚙ {}: {}", tool_name, input_summary));
                }
            }
            TranscriptRecord::ToolResult { output_summary, .. } => {
                let first_line = output_summary.lines().next().unwrap_or(output_summary);
                lines.push(format!("  ✓ {}", truncate_chars(first_line, 100)));
            }
        }
    }

    // Keep only last max_lines
    if lines.len() > max_lines {
        let start = lines.len() - max_lines;
        lines = lines[start..].to_vec();
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_preview_user_and_assistant() {
        let records = vec![
            TranscriptRecord::User {
                text: "Fix the bug in main.rs".to_string(),
                uuid: None,
                timestamp: None,
            },
            TranscriptRecord::AssistantText {
                text: "I'll look at main.rs and fix the issue.".to_string(),
                uuid: None,
                timestamp: None,
            },
        ];

        let result = render_preview(&records, 100);
        assert!(result.contains("▶ User: Fix the bug"));
        assert!(result.contains("◀ I'll look at main.rs"));
    }

    #[test]
    fn test_render_preview_with_tools() {
        let records = vec![
            TranscriptRecord::ToolUse {
                tool_name: "Bash".to_string(),
                input_summary: "cargo test".to_string(),
                input_full: None,
                uuid: None,
                timestamp: None,
            },
            TranscriptRecord::ToolResult {
                output_summary: "test result: ok".to_string(),
                is_error: None,
                uuid: None,
                timestamp: None,
            },
        ];

        let result = render_preview(&records, 100);
        assert!(result.contains("⚙ Bash: cargo test"));
        assert!(result.contains("✓ test result: ok"));
    }

    #[test]
    fn test_render_preview_thinking() {
        let records = vec![TranscriptRecord::Thinking {
            text: "Let me think about this problem...".to_string(),
            uuid: None,
            timestamp: None,
        }];

        let result = render_preview(&records, 100);
        assert!(result.contains("💭 Let me think about this problem..."));
    }

    #[test]
    fn test_render_preview_max_lines() {
        let records: Vec<TranscriptRecord> = (0..20)
            .map(|i| TranscriptRecord::User {
                text: format!("Message {}", i),
                uuid: None,
                timestamp: None,
            })
            .collect();

        let result = render_preview(&records, 5);
        let line_count = result.lines().count();
        assert_eq!(line_count, 5);
    }

    #[test]
    fn test_render_preview_empty() {
        let result = render_preview(&[], 100);
        assert!(result.is_empty());
    }

    #[test]
    fn test_truncate_chars_multibyte() {
        // Japanese text that would panic with byte-based truncation
        let text = "これは日本語のテストです。とても長い文章を書いています。";
        let result = truncate_chars(text, 10);
        assert!(result.ends_with("..."));
        // Should not panic
    }

    #[test]
    fn test_truncate_chars_ascii() {
        let text = "short";
        let result = truncate_chars(text, 120);
        assert_eq!(result, "short");
    }
}
