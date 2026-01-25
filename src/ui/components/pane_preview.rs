use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Paragraph},
    Frame,
};

use crate::agents::AgentStatus;
use crate::state::AppState;

/// Widget for previewing the selected pane content
pub struct PanePreview;

impl PanePreview {
    /// Render the preview with ANSI color support and syntax highlighting
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let agent = state.selected_agent();

        let (title, lines) = if let Some(agent) = agent {
            let title = format!(" {} ({}) ", agent.target, agent.agent_type.short_name());

            let mut styled_lines: Vec<Line> = Vec::new();
            let available_height = area.height.saturating_sub(2) as usize;
            let available_width = area.width.saturating_sub(2) as usize;

            // Apply scroll offset
            let content_lines: Vec<&str> = agent.last_content.lines().collect();
            let total_lines = content_lines.len();
            let scroll = state.preview_scroll as usize;
            let start = total_lines.saturating_sub(available_height + scroll);
            let end = total_lines.saturating_sub(scroll);

            for line in &content_lines[start..end.min(content_lines.len())] {
                let styled = Self::style_line(line, available_width);
                styled_lines.push(styled);
            }

            (title, styled_lines)
        } else {
            (
                " Preview ".to_string(),
                vec![Line::from(vec![Span::styled(
                    "No agent selected",
                    Style::default().fg(Color::DarkGray),
                )])],
            )
        };

        let border_color = if let Some(agent) = agent {
            match &agent.status {
                AgentStatus::AwaitingApproval { .. } => Color::Red,
                AgentStatus::Error { .. } => Color::Red,
                AgentStatus::Processing { .. } => Color::Yellow,
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

        let paragraph = Paragraph::new(lines).block(block);

        frame.render_widget(paragraph, area);
    }

    /// Truncate a string to fit within max_width (considering Unicode width)
    fn truncate_line(line: &str, max_width: usize) -> String {
        use unicode_width::UnicodeWidthStr;

        if line.width() <= max_width {
            return line.to_string();
        }

        let mut result = String::new();
        let mut current_width = 0;

        for c in line.chars() {
            let char_width = unicode_width::UnicodeWidthChar::width(c).unwrap_or(0);
            if current_width + char_width > max_width.saturating_sub(1) {
                result.push('…');
                break;
            }
            result.push(c);
            current_width += char_width;
        }

        result
    }

    /// Style a single line with syntax highlighting
    fn style_line(line: &str, max_width: usize) -> Line<'static> {
        let owned_line = Self::truncate_line(line, max_width);

        // Diff highlighting
        if owned_line.starts_with('+') && !owned_line.starts_with("+++") {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default().fg(Color::Green),
            )]);
        }

        if owned_line.starts_with('-') && !owned_line.starts_with("---") {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default().fg(Color::Red),
            )]);
        }

        if owned_line.starts_with("@@") {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default().fg(Color::Cyan),
            )]);
        }

        // Approval prompt highlighting
        if owned_line.contains("[y/n]") || owned_line.contains("[Y/n]") {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            )]);
        }

        // Yes/No button highlighting
        let trimmed = owned_line.trim();
        if trimmed == "Yes"
            || trimmed.starts_with("Yes,")
            || trimmed == "No"
            || trimmed.starts_with("No,")
        {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            )]);
        }

        // Numbered choice highlighting
        if trimmed
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
            && trimmed.contains('.')
        {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default().fg(Color::Cyan),
            )]);
        }

        // Error highlighting
        if owned_line.contains('✗')
            || owned_line.contains('❌')
            || owned_line.to_lowercase().contains("error")
        {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default().fg(Color::Red),
            )]);
        }

        // Success highlighting
        if owned_line.contains('✓') || owned_line.contains('✔') {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default().fg(Color::Green),
            )]);
        }

        // Prompt highlighting
        if owned_line.starts_with('❯') || owned_line.starts_with('>') {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default().fg(Color::Cyan),
            )]);
        }

        // Spinner/processing highlighting
        if owned_line.contains('⠋')
            || owned_line.contains('⠿')
            || owned_line.contains('⏺')
            || owned_line.contains('✳')
        {
            return Line::from(vec![Span::styled(
                owned_line,
                Style::default().fg(Color::Yellow),
            )]);
        }

        // Default: no special styling
        Line::from(vec![Span::raw(owned_line)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_style_diff_add() {
        let line = PanePreview::style_line("+ added line", 80);
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_style_diff_remove() {
        let line = PanePreview::style_line("- removed line", 80);
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_style_prompt() {
        let line = PanePreview::style_line("❯ input prompt", 80);
        assert!(!line.spans.is_empty());
    }

    #[test]
    fn test_truncate_line() {
        use unicode_width::UnicodeWidthStr;
        let long = "a".repeat(100);
        let truncated = PanePreview::truncate_line(&long, 50);
        assert!(truncated.width() <= 50);
        assert!(truncated.ends_with('…'));
    }
}
