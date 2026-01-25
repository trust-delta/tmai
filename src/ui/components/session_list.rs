use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, ListState},
    Frame,
};

use crate::agents::{AgentStatus, MonitoredAgent};
use crate::state::AppState;

/// Entry in the session list (can be agent or group header)
enum ListEntry {
    Agent(usize), // Index into agent_order
    GroupHeader(String),
}

/// Widget for displaying the list of monitored agents
pub struct SessionList;

impl SessionList {
    /// Render the session list
    pub fn render(frame: &mut Frame, area: Rect, state: &AppState) {
        let spinner_char = state.spinner_char();

        // Build list entries with group headers
        let (entries, selected_entry_index) = Self::build_entries(state);

        let items: Vec<ListItem> = entries
            .iter()
            .map(|entry| match entry {
                ListEntry::Agent(idx) => {
                    if let Some(agent) = state.agent_order.get(*idx).and_then(|id| state.agents.get(id)) {
                        Self::create_list_item(agent, spinner_char)
                    } else {
                        ListItem::new(Line::from(""))
                    }
                }
                ListEntry::GroupHeader(header) => Self::create_group_header(header),
            })
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
        list_state.select(Some(selected_entry_index));

        frame.render_stateful_widget(list, area, &mut list_state);
    }

    /// Build list entries with group headers and return the entry index for current selection
    fn build_entries(state: &AppState) -> (Vec<ListEntry>, usize) {
        let mut entries = Vec::new();
        let mut current_group: Option<String> = None;
        let mut selected_entry_index = 0;

        for (agent_idx, id) in state.agent_order.iter().enumerate() {
            if let Some(agent) = state.agents.get(id) {
                // Check if we need a group header
                if let Some(group_key) = state.get_group_key(agent) {
                    if current_group.as_ref() != Some(&group_key) {
                        entries.push(ListEntry::GroupHeader(group_key.clone()));
                        current_group = Some(group_key);
                    }
                }

                // Track the entry index for the selected agent
                if agent_idx == state.selected_index {
                    selected_entry_index = entries.len();
                }

                entries.push(ListEntry::Agent(agent_idx));
            }
        }

        (entries, selected_entry_index)
    }

    /// Create a group header item
    fn create_group_header(header: &str) -> ListItem<'static> {
        let display = if header.len() > 50 {
            format!("...{}", &header[header.len() - 47..])
        } else {
            header.to_string()
        };

        ListItem::new(Line::from(vec![
            Span::styled(
                format!("── {} ", display),
                Style::default()
                    .fg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                "─".repeat(40),
                Style::default().fg(Color::DarkGray),
            ),
        ]))
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
