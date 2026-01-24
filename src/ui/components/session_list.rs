use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, ListState},
    Frame,
};

use crate::agents::{AgentStatus, MonitoredAgent};
use crate::state::AppState;

/// Widget for displaying the list of monitored agents
pub struct SessionList;

impl SessionList {
    /// Render the session list
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let spinner_char = state.spinner_char();
        let items: Vec<ListItem> = state
            .agent_order
            .iter()
            .filter_map(|id| state.agents.get(id))
            .map(|agent| Self::create_list_item(agent, spinner_char))
            .collect();

        let title = format!(
            " Agents ({}) {} ",
            state.agents.len(),
            if state.attention_count() > 0 {
                format!("[{}!]", state.attention_count())
            } else {
                String::new()
            }
        );

        let list = List::new(items)
            .block(
                Block::default()
                    .title(title)
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(Color::Gray)),
            )
            .highlight_style(
                Style::default()
                    .bg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD),
            )
            .highlight_symbol("▶ ");

        let mut list_state = ListState::default();
        list_state.select(Some(state.selected_index));

        frame.render_stateful_widget(list, area, &mut list_state);
    }

    fn create_list_item(agent: &MonitoredAgent, spinner_char: char) -> ListItem<'static> {
        let status_indicator = match &agent.status {
            AgentStatus::Processing { .. } => spinner_char.to_string(),
            _ => agent.status.indicator().to_string(),
        };
        let status_color = Self::status_color(&agent.status);

        let mut spans = vec![
            Span::styled(
                format!("{} ", status_indicator),
                Style::default().fg(status_color),
            ),
            Span::styled(
                format!("[{}] ", agent.agent_type.short_name()),
                Style::default().fg(Color::Cyan),
            ),
            Span::styled(
                agent.display_name(),
                Style::default().fg(Color::White),
            ),
        ];

        // Add status details
        match &agent.status {
            AgentStatus::Processing { activity } if !activity.is_empty() => {
                spans.push(Span::styled(
                    format!(" - {}", truncate(activity, 30)),
                    Style::default().fg(Color::Yellow),
                ));
            }
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                spans.push(Span::styled(
                    format!(" - {}", approval_type),
                    Style::default()
                        .fg(Color::Red)
                        .add_modifier(Modifier::BOLD),
                ));
            }
            AgentStatus::Error { message } => {
                spans.push(Span::styled(
                    format!(" - {}", truncate(message, 30)),
                    Style::default().fg(Color::Red),
                ));
            }
            _ => {}
        }

        // Add title if different from target
        if !agent.title.is_empty() && agent.title != agent.target {
            let title_preview = truncate(&agent.title, 40);
            if !title_preview.is_empty() {
                spans.push(Span::styled(
                    format!(" | {}", title_preview),
                    Style::default().fg(Color::DarkGray),
                ));
            }
        }

        ListItem::new(Line::from(spans))
    }

    fn status_color(status: &AgentStatus) -> Color {
        match status {
            AgentStatus::Idle => Color::Green,
            AgentStatus::Processing { .. } => Color::Yellow,
            AgentStatus::AwaitingApproval { .. } => Color::Red,
            AgentStatus::Error { .. } => Color::Red,
            AgentStatus::Unknown => Color::Gray,
        }
    }
}

/// Truncate a string to a maximum length
fn truncate(s: &str, max_len: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max_len {
        s.to_string()
    } else {
        let truncated: String = chars[..max_len.saturating_sub(3)].iter().collect();
        format!("{}...", truncated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate() {
        assert_eq!(truncate("short", 10), "short");
        assert_eq!(truncate("this is a long string", 10), "this is...");
    }
}
