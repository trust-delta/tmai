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

/// Spinner frames for processing animation
pub const SPINNER_FRAMES: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/// Application state
#[derive(Debug)]
pub struct AppState {
    /// All monitored agents by target ID
    pub agents: HashMap<String, MonitoredAgent>,
    /// Order of agents for display
    pub agent_order: Vec<String>,
    /// Currently selected agent index
    pub selected_index: usize,
    /// Whether help popup is shown
    pub show_help: bool,
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
}

impl AppState {
    /// Create a new application state
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            agent_order: Vec::new(),
            selected_index: 0,
            show_help: false,
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
                        b.last_update.cmp(&a.last_update).then_with(|| a.id.cmp(&b.id))
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
            SortBy::AgentType => Some(agent.agent_type.short_name().to_string()),
            _ => None,
        }
    }

    /// Move selection up
    pub fn select_previous(&mut self) {
        if !self.agent_order.is_empty() && self.selected_index > 0 {
            self.selected_index -= 1;
            self.preview_scroll = 0;
        }
    }

    /// Move selection down
    pub fn select_next(&mut self) {
        if !self.agent_order.is_empty() && self.selected_index < self.agent_order.len() - 1 {
            self.selected_index += 1;
            self.preview_scroll = 0;
        }
    }

    /// Select first agent
    pub fn select_first(&mut self) {
        if !self.agent_order.is_empty() {
            self.selected_index = 0;
            self.preview_scroll = 0;
        }
    }

    /// Select last agent
    pub fn select_last(&mut self) {
        if !self.agent_order.is_empty() {
            self.selected_index = self.agent_order.len() - 1;
            self.preview_scroll = 0;
        }
    }

    /// Toggle help popup
    pub fn toggle_help(&mut self) {
        self.show_help = !self.show_help;
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

        assert_eq!(state.selected_index, 0);

        state.select_next();
        assert_eq!(state.selected_index, 1);

        state.select_next();
        assert_eq!(state.selected_index, 2);

        state.select_next();
        assert_eq!(state.selected_index, 2); // Can't go past end

        state.select_previous();
        assert_eq!(state.selected_index, 1);

        state.select_first();
        assert_eq!(state.selected_index, 0);

        state.select_last();
        assert_eq!(state.selected_index, 2);
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
