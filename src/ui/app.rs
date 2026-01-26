use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::agents::{AgentType, ApprovalType};
use crate::config::Settings;
use crate::detectors::get_detector;
use crate::monitor::{PollMessage, Poller};
use crate::state::{AppState, CreateSessionStep, SharedState, SortBy};
use crate::tmux::TmuxClient;

use super::components::{
    CreateSessionPopup, HelpPopup, InputWidget, ListEntry, PanePreview, SelectionPopup,
    SessionList, StatusBar,
};
use super::Layout;

/// Main application
pub struct App {
    state: SharedState,
    settings: Settings,
    tmux_client: TmuxClient,
    layout: Layout,
}

impl App {
    /// Create a new application
    pub fn new(settings: Settings) -> Self {
        let state = AppState::shared();
        let tmux_client = TmuxClient::with_capture_lines(settings.capture_lines);
        let layout = Layout::new().with_preview_height(settings.ui.preview_height);

        Self {
            state,
            settings,
            tmux_client,
            layout,
        }
    }

    /// Run the application
    pub async fn run(&mut self) -> Result<()> {
        // Check if tmux is available
        if !self.tmux_client.is_available() {
            anyhow::bail!("tmux is not running or not available");
        }

        // Setup terminal
        crossterm::terminal::enable_raw_mode()?;
        let mut stdout = io::stdout();
        crossterm::execute!(
            stdout,
            crossterm::terminal::EnterAlternateScreen,
            crossterm::event::EnableMouseCapture
        )?;

        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        // Start poller
        let poller = Poller::new(self.settings.clone(), self.state.clone());
        let mut poll_rx = poller.start();

        // Main loop
        let result = self.main_loop(&mut terminal, &mut poll_rx).await;

        // Restore terminal
        crossterm::terminal::disable_raw_mode()?;
        crossterm::execute!(
            terminal.backend_mut(),
            crossterm::terminal::LeaveAlternateScreen,
            crossterm::event::DisableMouseCapture
        )?;
        terminal.show_cursor()?;

        result
    }

    async fn main_loop(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
        poll_rx: &mut mpsc::Receiver<PollMessage>,
    ) -> Result<()> {
        loop {
            // Check if we should quit
            {
                let state = self.state.read();
                if !state.running {
                    break;
                }
            }

            // Update selectable entries count
            {
                let (entries, _ui_idx, selectable_count, agent_index) = {
                    let state = self.state.read();
                    SessionList::build_entries(&state)
                };
                let mut state = self.state.write();
                state.update_selectable_entries(selectable_count, agent_index);
                drop(entries); // Avoid unused warning
            }

            // Draw UI
            terminal.draw(|frame| {
                let state = self.state.read();
                let show_input = state.is_input_mode();
                let areas = self.layout.calculate_with_input(frame.area(), show_input);

                // Render main components
                SessionList::render(frame, areas.session_list, &state);

                if let Some(preview_area) = areas.preview {
                    PanePreview::render(frame, preview_area, &state);
                }

                // Render input widget only when in input mode
                if let Some(input_area) = areas.input {
                    InputWidget::render(frame, input_area, &state);
                }

                StatusBar::render(frame, areas.status_bar, &state);

                // Render popups
                if state.show_help {
                    let popup_area = self.layout.popup_area(frame.area(), 60, 70);
                    HelpPopup::render(frame, popup_area);
                }

                // Selection popup for AskUserQuestion (only show in input mode)
                if state.is_input_mode() {
                    if let Some(agent) = state.selected_agent() {
                        if let crate::agents::AgentStatus::AwaitingApproval {
                            approval_type,
                            details,
                        } = &agent.status
                        {
                            if SelectionPopup::should_show(approval_type) {
                                let popup_area = self.layout.popup_area(frame.area(), 50, 50);
                                SelectionPopup::render(frame, popup_area, approval_type, details);
                            }
                        }
                    }
                }

                // Create session popup
                if state.is_create_session_mode() {
                    let popup_area = self.layout.popup_area(frame.area(), 50, 50);
                    CreateSessionPopup::render(frame, popup_area, &state);
                }
            })?;

            // Tick spinner animation
            {
                let mut state = self.state.write();
                state.tick_spinner();
            }

            // Handle events with timeout
            // Use shorter timeout in passthrough mode for better responsiveness
            let poll_timeout = {
                let state = self.state.read();
                if state.is_passthrough_mode() {
                    Duration::from_millis(1) // Fast response in passthrough
                } else {
                    Duration::from_millis(50)
                }
            };
            if event::poll(poll_timeout)? {
                if let Event::Key(key) = event::read()? {
                    self.handle_key(key.code, key.modifiers)?;
                }
            }

            // Process poll messages
            while let Ok(msg) = poll_rx.try_recv() {
                match msg {
                    PollMessage::AgentsUpdated(agents) => {
                        let mut state = self.state.write();
                        state.update_agents(agents);
                        state.clear_error();
                    }
                    PollMessage::Error(error) => {
                        let mut state = self.state.write();
                        state.set_error(error);
                    }
                }
            }
        }

        Ok(())
    }

