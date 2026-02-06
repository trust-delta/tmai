use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
    },
    Frame,
};

use crate::state::AppState;
use crate::teams::TaskStatus;

/// Full-screen overlay showing all teams, their members, and task progress
pub struct TeamOverview;

impl TeamOverview {
    /// Render the team overview screen (full screen, like HelpScreen)
    ///
    /// Shows all teams with their members, task progress bars, and dependency info.
    /// Scrollable with j/k, close with T or Esc.
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let content_lines = Self::build_content(state);
        let total_lines = content_lines.len();

        // Calculate visible area (subtract 2 for border)
        let visible_height = area.height.saturating_sub(2) as usize;

        // Clamp scroll to valid range
        let max_scroll = total_lines.saturating_sub(visible_height);
        let scroll = (state.team_overview_scroll as usize).min(max_scroll);

        let block = Block::default()
            .title(" Team Overview (j/k to scroll, T or Esc to close) ")
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Cyan));

        let paragraph = Paragraph::new(content_lines)
            .block(block)
            .scroll((scroll as u16, 0));

        frame.render_widget(paragraph, area);

        // Render scrollbar
        if total_lines > visible_height {
            let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
                .begin_symbol(Some("\u{2191}"))
                .end_symbol(Some("\u{2193}"));

            let mut scrollbar_state = ScrollbarState::new(max_scroll).position(scroll);

            frame.render_stateful_widget(
                scrollbar,
                area.inner(ratatui::layout::Margin {
                    vertical: 1,
                    horizontal: 0,
                }),
                &mut scrollbar_state,
            );
        }
    }

    /// Build the content lines for the team overview
    fn build_content(state: &AppState) -> Vec<Line<'static>> {
        let mut lines = Vec::new();

        lines.push(Self::title_line("Team Overview"));
        lines.push(Line::from(""));

        if state.teams.is_empty() {
            lines.push(Line::from(Span::styled(
                "  No teams found.",
                Style::default().fg(Color::DarkGray),
            )));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "  Teams are detected from ~/.claude/teams/*/config.json",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        // Sort team names for consistent display
        let mut team_names: Vec<&String> = state.teams.keys().collect();
        team_names.sort();

        for team_name in team_names {
            let snapshot = &state.teams[team_name];
            let config = &snapshot.config;
            let tasks = &snapshot.tasks;

            // Team header
            let member_count = config.members.len();
            lines.push(Self::section_header(&format!(
                "{} ({} members)",
                team_name, member_count
            )));

            // Team description
            if let Some(ref desc) = config.description {
                lines.push(Line::from(vec![
                    Span::styled("  ", Style::default()),
                    Span::styled(desc.clone(), Style::default().fg(Color::DarkGray)),
                ]));
            }

            // Task progress bar
            let total_tasks = tasks.len();
            if total_tasks > 0 {
                let done = tasks
                    .iter()
                    .filter(|t| t.status == TaskStatus::Completed)
                    .count();
                let in_progress = tasks
                    .iter()
                    .filter(|t| t.status == TaskStatus::InProgress)
                    .count();
                let percent = if total_tasks > 0 {
                    (done * 100) / total_tasks
                } else {
                    0
                };

                let bar = Self::build_progress_bar(done, in_progress, total_tasks, 20);
                lines.push(Line::from(vec![
                    Span::styled("  Tasks: ", Style::default().fg(Color::DarkGray)),
                    bar,
                    Span::styled(
                        format!(" {}/{} ({}%)", done, total_tasks, percent),
                        Style::default().fg(Color::White),
                    ),
                ]));
            } else {
                lines.push(Line::from(Span::styled(
                    "  Tasks: none",
                    Style::default().fg(Color::DarkGray),
                )));
            }

            lines.push(Line::from(""));

            // Member list with status and current task
            lines.push(Line::from(Span::styled(
                "  Members:",
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
            )));

            for member in &config.members {
                let mut spans = vec![Span::styled("    ", Style::default())];

                // Check if member has a mapped pane
                let has_pane = snapshot.member_panes.contains_key(&member.name);
                let status_icon = if has_pane { "\u{25CF}" } else { "\u{25CB}" };
                let status_color = if has_pane {
                    Color::Green
                } else {
                    Color::DarkGray
                };

                spans.push(Span::styled(
                    format!("{} ", status_icon),
                    Style::default().fg(status_color),
                ));

                spans.push(Span::styled(
                    member.name.clone(),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ));

                // Show agent type if available
                if let Some(ref agent_type) = member.agent_type {
                    spans.push(Span::styled(
                        format!(" ({})", agent_type),
                        Style::default().fg(Color::DarkGray),
                    ));
                }

                // Show current task if the member owns one that's in progress
                let current_task = tasks.iter().find(|t| {
                    t.owner.as_deref() == Some(&member.name) && t.status == TaskStatus::InProgress
                });
                if let Some(task) = current_task {
                    spans.push(Span::styled(
                        format!(" -> #{} {}", task.id, task.subject),
                        Style::default().fg(Color::Yellow),
                    ));
                }

                lines.push(Line::from(spans));
            }

            lines.push(Line::from(""));

            // Task list with dependencies
            if !tasks.is_empty() {
                lines.push(Line::from(Span::styled(
                    "  Tasks:",
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                )));

                for task in tasks {
                    let status_icon = match task.status {
                        TaskStatus::Completed => Span::styled(
                            "\u{2713} ",
                            Style::default()
                                .fg(Color::Green)
                                .add_modifier(Modifier::BOLD),
                        ),
                        TaskStatus::InProgress => Span::styled(
                            format!("{} ", state.spinner_char()),
                            Style::default()
                                .fg(Color::Yellow)
                                .add_modifier(Modifier::BOLD),
                        ),
                        TaskStatus::Pending => {
                            Span::styled("\u{25CB} ", Style::default().fg(Color::DarkGray))
                        }
                    };

                    let subject_color = match task.status {
                        TaskStatus::Completed => Color::Green,
                        TaskStatus::InProgress => Color::Yellow,
                        TaskStatus::Pending => Color::DarkGray,
                    };

                    let mut spans = vec![
                        Span::styled("    ", Style::default()),
                        status_icon,
                        Span::styled(format!("#{} ", task.id), Style::default().fg(Color::Cyan)),
                        Span::styled(task.subject.clone(), Style::default().fg(subject_color)),
                    ];

                    // Show owner
                    if let Some(ref owner) = task.owner {
                        spans.push(Span::styled(
                            format!(" [{}]", owner),
                            Style::default().fg(Color::Magenta),
                        ));
                    }

                    // Show blocked_by
                    if !task.blocked_by.is_empty() {
                        spans.push(Span::styled(
                            format!(" blocked by #{}", task.blocked_by.join(", #")),
                            Style::default().fg(Color::Red),
                        ));
                    }

                    // Show blocks
                    if !task.blocks.is_empty() {
                        spans.push(Span::styled(
                            format!(" blocks #{}", task.blocks.join(", #")),
                            Style::default().fg(Color::Blue),
                        ));
                    }

                    lines.push(Line::from(spans));
                }
            }

            lines.push(Line::from(""));
        }

        lines.push(Line::from(Span::styled(
            "Press T or Esc to close",
            Style::default().fg(Color::DarkGray),
        )));

        lines
    }

    /// Build a progress bar span
    fn build_progress_bar(
        done: usize,
        in_progress: usize,
        total: usize,
        bar_width: usize,
    ) -> Span<'static> {
        if total == 0 {
            return Span::styled(
                "\u{2591}".repeat(bar_width),
                Style::default().fg(Color::DarkGray),
            );
        }

        let done_width = (done * bar_width) / total;
        let in_progress_width = (in_progress * bar_width) / total;
        let remaining_width = bar_width.saturating_sub(done_width + in_progress_width);

        let mut bar = String::new();
        bar.push_str(&"\u{2588}".repeat(done_width));
        bar.push_str(&"\u{2593}".repeat(in_progress_width));
        bar.push_str(&"\u{2591}".repeat(remaining_width));

        // We need to use a single span with the full bar since we can't mix colors in one Span.
        // Use the dominant color based on progress.
        let color = if done == total {
            Color::Green
        } else if done + in_progress > 0 {
            Color::Yellow
        } else {
            Color::DarkGray
        };

        Span::styled(bar, Style::default().fg(color))
    }

    /// Create a title line
    fn title_line(text: &str) -> Line<'static> {
        Line::from(vec![Span::styled(
            text.to_string(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )])
    }

    /// Create a section header line
    fn section_header(text: &str) -> Line<'static> {
        Line::from(vec![Span::styled(
            format!("\u{2500}\u{2500}\u{2500} {} \u{2500}\u{2500}\u{2500}", text),
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_progress_bar_empty() {
        let bar = TeamOverview::build_progress_bar(0, 0, 0, 10);
        // Should produce a bar of light shade characters
        assert_eq!(bar.content.len(), 30); // 10 chars * 3 bytes each (UTF-8)
    }

    #[test]
    fn test_progress_bar_full() {
        let bar = TeamOverview::build_progress_bar(5, 0, 5, 10);
        // All done: should be green full blocks
        assert!(bar.content.contains('\u{2588}'));
    }

    #[test]
    fn test_progress_bar_partial() {
        let bar = TeamOverview::build_progress_bar(2, 1, 5, 10);
        // Should contain both full blocks and medium shade
        let content = bar.content.to_string();
        assert!(content.contains('\u{2588}') || content.contains('\u{2593}'));
    }
}
