use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::state::{AppState, SortBy};

/// Status bar widget
pub struct StatusBar;

impl StatusBar {
    /// Render the status bar
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let mut spans = vec![];

        // Show different hints based on input mode
        if state.is_passthrough_mode() {
            // Passthrough mode hints
            spans.push(Span::styled(
                " -- PASSTHROUGH -- ",
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Magenta)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(" ", Style::default()));

            spans.push(Span::styled(
                "Keys sent directly to pane ",
                Style::default().fg(Color::White),
            ));

            spans.push(Span::styled(
                "Esc",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(":Exit ", Style::default().fg(Color::DarkGray)));
        } else if state.is_input_mode() {
            // Input mode hints
            spans.push(Span::styled(
                " -- INPUT -- ",
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(" ", Style::default()));

            spans.push(Span::styled(
                "Enter",
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(":Send ", Style::default().fg(Color::DarkGray)));

            spans.push(Span::styled(
                "Esc",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(":Cancel ", Style::default().fg(Color::DarkGray)));

            spans.push(Span::styled(
                "<-/->",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(":Move ", Style::default().fg(Color::DarkGray)));
        } else {
            // Normal mode hints
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
                "i",
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                ":Input ",
                Style::default().fg(Color::DarkGray),
            ));

            spans.push(Span::styled(
                "→",
                Style::default()
                    .fg(Color::Magenta)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                ":Direct ",
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
                "s",
                Style::default()
                    .fg(Color::Blue)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                ":Sort ",
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

            // Show current sort method if not default (Directory)
            if state.sort_by != SortBy::Directory {
                spans.push(Span::styled(
                    format!("[Sort:{}] ", state.sort_by.display_name()),
                    Style::default().fg(Color::Blue),
                ));
            }
        }

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
