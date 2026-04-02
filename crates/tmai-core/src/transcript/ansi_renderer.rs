//! ANSI-rich preview renderer for transcript records.
//!
//! Converts parsed [`TranscriptRecord`]s into terminal output with ANSI
//! color/style codes, producing a visually rich preview that does not
//! depend on `tmux capture-pane`.
//!
//! Design notes:
//! - Markdown → ANSI conversion is intentionally simple (no external crate).
//!   It handles headings, bold, italic, inline code, code blocks, and lists.
//! - Tool use / tool result records get distinct colored prefixes.
//! - The output is suitable for direct display in an xterm-compatible
//!   terminal or for conversion to HTML via `ansi_up`.

use super::types::TranscriptRecord;

// ── ANSI escape helpers ──────────────────────────────────────────────

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const ITALIC: &str = "\x1b[3m";

// Foreground colors
const FG_GREEN: &str = "\x1b[32m";
const FG_YELLOW: &str = "\x1b[33m";
const FG_BLUE: &str = "\x1b[34m";
const FG_MAGENTA: &str = "\x1b[35m";
const FG_CYAN: &str = "\x1b[36m";
const FG_WHITE: &str = "\x1b[37m";
const FG_BRIGHT_BLACK: &str = "\x1b[90m";

// Background for code blocks
const BG_CODE: &str = "\x1b[48;5;236m"; // dark grey background

// ── Public API ───────────────────────────────────────────────────────