    fn handle_key(&mut self, code: KeyCode, modifiers: KeyModifiers) -> Result<()> {
        // Check state without holding the lock for the entire function
        let (show_help, is_input_mode, is_passthrough_mode, is_create_session_mode) = {
            let state = self.state.read();
            (
                state.show_help,
                state.is_input_mode(),
                state.is_passthrough_mode(),
                state.is_create_session_mode(),
            )
        };

        // Handle help popup first
        if show_help {
            let mut state = self.state.write();
            state.show_help = false;
            return Ok(());
        }

        // Handle create session mode
        if is_create_session_mode {
            return self.handle_create_session_mode_key(code, modifiers);
        }

        // Dispatch based on input mode
        if is_passthrough_mode {
            self.handle_passthrough_mode_key(code, modifiers)
        } else if is_input_mode {
            self.handle_input_mode_key(code, modifiers)
        } else {
            self.handle_normal_mode_key(code, modifiers)
        }
    }

    /// Handle keys in normal (navigation) mode
    fn handle_normal_mode_key(&mut self, code: KeyCode, modifiers: KeyModifiers) -> Result<()> {
        let mut state = self.state.write();

        match code {
            // Quit
            KeyCode::Char('q') | KeyCode::Esc => {
                state.quit();
            }

            // Enter input mode
            KeyCode::Char('i') | KeyCode::Char('/') => {
                state.enter_input_mode();
            }

            // "Other" input for AskUserQuestion
            KeyCode::Char('o') => {
                // Check if we're in an AskUserQuestion state
                if let Some(target) = state.selected_target() {
                    let is_user_question = state.agents.get(target).map_or(false, |agent| {
                        matches!(
                            &agent.status,
                            crate::agents::AgentStatus::AwaitingApproval {
                                approval_type: ApprovalType::UserQuestion { .. },
                                ..
                            }
                        )
                    });
                    if is_user_question {
                        state.enter_input_mode();
                    }
                }
            }

            // Navigation
            KeyCode::Char('j') | KeyCode::Down => {
                state.select_next();
            }
            KeyCode::Char('k') | KeyCode::Up => {
                state.select_previous();
            }
            KeyCode::Char('g') => {
                state.select_first();
            }
            KeyCode::Char('G') => {
                state.select_last();
            }

            // Preview scroll
            KeyCode::Char('d') if modifiers.contains(KeyModifiers::CONTROL) => {
                state.scroll_preview_down(10);
            }
            KeyCode::Char('u') if modifiers.contains(KeyModifiers::CONTROL) => {
                state.scroll_preview_up(10);
            }

            // Approval actions
            KeyCode::Char('y') => {
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    if let Some(agent) = state.agents.get(&target) {
                        let detector = get_detector(&agent.agent_type);
                        let keys = detector.approval_keys();
                        drop(state); // Release lock before tmux command
                        let _ = self.tmux_client.send_keys(&target, keys);
                    }
                }
            }
            KeyCode::Char('n') => {
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    if let Some(agent) = state.agents.get(&target) {
                        let detector = get_detector(&agent.agent_type);
                        let keys = detector.rejection_keys();
                        drop(state);
                        let _ = self.tmux_client.send_keys(&target, keys);
                    }
                }
            }

