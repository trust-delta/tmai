use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

use crate::agents::MonitoredAgent;

/// Shared state type alias
pub type SharedState = Arc<RwLock<AppState>>;

/// Input mode for the application
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum InputMode {
    /// Normal navigation mode
    #[default]
    Normal,
    /// Text input mode
    Input,
    /// Passthrough mode - keys are sent directly to the target pane
    Passthrough,
}

/// Sort method for agent list
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortBy {
    /// Sort by working directory (default)
    #[default]
    Directory,
    /// Default order (session:window.pane)
    SessionOrder,
    /// Sort by agent type
    AgentType,
    /// Sort by status (attention needed first)
    Status,
    /// Sort by last update time
    LastUpdate,
}

impl SortBy {
    /// Get the next sort method in cycle
    pub fn next(self) -> Self {
        match self {
            SortBy::Directory => SortBy::SessionOrder,
            SortBy::SessionOrder => SortBy::AgentType,
            SortBy::AgentType => SortBy::Status,
            SortBy::Status => SortBy::LastUpdate,
            SortBy::LastUpdate => SortBy::Directory,
        }
    }

    /// Get display name for the sort method
    pub fn display_name(&self) -> &'static str {
        match self {
            SortBy::Directory => "Directory",
            SortBy::SessionOrder => "Session",
            SortBy::AgentType => "Type",
            SortBy::Status => "Status",
            SortBy::LastUpdate => "Updated",
        }
    }
}

/// Monitor scope for filtering panes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MonitorScope {
    /// Monitor all attached sessions
    #[default]
    AllSessions,
    /// Monitor current session only
    CurrentSession,
    /// Monitor current window only
    CurrentWindow,
}

impl MonitorScope {
    /// Get the next scope in cycle
    pub fn next(self) -> Self {
        match self {
            MonitorScope::AllSessions => MonitorScope::CurrentSession,
            MonitorScope::CurrentSession => MonitorScope::CurrentWindow,
            MonitorScope::CurrentWindow => MonitorScope::AllSessions,
        }
    }

    /// Get display name for the scope
    pub fn display_name(&self) -> &'static str {
        match self {
            MonitorScope::AllSessions => "All",
            MonitorScope::CurrentSession => "Session",
            MonitorScope::CurrentWindow => "Window",
        }
    }
}

/// Spinner frames for processing animation
pub const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/// Placement type for creating new AI process
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlacementType {
    /// Create a new tmux session + window
    NewSession,
    /// Create a new window in existing session
    NewWindow,
    /// Split existing window to add a pane
    SplitPane,
}

/// Action to confirm before executing
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfirmAction {
    /// Kill a tmux pane
    KillPane { target: String },
}

/// State for confirmation dialog
#[derive(Debug, Clone)]
pub struct ConfirmationState {
    /// Action to execute on confirmation
    pub action: ConfirmAction,
    /// Message to display
    pub message: String,
}

/// Step in the create process flow
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateProcessStep {
    /// Select placement type (new session / new window / split pane)
    SelectPlacement,
    /// Select target tmux session (for NewWindow / SplitPane)
    SelectTarget,
    /// Select directory
    SelectDirectory,
    /// Select AI agent type
    SelectAgent,
}

/// State for the create process flow
#[derive(Debug, Clone)]
pub struct CreateProcessState {
    /// Current step in the flow
    pub step: CreateProcessStep,
    /// Selected placement type
    pub placement_type: Option<PlacementType>,
    /// Group key that initiated the flow (directory path or session name)
    pub origin_group_key: String,
    /// Selected tmux session name
    pub target_session: Option<String>,
    /// Selected directory path
    pub directory: Option<String>,
    /// Cursor position in the popup list
    pub cursor: usize,
    /// Input buffer for directory path entry
    pub input_buffer: String,
    /// Available sessions list (cached)
    pub available_sessions: Vec<String>,
    /// Known directories from current agents
    pub known_directories: Vec<String>,
    /// Whether in path input mode
    pub is_input_mode: bool,
}

