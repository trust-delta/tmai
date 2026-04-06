use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph},
    Frame,
};

use tmai_core::agents::{ApprovalCategory, InteractionMode};

/// Selection popup widget for AskUserQuestion
pub struct SelectionPopup;

impl SelectionPopup {
    /// Render a selection popup for choices
    pub fn render(
        frame: &mut Frame,
        area: Rect,
        approval_type: &ApprovalCategory,
        interaction: Option<&InteractionMode>,
        question: &str,
    ) {
        // Clear the area first
        frame.render_widget(Clear, area);

        let mut lines = vec![
            Line::from(vec![Span::styled(
                "Selection Required",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            )]),
            Line::from(""),
        ];

        // Add question if provided
        if !question.is_empty() {
            lines.push(Line::from(vec![Span::styled(
                question.to_string(),
                Style::default().fg(Color::White),
            )]));
            lines.push(Line::from(""));
        }

        // Add choices from interaction mode
        if let Some(interaction) = interaction {
            let (choices, is_multi) = match interaction {
                InteractionMode::SingleSelect { choices, .. } => (choices, false),
                InteractionMode::MultiSelect { choices, .. } => (choices, true),
            };

            lines.push(Line::from(vec![Span::styled(
                "Options:",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )]));

            for (i, choice) in choices.iter().enumerate() {
                let num = i + 1;
                lines.push(Line::from(vec![
                    Span::styled(
                        format!("  {}. ", num),
                        Style::default()
                            .fg(Color::Green)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(choice.clone(), Style::default().fg(Color::White)),
                ]));
            }

            lines.push(Line::from(""));

            if is_multi {
                lines.push(Line::from(vec![Span::styled(
                    "Press number keys to toggle, Enter to confirm",
                    Style::default().fg(Color::DarkGray),
                )]));
            } else {
                lines.push(Line::from(vec![Span::styled(
                    "Press number key (1-9) to select",
                    Style::default().fg(Color::DarkGray),
                )]));
            }
        }

        lines.push(Line::from(vec![Span::styled(
            "Press Esc to cancel",
            Style::default().fg(Color::DarkGray),
        )]));

        let block = Block::default()
            .title(" Select Option ")
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Yellow));

        let paragraph = Paragraph::new(lines).block(block);

        frame.render_widget(paragraph, area);
    }

    /// Check if we should show the selection popup for this approval type
    pub fn should_show(
        approval_type: &ApprovalCategory,
        interaction: Option<&InteractionMode>,
    ) -> bool {
        matches!(approval_type, ApprovalCategory::UserQuestion) && interaction.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_show() {
        let interaction = InteractionMode::SingleSelect {
            choices: vec!["A".to_string(), "B".to_string()],
            cursor_position: 1,
        };
        assert!(SelectionPopup::should_show(
            &ApprovalCategory::UserQuestion,
            Some(&interaction),
        ));

        assert!(!SelectionPopup::should_show(
            &ApprovalCategory::FileEdit,
            None,
        ));
    }
}
