use ratatui::{
    layout::{Constraint, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph},
    Frame,
};

use tmai_core::state::AppState;
use tmai_core::teams::TaskStatus;

/// Popup overlay showing team tasks for the selected agent's team
pub struct TaskOverlay;

impl TaskOverlay {
    /// Render the task overlay popup centered on the screen
    ///
    /// Shows the task list for the team that the currently selected agent belongs to.
    /// Each task displays a status icon, task ID, subject, owner, and blocked_by info.
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let popup_area = Self::centered_rect(60, 60, area);

        // Clear the area behind the popup
        frame.render_widget(Clear, popup_area);

        // Get team name from selected agent's team_info
        let team_name = match state.selected_agent() {
            Some(agent) => match &agent.team_info {
                Some(info) => info.team_name.clone(),
                None => return,
            },
            None => return,
        };

        // Look up TeamSnapshot from state.teams
        let snapshot = match state.teams.get(&team_name) {
            Some(s) => s,
            None => {
                // No snapshot available, show empty overlay
                let block = Block::default()
                    .title(format!(" Tasks: {} (no data) ", team_name))
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(Color::Cyan));
                let paragraph = Paragraph::new(vec![
                    Line::from(""),
                    Line::from(Span::styled(
                        "  No task data available",
                        Style::default().fg(Color::DarkGray),
                    )),
                ])
                .block(block);
                frame.render_widget(paragraph, popup_area);
                return;
            }
        };

        let tasks = &snapshot.tasks;
        let total = tasks.len();
        let done = tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Completed)
            .count();

        let title = format!(" Tasks: {} ({}/{} done) ", team_name, done, total);

        let mut lines: Vec<Line<'static>> = Vec::new();
        lines.push(Line::from(""));

        for task in tasks {
            let status_icon = match task.status {
                TaskStatus::Completed => Span::styled(
                    " \u{2713} ",
                    Style::default()
                        .fg(Color::Green)
                        .add_modifier(Modifier::BOLD),
                ),
                TaskStatus::InProgress => Span::styled(
                    format!(" {} ", state.spinner_char()),
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ),
                TaskStatus::Pending => {
                    Span::styled(" \u{25CB} ", Style::default().fg(Color::DarkGray))
                }
            };

            let status_color = match task.status {
                TaskStatus::Completed => Color::Green,
                TaskStatus::InProgress => Color::Yellow,
                TaskStatus::Pending => Color::DarkGray,
            };

            let mut spans = vec![
                Span::raw("  "),
                status_icon,
                Span::styled(
                    format!("#{} ", task.id),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(task.subject.clone(), Style::default().fg(status_color)),
            ];

            // Show owner in [brackets]
            if let Some(ref owner) = task.owner {
                spans.push(Span::styled(
                    format!(" [{}]", owner),
                    Style::default().fg(Color::Magenta),
                ));
            }

            // Show blocked_by info
            if !task.blocked_by.is_empty() {
                spans.push(Span::styled(
                    format!(" blocked by #{}", task.blocked_by.join(", #")),
                    Style::default().fg(Color::Red),
                ));
            }

            lines.push(Line::from(spans));
        }

        if tasks.is_empty() {
            lines.push(Line::from(Span::styled(
                "  No tasks found",
                Style::default().fg(Color::DarkGray),
            )));
        }

        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "  Press t or Esc to close",
            Style::default().fg(Color::DarkGray),
        )));

        let block = Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Cyan));

        let paragraph = Paragraph::new(lines)
            .block(block)
            .scroll((state.view.task_overlay_scroll, 0));

        frame.render_widget(paragraph, popup_area);
    }

    /// Center a popup area in the parent area
    fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
        let popup_layout = ratatui::layout::Layout::vertical([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);
        ratatui::layout::Layout::horizontal([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_centered_rect() {
        let area = Rect::new(0, 0, 100, 50);
        let popup = TaskOverlay::centered_rect(60, 60, area);
        // Popup should be centered and smaller than the parent
        assert!(popup.x > 0);
        assert!(popup.y > 0);
        assert!(popup.width < area.width);
        assert!(popup.height < area.height);
    }
}