/// Application state
#[derive(Debug)]
pub struct AppState {
    /// All monitored agents by target ID
    pub agents: HashMap<String, MonitoredAgent>,
    /// Order of agents for display
    pub agent_order: Vec<String>,
    /// Currently selected agent index
    pub selected_index: usize,
    /// Whether help screen is shown
    pub show_help: bool,
    /// Help screen scroll offset
    pub help_scroll: u16,
    /// Preview scroll offset
    pub preview_scroll: u16,
    /// Error message to display
    pub error_message: Option<String>,
    /// Last poll timestamp
    pub last_poll: Option<chrono::DateTime<chrono::Utc>>,
    /// Whether the app is running
    pub running: bool,
    /// Current input mode
    pub input_mode: InputMode,
    /// Input buffer for text entry
    pub input_buffer: String,
    /// Cursor position in input buffer (byte offset)
    pub cursor_position: usize,
    /// Spinner animation frame counter
    pub spinner_frame: usize,
    /// Last spinner update time
    last_spinner_update: std::time::Instant,
    /// Current sort method
    pub sort_by: SortBy,
    /// Create process flow state (None if not in create mode)
    pub create_process: Option<CreateProcessState>,
    /// Selected entry index (for UI navigation including CreateNew entries)
    pub selected_entry_index: usize,
    /// Total selectable entries count (cached)
    pub selectable_count: usize,
    /// Whether CreateNew entry is currently selected
    pub is_on_create_new: bool,
    /// Monitor scope for filtering panes
    pub monitor_scope: MonitorScope,
    /// Current session name (for scope display)
    pub current_session: Option<String>,
    /// Current window index (for scope display)
    pub current_window: Option<u32>,
    /// Confirmation dialog state (None if not showing)
    pub confirmation_state: Option<ConfirmationState>,
}

