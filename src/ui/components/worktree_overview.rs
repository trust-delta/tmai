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
use tmai_core::git::strip_git_suffix;
use tmai_core::state::{AppState, InputMode};

/// Full-screen overlay showing all worktrees grouped by repository.
///
/// Interactive: j/k to navigate, c to create, d to delete, l/Enter to launch agent, v to view diff.
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
            .title(" Worktree Overview (j/k select, c create, d delete, l launch, v diff, w/Esc close) ")
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

    /// Count total selectable worktrees (non-main, across all repos)
    pub fn selectable_count(state: &AppState) -> usize {
        state
            .worktree_info
            .iter()
            .flat_map(|r| r.worktrees.iter())
            .count()
    }

    /// Get the selected worktree's details (repo_path, worktree name, path)
    pub fn selected_worktree(state: &AppState) -> Option<SelectedWorktree> {
        let idx = state.view.worktree_selected_index?;
        let mut flat_idx = 0;
        for repo in &state.worktree_info {
            for wt in &repo.worktrees {
                if flat_idx == idx {
                    return Some(SelectedWorktree {
                        repo_name: repo.repo_name.clone(),
                        repo_path: strip_git_suffix(&repo.repo_path).to_string(),
                        worktree_name: wt.name.clone(),
                        worktree_path: wt.path.clone(),
                        is_main: wt.is_main,
                        has_agent: wt.agent_target.is_some(),
                    });
                }
                flat_idx += 1;
            }
        }
        None
    }

    /// Build the content lines for the worktree overview
    fn build_content(state: &AppState) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        let selected_idx = state.view.worktree_selected_index;

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
                "  Worktrees are detected from agents in git repositories.",
                Style::default().fg(Color::DarkGray),
            )));
            lines.push(Line::from(Span::styled(
                "  Start an agent in a git repo to see worktrees here.",
                Style::default().fg(Color::DarkGray),
            )));
            return lines;
        }

        let mut flat_idx = 0usize;

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
                    let is_selected = selected_idx == Some(flat_idx);
                    let mut spans = Vec::new();

                    // Selection indicator
                    if is_selected {
                        spans.push(Span::styled(
                            "\u{25b6} ",
                            Style::default()
                                .fg(Color::Cyan)
                                .add_modifier(Modifier::BOLD),
                        ));
                    } else {
                        spans.push(Span::styled("  ", Style::default()));
                    }

                    // Worktree name
                    let name_style = if is_selected {
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD | Modifier::REVERSED)
                    } else if wt.is_main {
                        Style::default()
                            .fg(Color::White)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default()
                            .fg(Color::Cyan)
                            .add_modifier(Modifier::BOLD)
                    };
                    spans.push(Span::styled(format!("{:16}", wt.name), name_style));

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

                    // Diff summary (inline "+N -M")
                    if let Some(ref ds) = wt.diff_summary {
                        if ds.insertions > 0 || ds.deletions > 0 {
                            spans.push(Span::styled(
                                format!("+{}", ds.insertions),
                                Style::default().fg(Color::Green),
                            ));
                            spans.push(Span::styled(" ", Style::default()));
                            spans.push(Span::styled(
                                format!("-{}", ds.deletions),
                                Style::default().fg(Color::Red),
                            ));
                            spans.push(Span::styled(
                                format!(" ({}f) ", ds.files_changed),
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
                    flat_idx += 1;
                }
            }

            lines.push(Line::from(""));
        }

        // Worktree create input prompt
        if state.input.mode == InputMode::WorktreeCreate {
            // Split buffer at cursor position (character-aware)
            let cursor_pos = state.input.cursor_position;
            let byte_idx = state
                .input
                .buffer
                .char_indices()
                .nth(cursor_pos)
                .map(|(i, _)| i)
                .unwrap_or(state.input.buffer.len());
            let before = &state.input.buffer[..byte_idx];
            let after = &state.input.buffer[byte_idx..];

            lines.push(Line::from(vec![
                Span::styled(
                    "  Branch name: ",
                    Style::default()
                        .fg(Color::Green)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(before.to_string(), Style::default().fg(Color::White)),
                Span::styled("\u{2588}", Style::default().fg(Color::Cyan)),
                Span::styled(after.to_string(), Style::default().fg(Color::White)),
            ]));
            lines.push(Line::from(Span::styled(
                "  Enter to confirm, Esc to cancel",
                Style::default().fg(Color::DarkGray),
            )));
            lines.push(Line::from(""));
        }

        // Footer with keybindings
        lines.push(Line::from(vec![
            Span::styled("  c", Style::default().fg(Color::Green)),
            Span::styled(" create  ", Style::default().fg(Color::DarkGray)),
            Span::styled("d", Style::default().fg(Color::Red)),
            Span::styled(" delete  ", Style::default().fg(Color::DarkGray)),
            Span::styled("l/Enter", Style::default().fg(Color::Yellow)),
            Span::styled(" launch  ", Style::default().fg(Color::DarkGray)),
            Span::styled("v", Style::default().fg(Color::Blue)),
            Span::styled(" diff  ", Style::default().fg(Color::DarkGray)),
            Span::styled("w/Esc", Style::default().fg(Color::DarkGray)),
            Span::styled(" close", Style::default().fg(Color::DarkGray)),
        ]));

        lines
    }
}

/// Full-screen diff viewer overlay
pub struct DiffViewer;

impl DiffViewer {
    /// Render the diff viewer overlay
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        if state.worktree_diff_loading {
            let block = Block::default()
                .title(" Diff Viewer (loading...) ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(Color::Blue));
            let paragraph = Paragraph::new(vec![
                Line::from(""),
                Line::from(Span::styled(
                    "  Loading diff...",
                    Style::default().fg(Color::DarkGray),
                )),
            ])
            .block(block);
            frame.render_widget(paragraph, area);
            return;
        }

        let content = state
            .worktree_diff_content
            .as_deref()
            .unwrap_or("(no diff)");

        let content_lines: Vec<Line<'static>> = content
            .lines()
            .map(|line| {
                let style = if line.starts_with('+') && !line.starts_with("+++") {
                    Style::default().fg(Color::Green)
                } else if line.starts_with('-') && !line.starts_with("---") {
                    Style::default().fg(Color::Red)
                } else if line.starts_with("@@") {
                    Style::default().fg(Color::Cyan)
                } else if line.starts_with("diff ") || line.starts_with("index ") {
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(Color::White)
                };
                Line::from(Span::styled(line.to_string(), style))
            })
            .collect();

        let total_lines = content_lines.len();
        let visible_height = area.height.saturating_sub(2) as usize;
        let max_scroll = total_lines.saturating_sub(visible_height);
        let scroll = (state.view.diff_viewer_scroll as usize).min(max_scroll);

        let block = Block::default()
            .title(" Diff Viewer (j/k scroll, Esc close) ")
            .borders(Borders::ALL)
            .border_type(BorderType::Rounded)
            .border_style(Style::default().fg(Color::Blue));

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
}

/// Information about the currently selected worktree
#[derive(Debug, Clone)]
pub struct SelectedWorktree {
    pub repo_name: String,
    pub repo_path: String,
    pub worktree_name: String,
    pub worktree_path: String,
    pub is_main: bool,
    pub has_agent: bool,
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
