use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState,
    },
    Frame,
};

use tmai_core::agents::AgentStatus;
use tmai_core::state::AppState;

/// Full-screen overlay showing all worktrees grouped by repository
pub struct WorktreeOverview;

impl WorktreeOverview {
    /// Render the worktree overview screen (full screen)
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let content_lines = Self::build_content(state);
        let total_lines = content_lines.len();

        let visible_height = area.height.saturating_sub(2) as usize;
        let max_scroll = total_lines.saturating_sub(visible_height);
        let scroll = (state.view.worktree_overview_scroll as usize).min(max_scroll);

        let block = Block::default()
            .title(" Worktree Overview (j/k to scroll, w or Esc to close) ")
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

    /// Build the content lines for the worktree overview
    fn build_content(state: &AppState) -> Vec<Line<'static>> {
        let mut lines = Vec::new();

        lines.push(Line::from(vec![Span::styled(
            "Worktree Overview".to_string(),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )]));
        lines.push(Line::from(""));

        if state.worktree_info.is_empty() {
            lines.push(Line::from(Span::styled(
                "  No worktrees found.",
                Style::default().fg(Color::DarkGray),
            )));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "  Worktrees are detected from agents in git repositories",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        for repo in &state.worktree_info {
            // Repository header
            lines.push(Line::from(vec![Span::styled(
                format!(
                    "\u{2500}\u{2500}\u{2500} {} ({}) \u{2500}\u{2500}\u{2500}",
                    repo.repo_name,
                    repo.repo_path
                        .strip_suffix("/.git")
                        .unwrap_or(&repo.repo_path)
                ),
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            )]));

            if repo.worktrees.is_empty() {
                lines.push(Line::from(Span::styled(
                    "  (no worktrees)",
                    Style::default().fg(Color::DarkGray),
                )));
            } else {
                for wt in &repo.worktrees {
                    let mut spans = vec![Span::styled("  ", Style::default())];

                    // Worktree name
                    let name_color = if wt.is_main {
                        Color::White
                    } else {
                        Color::Cyan
                    };
                    spans.push(Span::styled(
                        format!("{:16}", wt.name),
                        Style::default().fg(name_color).add_modifier(Modifier::BOLD),
                    ));

                    // Branch
                    let branch = wt.branch.as_deref().unwrap_or("(detached)");
                    spans.push(Span::styled(
                        format!("{:14}", branch),
                        Style::default().fg(Color::Magenta),
                    ));

                    // Dirty indicator
                    if wt.is_dirty == Some(true) {
                        spans.push(Span::styled(
                            "* ",
                            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
                        ));
                    } else {
                        spans.push(Span::styled("  ", Style::default()));
                    }

                    // Agent status
                    match &wt.agent_status {
                        Some(status) => {
                            let (icon, color) = status_icon_and_color(status);
                            let label = status_label(status);
                            spans.push(Span::styled(
                                format!("{} ", icon),
                                Style::default().fg(color),
                            ));
                            spans.push(Span::styled(
                                format!("{:14}", label),
                                Style::default().fg(color),
                            ));
                        }
                        None => {
                            spans.push(Span::styled(
                                "\u{2500} (no agent)    ",
                                Style::default().fg(Color::DarkGray),
                            ));
                        }
                    }

                    // Agent target
                    if let Some(ref target) = wt.agent_target {
                        spans.push(Span::styled(
                            target.clone(),
                            Style::default().fg(Color::DarkGray),
                        ));
                    }

                    lines.push(Line::from(spans));
                }
            }

            lines.push(Line::from(""));
        }

        lines.push(Line::from(Span::styled(
            "Press w or Esc to close",
            Style::default().fg(Color::DarkGray),
        )));

        lines
    }
}

/// Get status icon and color for an agent status
fn status_icon_and_color(status: &AgentStatus) -> (&'static str, Color) {
    match status {
        AgentStatus::Idle => ("\u{2713}", Color::Green),
        AgentStatus::Processing { .. } => ("\u{25cf}", Color::Yellow),
        AgentStatus::AwaitingApproval { .. } => ("?", Color::Magenta),
        AgentStatus::Error { .. } => ("\u{26a0}", Color::Red),
        AgentStatus::Unknown => ("\u{2500}", Color::DarkGray),
        AgentStatus::Offline => ("\u{25cb}", Color::DarkGray),
    }
}

/// Get status label for an agent status
fn status_label(status: &AgentStatus) -> &'static str {
    match status {
        AgentStatus::Idle => "Idle",
        AgentStatus::Processing { .. } => "Processing",
        AgentStatus::AwaitingApproval { .. } => "Approval",
        AgentStatus::Error { .. } => "Error",
        AgentStatus::Unknown => "Unknown",
        AgentStatus::Offline => "Offline",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_icon_and_color() {
        let (icon, color) = status_icon_and_color(&AgentStatus::Idle);
        assert_eq!(icon, "\u{2713}");
        assert_eq!(color, Color::Green);

        let (icon, color) = status_icon_and_color(&AgentStatus::Processing {
            activity: String::new(),
        });
        assert_eq!(icon, "\u{25cf}");
        assert_eq!(color, Color::Yellow);
    }

    #[test]
    fn test_status_label() {
        assert_eq!(status_label(&AgentStatus::Idle), "Idle");
        assert_eq!(
            status_label(&AgentStatus::Processing {
                activity: String::new()
            }),
            "Processing"
        );
    }
}
