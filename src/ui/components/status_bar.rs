use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};
use unicode_width::UnicodeWidthStr;

// MonitorScope and SortBy temporarily unused (scope/sort cycling disabled)
use crate::ui::{SplitDirection, ViewMode};
#[allow(unused_imports)]
use tmai_core::state::{AppState, MonitorScope, SortBy};

/// Status bar widget
pub struct StatusBar;

impl StatusBar {
    /// Render the status bar
    pub fn render(
        frame: &mut Frame,
        area: Rect,
        state: &AppState,
        view_mode: ViewMode,
        split_direction: SplitDirection,
    ) {
        let mut spans = vec![];

        // Show view mode and split direction
        spans.push(Span::styled(
            format!(" {} ", view_mode.display_name()),
            Style::default().fg(Color::White).bg(Color::DarkGray),
        ));
        if view_mode == ViewMode::Both {
            spans.push(Span::styled(
                format!("|{}", split_direction.display_name()),
                Style::default().fg(Color::DarkGray),
            ));
        }
        spans.push(Span::raw(" "));

        // Show selected agent/entry info
        Self::render_selection_info(&mut spans, state);

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
            spans.push(Span::styled(
                ":Cancel ",
                Style::default().fg(Color::DarkGray),
            ));

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
                "p",
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
                "t",
                Style::default()
                    .fg(Color::Blue)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                ":Tasks ",
                Style::default().fg(Color::DarkGray),
            ));

            spans.push(Span::styled(
                "T",
                Style::default()
                    .fg(Color::Magenta)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                ":Teams ",
                Style::default().fg(Color::DarkGray),
            ));

            spans.push(Span::styled(
                "h",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(":Help ", Style::default().fg(Color::DarkGray)));

            spans.push(Span::styled(
                "q",
                Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(":Quit ", Style::default().fg(Color::DarkGray)));

            // Scope/sort display temporarily disabled (always AllSessions + Directory)
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

        // Notification message (task completed, teammate idle, etc.)
        if let Some(notification) = state.active_notification() {
            spans.push(Span::styled(
                format!(" {} ", notification),
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ));
        }

        // Error message
        if let Some(error) = &state.error_message {
            spans.push(Span::styled(
                format!(" Error: {} ", error),
                Style::default().fg(Color::White).bg(Color::Red),
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

        let paragraph = Paragraph::new(Line::from(spans)).style(Style::default().bg(Color::Black));

        frame.render_widget(paragraph, area);
    }

    /// Render selection info at the start of status bar
    fn render_selection_info(spans: &mut Vec<Span<'static>>, state: &AppState) {
        if state.selection.is_on_create_new {
            // CreateNew entry selected
            spans.push(Span::styled(" [+ New] ", Style::default().fg(Color::Green)));
        } else if let Some(agent) = state.selected_agent() {
            if agent.is_virtual {
                // Virtual agent (offline team member)
                spans.push(Span::styled(
                    " [Offline] ",
                    Style::default().fg(Color::DarkGray),
                ));
                if let Some(ref team_info) = agent.team_info {
                    spans.push(Span::styled(
                        format!(
                            "{}/{} - Pane not found ",
                            team_info.team_name, team_info.member_name
                        ),
                        Style::default().fg(Color::DarkGray),
                    ));
                }
            } else {
                // Agent selected - show target and agent type
                let short_target = if agent.id.width() > 12 {
                    // Truncate with ellipsis
                    let truncated = truncate_to_width(&agent.id, 9);
                    format!("{}...", truncated)
                } else {
                    agent.id.clone()
                };
                spans.push(Span::styled(
                    format!(" {} ", short_target),
                    Style::default().fg(Color::Cyan),
                ));
                spans.push(Span::styled(
                    format!("{} ", agent.agent_type.short_name()),
                    Style::default().fg(Color::Yellow),
                ));

                // Show detection source
                let detection_label = agent.detection_source.label();
                let detection_color = match agent.detection_source {
                    tmai_core::agents::DetectionSource::IpcSocket => Color::Green,
                    tmai_core::agents::DetectionSource::CapturePane => Color::DarkGray,
                };
                spans.push(Span::styled(
                    format!("[{}] ", detection_label),
                    Style::default().fg(detection_color),
                ));

                // Show team info if the agent is part of a team
                if let Some(team_info) = &agent.team_info {
                    spans.push(Span::styled(
                        format!("[{}/{}] ", team_info.team_name, team_info.member_name),
                        Style::default().fg(Color::Magenta),
                    ));
                }

                // Show git branch if available
                if let Some(ref branch) = agent.git_branch {
                    let branch_color = if agent.git_dirty.unwrap_or(false) {
                        Color::Yellow
                    } else {
                        Color::Cyan
                    };
                    spans.push(Span::styled(
                        format!("[{}] ", branch),
                        Style::default().fg(branch_color),
                    ));
                }
            }
        }
    }
}

/// Truncate a string to fit within a given display width
fn truncate_to_width(s: &str, max_width: usize) -> String {
    let mut result = String::new();
    let mut current_width = 0;

    for c in s.chars() {
        let char_width = unicode_width::UnicodeWidthChar::width(c).unwrap_or(0);
        if current_width + char_width > max_width {
            break;
        }
        result.push(c);
        current_width += char_width;
    }

    result
}

#[cfg(test)]
mod tests {
    // StatusBar is purely UI, tested through integration tests
}
