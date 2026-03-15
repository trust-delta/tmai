//! Preview text renderer for transcript records.

use super::types::TranscriptRecord;

/// Render transcript records into human-readable preview text
pub fn render_preview(records: &[TranscriptRecord], max_lines: usize) -> String {
    let mut lines = Vec::new();

    for record in records {
        match record {
            TranscriptRecord::User { text } => {
                let first_line = text.lines().next().unwrap_or(text);
                let truncated = if first_line.len() > 120 {
                    format!("{}...", &first_line[..120])
                } else {
                    first_line.to_string()
                };
                lines.push(format!("▶ User: {}", truncated));
            }
            TranscriptRecord::AssistantText { text } => {
                // Show first few lines of assistant text
                for (i, line) in text.lines().enumerate() {
                    if i >= 5 {
                        lines.push("  ...".to_string());
                        break;
                    }
                    if i == 0 {
                        let truncated = if line.len() > 120 {
                            format!("{}...", &line[..120])
                        } else {
                            line.to_string()
                        };
                        lines.push(format!("◀ {}", truncated));
                    } else {
                        let truncated = if line.len() > 120 {
                            format!("{}...", &line[..120])
                        } else {
                            line.to_string()
                        };
                        lines.push(format!("  {}", truncated));
                    }
                }
            }
            TranscriptRecord::ToolUse {
                tool_name,
                input_summary,
            } => {
                if input_summary.is_empty() {
                    lines.push(format!("  ⚙ {}", tool_name));
                } else {
                    lines.push(format!("  ⚙ {}: {}", tool_name, input_summary));
                }
            }
            TranscriptRecord::ToolResult { output_summary } => {
                let first_line = output_summary.lines().next().unwrap_or(output_summary);
                let truncated = if first_line.len() > 100 {
                    format!("{}...", &first_line[..100])
                } else {
                    first_line.to_string()
                };
                lines.push(format!("  ✓ {}", truncated));
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
            },
            TranscriptRecord::AssistantText {
                text: "I'll look at main.rs and fix the issue.".to_string(),
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
            },
            TranscriptRecord::ToolResult {
                output_summary: "test result: ok".to_string(),
            },
        ];

        let result = render_preview(&records, 100);
        assert!(result.contains("⚙ Bash: cargo test"));
        assert!(result.contains("✓ test result: ok"));
    }

    #[test]
    fn test_render_preview_max_lines() {
        let records: Vec<TranscriptRecord> = (0..20)
            .map(|i| TranscriptRecord::User {
                text: format!("Message {}", i),
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
}
