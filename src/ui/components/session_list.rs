use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, ListState},
    Frame,
};

use crate::agents::{AgentStatus, MonitoredAgent};
use crate::state::AppState;
use crate::ui::SplitDirection;

/// Entry in the session list (can be agent, group header, or create new button)
#[derive(Debug, Clone)]
pub enum ListEntry {
    Agent(usize), // Index into agent_order
    GroupHeader(String),
    CreateNew { group_key: String },
}

/// Widget for displaying the list of monitored agents
pub struct SessionList;

impl SessionList {
    /// Render the session list
    pub fn render(
        frame: &mut Frame,
        area: Rect,
        state: &AppState,
        split_direction: SplitDirection,
    ) {
        match split_direction {
            SplitDirection::Horizontal => Self::render_vertical_list(frame, area, state),
            SplitDirection::Vertical => Self::render_horizontal_list(frame, area, state),
        }
    }

    /// Render vertical list (traditional, multi-line per agent)
    fn render_vertical_list(frame: &mut Frame, area: Rect, state: &AppState) {
        let spinner_char = state.spinner_char();

        // Build list entries with group headers
        let (entries, ui_entry_index, _selectable_count, _agent_index) = Self::build_entries(state);

        let items: Vec<ListItem> = entries
            .iter()
            .map(|entry| match entry {
                ListEntry::Agent(idx) => {
                    if let Some(agent) = state
                        .agent_order
                        .get(*idx)
                        .and_then(|id| state.agents.get(id))
                    {
                        Self::create_list_item(agent, spinner_char)
                    } else {
                        ListItem::new(Line::from(""))
                    }
                }
                ListEntry::GroupHeader(header) => Self::create_group_header(header),
                ListEntry::CreateNew { .. } => Self::create_new_item(),
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
        list_state.select(Some(ui_entry_index));

        frame.render_stateful_widget(list, area, &mut list_state);
    }

    /// Render horizontal list (compact, single-line per agent, laid out horizontally)
    fn render_horizontal_list(frame: &mut Frame, area: Rect, state: &AppState) {
        let spinner_char = state.spinner_char();

        // Build list entries
        let (entries, ui_entry_index, _selectable_count, _agent_index) = Self::build_entries(state);

        // Use full width for each item (horizontal layout means full-width rows)
        let inner_width = area.width.saturating_sub(4); // borders + highlight symbol

        let items: Vec<ListItem> = entries
            .iter()
            .enumerate()
            .map(|(idx, entry)| {
                let is_selected = idx == ui_entry_index;
                match entry {
                    ListEntry::Agent(agent_idx) => {
                        if let Some(agent) = state
                            .agent_order
                            .get(*agent_idx)
                            .and_then(|id| state.agents.get(id))
                        {
                            Self::create_compact_item(agent, spinner_char, inner_width, is_selected)
                        } else {
                            ListItem::new(Line::from(""))
                        }
                    }
                    ListEntry::GroupHeader(header) => {
                        Self::create_compact_group_header(header, inner_width)
                    }
                    ListEntry::CreateNew { .. } => {
                        Self::create_compact_new_item(inner_width, is_selected)
                    }
                }
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
        list_state.select(Some(ui_entry_index));

        frame.render_stateful_widget(list, area, &mut list_state);
    }

    /// Build list entries with group headers and return the UI entry index for highlighting
    /// Also returns selectable_count and the agent index for the current selection
    pub fn build_entries(state: &AppState) -> (Vec<ListEntry>, usize, usize, Option<usize>) {
        let mut entries = Vec::new();
        let mut current_group: Option<String> = None;
        let mut selectable_index = 0; // Index among selectable items only
        let mut ui_entry_index = 0; // Index in the full entries list for highlighting
        let mut selected_agent_index: Option<usize> = None;

        // Add CreateNew at the top (always first selectable item)
        if state.selected_entry_index == 0 {
            ui_entry_index = 0;
        }
        entries.push(ListEntry::CreateNew {
            group_key: String::new(),
        });
        selectable_index += 1;

        for (agent_idx, id) in state.agent_order.iter().enumerate() {
            if let Some(agent) = state.agents.get(id) {
                // Check if we need a group header
                if let Some(group_key) = state.get_group_key(agent) {
                    if current_group.as_ref() != Some(&group_key) {
                        entries.push(ListEntry::GroupHeader(group_key.clone()));
                        current_group = Some(group_key);
                    }
                }

                // Track the entry index for the selected entry
                if selectable_index == state.selected_entry_index {
                    ui_entry_index = entries.len();
                    selected_agent_index = Some(agent_idx);
                }

                entries.push(ListEntry::Agent(agent_idx));
                selectable_index += 1;
            }
        }

        (
            entries,
            ui_entry_index,
            selectable_index,
            selected_agent_index,
        )
    }

    /// Get the currently selected entry
    pub fn get_selected_entry(state: &AppState) -> Option<ListEntry> {
        let (entries, ui_entry_index, _, _) = Self::build_entries(state);
        entries.get(ui_entry_index).cloned()
    }

    /// Create a group header item
    fn create_group_header(header: &str) -> ListItem<'static> {
        let display = if header.len() > 45 {
            format!("...{}", &header[header.len() - 42..])
        } else {
            header.to_string()
        };

        ListItem::new(Line::from(vec![Span::styled(
            format!("▸ {} ", display),
            Style::default()
                .fg(Color::Blue)
                .add_modifier(Modifier::BOLD),
        )]))
    }

    /// Create a "new session" item
    fn create_new_item() -> ListItem<'static> {
        ListItem::new(Line::from(vec![Span::styled(
            "+ 新規プロセス",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::ITALIC),
        )]))
    }

    fn create_list_item(agent: &MonitoredAgent, spinner_char: char) -> ListItem<'static> {
        let status_indicator = match &agent.status {
            AgentStatus::Processing { .. } => spinner_char.to_string(),
            _ => agent.status.indicator().to_string(),
        };
        let status_color = Self::status_color(&agent.status);

        // Line 1: AgentType | pid:xxx [context warning] (2-char indent for items under group header)
        let mut line1_spans = vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                agent.agent_type.short_name().to_string(),
                Style::default().fg(Color::Cyan),
            ),
            Span::styled(" | ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("pid:{}", agent.pid),
                Style::default().fg(Color::DarkGray),
            ),
        ];

        // Add context warning if present
        if let Some(percent) = agent.context_warning {
            let warning_color = if percent <= 10 {
                Color::Red
            } else if percent <= 20 {
                Color::Yellow
            } else {
                Color::Rgb(255, 165, 0) // Orange
            };
            line1_spans.push(Span::styled(
                format!(" ⚠{}%", percent),
                Style::default().fg(warning_color),
            ));
        }

        let line1 = Line::from(line1_spans);

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
            Span::styled("    ", Style::default()),
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
            Span::styled("    ", Style::default()),
            Span::styled(title_display, Style::default().fg(Color::White)),
        ]);

        // Line 4: session | pane
        let line4 = Line::from(vec![
            Span::styled("    ", Style::default()),
            Span::styled(
                format!(
                    "{} | {}.{}",
                    agent.session, agent.window_index, agent.pane_index
                ),
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

    /// Create a compact single-line item for horizontal layout
    /// Format: ⣾ CC | pid:1234 | session:0.1 | title | status
    fn create_compact_item(
        agent: &MonitoredAgent,
        spinner_char: char,
        max_width: u16,
        is_selected: bool,
    ) -> ListItem<'static> {
        let status_indicator = match &agent.status {
            AgentStatus::Processing { .. } => spinner_char.to_string(),
            _ => agent.status.indicator().to_string(),
        };
        let status_color = Self::status_color(&agent.status);

        // Calculate available space for dynamic parts
        // Fixed: indicator(2) + CC(2) + " | "(3) + "pid:"(4) + pid(~6) + " | "(3) + session(~15) + " | "(3) + " | "(3) ≈ 40
        let fixed_len = 45_usize;
        let remaining = (max_width as usize).saturating_sub(fixed_len);
        let title_len = remaining / 2;
        let status_len = remaining.saturating_sub(title_len);

        let title_display = if agent.title.is_empty() {
            "-".to_string()
        } else {
            truncate(&agent.title, title_len.max(10))
        };

        let status_text = match &agent.status {
            AgentStatus::Idle => "Idle".to_string(),
            AgentStatus::Processing { activity } => {
                if activity.is_empty() {
                    "Processing".to_string()
                } else {
                    format!("Processing: {}", truncate(activity, status_len.saturating_sub(12).max(5)))
                }
            }
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                truncate(&approval_type.to_string(), status_len.max(10))
            }
            AgentStatus::Error { message } => format!("Error: {}", truncate(message, status_len.saturating_sub(7).max(5))),
            AgentStatus::Unknown => "Unknown".to_string(),
        };

        let bg_color = if is_selected {
            Color::DarkGray
        } else {
            Color::Reset
        };

        let session_info = format!("{}:{}.{}", agent.session, agent.window_index, agent.pane_index);

        let line = Line::from(vec![
            Span::styled(
                format!("{} ", status_indicator),
                Style::default().fg(status_color).bg(bg_color),
            ),
            Span::styled(
                agent.agent_type.short_name().to_string(),
                Style::default().fg(Color::Cyan).bg(bg_color),
            ),
            Span::styled(" | ", Style::default().fg(Color::DarkGray).bg(bg_color)),
            Span::styled(
                format!("pid:{:<6}", agent.pid),
                Style::default().fg(Color::DarkGray).bg(bg_color),
            ),
            Span::styled(" | ", Style::default().fg(Color::DarkGray).bg(bg_color)),
            Span::styled(
                session_info,
                Style::default().fg(Color::White).bg(bg_color),
            ),
            Span::styled(" | ", Style::default().fg(Color::DarkGray).bg(bg_color)),
            Span::styled(
                title_display,
                Style::default().fg(Color::White).bg(bg_color),
            ),
            Span::styled(" | ", Style::default().fg(Color::DarkGray).bg(bg_color)),
            Span::styled(
                status_text,
                Style::default().fg(status_color).bg(bg_color),
            ),
        ]);

        ListItem::new(line)
    }

    /// Create a compact group header for horizontal layout
    fn create_compact_group_header(header: &str, max_width: u16) -> ListItem<'static> {
        // Use full width for header display
        let available = max_width.saturating_sub(4) as usize; // "▸ " prefix
        let display = if header.chars().count() > available {
            // Show last part of path (more useful for directories)
            let chars: Vec<char> = header.chars().collect();
            let start = chars.len().saturating_sub(available.saturating_sub(3));
            let short: String = chars[start..].iter().collect();
            format!("...{}", short)
        } else {
            header.to_string()
        };

        ListItem::new(Line::from(vec![Span::styled(
            format!("▸ {}", display),
            Style::default()
                .fg(Color::Blue)
                .add_modifier(Modifier::BOLD),
        )]))
    }

    /// Create a compact "new session" item
    fn create_compact_new_item(_max_width: u16, is_selected: bool) -> ListItem<'static> {
        let bg_color = if is_selected {
            Color::DarkGray
        } else {
            Color::Reset
        };

        ListItem::new(Line::from(vec![Span::styled(
            "+ New",
            Style::default()
                .fg(Color::Cyan)
                .bg(bg_color)
                .add_modifier(Modifier::ITALIC),
        )]))
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
