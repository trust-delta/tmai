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
        let display = if header.len() > 45 {
            format!("...{}", &header[header.len() - 42..])
        } else {
            header.to_string()
        };

        ListItem::new(Line::from(vec![
            Span::styled(
                format!("▸ {} ", display),
                Style::default()
                    .fg(Color::Blue)
                    .add_modifier(Modifier::BOLD),
            ),
        ]))
    }

    fn create_list_item(agent: &MonitoredAgent, spinner_char: char) -> ListItem<'static> {
        let status_indicator = match &agent.status {
            AgentStatus::Processing { .. } => spinner_char.to_string(),
            _ => agent.status.indicator().to_string(),
        };
        let status_color = Self::status_color(&agent.status);

        // Line 1: AgentType | pid:xxx
        let line1 = Line::from(vec![
            Span::styled(
                agent.agent_type.short_name().to_string(),
                Style::default().fg(Color::Cyan),
            ),
            Span::styled(" | ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("pid:{}", agent.pid),
                Style::default().fg(Color::DarkGray),
            ),
        ]);

        // Line 2: status indicator + status_text
        let status_text = match &agent.status {
            AgentStatus::Idle => "Idle".to_string(),
            AgentStatus::Processing { activity } => {
                if activity.is_empty() {
                    "Processing...".to_string()
                } else {
                    format!("Processing: {}", truncate(activity, 20))
                }
            }
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                format!("Awaiting: {}", approval_type)
            }
            AgentStatus::Error { message } => {
                format!("Error: {}", truncate(message, 20))
            }
            AgentStatus::Unknown => "Unknown".to_string(),
        };

        let line2 = Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                format!("{} ", status_indicator),
                Style::default().fg(status_color),
            ),
            Span::styled(status_text, Style::default().fg(status_color)),
        ]);

        // Line 3: title
        let title_display = if agent.title.is_empty() {
            "-".to_string()
        } else {
            truncate(&agent.title, 35)
        };

        let line3 = Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(title_display, Style::default().fg(Color::White)),
        ]);

        // Line 4: session | pane
        let line4 = Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                format!("{} | {}.{}", agent.session, agent.window_index, agent.pane_index),
                Style::default().fg(Color::White),
            ),
        ]);

        ListItem::new(vec![line1, line2, line3, line4])
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