            // Number selection (for AskUserQuestion)
            KeyCode::Char(c) if c.is_ascii_digit() && c != '0' => {
                let num = c.to_digit(10).unwrap() as usize;
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    // Check if it's a UserQuestion and get choices + multi_select
                    let question_info = state.agents.get(&target).and_then(|agent| {
                        if let crate::agents::AgentStatus::AwaitingApproval {
                            approval_type:
                                ApprovalType::UserQuestion {
                                    choices,
                                    multi_select,
                                    ..
                                },
                            ..
                        } = &agent.status
                        {
                            Some((choices.clone(), *multi_select))
                        } else {
                            None
                        }
                    });

                    if let Some((choices, multi_select)) = question_info {
                        let count = choices.len();
                        // count+1 for "Other" option
                        let total_options = count + 1;
                        if num <= total_options {
                            // Check if this is the "Other" option or "Type something" choice
                            let is_other = num == total_options
                                || choices
                                    .get(num - 1)
                                    .map(|c| c.to_lowercase().contains("type something"))
                                    .unwrap_or(false);

                            if is_other {
                                // "Other" or "Type something" - enter input mode
                                drop(state);
                                // Send the number to select it (use literal to avoid key interpretation issues)
                                let _ = self.tmux_client.send_keys_literal(&target, &num.to_string());
                                // Then enter tmai input mode for user to type
                                let mut state = self.state.write();
                                state.enter_input_mode();
                            } else {
                                drop(state);
                                // Send the number key as literal
                                let _ = self.tmux_client.send_keys_literal(&target, &num.to_string());
                                if !multi_select {
                                    // Single select: confirm with Enter
                                    let _ = self.tmux_client.send_keys(&target, "Enter");
                                }
                            }
                        }
                    }
                }
            }

            // Space key for toggle in multi-select UserQuestion
            KeyCode::Char(' ') => {
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    // Check if it's a multi-select UserQuestion
                    let is_multi_select = state.agents.get(&target).map_or(false, |agent| {
                        matches!(
                            &agent.status,
                            crate::agents::AgentStatus::AwaitingApproval {
                                approval_type: ApprovalType::UserQuestion {
                                    multi_select: true,
                                    ..
                                },
                                ..
                            }
                        )
                    });
                    if is_multi_select {
                        drop(state);
                        let _ = self.tmux_client.send_keys(&target, "Space");
                    }
                }
            }

            // Enter key - handle CreateNew selection or multi-select confirmation
            KeyCode::Enter => {
                // Check if we're on a CreateNew entry
                if let Some(ListEntry::CreateNew { group_key }) = SessionList::get_selected_entry(&state) {
                    let group_key = group_key.clone();
                    let sessions = self.tmux_client.list_sessions().unwrap_or_default();
                    state.start_create_session(group_key, sessions);
                } else if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    // Check if it's a multi-select UserQuestion and get info
                    let multi_info = state.agents.get(&target).and_then(|agent| {
                        if let crate::agents::AgentStatus::AwaitingApproval {
                            approval_type:
                                ApprovalType::UserQuestion {
                                    choices,
                                    multi_select: true,
                                    cursor_position,
                                },
                            ..
                        } = &agent.status
                        {
                            Some((choices.len(), *cursor_position))
                        } else {
                            None
                        }
                    });
                    if let Some((choice_count, cursor_pos)) = multi_info {
                        drop(state);
                        // Calculate how many Down presses needed to reach Submit
                        // Submit is right after the last choice
                        // (choice_count - cursor_pos) moves to last choice, then Submit
                        let downs_needed = choice_count.saturating_sub(cursor_pos.saturating_sub(1));
                        for _ in 0..downs_needed {
                            let _ = self.tmux_client.send_keys(&target, "Down");
                        }
                        let _ = self.tmux_client.send_keys(&target, "Enter");
                    }
                }
            }

            // Focus pane
            KeyCode::Char('f') => {
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    drop(state);
                    let _ = self.tmux_client.focus_pane(&target);
                }
            }

            // Toggle preview
            KeyCode::Char('p') => {
                drop(state);
                self.layout.toggle_preview();
            }

            // Cycle sort method
            KeyCode::Char('s') => {
                state.cycle_sort();
            }

            // Enter passthrough mode (direct key input to pane)
            KeyCode::Right => {
                state.enter_passthrough_mode();
            }

            // Help
            KeyCode::Char('?') => {
                state.toggle_help();
            }

            _ => {}
        }

        Ok(())
    }

    /// Handle keys in input mode
    fn handle_input_mode_key(&mut self, code: KeyCode, _modifiers: KeyModifiers) -> Result<()> {
        match code {
            // Exit input mode
            KeyCode::Esc => {
                let mut state = self.state.write();
                state.exit_input_mode();
            }

            // Send input
            KeyCode::Enter => {
                self.send_input()?;
            }

            // Text editing
            KeyCode::Char(c) => {
                let mut state = self.state.write();
                state.input_char(c);
            }
            KeyCode::Backspace => {
                let mut state = self.state.write();
                state.input_backspace();
            }
            KeyCode::Delete => {
                let mut state = self.state.write();
                state.input_delete();
            }

            // Cursor movement
            KeyCode::Left => {
                let mut state = self.state.write();
                state.cursor_left();
            }
            KeyCode::Right => {
                let mut state = self.state.write();
                state.cursor_right();
            }
            KeyCode::Home => {
                let mut state = self.state.write();
                state.cursor_home();
            }
            KeyCode::End => {
                let mut state = self.state.write();
                state.cursor_end();
            }

            _ => {}
        }

        Ok(())
    }

    /// Send the input buffer content to the selected pane
    fn send_input(&mut self) -> Result<()> {
        let mut state = self.state.write();
        let input = state.take_input();
        let target = state.selected_target().map(|s| s.to_string());
        state.exit_input_mode();
        drop(state);

        if !input.is_empty() {
            if let Some(target) = target {
                // Send text as literal (preserves special characters)
                self.tmux_client.send_keys_literal(&target, &input)?;
                // Send Enter to submit
                self.tmux_client.send_keys(&target, "Enter")?;
            }
        }
        Ok(())
    }

    /// Handle keys in passthrough mode - send directly to target pane
    fn handle_passthrough_mode_key(&mut self, code: KeyCode, modifiers: KeyModifiers) -> Result<()> {
        // Escape exits passthrough mode
        if code == KeyCode::Esc {
            let mut state = self.state.write();
            state.exit_input_mode();
            return Ok(());
        }

        // Get target pane
        let target = {
            let state = self.state.read();
            state.selected_target().map(|s| s.to_string())
        };

        let Some(target) = target else {
            return Ok(());
        };

        // Map key to tmux key name and send
        let key_str = match code {
            KeyCode::Char(c) => {
                if modifiers.contains(KeyModifiers::CONTROL) {
                    format!("C-{}", c)
                } else {
                    // Send character as literal - no preview refresh, poller handles it
                    self.tmux_client.send_keys_literal(&target, &c.to_string())?;
                    return Ok(());
                }
            }
            KeyCode::Enter => "Enter".to_string(),
            KeyCode::Backspace => "BSpace".to_string(),
            KeyCode::Delete => "DC".to_string(),
            KeyCode::Up => "Up".to_string(),
            KeyCode::Down => "Down".to_string(),
            KeyCode::Left => "Left".to_string(),
            KeyCode::Right => "Right".to_string(),
            KeyCode::Home => "Home".to_string(),
            KeyCode::End => "End".to_string(),
            KeyCode::PageUp => "PPage".to_string(),
            KeyCode::PageDown => "NPage".to_string(),
            KeyCode::Tab => "Tab".to_string(),
            _ => return Ok(()),
        };

        // Send key - no preview refresh, poller handles it with faster interval in passthrough mode
        let _ = self.tmux_client.send_keys(&target, &key_str);
        Ok(())
    }

    /// Handle keys in create session mode
    fn handle_create_session_mode_key(
        &mut self,
        code: KeyCode,
        _modifiers: KeyModifiers,
    ) -> Result<()> {
        // Get current state info
        let (step, is_input_mode, item_count) = {
            let state = self.state.read();
            let step = state
                .create_session
                .as_ref()
                .map(|s| s.step)
                .unwrap_or(CreateSessionStep::SelectAgent);
            let is_input = state
                .create_session
                .as_ref()
                .map(|s| s.is_input_mode)
                .unwrap_or(false);
            let count = CreateSessionPopup::item_count(&state);
            (step, is_input, count)
        };

        // Handle input mode for directory entry
        if is_input_mode {
            match code {
                KeyCode::Esc => {
                    let mut state = self.state.write();
                    if let Some(ref mut cs) = state.create_session {
                        cs.is_input_mode = false;
                        cs.input_buffer.clear();
                    }
                }
                KeyCode::Enter => {
                    let path = {
                        let state = self.state.read();
                        state
                            .create_session
                            .as_ref()
                            .map(|s| s.input_buffer.clone())
                            .unwrap_or_default()
                    };
                    if !path.is_empty() {
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_session {
                            // Expand ~ to home directory
                            let expanded_path = if path.starts_with('~') {
                                dirs::home_dir()
                                    .map(|h| path.replacen('~', &h.to_string_lossy(), 1))
                                    .unwrap_or(path)
                            } else {
                                path
                            };
                            cs.selected_directory = Some(expanded_path);
                            cs.is_input_mode = false;
                            cs.input_buffer.clear();
                            cs.step = CreateSessionStep::SelectAgent;
                            cs.cursor = 0;
                        }
                    }
                }
                KeyCode::Backspace => {
                    let mut state = self.state.write();
                    if let Some(ref mut cs) = state.create_session {
                        cs.input_buffer.pop();
                    }
                }
                KeyCode::Char(c) => {
                    let mut state = self.state.write();
                    if let Some(ref mut cs) = state.create_session {
                        cs.input_buffer.push(c);
                    }
                }
                _ => {}
            }
            return Ok(());
        }

        match code {
            // Cancel / go back
            KeyCode::Esc => {
                let mut state = self.state.write();
                let should_cancel = state
                    .create_session
                    .as_ref()
                    .map(|cs| match cs.step {
                        CreateSessionStep::SelectTarget | CreateSessionStep::SelectDirectory => true,
                        CreateSessionStep::SelectAgent => false,
                    })
                    .unwrap_or(true);

                if should_cancel {
                    state.cancel_create_session();
                } else {
                    // Go back to previous step
                    let prev_step = match state.sort_by {
                        SortBy::Directory => CreateSessionStep::SelectTarget,
                        SortBy::SessionOrder => CreateSessionStep::SelectDirectory,
                        _ => CreateSessionStep::SelectAgent,
                    };
                    if let Some(ref mut cs) = state.create_session {
                        cs.step = prev_step;
                        cs.cursor = 0;
                    }
                }
            }

            // Navigate up
            KeyCode::Up | KeyCode::Char('k') => {
                let mut state = self.state.write();
                state.create_session_cursor_up();
            }

            // Navigate down
            KeyCode::Down | KeyCode::Char('j') => {
                let mut state = self.state.write();
                state.create_session_cursor_down(item_count);
            }

            // Select / confirm
            KeyCode::Enter => {
                self.handle_create_session_select(step)?;
            }

            _ => {}
        }

        Ok(())
    }

    /// Handle selection in create session mode
    fn handle_create_session_select(&mut self, step: CreateSessionStep) -> Result<()> {
        match step {
            CreateSessionStep::SelectTarget => {
                let (cursor, session_count, sessions) = {
                    let state = self.state.read();
                    let cs = state.create_session.as_ref().unwrap();
                    (cs.cursor, cs.available_sessions.len(), cs.available_sessions.clone())
                };

                if cursor < session_count {
                    // Selected an existing session
                    let selected_session = sessions[cursor].clone();
                    let mut state = self.state.write();
                    if let Some(ref mut cs) = state.create_session {
                        cs.selected_session = Some(selected_session);
                        cs.step = CreateSessionStep::SelectAgent;
                        cs.cursor = 0;
                    }
                } else {
                    // "New session" selected - create a new session
                    let dir = {
                        let state = self.state.read();
                        state
                            .create_session
                            .as_ref()
                            .and_then(|cs| cs.selected_directory.clone())
                            .unwrap_or_else(|| ".".to_string())
                    };

                    // Generate unique session name
                    let session_name = format!("ai-{}", chrono::Utc::now().timestamp());
                    if let Err(e) = self.tmux_client.create_session(&session_name, &dir) {
                        let mut state = self.state.write();
                        state.set_error(format!("Failed to create session: {}", e));
                        state.cancel_create_session();
                        return Ok(());
                    }

                    let mut state = self.state.write();
                    if let Some(ref mut cs) = state.create_session {
                        cs.selected_session = Some(session_name);
                        cs.step = CreateSessionStep::SelectAgent;
                        cs.cursor = 0;
                    }
                }
            }

            CreateSessionStep::SelectDirectory => {
                let (cursor, known_dirs) = {
                    let state = self.state.read();
                    let cs = state.create_session.as_ref();
                    (
                        cs.map(|s| s.cursor).unwrap_or(0),
                        cs.map(|s| s.known_directories.clone()).unwrap_or_default(),
                    )
                };

                match cursor {
                    0 => {
                        // "Enter path" - switch to input mode
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_session {
                            cs.is_input_mode = true;
                        }
                    }
                    1 => {
                        // Home directory
                        let home = dirs::home_dir()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|| "~".to_string());
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_session {
                            cs.selected_directory = Some(home);
                            cs.step = CreateSessionStep::SelectAgent;
                            cs.cursor = 0;
                        }
                    }
                    2 => {
                        // Current directory
                        let cwd = std::env::current_dir()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|_| ".".to_string());
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_session {
                            cs.selected_directory = Some(cwd);
                            cs.step = CreateSessionStep::SelectAgent;
                            cs.cursor = 0;
                        }
                    }
                    n if n >= 3 => {
                        // Known directory from agents
                        let dir_idx = n - 3;
                        if let Some(dir) = known_dirs.get(dir_idx) {
                            let dir = dir.clone();
                            let mut state = self.state.write();
                            if let Some(ref mut cs) = state.create_session {
                                cs.selected_directory = Some(dir);
                                cs.step = CreateSessionStep::SelectAgent;
                                cs.cursor = 0;
                            }
                        }
                    }
                    _ => {}
                }
            }

            CreateSessionStep::SelectAgent => {
                let cursor = {
                    let state = self.state.read();
                    state.create_session.as_ref().map(|s| s.cursor).unwrap_or(0)
                };

                let agents = AgentType::all_variants();
                if let Some(agent_type) = agents.get(cursor) {
                    self.execute_create_session(agent_type.clone())?;
                }
            }
        }

        Ok(())
    }

    /// Execute the session creation with the selected parameters
    fn execute_create_session(&mut self, agent_type: AgentType) -> Result<()> {
        let (session, directory) = {
            let state = self.state.read();
            let cs = state.create_session.as_ref().unwrap();
            (
                cs.selected_session.clone().unwrap_or_else(|| "main".to_string()),
                cs.selected_directory
                    .clone()
                    .unwrap_or_else(|| ".".to_string()),
            )
        };

        // Create a new pane in the selected session
        let target = match self.tmux_client.split_window(&session, &directory) {
            Ok(t) => t,
            Err(e) => {
                let mut state = self.state.write();
                state.set_error(format!("Failed to create pane: {}", e));
                state.cancel_create_session();
                return Ok(());
            }
        };

        // Run the agent command
        let command = agent_type.command();
        if !command.is_empty() {
            if let Err(e) = self.tmux_client.run_command(&target, command) {
                let mut state = self.state.write();
                state.set_error(format!("Failed to start agent: {}", e));
            }
        }

        // Close the create session popup
        {
            let mut state = self.state.write();
            state.cancel_create_session();
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_creation() {
        let settings = Settings::default();
        let _app = App::new(settings);
    }
}
