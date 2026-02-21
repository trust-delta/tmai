use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph},
    Frame,
};

use tmai_core::state::ConfirmationState;

/// Confirmation popup widget for destructive actions
pub struct ConfirmationPopup;

impl ConfirmationPopup {
    /// Render a confirmation popup
    pub fn render(frame: &mut Frame, area: Rect, state: &ConfirmationState) {
        // Clear the area first
        frame.render_widget(Clear, area);

        let lines = vec![
            Line::from(""),
            Line::from(vec![
                Span::raw("  "),
                Span::styled(state.message.clone(), Style::default().fg(Color::White)),
            ]),
            Line::from(""),
            Line::from(vec![
                Span::raw("  "),
                Span::styled(
                    "y",
                    Style::default()
                        .fg(Color::Green)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" Yes  ", Style::default().fg(Color::White)),
                Span::styled(
                    "n",
                    Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
                ),
                Span::styled(" No", Style::default().fg(Color::White)),
            ]),
            Line::from(""),
        ];

        let block = Block::default()
            .title(" Confirmation ")
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Yellow));

        let paragraph = Paragraph::new(lines).block(block);

        frame.render_widget(paragraph, area);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tmai_core::state::ConfirmAction;

    #[test]
    fn test_confirmation_state_creation() {
        let state = ConfirmationState {
            action: ConfirmAction::KillPane {
                target: "main:0.0".to_string(),
            },
            message: "Kill pane main:0.0?".to_string(),
        };
        assert_eq!(state.message, "Kill pane main:0.0?");
    }
}
