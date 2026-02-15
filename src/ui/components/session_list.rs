use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, ListState},
    Frame,
};
use unicode_width::UnicodeWidthStr;

use crate::agents::{AgentMode, AgentStatus, MonitoredAgent};
use crate::state::{AppState, SortBy};
use crate::ui::SplitDirection;

/// Optional task summary for team group headers
#[derive(Debug, Clone, Default)]
pub struct GroupTaskSummary {
    /// Number of completed tasks
    pub done: usize,
    /// Total number of tasks
    pub total: usize,
}

/// Entry in the session list (can be agent, group header, or create new button)
#[derive(Debug, Clone)]
pub enum ListEntry {
    Agent(usize), // Index into agent_order
    GroupHeader {
        key: String,
        agent_count: usize,
        attention_count: usize,
        collapsed: bool,
        /// Task summary (only populated when sorted by Team)
        task_summary: Option<GroupTaskSummary>,
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
                            let tree_prefix = Self::get_tree_prefix(agent, state, *agent_idx);
                            Self::create_list_item(
                                agent,
                                spinner_char,
                                is_selected,
                                marquee_offset,
                                &tree_prefix,
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
                        task_summary,
                    } => Self::create_group_header(
                        key,
                        *agent_count,
                        *attention_count,
                        *collapsed,
                        is_selected,
                        marquee_offset,
                        task_summary.as_ref(),
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
            .highlight_symbol("\u{25B6} ");

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
                            let tree_prefix = Self::get_tree_prefix(agent, state, *agent_idx);
                            Self::create_compact_item(
                                agent,
                                spinner_char,
                                inner_width,
                                is_selected,
                                marquee_offset,
                                &tree_prefix,
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
                        task_summary,
                    } => Self::create_compact_group_header(
                        key,
                        inner_width,
                        *agent_count,
                        *attention_count,
                        *collapsed,
                        is_selected,
                        marquee_offset,
                        task_summary.as_ref(),
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
                // Skip group header for team members (non-lead) — they nest under their leader
                let is_nested_member = agent.team_info.as_ref().is_some_and(|ti| !ti.is_lead);

                // Check if we need a group header
                if let Some(group_key) = state.get_group_key(agent) {
                    if current_group.as_ref() != Some(&group_key) && !is_nested_member {
                        let collapsed = state.is_group_collapsed(&group_key);
                        let (agent_count, attention_count) =
                            group_stats.get(&group_key).copied().unwrap_or((0, 0));

                        // Track the entry index for the selected entry (group header is now selectable)
                        if selectable_index == state.selection.selected_entry_index {
                            ui_entry_index = entries.len();
                        }

                        // Build task summary for team groups
                        let task_summary = if state.sort_by == SortBy::Team {
                            // Extract team name from "Team: {name}" format
                            let team_name = group_key.strip_prefix("Team: ");
                            team_name.and_then(|name| {
                                state.teams.get(name).map(|snapshot| GroupTaskSummary {
                                    done: snapshot.task_done,
                                    total: snapshot.task_total,
                                })
                            })
                        } else {
                            None
                        };

                        entries.push(ListEntry::GroupHeader {
                            key: group_key.clone(),
                            agent_count,
                            attention_count,
                            collapsed,
                            task_summary,
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
                if selectable_index == state.selection.selected_entry_index {
                    ui_entry_index = entries.len();
                    selected_agent_index = Some(agent_idx);
                }

                entries.push(ListEntry::Agent(agent_idx));
                selectable_index += 1;
            }
        }

        // Add CreateNew at the bottom (last selectable item)
        if selectable_index == state.selection.selected_entry_index {
            ui_entry_index = entries.len();
        }
        entries.push(ListEntry::CreateNew {
            group_key: String::new(),
        });
        selectable_index += 1;

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
    ///
    /// When `task_summary` is provided (Team sort mode), displays task progress info.
    fn create_group_header(
        header: &str,
        agent_count: usize,
        attention_count: usize,
        collapsed: bool,
        is_selected: bool,
        marquee_offset: usize,
        task_summary: Option<&GroupTaskSummary>,
    ) -> ListItem<'static> {
        // Collapse icon: \u{25B8} (collapsed) or \u{25BE} (expanded)
        let icon = if collapsed { "\u{25B8}" } else { "\u{25BE}" };

        // Max width for header text (reserve space for icon, count, attention)
        const HEADER_MAX_WIDTH: usize = 40;
        let display = get_marquee_text_path(header, HEADER_MAX_WIDTH, marquee_offset, is_selected);

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
                format!(" \u{26A0}{}", attention_count),
                Style::default().fg(Color::Red),
            ));
        }

        // Show task summary if available (Team sort mode)
        if let Some(summary) = task_summary {
            if summary.total > 0 {
                spans.push(Span::styled(
                    format!("  Tasks: {}/{}", summary.done, summary.total),
                    Style::default().fg(Color::Yellow),
                ));
            }
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

    /// Create a 2-line list item for vertical layout
    ///
    /// Line 1: `[tree] status_indicator detection_icon AgentType  pid:NNNN  W:N[name] P:N  [team/member]  ⚠N%`
    /// Line 2: `    StatusLabel: detail_text` (with marquee)
    fn create_list_item(
        agent: &MonitoredAgent,
        spinner_char: char,
        is_selected: bool,
        marquee_offset: usize,
        tree_prefix: &str,
    ) -> ListItem<'static> {
        let status_indicator = match &agent.status {
            AgentStatus::Processing { .. } => spinner_char.to_string(),
            _ => agent.status.indicator().to_string(),
        };
        let status_color = Self::status_color(&agent.status);

        // Detection source color
        let detection_color = match agent.detection_source {
            crate::agents::DetectionSource::IpcSocket => Color::Green,
            crate::agents::DetectionSource::CapturePane => Color::DarkGray,
        };

        // Line 1: identification info in a single line
        let mut line1_spans: Vec<Span<'static>> = Vec::new();

        if !tree_prefix.is_empty() {
            line1_spans.push(Span::styled(
                format!("{} ", tree_prefix),
                Style::default().fg(Color::DarkGray),
            ));
        }

        // 1) AI name + detection source
        line1_spans.extend([
            Span::styled(
                format!("{} ", status_indicator),
                Style::default().fg(status_color),
            ),
            Span::styled(
                agent.agent_type.short_name().to_string(),
                Style::default().fg(Color::Cyan),
            ),
            Span::styled(
                format!("[{}]", agent.detection_source.label()),
                Style::default().fg(detection_color),
            ),
        ]);

        // 2) Team badge
        if let Some(ref team_info) = agent.team_info {
            line1_spans.push(Span::styled(
                format!("  [{}/{}]", team_info.team_name, team_info.member_name),
                Style::default().fg(Color::Magenta),
            ));
        }

        // 3) Context warning
        if let Some(percent) = agent.context_warning {
            let warning_color = if percent <= 10 {
                Color::Red
            } else if percent <= 20 {
                Color::Yellow
            } else {
                Color::Rgb(255, 165, 0) // Orange
            };
            line1_spans.push(Span::styled(
                format!("  \u{26A0}{}%", percent),
                Style::default().fg(warning_color),
            ));
        }

        // 4) Status label
        let status_label = match &agent.status {
            AgentStatus::Idle => "Idle".to_string(),
            AgentStatus::Processing { activity } => Self::processing_label(activity),
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                format!("Awaiting: {}", approval_type)
            }
            AgentStatus::Error { .. } => "Error".to_string(),
            AgentStatus::Offline => "Offline".to_string(),
            AgentStatus::Unknown => "Unknown".to_string(),
        };
        line1_spans.push(Span::styled(
            format!("  {}", status_label),
            Style::default().fg(status_color),
        ));

        // 5) Mode icon (Plan/Delegate/AutoApprove)
        if agent.mode != AgentMode::Default {
            line1_spans.push(Span::styled(
                format!("  {}", agent.mode),
                Style::default().fg(Color::Cyan),
            ));
        }

        // 6) Git branch badge
        if let Some(ref branch) = agent.git_branch {
            let branch_color = if agent.git_dirty.unwrap_or(false) {
                Color::Yellow
            } else {
                Color::Cyan
            };
            line1_spans.push(Span::styled(
                format!("  [{}]", branch),
                Style::default().fg(branch_color),
            ));
        }

        let line1 = Line::from(line1_spans);

        // Line 2: title + other meta (detection icon, pid, window/pane)
        const DETAIL_MAX_WIDTH: usize = 40;

        // Resolve title source: prefer active_form from team task, fallback to title
        let title_source = agent
            .team_info
            .as_ref()
            .and_then(|ti| ti.current_task.as_ref())
            .and_then(|task| task.active_form.as_ref())
            .cloned()
            .unwrap_or_else(|| agent.title.clone());

        let title_text = if title_source.is_empty() {
            "-".to_string()
        } else {
            get_marquee_text(&title_source, DETAIL_MAX_WIDTH, marquee_offset, is_selected)
        };

        // Indent: 4 spaces (+ tree_prefix width if applicable)
        let indent = if tree_prefix.is_empty() {
            "    ".to_string()
        } else {
            format!("{}  ", " ".repeat(tree_prefix.width()))
        };

        let line2 = Line::from(vec![
            Span::styled(indent, Style::default()),
            Span::styled(title_text, Style::default().fg(Color::White)),
            Span::styled(
                format!("  pid:{}", agent.pid),
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                format!(
                    "  W:{}[{}] P:{}",
                    agent.window_index, agent.window_name, agent.pane_index
                ),
                Style::default().fg(Color::DarkGray),
            ),
        ]);

        ListItem::new(vec![line1, line2])
    }

    /// Map Processing activity to a specific status label
    ///
    /// Extracts the leading verb from the activity string (e.g., "Compacting" from
    /// "✶ Compacting…").  Returns "Processing" when the activity is empty or does
    /// not start with an uppercase letter.
    fn processing_label(activity: &str) -> String {
        if activity.is_empty() {
            return "Processing".to_string();
        }
        // Strip spinner chars and whitespace prefix
        let stripped =
            activity.trim_start_matches(|c: char| "·✢✳✶✻✽*".contains(c) || c.is_whitespace());
        // Take the first word (split on whitespace, '…', or '.')
        let verb = stripped.split(['\u{2026}', '.', ' ']).next().unwrap_or("");
        if verb.is_empty() || !verb.starts_with(|c: char| c.is_uppercase()) {
            "Processing".to_string()
        } else {
            verb.to_string()
        }
    }

    fn status_color(status: &AgentStatus) -> Color {
        match status {
            AgentStatus::Idle => Color::Green,
            AgentStatus::Processing { .. } => Color::Yellow,
            AgentStatus::AwaitingApproval { .. } => Color::Magenta,
            AgentStatus::Error { .. } => Color::Red,
            AgentStatus::Offline => Color::DarkGray,
            AgentStatus::Unknown => Color::Gray,
        }
    }

    /// Determine if an agent at a given index is the last team member under its leader
    fn is_last_team_member(state: &AppState, agent_idx: usize) -> bool {
        let agent = match state
            .agent_order
            .get(agent_idx)
            .and_then(|id| state.agents.get(id))
        {
            Some(a) => a,
            None => return false,
        };

        let team_name = match &agent.team_info {
            Some(ti) if !ti.is_lead => &ti.team_name,
            _ => return false,
        };

        // Check the next agent in order
        if let Some(next_id) = state.agent_order.get(agent_idx + 1) {
            if let Some(next_agent) = state.agents.get(next_id) {
                if let Some(ref next_ti) = next_agent.team_info {
                    // Same team and also a non-lead member → not last
                    if &next_ti.team_name == team_name && !next_ti.is_lead {
                        return false;
                    }
                }
            }
        }

        true
    }

    /// Get the tree prefix for a team member agent
    fn get_tree_prefix(agent: &MonitoredAgent, state: &AppState, agent_idx: usize) -> String {
        match &agent.team_info {
            Some(ti) if !ti.is_lead => {
                if Self::is_last_team_member(state, agent_idx) {
                    "\u{2514}\u{2500}".to_string() // └─
                } else {
                    "\u{251C}\u{2500}".to_string() // ├─
                }
            }
            _ => String::new(),
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
        tree_prefix: &str,
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
        let prefix_len = if tree_prefix.is_empty() {
            0
        } else {
            tree_prefix.width() + 1
        };
        let fixed_len = 56_usize + prefix_len;
        let title_width = (max_width as usize).saturating_sub(fixed_len).max(10);

        // Apply marquee to title for selected item
        // Prefer active_form from team task if available
        let title_source = agent
            .team_info
            .as_ref()
            .and_then(|ti| ti.current_task.as_ref())
            .and_then(|task| task.active_form.as_ref())
            .cloned()
            .unwrap_or_else(|| agent.title.clone());

        let title_display = if title_source.is_empty() {
            fixed_width("-", title_width)
        } else {
            get_marquee_text(&title_source, title_width, marquee_offset, is_selected)
        };

        let status_text = match &agent.status {
            AgentStatus::Idle => "Idle".to_string(),
            AgentStatus::Processing { activity } => Self::processing_label(activity),
            AgentStatus::AwaitingApproval { .. } => "Awaiting".to_string(),
            AgentStatus::Error { .. } => "Error".to_string(),
            AgentStatus::Offline => "Offline".to_string(),
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

        let mut spans: Vec<Span<'static>> = Vec::new();

        if !tree_prefix.is_empty() {
            spans.push(Span::styled(
                format!("{} ", tree_prefix),
                Style::default().fg(Color::DarkGray).bg(bg_color),
            ));
        }

        spans.extend([
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

        // Add mode icon if not default
        if agent.mode != AgentMode::Default {
            spans.push(Span::styled(
                format!(" {}", agent.mode),
                Style::default().fg(Color::Cyan).bg(bg_color),
            ));
        }

        // Add team badge if agent is part of a team
        if let Some(ref team_info) = agent.team_info {
            spans.push(Span::styled(
                format!(" [{}/{}]", team_info.team_name, team_info.member_name),
                Style::default().fg(Color::Magenta).bg(bg_color),
            ));
        }

        // Add git branch badge if available
        if let Some(ref branch) = agent.git_branch {
            let branch_color = if agent.git_dirty.unwrap_or(false) {
                Color::Yellow
            } else {
                Color::Cyan
            };
            spans.push(Span::styled(
                format!(" [{}]", branch),
                Style::default().fg(branch_color).bg(bg_color),
            ));
        }

        ListItem::new(Line::from(spans))
    }

    /// Create a compact group header for horizontal layout
    ///
    /// When `task_summary` is provided (Team sort mode), displays task progress info.
    #[allow(clippy::too_many_arguments)]
    fn create_compact_group_header(
        header: &str,
        max_width: u16,
        agent_count: usize,
        attention_count: usize,
        collapsed: bool,
        is_selected: bool,
        marquee_offset: usize,
        task_summary: Option<&GroupTaskSummary>,
    ) -> ListItem<'static> {
        // Collapse icon: \u{25B8} (collapsed) or \u{25BE} (expanded)
        let icon = if collapsed { "\u{25B8}" } else { "\u{25BE}" };

        // Calculate available space
        // Reserve: icon(2) + space(1) + count_display(~8) + attention(~4) + task_info(~15)
        let reserved = if task_summary.is_some() {
            30_usize
        } else {
            15_usize
        };
        let available = (max_width as usize).saturating_sub(reserved);

        // Apply marquee for selected item (path-aware: show tail on truncation)
        let display = get_marquee_text_path(header, available, marquee_offset, is_selected);

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
                format!(" \u{26A0}{}", attention_count),
                Style::default().fg(Color::Red).bg(bg_color),
            ));
        }

        // Show task summary if available (Team sort mode)
        if let Some(summary) = task_summary {
            if summary.total > 0 {
                spans.push(Span::styled(
                    format!("  Tasks: {}/{}", summary.done, summary.total),
                    Style::default().fg(Color::Yellow).bg(bg_color),
                ));
            }
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

/// Get marquee-scrolled text for paths: non-selected items show the tail (end) of the path
/// instead of the head, since the meaningful part of a path is usually at the end.
fn get_marquee_text_path(text: &str, max_width: usize, offset: usize, is_selected: bool) -> String {
    let text_width = text.width();

    // If text fits within max_width, pad with spaces
    if text_width <= max_width {
        let padding = max_width.saturating_sub(text_width);
        return format!("{}{}", text, " ".repeat(padding));
    }

    // Non-selected items: truncate showing the tail with leading ellipsis
    if !is_selected {
        return truncate_path_with_ellipsis(text, max_width);
    }

    // Selected item: marquee scroll (same as regular get_marquee_text)
    let padding = "   "; // 3 spaces between loops
    let looped_text = format!("{}{}{}", text, padding, text);
    let loop_length = text_width + padding.width();
    let effective_offset = offset % loop_length;

    extract_substring_by_width(&looped_text, effective_offset, max_width)
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

/// Truncate a path string to fit within max_width, keeping the tail (end) visible
/// with a leading "..." ellipsis. This is useful for directory paths where the
/// meaningful part is at the end (e.g., "...conversation-handoff-mcp" instead of
/// "/home/trustdelta/wo...").
fn truncate_path_with_ellipsis(s: &str, max_width: usize) -> String {
    if max_width <= 3 {
        return truncate_to_width(s, max_width);
    }

    let s_width = s.width();
    if s_width <= max_width {
        let padding = max_width.saturating_sub(s_width);
        return format!("{}{}", s, " ".repeat(padding));
    }

    // We need to show "..." + tail portion
    let tail_max = max_width.saturating_sub(3); // reserve 3 chars for "..."

    // Walk from the end of the string to find the tail portion
    let chars: Vec<char> = s.chars().collect();
    let mut tail_start = chars.len();
    let mut tail_width = 0;
    for i in (0..chars.len()).rev() {
        let cw = unicode_width::UnicodeWidthChar::width(chars[i]).unwrap_or(0);
        if tail_width + cw > tail_max {
            break;
        }
        tail_width += cw;
        tail_start = i;
    }

    let tail: String = chars[tail_start..].iter().collect();
    let padding = max_width.saturating_sub(3 + tail_width);
    format!("...{}{}", tail, " ".repeat(padding))
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

    #[test]
    fn test_truncate_path_with_ellipsis_short() {
        // Path that fits - should be padded
        let result = truncate_path_with_ellipsis("/short", 20);
        assert!(result.starts_with("/short"));
        assert_eq!(result.width(), 20);
    }

    #[test]
    fn test_truncate_path_with_ellipsis_long() {
        // Long path - should show "..." + tail
        let result =
            truncate_path_with_ellipsis("/home/trustdelta/works/conversation-handoff-mcp", 30);
        assert!(result.starts_with("..."));
        assert_eq!(result.width(), 30);
        // Should contain the tail of the path
        assert!(result.contains("handoff-mcp"));
    }

    #[test]
    fn test_get_marquee_text_path_non_selected() {
        // Long path, non-selected - should show tail with leading ellipsis
        let result = get_marquee_text_path(
            "/home/trustdelta/works/conversation-handoff-mcp",
            30,
            0,
            false,
        );
        assert!(result.starts_with("..."));
        assert!(result.contains("handoff-mcp"));
    }

    #[test]
    fn test_get_marquee_text_path_selected() {
        // Long path, selected - should marquee scroll
        let text = "/home/trustdelta/works/conversation-handoff-mcp";
        let result_0 = get_marquee_text_path(text, 20, 0, true);
        let result_1 = get_marquee_text_path(text, 20, 1, true);
        assert_ne!(result_0, result_1);
    }

    #[test]
    fn test_processing_label_compacting() {
        assert_eq!(
            SessionList::processing_label("✻ Compacting conversation…"),
            "Compacting"
        );
        assert_eq!(SessionList::processing_label("Compacting..."), "Compacting");
        assert_eq!(SessionList::processing_label("Compacting"), "Compacting");
    }

    #[test]
    fn test_processing_label_default() {
        assert_eq!(SessionList::processing_label(""), "Processing");
        // Lowercase start → Processing
        assert_eq!(SessionList::processing_label("tasks running"), "Processing");
    }

    #[test]
    fn test_processing_label_various_verbs() {
        assert_eq!(SessionList::processing_label("Cerebrating…"), "Cerebrating");
        assert_eq!(
            SessionList::processing_label("✻ Levitating… (2m · ↓ 13 tokens)"),
            "Levitating"
        );
        assert_eq!(
            SessionList::processing_label("· Gallivanting…"),
            "Gallivanting"
        );
        assert_eq!(SessionList::processing_label("✶ Crunching…"), "Crunching");
        // First word is capitalized → extract it
        assert_eq!(SessionList::processing_label("Tasks running"), "Tasks");
    }
}
