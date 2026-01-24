use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph},
    Frame,
};

/// Help popup widget
pub struct HelpPopup;

impl HelpPopup {
    /// Render the help popup
    pub fn render(frame: &mut Frame, area: Rect) {
        // Clear the area first
        frame.render_widget(Clear, area);

        let help_text = vec![
            Line::from(vec![Span::styled(
                "tmai - Tmux Multi Agent Interface",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )]),
            Line::from(""),
            Line::from(vec![Span::styled(
                "Navigation",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            )]),
            Self::help_line("j / ↓", "Select next agent"),
            Self::help_line("k / ↑", "Select previous agent"),
            Self::help_line("g", "Select first agent"),
            Self::help_line("G", "Select last agent"),
            Self::help_line("Ctrl+d", "Scroll preview down"),
            Self::help_line("Ctrl+u", "Scroll preview up"),
            Line::from(""),
            Line::from(vec![Span::styled(
                "Actions",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            )]),
            Self::help_line("y", "Approve/Accept (send 'y')"),
            Self::help_line("n", "Reject/Decline (send 'n')"),
            Self::help_line("1-9", "Select numbered option"),
            Self::help_line("f", "Focus pane in tmux"),
            Self::help_line("Enter", "Toggle selection"),
            Line::from(""),
            Line::from(vec![Span::styled(
                "General",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            )]),
            Self::help_line("p", "Toggle preview panel"),
            Self::help_line("?", "Toggle this help"),
            Self::help_line("q / Esc", "Quit"),
            Line::from(""),
            Line::from(vec![Span::styled(
                "Press any key to close",
                Style::default().fg(Color::DarkGray),
            )]),
        ];

        let block = Block::default()
            .title(" Help ")
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Cyan));

        let paragraph = Paragraph::new(help_text).block(block);

        frame.render_widget(paragraph, area);
    }

    fn help_line(key: &str, description: &str) -> Line<'static> {
        Line::from(vec![
            Span::styled(
                format!("  {:12}", key),
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(description.to_string(), Style::default().fg(Color::White)),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_help_line() {
        let line = HelpPopup::help_line("test", "description");
        assert_eq!(line.spans.len(), 2);
    }
}
