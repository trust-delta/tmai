use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::state::AppState;

/// Status bar widget
pub struct StatusBar;

impl StatusBar {
    /// Render the status bar
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let mut spans = vec![];

        // Key hints
        spans.push(Span::styled(
            " j/k",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(":Nav ", Style::default().fg(Color::DarkGray)));

        spans.push(Span::styled(
            "y",
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(
            "/",
            Style::default().fg(Color::DarkGray),
        ));
        spans.push(Span::styled(
            "n",
            Style::default()
                .fg(Color::Red)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(
            ":Approve ",
            Style::default().fg(Color::DarkGray),
        ));

        spans.push(Span::styled(
            "1-9",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(
            ":Select ",
            Style::default().fg(Color::DarkGray),
        ));

        spans.push(Span::styled(
            "f",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(
            ":Focus ",
            Style::default().fg(Color::DarkGray),
        ));

        spans.push(Span::styled(
            "?",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(":Help ", Style::default().fg(Color::DarkGray)));

        spans.push(Span::styled(
            "q",
            Style::default()
                .fg(Color::Red)
                .add_modifier(Modifier::BOLD),
        ));
        spans.push(Span::styled(":Quit ", Style::default().fg(Color::DarkGray)));

        // Spacer
        spans.push(Span::raw(" "));

        // Attention indicator
        let attention_count = state.attention_count();
        if attention_count > 0 {
            spans.push(Span::styled(
                format!(" {} needs attention ", attention_count),
                Style::default()
                    .fg(Color::White)
                    .bg(Color::Red)
                    .add_modifier(Modifier::BOLD),
            ));
        }

        // Error message
        if let Some(error) = &state.error_message {
            spans.push(Span::styled(
                format!(" Error: {} ", error),
                Style::default()
                    .fg(Color::White)
                    .bg(Color::Red),
            ));
        }

        // Last poll time
        if let Some(last_poll) = state.last_poll {
            let elapsed = chrono::Utc::now()
                .signed_duration_since(last_poll)
                .num_seconds();
            spans.push(Span::styled(
                format!(" [{}s] ", elapsed),
                Style::default().fg(Color::DarkGray),
            ));
        }

        let paragraph = Paragraph::new(Line::from(spans))
            .style(Style::default().bg(Color::Black));

        frame.render_widget(paragraph, area);
    }
}

#[cfg(test)]
mod tests {
    // StatusBar is purely UI, tested through integration tests
}
