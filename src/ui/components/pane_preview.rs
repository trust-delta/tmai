use ansi_to_tui::IntoText;
use ratatui::{
    layout::Rect,
    style::{Color, Style},
    text::{Line, Span, Text},
    widgets::{Block, BorderType, Borders, Paragraph},
    Frame,
};

use crate::agents::AgentStatus;
use crate::state::AppState;

/// Widget for previewing the selected pane content
pub struct PanePreview;

impl PanePreview {
    /// Render the preview with ANSI color support
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        // Show empty preview when CreateNew is selected
        if state.is_on_create_new {
            let block = Block::default()
                .title(" Preview ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(Color::Gray));
            let paragraph = Paragraph::new(Text::from("")).block(block);
            frame.render_widget(paragraph, area);
            return;
        }

        let agent = state.selected_agent();

        let (title, text) = if let Some(agent) = agent {
            // Virtual agent (offline team member) - show placeholder
            if agent.is_virtual {
                let member_label = agent
                    .team_info
                    .as_ref()
                    .map(|ti| format!("{}/{}", ti.team_name, ti.member_name))
                    .unwrap_or_else(|| "Unknown".to_string());
                let title = format!(" {} (Offline) ", member_label);
                let text = Text::from(vec![
                    Line::from(""),
                    Line::from(vec![Span::styled(
                        "  Team member not connected",
                        Style::default().fg(Color::DarkGray),
                    )]),
                    Line::from(""),
                    Line::from(vec![Span::styled(
                        "  Pane not found — member may not have started yet or has exited.",
                        Style::default().fg(Color::DarkGray),
                    )]),
                ]);

                let block = Block::default()
                    .title(title)
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(Color::DarkGray));

                let paragraph = Paragraph::new(text).block(block);
                frame.render_widget(paragraph, area);
                return;
            }

            let title = format!(" {} ({}) ", agent.target, agent.agent_type.short_name());

            let available_height = area.height.saturating_sub(2) as usize;
            let available_width = area.width.saturating_sub(2) as usize;

            // Apply scroll offset - work with ANSI content for color rendering
            let content_lines: Vec<&str> = agent.last_content_ansi.lines().collect();
            // Trim trailing empty lines to prevent blank preview after terminal clear/compact
            let total_lines = content_lines
                .iter()
                .rposition(|line| !line.trim().is_empty())
                .map(|i| i + 1)
                .unwrap_or(0);
            let scroll = state.preview_scroll as usize;
            let start = total_lines.saturating_sub(available_height + scroll);
            let end = total_lines.saturating_sub(scroll);

            // Join visible lines and parse ANSI codes
            let visible_content: String = content_lines[start..end.min(content_lines.len())]
                .iter()
                .map(|line| Self::truncate_line(line, available_width))
                .collect::<Vec<_>>()
                .join("\n");

            // Parse ANSI escape sequences into styled Text
            let styled_text = match visible_content.as_str().into_text() {
                Ok(text) => text,
                Err(_) => Text::raw(visible_content),
            };

            (title, styled_text)
        } else {
            (
                " Preview ".to_string(),
                Text::from(vec![Line::from(vec![Span::styled(
                    "No agent selected",
                    Style::default().fg(Color::DarkGray),
                )])]),
            )
        };

        let border_color = if let Some(agent) = agent {
            match &agent.status {
                AgentStatus::AwaitingApproval { .. } => Color::Magenta,
                AgentStatus::Error { .. } => Color::Red,
                AgentStatus::Processing { .. } => Color::Yellow,
                AgentStatus::Offline => Color::DarkGray,
                _ => Color::Gray,
            }
        } else {
            Color::Gray
        };

        let block = Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(border_color));

        let paragraph = Paragraph::new(text).block(block);

        frame.render_widget(paragraph, area);
    }

    /// Truncate a string to fit within max_width (considering Unicode width and ANSI codes)
    fn truncate_line(line: &str, max_width: usize) -> String {
        let mut result = String::new();
        let mut current_width = 0;
        let mut chars = line.chars().peekable();
        let mut truncated = false;

        while let Some(c) = chars.next() {
            // Check for ANSI escape sequence
            if c == '\x1b' {
                // Start of escape sequence - copy it entirely
                result.push(c);
                if chars.peek() == Some(&'[') {
                    result.push(chars.next().unwrap()); // '['
                                                        // Copy until we hit the terminating character (letter)
                    while let Some(&next) = chars.peek() {
                        result.push(chars.next().unwrap());
                        if next.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                continue;
            }

            let char_width = unicode_width::UnicodeWidthChar::width(c).unwrap_or(0);
            if current_width + char_width > max_width.saturating_sub(1) {
                result.push('…');
                truncated = true;
                break;
            }
            result.push(c);
            current_width += char_width;
        }

        // Add ANSI reset if we truncated (to prevent color bleed)
        if truncated {
            result.push_str("\x1b[0m");
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_line_plain() {
        let long = "a".repeat(100);
        let truncated = PanePreview::truncate_line(&long, 50);
        // Should end with ellipsis and reset code
        assert!(truncated.contains('…'));
    }

    #[test]
    fn test_truncate_line_with_ansi() {
        // Line with ANSI color codes
        let colored = "\x1b[32mgreen text\x1b[0m and more text here that is long";
        let truncated = PanePreview::truncate_line(colored, 20);
        // ANSI codes should be preserved
        assert!(truncated.contains("\x1b[32m"));
        // Should end with reset code
        assert!(truncated.ends_with("\x1b[0m"));
    }

    #[test]
    fn test_truncate_line_short() {
        let short = "short";
        let truncated = PanePreview::truncate_line(short, 50);
        assert_eq!(truncated, "short");
    }

    /// Helper to compute effective line count (same logic as render)
    fn effective_line_count(content: &str) -> usize {
        let lines: Vec<&str> = content.lines().collect();
        lines
            .iter()
            .rposition(|line| !line.trim().is_empty())
            .map(|i| i + 1)
            .unwrap_or(0)
    }

    #[test]
    fn test_trailing_empty_lines_trimmed() {
        // Simulates post-compact: content at top, empty lines below
        let content = "line1\nline2\n\n\n\n";
        assert_eq!(effective_line_count(content), 2);
    }

    #[test]
    fn test_no_trailing_empty_lines() {
        let content = "line1\nline2\nline3";
        assert_eq!(effective_line_count(content), 3);
    }

    #[test]
    fn test_all_empty_lines() {
        let content = "\n\n\n";
        assert_eq!(effective_line_count(content), 0);
    }

    #[test]
    fn test_empty_content() {
        let content = "";
        assert_eq!(effective_line_count(content), 0);
    }

    #[test]
    fn test_content_with_middle_empty_lines() {
        // Empty lines in the middle should be preserved (content at bottom counts)
        let content = "header\n\n\n\nfooter";
        assert_eq!(effective_line_count(content), 5);
    }
}