impl AppState {
    /// Create a new application state
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            agent_order: Vec::new(),
            selected_index: 0,
            show_help: false,
            help_scroll: 0,
            preview_scroll: 0,
            error_message: None,
            last_poll: None,
            running: true,
            input_mode: InputMode::Normal,
            input_buffer: String::new(),
            cursor_position: 0,
            spinner_frame: 0,
            last_spinner_update: std::time::Instant::now(),
            sort_by: SortBy::Directory,
            create_process: None,
            selected_entry_index: 0,
            selectable_count: 0,
            is_on_create_new: false,
            monitor_scope: MonitorScope::default(),
            current_session: None,
            current_window: None,
            confirmation_state: None,
        }
    }

    /// Advance the spinner animation frame (time-based, ~150ms per frame)
    pub fn tick_spinner(&mut self) {
        let elapsed = self.last_spinner_update.elapsed();
        if elapsed.as_millis() >= 150 {
            self.last_spinner_update = std::time::Instant::now();
            self.spinner_frame = (self.spinner_frame + 1) % SPINNER_FRAMES.len();
        }
    }

    /// Get the current spinner character
    pub fn spinner_char(&self) -> char {
        SPINNER_FRAMES[self.spinner_frame]
    }

    /// Create a shared state
    pub fn shared() -> SharedState {
        Arc::new(RwLock::new(Self::new()))
    }

    /// Get the currently selected agent
    pub fn selected_agent(&self) -> Option<&MonitoredAgent> {
        self.agent_order
            .get(self.selected_index)
            .and_then(|id| self.agents.get(id))
    }

    /// Get a mutable reference to the selected agent
    pub fn selected_agent_mut(&mut self) -> Option<&mut MonitoredAgent> {
        if let Some(id) = self.agent_order.get(self.selected_index).cloned() {
            self.agents.get_mut(&id)
        } else {
            None
        }
    }

    /// Get the selected agent's target ID
    pub fn selected_target(&self) -> Option<&str> {
        self.agent_order
            .get(self.selected_index)
            .map(|s| s.as_str())
    }

    /// Update agents from a new list
    pub fn update_agents(&mut self, agents: Vec<MonitoredAgent>) {
        let new_ids: Vec<String> = agents.iter().map(|a| a.id.clone()).collect();

        // Remove agents that no longer exist
        self.agents.retain(|id, _| new_ids.contains(id));

        // Update or add new agents
        for agent in agents {
            let id = agent.id.clone();
            if let Some(existing) = self.agents.get_mut(&id) {
                existing.status = agent.status;
                existing.last_content = agent.last_content;
                existing.last_content_ansi = agent.last_content_ansi;
                existing.title = agent.title;
                existing.last_update = agent.last_update;
            } else {
                self.agents.insert(id.clone(), agent);
            }
        }

        // Update order, preserving selection if possible
        let old_selected = self.selected_target().map(|s| s.to_string());
        self.agent_order = new_ids;

        // Apply current sort
        self.sort_agents();

        // Try to preserve selection
        if let Some(old_id) = old_selected {
            if let Some(new_index) = self.agent_order.iter().position(|id| id == &old_id) {
                self.selected_index = new_index;
            }
        }

        // Ensure selection is valid
        if self.selected_index >= self.agent_order.len() && !self.agent_order.is_empty() {
            self.selected_index = self.agent_order.len() - 1;
        }

        self.last_poll = Some(chrono::Utc::now());
    }

    /// Cycle through sort methods
    pub fn cycle_sort(&mut self) {
        self.sort_by = self.sort_by.next();
        self.sort_agents();
    }

    /// Cycle through monitor scopes
    pub fn cycle_monitor_scope(&mut self) {
        self.monitor_scope = self.monitor_scope.next();
    }

    /// Sort agent_order based on current sort_by setting
    fn sort_agents(&mut self) {
        let agents = &self.agents;
        self.agent_order.sort_by(|a, b| {
            let agent_a = agents.get(a);
            let agent_b = agents.get(b);

            match (agent_a, agent_b) {
                (Some(a), Some(b)) => match self.sort_by {
                    SortBy::Directory => {
                        // Sort by cwd, then by id
                        a.cwd.cmp(&b.cwd).then_with(|| a.id.cmp(&b.id))
                    }
                    SortBy::SessionOrder => {
                        // session:window.pane order
                        a.id.cmp(&b.id)
                    }
                    SortBy::AgentType => {
                        // Sort by agent type name, then by id
                        a.agent_type
                            .short_name()
                            .cmp(b.agent_type.short_name())
                            .then_with(|| a.id.cmp(&b.id))
                    }
                    SortBy::Status => {
                        // Sort by status priority (attention needed first)
                        let priority_a = Self::status_priority(&a.status);
                        let priority_b = Self::status_priority(&b.status);
                        priority_a.cmp(&priority_b).then_with(|| a.id.cmp(&b.id))
                    }
                    SortBy::LastUpdate => {
                        // Sort by last update (most recent first)
                        b.last_update
                            .cmp(&a.last_update)
                            .then_with(|| a.id.cmp(&b.id))
                    }
                },
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
    }

    /// Get priority for status sorting (lower = higher priority)
    fn status_priority(status: &crate::agents::AgentStatus) -> u8 {
        match status {
            crate::agents::AgentStatus::AwaitingApproval { .. } => 0, // Highest priority
            crate::agents::AgentStatus::Error { .. } => 1,
            crate::agents::AgentStatus::Processing { .. } => 2,
            crate::agents::AgentStatus::Idle => 3,
            crate::agents::AgentStatus::Unknown => 4,
        }
    }

    /// Get the current group key for an agent (for display headers)
    pub fn get_group_key(&self, agent: &MonitoredAgent) -> Option<String> {
        match self.sort_by {
            SortBy::Directory => Some(agent.cwd.clone()),
            SortBy::SessionOrder => Some(agent.session.clone()),
            SortBy::AgentType => Some(agent.agent_type.short_name().to_string()),
            _ => None,
        }
    }

    /// Move selection up
    pub fn select_previous(&mut self) {
        if self.selected_entry_index > 0 {
            self.selected_entry_index -= 1;
            self.preview_scroll = 0;
            self.sync_selected_index_from_entry();
        }
    }

    /// Move selection down
    pub fn select_next(&mut self) {
        if self.selectable_count > 0 && self.selected_entry_index < self.selectable_count - 1 {
            self.selected_entry_index += 1;
            self.preview_scroll = 0;
            self.sync_selected_index_from_entry();
        }
    }

    /// Select first entry
    pub fn select_first(&mut self) {
        if self.selectable_count > 0 {
            self.selected_entry_index = 0;
            self.preview_scroll = 0;
            self.sync_selected_index_from_entry();
        }
    }

    /// Select last entry
    pub fn select_last(&mut self) {
        if self.selectable_count > 0 {
            self.selected_entry_index = self.selectable_count - 1;
            self.preview_scroll = 0;
            self.sync_selected_index_from_entry();
        }
    }

    /// Sync selected_index from selected_entry_index
    /// This maps the entry index back to agent_order index for preview display
    fn sync_selected_index_from_entry(&mut self) {
        // This will be properly synced when build_entries is called during render
        // For now, just ensure selected_index stays valid
        if !self.agent_order.is_empty() && self.selected_index >= self.agent_order.len() {
            self.selected_index = self.agent_order.len() - 1;
        }
    }

    /// Update selectable count and sync entry index
    pub fn update_selectable_entries(
        &mut self,
        selectable_count: usize,
        agent_index: Option<usize>,
    ) {
        self.selectable_count = selectable_count;
        self.is_on_create_new = agent_index.is_none();
        if let Some(idx) = agent_index {
            self.selected_index = idx;
        }
        // Ensure entry index is valid
        if self.selected_entry_index >= selectable_count && selectable_count > 0 {
            self.selected_entry_index = selectable_count - 1;
        }
    }

    /// Get all unique directories from current agents
    pub fn get_known_directories(&self) -> Vec<String> {
        let mut dirs: Vec<String> = self.agents.values().map(|a| a.cwd.clone()).collect();
        dirs.sort();
        dirs.dedup();
        dirs
    }

    /// Toggle help screen
    pub fn toggle_help(&mut self) {
        self.show_help = !self.show_help;
        if self.show_help {
            self.help_scroll = 0;
        }
    }

    /// Scroll help screen down
    pub fn scroll_help_down(&mut self, amount: u16) {
        self.help_scroll = self.help_scroll.saturating_add(amount);
    }

    /// Scroll help screen up
    pub fn scroll_help_up(&mut self, amount: u16) {
        self.help_scroll = self.help_scroll.saturating_sub(amount);
    }

    /// Scroll preview down
    pub fn scroll_preview_down(&mut self, amount: u16) {
        self.preview_scroll = self.preview_scroll.saturating_add(amount);
    }

    /// Scroll preview up
    pub fn scroll_preview_up(&mut self, amount: u16) {
        self.preview_scroll = self.preview_scroll.saturating_sub(amount);
    }

    /// Get agents that need attention (awaiting approval or error)
    pub fn agents_needing_attention(&self) -> Vec<&MonitoredAgent> {
        self.agent_order
            .iter()
            .filter_map(|id| self.agents.get(id))
            .filter(|a| a.status.needs_attention())
            .collect()
    }

    /// Get count of agents needing attention
    pub fn attention_count(&self) -> usize {
        self.agents_needing_attention().len()
    }

    /// Set error message
    pub fn set_error(&mut self, message: String) {
        self.error_message = Some(message);
    }

    /// Clear error message
    pub fn clear_error(&mut self) {
        self.error_message = None;
    }

    /// Stop the application
    pub fn quit(&mut self) {
        self.running = false;
    }

    // =========================================
    // Input mode methods
    // =========================================

    /// Enter input mode
    pub fn enter_input_mode(&mut self) {
        self.input_mode = InputMode::Input;
    }

    /// Enter passthrough mode
    pub fn enter_passthrough_mode(&mut self) {
        self.input_mode = InputMode::Passthrough;
    }

    /// Exit input mode and clear buffer
    pub fn exit_input_mode(&mut self) {
        self.input_mode = InputMode::Normal;
        self.input_buffer.clear();
        self.cursor_position = 0;
    }

    /// Check if in input mode
    pub fn is_input_mode(&self) -> bool {
        self.input_mode == InputMode::Input
    }

    /// Check if in passthrough mode
    pub fn is_passthrough_mode(&self) -> bool {
        self.input_mode == InputMode::Passthrough
    }

    /// Get the input buffer
    pub fn get_input(&self) -> &str {
        &self.input_buffer
    }

    /// Get cursor position
    pub fn get_cursor_position(&self) -> usize {
        self.cursor_position
    }

    /// Insert a character at cursor position
    pub fn input_char(&mut self, c: char) {
        self.input_buffer.insert(self.cursor_position, c);
        self.cursor_position += c.len_utf8();
    }

    /// Delete character before cursor (backspace)
    pub fn input_backspace(&mut self) {
        if self.cursor_position > 0 {
            // Find the previous character boundary
            let prev_char_boundary = self.input_buffer[..self.cursor_position]
                .char_indices()
                .last()
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.input_buffer.remove(prev_char_boundary);
            self.cursor_position = prev_char_boundary;
        }
    }

    /// Delete character at cursor (delete key)
    pub fn input_delete(&mut self) {
        if self.cursor_position < self.input_buffer.len() {
            self.input_buffer.remove(self.cursor_position);
        }
    }

    /// Move cursor left
    pub fn cursor_left(&mut self) {
        if self.cursor_position > 0 {
            // Find the previous character boundary
            self.cursor_position = self.input_buffer[..self.cursor_position]
                .char_indices()
                .last()
                .map(|(i, _)| i)
                .unwrap_or(0);
        }
    }

    /// Move cursor right
    pub fn cursor_right(&mut self) {
        if self.cursor_position < self.input_buffer.len() {
            // Find the next character boundary
            if let Some(c) = self.input_buffer[self.cursor_position..].chars().next() {
                self.cursor_position += c.len_utf8();
            }
        }
    }

    /// Move cursor to start
    pub fn cursor_home(&mut self) {
        self.cursor_position = 0;
    }

    /// Move cursor to end
    pub fn cursor_end(&mut self) {
        self.cursor_position = self.input_buffer.len();
    }

    /// Take the input buffer content and clear it
    pub fn take_input(&mut self) -> String {
        let input = std::mem::take(&mut self.input_buffer);
        self.cursor_position = 0;
        input
    }

    // =========================================
    // Create process methods
    // =========================================

    /// Start create process flow from a group
    pub fn start_create_process(&mut self, group_key: String, sessions: Vec<String>) {
        // Get known directories from current agents
        let known_directories = self.get_known_directories();

        // Pre-select directory if sorted by Directory
        let directory = if self.sort_by == SortBy::Directory {
            Some(group_key.clone())
        } else {
            None
        };

        // Pre-select session if sorted by SessionOrder
        let target_session = if self.sort_by == SortBy::SessionOrder {
            Some(group_key.clone())
        } else {
            None
        };

        self.create_process = Some(CreateProcessState {
            step: CreateProcessStep::SelectPlacement,
            placement_type: None,
            origin_group_key: group_key,
            target_session,
            directory,
            cursor: 0,
            input_buffer: String::new(),
            available_sessions: sessions,
            known_directories,
            is_input_mode: false,
        });
    }

    /// Cancel create process flow
    pub fn cancel_create_process(&mut self) {
        self.create_process = None;
    }

    /// Check if in create process mode
    pub fn is_create_process_mode(&self) -> bool {
        self.create_process.is_some()
    }

    // =========================================
    // Confirmation dialog methods
    // =========================================

    /// Show a confirmation dialog
    pub fn show_confirmation(&mut self, action: ConfirmAction, message: String) {
        self.confirmation_state = Some(ConfirmationState { action, message });
    }

    /// Cancel the confirmation dialog
    pub fn cancel_confirmation(&mut self) {
        self.confirmation_state = None;
    }

    /// Check if confirmation dialog is showing
    pub fn is_showing_confirmation(&self) -> bool {
        self.confirmation_state.is_some()
    }

    /// Get the confirmation action (for execution)
    pub fn get_confirmation_action(&self) -> Option<ConfirmAction> {
        self.confirmation_state.as_ref().map(|s| s.action.clone())
    }

    /// Move cursor up in create process popup
    pub fn create_process_cursor_up(&mut self) {
        if let Some(ref mut state) = self.create_process {
            if state.cursor > 0 {
                state.cursor -= 1;
            }
        }
    }

    /// Move cursor down in create process popup
    pub fn create_process_cursor_down(&mut self, max: usize) {
        if let Some(ref mut state) = self.create_process {
            if state.cursor < max.saturating_sub(1) {
                state.cursor += 1;
            }
        }
    }

    /// Get create process cursor position
    pub fn create_process_cursor(&self) -> usize {
        self.create_process.as_ref().map(|s| s.cursor).unwrap_or(0)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType};

    fn create_test_agent(id: &str) -> MonitoredAgent {
        MonitoredAgent::new(
            id.to_string(),
            AgentType::ClaudeCode,
            "Test".to_string(),
            "/home".to_string(),
            1234,
            "main".to_string(),
            0,
            0,
        )
    }

    #[test]
    fn test_new_state() {
        let state = AppState::new();
        assert!(state.agents.is_empty());
        assert!(state.running);
    }

    #[test]
    fn test_update_agents() {
        let mut state = AppState::new();
        let agents = vec![create_test_agent("main:0.0"), create_test_agent("main:0.1")];

        state.update_agents(agents);

        assert_eq!(state.agents.len(), 2);
        assert_eq!(state.agent_order.len(), 2);
    }

    #[test]
    fn test_selection() {
        let mut state = AppState::new();
        let agents = vec![
            create_test_agent("main:0.0"),
            create_test_agent("main:0.1"),
            create_test_agent("main:0.2"),
        ];
        state.update_agents(agents);
        // Simulate selectable count: 3 agents + 1 CreateNew = 4
        state.selectable_count = 4;

        assert_eq!(state.selected_entry_index, 0);

        state.select_next();
        assert_eq!(state.selected_entry_index, 1);

        state.select_next();
        assert_eq!(state.selected_entry_index, 2);

        state.select_next();
        assert_eq!(state.selected_entry_index, 3); // CreateNew entry

        state.select_next();
        assert_eq!(state.selected_entry_index, 3); // Can't go past end

        state.select_previous();
        assert_eq!(state.selected_entry_index, 2);

        state.select_first();
        assert_eq!(state.selected_entry_index, 0);

        state.select_last();
        assert_eq!(state.selected_entry_index, 3);
    }

    #[test]
    fn test_attention_count() {
        let mut state = AppState::new();
        let mut agent1 = create_test_agent("main:0.0");
        agent1.status = AgentStatus::Idle;

        let mut agent2 = create_test_agent("main:0.1");
        agent2.status = AgentStatus::AwaitingApproval {
            approval_type: crate::agents::ApprovalType::FileEdit,
            details: String::new(),
        };

        state.update_agents(vec![agent1, agent2]);

        assert_eq!(state.attention_count(), 1);
    }
}
