use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, ListState},
    Frame,
};
use unicode_width::UnicodeWidthStr;

use crate::agents::{AgentStatus, MonitoredAgent};
use crate::state::AppState;
use crate::ui::SplitDirection;

/// Entry in the session list (can be agent, group header, or create new button)
#[derive(Debug, Clone)]
pub enum ListEntry {
    Agent(usize), // Index into agent_order
    GroupHeader {
        key: String,
        agent_count: usize,
        attention_count: usize,
        collapsed: bool,
    },
    CreateNew {
        group_key: String,
    },
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
        let marquee_offset = state.marquee_offset();

        // Build list entries with group headers
        let (entries, ui_entry_index, _selectable_count, _agent_index) = Self::build_entries(state);

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
                            Self::create_list_item(agent, spinner_char, is_selected, marquee_offset)
                        } else {
                            ListItem::new(Line::from(""))
                        }
                    }
                    ListEntry::GroupHeader {
                        key,
                        agent_count,
                        attention_count,
                        collapsed,
                    } => Self::create_group_header(
                        key,
                        *agent_count,
                        *attention_count,
                        *collapsed,
                        is_selected,
                        marquee_offset,
                    ),
                    ListEntry::CreateNew { .. } => Self::create_new_item(),
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

    /// Render horizontal list (compact, single-line per agent, laid out horizontally)
    fn render_horizontal_list(frame: &mut Frame, area: Rect, state: &AppState) {
        let spinner_char = state.spinner_char();
        let marquee_offset = state.marquee_offset();

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
                            Self::create_compact_item(
                                agent,
                                spinner_char,
                                inner_width,
                                is_selected,
                                marquee_offset,
                            )
                        } else {
                            ListItem::new(Line::from(""))
                        }
                    }
                    ListEntry::GroupHeader {
                        key,
                        agent_count,
                        attention_count,
                        collapsed,
                    } => Self::create_compact_group_header(
                        key,
                        inner_width,
                        *agent_count,
                        *attention_count,
                        *collapsed,
                        is_selected,
                        marquee_offset,
                    ),
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

        // First pass: collect group statistics
        let mut group_stats: std::collections::HashMap<String, (usize, usize)> =
            std::collections::HashMap::new();
        for id in &state.agent_order {
            if let Some(agent) = state.agents.get(id) {
                if let Some(group_key) = state.get_group_key(agent) {
                    let entry = group_stats.entry(group_key).or_insert((0, 0));
                    entry.0 += 1; // agent_count
                    if agent.status.needs_attention() {
                        entry.1 += 1; // attention_count
                    }
                }
            }
        }

        // Second pass: build entries
        let mut current_group: Option<String> = None;
        for (agent_idx, id) in state.agent_order.iter().enumerate() {
            if let Some(agent) = state.agents.get(id) {
                // Check if we need a group header
                if let Some(group_key) = state.get_group_key(agent) {
                    if current_group.as_ref() != Some(&group_key) {
                        let collapsed = state.is_group_collapsed(&group_key);
                        let (agent_count, attention_count) =
                            group_stats.get(&group_key).copied().unwrap_or((0, 0));

                        // Track the entry index for the selected entry (group header is now selectable)
                        if selectable_index == state.selected_entry_index {
                            ui_entry_index = entries.len();
                        }

                        entries.push(ListEntry::GroupHeader {
                            key: group_key.clone(),
                            agent_count,
                            attention_count,
                            collapsed,
                        });
                        selectable_index += 1; // GroupHeader is now selectable
                        current_group = Some(group_key.clone());

                        // If collapsed, skip all agents in this group
                        if collapsed {
                            continue;
                        }
                    } else if state.is_group_collapsed(&group_key) {
                        // Same group but collapsed, skip this agent
                        continue;
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
    fn create_group_header(
        header: &str,
        agent_count: usize,
        attention_count: usize,
        collapsed: bool,
        is_selected: bool,
        marquee_offset: usize,
    ) -> ListItem<'static> {
        // Collapse icon: ▸ (collapsed) or ▾ (expanded)
        let icon = if collapsed { "▸" } else { "▾" };

        // Max width for header text (reserve space for icon, count, attention)
        const HEADER_MAX_WIDTH: usize = 40;
        let display = get_marquee_text(header, HEADER_MAX_WIDTH, marquee_offset, is_selected);

        let mut spans = vec![Span::styled(
            format!("{} {} ", icon, display.trim_end()),
            Style::default()
                .fg(Color::Blue)
                .add_modifier(Modifier::BOLD),
        )];

        // Show agent count
        spans.push(Span::styled(
            format!("({})", agent_count),
            Style::default().fg(Color::DarkGray),
        ));

        // Show attention count if any (in red)
        if attention_count > 0 {
            spans.push(Span::styled(
                format!(" ⚠{}", attention_count),
                Style::default().fg(Color::Red),
            ));
        }

        ListItem::new(Line::from(spans))
    }

    /// Create a "new session" item
    fn create_new_item() -> ListItem<'static> {
        ListItem::new(Line::from(vec![Span::styled(
            "+ New Process",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::ITALIC),
        )]))
    }

    fn create_list_item(
        agent: &MonitoredAgent,
        spinner_char: char,
        is_selected: bool,
        marquee_offset: usize,
    ) -> ListItem<'static> {
        let status_indicator = match &agent.status {
            AgentStatus::Processing { .. } => spinner_char.to_string(),
            _ => agent.status.indicator().to_string(),
        };
        let status_color = Self::status_color(&agent.status);

        // Line 1: [detection icon] AgentType | pid:xxx [context warning]
        // ● = PTY state file, ○ = capture-pane
        let detection_icon = agent.detection_source.icon();
        let detection_color = match agent.detection_source {
            crate::agents::DetectionSource::PtyStateFile => Color::Green,
            crate::agents::DetectionSource::CapturePane => Color::DarkGray,
        };

        let mut line1_spans = vec![
            Span::styled(
                format!("{} ", detection_icon),
                Style::default().fg(detection_color),
            ),
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

        // Line 2: status indicator + status_text (with marquee for activity)
        let status_text = match &agent.status {
            AgentStatus::Idle => "Idle".to_string(),
            AgentStatus::Processing { activity } => {
                if activity.is_empty() {
                    "Processing...".to_string()
                } else {
                    let activity_text =
                        get_marquee_text(activity, 20, marquee_offset, is_selected);
                    format!("Processing: {}", activity_text.trim_end())
                }
            }
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                format!("Awaiting: {}", approval_type)
            }
            AgentStatus::Error { message } => {
                let error_text = get_marquee_text(message, 20, marquee_offset, is_selected);
                format!("Error: {}", error_text.trim_end())
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

        // Line 3: title (with marquee)
        const TITLE_MAX_WIDTH: usize = 35;
        let title_display = if agent.title.is_empty() {
            "-".to_string()
        } else {
            get_marquee_text(&agent.title, TITLE_MAX_WIDTH, marquee_offset, is_selected)
        };

        let line3 = Line::from(vec![
            Span::styled("    ", Style::default()),
            Span::styled(title_display, Style::default().fg(Color::White)),
        ]);

        // Line 4: W:index[name]  P:index
        let line4 = Line::from(vec![
            Span::styled("    ", Style::default()),
            Span::styled(
                format!(
                    "W:{}[{}]  P:{}",
                    agent.window_index, agent.window_name, agent.pane_index
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
    /// Format: ⣾ CC | pid:1234 | W:1[name] P:0 | title | status
    /// Each column has fixed width for alignment
    fn create_compact_item(
        agent: &MonitoredAgent,
        spinner_char: char,
        max_width: u16,
        is_selected: bool,
        marquee_offset: usize,
    ) -> ListItem<'static> {
        let status_indicator = match &agent.status {
            AgentStatus::Processing { .. } => spinner_char.to_string(),
            _ => agent.status.indicator().to_string(),
        };
        let status_color = Self::status_color(&agent.status);

        // Fixed column widths
        const STATUS_WIDTH: usize = 12; // "Processing" or "Awaiting..."
        const PID_WIDTH: usize = 10; // "pid:123456"
        const SESSION_WIDTH: usize = 18; // "W:1[windowname] P:0"

        // Calculate remaining space for title
        // Fixed parts: indicator(2) + CC(2) + separators(12) + status(12) + pid(10) + session(18) = 56
        let fixed_len = 56_usize;
        let title_width = (max_width as usize).saturating_sub(fixed_len).max(10);

        // Apply marquee to title for selected item
        let title_display = if agent.title.is_empty() {
            fixed_width("-", title_width)
        } else {
            get_marquee_text(&agent.title, title_width, marquee_offset, is_selected)
        };

        let status_text = match &agent.status {
            AgentStatus::Idle => "Idle".to_string(),
            AgentStatus::Processing { activity } => {
                if activity.is_empty() {
                    "Processing".to_string()
                } else {
                    "Processing".to_string() // Keep it short for alignment
                }
            }
            AgentStatus::AwaitingApproval { .. } => "Awaiting".to_string(),
            AgentStatus::Error { .. } => "Error".to_string(),
            AgentStatus::Unknown => "Unknown".to_string(),
        };
        let status_text = fixed_width(&status_text, STATUS_WIDTH);

        let bg_color = if is_selected {
            Color::DarkGray
        } else {
            Color::Reset
        };

        let session_info = format!(
            "W:{}[{}] P:{}",
            agent.window_index, agent.window_name, agent.pane_index
        );

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
            Span::styled(status_text, Style::default().fg(status_color).bg(bg_color)),
            Span::styled(" | ", Style::default().fg(Color::DarkGray).bg(bg_color)),
            Span::styled(
                fixed_width(&format!("pid:{}", agent.pid), PID_WIDTH),
                Style::default().fg(Color::DarkGray).bg(bg_color),
            ),
            Span::styled(" | ", Style::default().fg(Color::DarkGray).bg(bg_color)),
            Span::styled(
                fixed_width(&session_info, SESSION_WIDTH),
                Style::default().fg(Color::White).bg(bg_color),
            ),
            Span::styled(" | ", Style::default().fg(Color::DarkGray).bg(bg_color)),
            Span::styled(
                title_display,
                Style::default().fg(Color::White).bg(bg_color),
            ),
        ]);

        ListItem::new(line)
    }

    /// Create a compact group header for horizontal layout
    fn create_compact_group_header(
        header: &str,
        max_width: u16,
        agent_count: usize,
        attention_count: usize,
        collapsed: bool,
        is_selected: bool,
        marquee_offset: usize,
    ) -> ListItem<'static> {
        // Collapse icon: ▸ (collapsed) or ▾ (expanded)
        let icon = if collapsed { "▸" } else { "▾" };

        // Calculate available space
        // Reserve: icon(2) + space(1) + count_display(~8) + attention(~4)
        let reserved = 15_usize;
        let available = (max_width as usize).saturating_sub(reserved);

        // Apply marquee for selected item
        let display = get_marquee_text(header, available, marquee_offset, is_selected);

        let bg_color = if is_selected {
            Color::DarkGray
        } else {
            Color::Reset
        };

        let mut spans = vec![Span::styled(
            format!("{} {} ", icon, display.trim_end()),
            Style::default()
                .fg(Color::Blue)
                .bg(bg_color)
                .add_modifier(Modifier::BOLD),
        )];

        // Show agent count
        spans.push(Span::styled(
            format!("({})", agent_count),
            Style::default().fg(Color::DarkGray).bg(bg_color),
        ));

        // Show attention count if any (in red)
        if attention_count > 0 {
            spans.push(Span::styled(
                format!(" ⚠{}", attention_count),
                Style::default().fg(Color::Red).bg(bg_color),
            ));
        }

        ListItem::new(Line::from(spans))
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

/// Get marquee-scrolled text for the selected item, or truncated text for non-selected items
fn get_marquee_text(text: &str, max_width: usize, offset: usize, is_selected: bool) -> String {
    let text_width = text.width();

    // If text fits within max_width, pad with spaces
    if text_width <= max_width {
        let padding = max_width.saturating_sub(text_width);
        return format!("{}{}", text, " ".repeat(padding));
    }

    // Non-selected items: truncate with ellipsis
    if !is_selected {
        return truncate_to_width_with_ellipsis(text, max_width);
    }

    // Selected item: marquee scroll
    let padding = "   "; // 3 spaces between loops
    let looped_text = format!("{}{}{}", text, padding, text);
    let loop_length = text_width + padding.width();
    let effective_offset = offset % loop_length;

    extract_substring_by_width(&looped_text, effective_offset, max_width)
}

/// Truncate a string to fit within max_width, adding ellipsis
fn truncate_to_width_with_ellipsis(s: &str, max_width: usize) -> String {
    if max_width <= 3 {
        return truncate_to_width(s, max_width);
    }

    let truncated = truncate_to_width(s, max_width.saturating_sub(3));
    let truncated_width = truncated.width();

    if truncated_width < s.width() {
        format!("{}...", truncated)
    } else {
        // No truncation needed, pad with spaces
        let padding = max_width.saturating_sub(truncated_width);
        format!("{}{}", truncated, " ".repeat(padding))
    }
}

/// Extract a substring starting at a given display width offset with a given max width
fn extract_substring_by_width(s: &str, start_offset: usize, max_width: usize) -> String {
    let mut result = String::new();
    let mut current_width = 0;
    let mut skip_width = 0;
    let mut started = false;

    for c in s.chars() {
        let char_width = unicode_width::UnicodeWidthChar::width(c).unwrap_or(0);

        if !started {
            if skip_width + char_width > start_offset {
                // This char straddles the start offset, skip it
                started = true;
            } else {
                skip_width += char_width;
                if skip_width >= start_offset {
                    started = true;
                }
                continue;
            }
        }

        if current_width + char_width > max_width {
            break;
        }

        result.push(c);
        current_width += char_width;
    }

    // Pad to max_width if needed
    let padding = max_width.saturating_sub(current_width);
    format!("{}{}", result, " ".repeat(padding))
}

/// Pad or truncate a string to a fixed display width (right-padded with spaces)
/// Uses Unicode width to handle CJK characters correctly
fn fixed_width(s: &str, width: usize) -> String {
    let display_width = s.width();

    if display_width >= width {
        // Truncate with ellipsis, accounting for display width
        if width <= 3 {
            truncate_to_width(s, width)
        } else {
            let truncated = truncate_to_width(s, width.saturating_sub(3));
            format!("{}...", truncated)
        }
    } else {
        // Pad with spaces
        let padding = width - display_width;
        format!("{}{}", s, " ".repeat(padding))
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
    use super::*;

    #[test]
    fn test_get_marquee_text_short() {
        // Text that fits - should be padded
        let result = get_marquee_text("short", 10, 0, false);
        assert_eq!(result.len(), 10);
        assert!(result.starts_with("short"));
    }

    #[test]
    fn test_get_marquee_text_non_selected() {
        // Long text, non-selected - should be truncated with ellipsis
        let result = get_marquee_text("this is a long string", 10, 0, false);
        assert!(result.ends_with("..."));
        assert_eq!(result.width(), 10);
    }

    #[test]
    fn test_get_marquee_text_selected() {
        // Long text, selected - should scroll
        let text = "this is a long string";
        let result_0 = get_marquee_text(text, 10, 0, true);
        let result_1 = get_marquee_text(text, 10, 1, true);
        // Different offsets should produce different results
        assert_ne!(result_0, result_1);
    }
}
