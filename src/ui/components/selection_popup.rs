use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph},
    Frame,
};

use tmai_core::agents::ApprovalType;

/// Selection popup widget for AskUserQuestion
pub struct SelectionPopup;

impl SelectionPopup {
    /// Render a selection popup for choices
    pub fn render(frame: &mut Frame, area: Rect, approval_type: &ApprovalType, question: &str) {
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

        // Add choices
        if let ApprovalType::UserQuestion {
            choices,
            multi_select,
            ..
        } = approval_type
        {
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

            if *multi_select {
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
    pub fn should_show(approval_type: &ApprovalType) -> bool {
        matches!(approval_type, ApprovalType::UserQuestion { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_show() {
        assert!(SelectionPopup::should_show(&ApprovalType::UserQuestion {
            choices: vec!["A".to_string(), "B".to_string()],
            multi_select: false,
            cursor_position: 1,
        }));

        assert!(!SelectionPopup::should_show(&ApprovalType::FileEdit));
    }
}