/// Render transcript records into ANSI-colored preview text.
///
/// This is the ANSI-rich counterpart of [`super::renderer::render_preview`].
/// The output contains escape codes for colors, bold, italic, etc.
pub fn render_ansi_preview(records: &[TranscriptRecord], max_lines: usize) -> String {
    let mut lines: Vec<String> = Vec::new();

    for record in records {
        match record {
            TranscriptRecord::User { text } => {
                render_user_message(&mut lines, text);
            }
            TranscriptRecord::AssistantText { text } => {
                render_assistant_message(&mut lines, text);
            }
            TranscriptRecord::ToolUse {
                tool_name,
                input_summary,
            } => {
                render_tool_use(&mut lines, tool_name, input_summary);
            }
            TranscriptRecord::ToolResult { output_summary } => {
                render_tool_result(&mut lines, output_summary);
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

// ── Record renderers ─────────────────────────────────────────────────

fn render_user_message(lines: &mut Vec<String>, text: &str) {
    let first_line = text.lines().next().unwrap_or(text);
    let truncated = truncate_chars(first_line, 120);
    // Separator + green user prefix
    lines.push(format!(
        "{DIM}{FG_BRIGHT_BLACK}─────────────────────────────────{RESET}"
    ));
    lines.push(format!("{BOLD}{FG_GREEN}▶ User:{RESET} {}", truncated));
}

fn render_assistant_message(lines: &mut Vec<String>, text: &str) {
    // Check for embedded tool-use markers like "[⚙ Bash: ls]"
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[⚙") && trimmed.ends_with(']') {
            // Inline tool use from parser — render as tool badge
            let inner = &trimmed[1..trimmed.len() - 1]; // strip [ ]
            lines.push(format!("  {FG_YELLOW}{inner}{RESET}"));
        } else {
            // Render as markdown-ish ANSI
            let rendered = render_markdown_line(trimmed);
            lines.push(format!("  {}", rendered));
        }
    }
}

fn render_tool_use(lines: &mut Vec<String>, tool_name: &str, input_summary: &str) {
    let color = tool_color(tool_name);
    if input_summary.is_empty() {
        lines.push(format!("  {color}{BOLD}⚙ {tool_name}{RESET}"));
    } else {
        let summary = truncate_chars(input_summary, 100);
        lines.push(format!(
            "  {color}{BOLD}⚙ {tool_name}:{RESET}{color} {summary}{RESET}"
        ));
    }
}

fn render_tool_result(lines: &mut Vec<String>, output_summary: &str) {
    let first_line = output_summary.lines().next().unwrap_or(output_summary);
    let truncated = truncate_chars(first_line, 100);
    lines.push(format!("  {FG_GREEN}✓{RESET} {DIM}{truncated}{RESET}"));
}

// ── Markdown-lite ANSI rendering ─────────────────────────────────────

/// Render a single line of markdown-like text with ANSI codes.
///
/// Supported syntax:
/// - `# Heading` → bold + blue
/// - `**bold**` → bold
/// - `*italic*` / `_italic_` → italic
/// - `` `code` `` → cyan on dark bg
/// - ```` ```code block``` ```` → handled by caller (multiline)
/// - `- item` / `* item` → bullet with color
fn render_markdown_line(line: &str) -> String {
    // Headings
    if let Some(rest) = line.strip_prefix("### ") {
        return format!("{BOLD}{FG_BLUE}### {rest}{RESET}");
    }
    if let Some(rest) = line.strip_prefix("## ") {
        return format!("{BOLD}{FG_BLUE}## {rest}{RESET}");
    }
    if let Some(rest) = line.strip_prefix("# ") {
        return format!("{BOLD}{FG_BLUE}# {rest}{RESET}");
    }

    // Code block fence
    if line.starts_with("```") {
        return format!("{DIM}{FG_BRIGHT_BLACK}{line}{RESET}");
    }

    // Bullet lists
    if line.starts_with("- ") || line.starts_with("* ") {
        let rest = &line[2..];
        let rendered = render_inline_formatting(rest);
        return format!("{FG_CYAN}•{RESET} {rendered}");
    }

    // Numbered lists
    if let Some(pos) = line.find(". ") {
        let prefix = &line[..pos];
        if !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit()) {
            let rest = &line[pos + 2..];
            let rendered = render_inline_formatting(rest);
            return format!("{FG_CYAN}{prefix}.{RESET} {rendered}");
        }
    }

    render_inline_formatting(line)
}

/// Process inline formatting: **bold**, *italic*, `code`
fn render_inline_formatting(text: &str) -> String {
    let mut result = String::with_capacity(text.len() * 2);
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Inline code: `...`
        if chars[i] == '`' {
            if let Some(end) = find_closing(&chars, i + 1, '`') {
                let code_text: String = chars[i + 1..end].iter().collect();
                result.push_str(&format!("{BG_CODE}{FG_CYAN}{code_text}{RESET}"));
                i = end + 1;
                continue;
            }
        }

        // Bold: **...**
        if i + 1 < len && chars[i] == '*' && chars[i + 1] == '*' {
            if let Some(end) = find_closing_double(&chars, i + 2, '*') {
                let bold_text: String = chars[i + 2..end].iter().collect();
                result.push_str(&format!("{BOLD}{bold_text}{RESET}"));
                i = end + 2;
                continue;
            }
        }

        // Italic: *...*
        if chars[i] == '*' && (i + 1 < len && chars[i + 1] != '*') {
            if let Some(end) = find_closing(&chars, i + 1, '*') {
                let italic_text: String = chars[i + 1..end].iter().collect();
                result.push_str(&format!("{ITALIC}{italic_text}{RESET}"));
                i = end + 1;
                continue;
            }
        }

        result.push(chars[i]);
        i += 1;
    }

    result
}

/// Find closing single delimiter
fn find_closing(chars: &[char], start: usize, delimiter: char) -> Option<usize> {
    for i in start..chars.len() {
        if chars[i] == delimiter {
            return Some(i);
        }
    }
    None
}

/// Find closing double delimiter (e.g. **)
fn find_closing_double(chars: &[char], start: usize, delimiter: char) -> Option<usize> {
    for i in start..chars.len().saturating_sub(1) {
        if chars[i] == delimiter && chars[i + 1] == delimiter {
            return Some(i);
        }
    }
    None
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Assign a color to a tool name for visual distinction
fn tool_color(tool_name: &str) -> &'static str {
    match tool_name {
        "Bash" => FG_YELLOW,
        "Read" => FG_CYAN,
        "Edit" | "Write" => FG_MAGENTA,
        "Grep" | "Glob" => FG_BLUE,
        "Agent" => FG_GREEN,
        _ => FG_WHITE,
    }
}

/// Truncate a string at a char boundary, respecting UTF-8
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let truncated: String = s.chars().take(max_chars).collect();
    if truncated.len() < s.len() {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_user_message() {
        let records = vec![TranscriptRecord::User {
            text: "Fix the bug".to_string(),
        }];
        let result = render_ansi_preview(&records, 100);
        assert!(result.contains("▶ User:"));
        assert!(result.contains("Fix the bug"));
        // Should contain ANSI codes
        assert!(result.contains("\x1b["));
    }

    #[test]
    fn test_render_assistant_with_markdown() {
        let records = vec![TranscriptRecord::AssistantText {
            text: "# Heading\n**bold text** and `code`".to_string(),
        }];
        let result = render_ansi_preview(&records, 100);
        assert!(result.contains("Heading"));
        assert!(result.contains("bold text"));
        assert!(result.contains("code"));
    }

    #[test]
    fn test_render_tool_use_colored() {
        let records = vec![TranscriptRecord::ToolUse {
            tool_name: "Bash".to_string(),
            input_summary: "cargo test".to_string(),
        }];
        let result = render_ansi_preview(&records, 100);
        assert!(result.contains("⚙ Bash:"));
        assert!(result.contains("cargo test"));
    }

    #[test]
    fn test_render_tool_result() {
        let records = vec![TranscriptRecord::ToolResult {
            output_summary: "All tests passed".to_string(),
        }];
        let result = render_ansi_preview(&records, 100);
        assert!(result.contains("✓"));
        assert!(result.contains("All tests passed"));
    }

    #[test]
    fn test_render_mixed_conversation() {
        let records = vec![
            TranscriptRecord::User {
                text: "Hello".to_string(),
            },
            TranscriptRecord::AssistantText {
                text: "I'll help you.".to_string(),
            },
            TranscriptRecord::ToolUse {
                tool_name: "Read".to_string(),
                input_summary: "src/main.rs".to_string(),
            },
            TranscriptRecord::ToolResult {
                output_summary: "fn main() { ... }".to_string(),
            },
        ];
        let result = render_ansi_preview(&records, 100);
        let line_count = result.lines().count();
        assert!(line_count >= 4); // at least one line per record
    }

    #[test]
    fn test_max_lines_truncation() {
        let records: Vec<TranscriptRecord> = (0..50)
            .map(|i| TranscriptRecord::User {
                text: format!("Message {}", i),
            })
            .collect();
        let result = render_ansi_preview(&records, 10);
        let line_count = result.lines().count();
        assert!(line_count <= 10);
    }

    #[test]
    fn test_inline_formatting() {
        let result = render_inline_formatting("**bold** and *italic* and `code`");
        assert!(result.contains("bold"));
        assert!(result.contains("italic"));
        assert!(result.contains("code"));
        assert!(result.contains(BOLD));
        assert!(result.contains(ITALIC));
    }

    #[test]
    fn test_bullet_list() {
        let result = render_markdown_line("- item one");
        assert!(result.contains("•"));
        assert!(result.contains("item one"));
    }

    #[test]
    fn test_multibyte_truncation() {
        let text = "これは日本語テスト";
        let result = truncate_chars(text, 5);
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_embedded_tool_use_marker() {
        let records = vec![TranscriptRecord::AssistantText {
            text: "Let me check.\n[⚙ Bash: ls -la]".to_string(),
        }];
        let result = render_ansi_preview(&records, 100);
        assert!(result.contains("⚙ Bash: ls -la"));
        assert!(result.contains(FG_YELLOW));
    }
}
