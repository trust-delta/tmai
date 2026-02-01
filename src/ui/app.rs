use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::agents::{AgentStatus, AgentType, ApprovalType};
use crate::config::Settings;
use crate::detectors::get_detector;
use crate::monitor::{PollMessage, Poller};
use crate::state::{
    AppState, ConfirmAction, CreateProcessStep, PlacementType, SharedState, TreeEntry,
};
use crate::tmux::TmuxClient;

use super::components::{
    ConfirmationPopup, CreateProcessPopup, HelpScreen, InputWidget, ListEntry, PanePreview,
    QrScreen, SelectionPopup, SessionList, StatusBar,
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

    /// Get a clone of the shared state
    pub fn shared_state(&self) -> SharedState {
        self.state.clone()
    }

    /// Run the application
    pub async fn run(&mut self) -> Result<()> {
        // Check if tmux is available
        if !self.tmux_client.is_available() {
            anyhow::bail!("tmux is not running or not available");
        }

        // Capture current location for scope filtering display
        if let Ok((session, window)) = self.tmux_client.get_current_location() {
            let mut state = self.state.write();
            state.current_session = Some(session);
            state.current_window = Some(window);
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

                // Full-screen help mode
                if state.show_help {
                    HelpScreen::render(frame, frame.area(), &state);
                    return;
                }

                // QR code screen (overlay popup)
                if state.show_qr {
                    QrScreen::render(frame, frame.area(), &state);
                    return;
                }

                let show_input = state.is_input_mode();
                let areas = self.layout.calculate_with_input(frame.area(), show_input);

                // Render main components
                if let Some(session_list_area) = areas.session_list {
                    SessionList::render(frame, session_list_area, &state, areas.split_direction);
                }

                if let Some(preview_area) = areas.preview {
                    PanePreview::render(frame, preview_area, &state);
                }

                // Render input widget only when in input mode
                if let Some(input_area) = areas.input {
                    InputWidget::render(frame, input_area, &state);
                }

                StatusBar::render(
                    frame,
                    areas.status_bar,
                    &state,
                    self.layout.view_mode(),
                    self.layout.split_direction(),
                );

                // Selection popup for AskUserQuestion (only show in input mode)
                if state.is_input_mode() {
                    if let Some(agent) = state.selected_agent() {
                        if let AgentStatus::AwaitingApproval {
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

                // Create process popup
                if state.is_create_process_mode() {
                    let popup_area = self.layout.popup_area(frame.area(), 50, 50);
                    CreateProcessPopup::render(frame, popup_area, &state);
                }

                // Confirmation popup
                if let Some(ref confirmation) = state.confirmation_state {
                    let popup_area = self.layout.popup_area(frame.area(), 35, 25);
                    ConfirmationPopup::render(frame, popup_area, confirmation);
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
        let (
            show_help,
            show_qr,
            is_input_mode,
            is_passthrough_mode,
            is_create_process_mode,
            is_showing_confirmation,
        ) = {
            let state = self.state.read();
            (
                state.show_help,
                state.show_qr,
                state.is_input_mode(),
                state.is_passthrough_mode(),
                state.is_create_process_mode(),
                state.is_showing_confirmation(),
            )
        };

        // Handle confirmation dialog first (highest priority)
        if is_showing_confirmation {
            return self.handle_confirmation_key(code);
        }

        // Handle QR screen
        if show_qr {
            return self.handle_qr_screen_key(code);
        }

        // Handle help screen
        if show_help {
            return self.handle_help_screen_key(code, modifiers);
        }

        // Handle create process mode
        if is_create_process_mode {
            return self.handle_create_process_mode_key(code, modifiers);
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
                    let is_user_question = state.agents.get(target).is_some_and(|agent| {
                        matches!(
                            &agent.status,
                            AgentStatus::AwaitingApproval {
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

            // Number selection (for AskUserQuestion)
            // Support both half-width (1-9) and full-width (１-９) digits
            KeyCode::Char(c) if matches!(c, '1'..='9' | '１'..='９') => {
                let num = if c.is_ascii_digit() {
                    c.to_digit(10).unwrap() as usize
                } else {
                    // Full-width digit: convert '１'-'９' to 1-9
                    (c as u32 - '０' as u32) as usize
                };
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    // Check if it's a UserQuestion and get choices + multi_select
                    let question_info = state.agents.get(&target).and_then(|agent| {
                        if let AgentStatus::AwaitingApproval {
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
                                let _ = self
                                    .tmux_client
                                    .send_keys_literal(&target, &num.to_string());
                                // Then enter tmai input mode for user to type
                                let mut state = self.state.write();
                                state.enter_input_mode();
                            } else {
                                drop(state);
                                // Send the number key as literal
                                let _ = self
                                    .tmux_client
                                    .send_keys_literal(&target, &num.to_string());
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
                    let is_multi_select = state.agents.get(&target).is_some_and(|agent| {
                        matches!(
                            &agent.status,
                            AgentStatus::AwaitingApproval {
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

            // Approval key (y) - send to agent when awaiting approval
            KeyCode::Char('y') => {
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    let agent_info = state.agents.get(&target).map(|a| {
                        (
                            matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                            a.agent_type.clone(),
                        )
                    });
                    if let Some((true, agent_type)) = agent_info {
                        drop(state);
                        let detector = get_detector(&agent_type);
                        let _ = self
                            .tmux_client
                            .send_keys(&target, detector.approval_keys());
                    }
                }
            }

            // Rejection key (n) - send to agent when awaiting approval
            KeyCode::Char('n') => {
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    let agent_info = state.agents.get(&target).map(|a| {
                        (
                            matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                            a.agent_type.clone(),
                        )
                    });
                    if let Some((true, agent_type)) = agent_info {
                        drop(state);
                        let detector = get_detector(&agent_type);
                        let _ = self
                            .tmux_client
                            .send_keys(&target, detector.rejection_keys());
                    }
                }
            }

            // Enter key - handle CreateNew selection, GroupHeader toggle, or multi-select confirmation
            KeyCode::Enter => {
                // Check the selected entry type
                match SessionList::get_selected_entry(&state) {
                    Some(ListEntry::CreateNew { group_key }) => {
                        let group_key = group_key.clone();
                        let panes = self.tmux_client.list_all_panes().unwrap_or_default();
                        state.start_create_process(group_key, panes);
                        return Ok(());
                    }
                    Some(ListEntry::GroupHeader { key, .. }) => {
                        state.toggle_group_collapse(&key);
                        return Ok(());
                    }
                    _ => {}
                }

                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    // Check if it's a multi-select UserQuestion and get info
                    let multi_info = state.agents.get(&target).and_then(|agent| {
                        if let AgentStatus::AwaitingApproval {
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
                        let downs_needed =
                            choice_count.saturating_sub(cursor_pos.saturating_sub(1));
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

            // Cycle view mode (Both -> AgentsOnly -> PreviewOnly)
            KeyCode::Tab => {
                drop(state);
                self.layout.cycle_view_mode();
            }

            // Toggle split direction (Horizontal <-> Vertical)
            KeyCode::Char('l') => {
                drop(state);
                self.layout.toggle_split_direction();
            }

            // Cycle sort method
            KeyCode::Char('s') => {
                state.cycle_sort();
            }

            // Cycle monitor scope
            KeyCode::Char('m') => {
                state.cycle_monitor_scope();
            }

            // Enter passthrough mode (direct key input to pane)
            KeyCode::Char('p') | KeyCode::Right => {
                state.enter_passthrough_mode();
            }

            // Help
            KeyCode::Char('h') | KeyCode::Char('?') => {
                state.toggle_help();
            }

            // QR code screen
            KeyCode::Char('r') => {
                state.toggle_qr();
            }

            // Kill pane (with confirmation)
            KeyCode::Char('x') => {
                if let Some(target) = state.selected_target() {
                    let target = target.to_string();
                    state.show_confirmation(
                        ConfirmAction::KillPane {
                            target: target.clone(),
                        },
                        format!("Kill pane {}?", target),
                    );
                }
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

    /// Handle keys in confirmation dialog
    fn handle_confirmation_key(&mut self, code: KeyCode) -> Result<()> {
        match code {
            // Confirm action
            KeyCode::Char('y') | KeyCode::Char('Y') => {
                let action = {
                    let mut state = self.state.write();
                    let action = state.get_confirmation_action();
                    state.cancel_confirmation();
                    action
                };

                if let Some(action) = action {
                    match action {
                        ConfirmAction::KillPane { target } => {
                            if let Err(e) = self.tmux_client.kill_pane(&target) {
                                let mut state = self.state.write();
                                state.set_error(format!("Failed to kill pane: {}", e));
                            }
                        }
                    }
                }
            }

            // Cancel
            KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
                let mut state = self.state.write();
                state.cancel_confirmation();
            }

            _ => {}
        }

        Ok(())
    }

    /// Handle keys in QR code screen
    fn handle_qr_screen_key(&mut self, code: KeyCode) -> Result<()> {
        match code {
            // Close QR screen
            KeyCode::Char('r') | KeyCode::Esc | KeyCode::Char('q') => {
                let mut state = self.state.write();
                state.show_qr = false;
            }
            _ => {}
        }
        Ok(())
    }

    /// Handle keys in help screen
    fn handle_help_screen_key(&mut self, code: KeyCode, modifiers: KeyModifiers) -> Result<()> {
        let mut state = self.state.write();

        match code {
            // Close help
            KeyCode::Char('q') | KeyCode::Esc | KeyCode::Char('h') | KeyCode::Char('?') => {
                state.show_help = false;
            }
            // Scroll down
            KeyCode::Char('j') | KeyCode::Down => {
                state.scroll_help_down(1);
            }
            // Scroll up
            KeyCode::Char('k') | KeyCode::Up => {
                state.scroll_help_up(1);
            }
            // Page down
            KeyCode::Char('d') if modifiers.contains(KeyModifiers::CONTROL) => {
                state.scroll_help_down(10);
            }
            KeyCode::PageDown => {
                state.scroll_help_down(10);
            }
            // Page up
            KeyCode::Char('u') if modifiers.contains(KeyModifiers::CONTROL) => {
                state.scroll_help_up(10);
            }
            KeyCode::PageUp => {
                state.scroll_help_up(10);
            }
            // Jump to top
            KeyCode::Char('g') => {
                state.help_scroll = 0;
            }
            // Jump to bottom
            KeyCode::Char('G') => {
                state.help_scroll = u16::MAX; // Will be clamped in render
            }
            _ => {}
        }

        Ok(())
    }

    /// Handle keys in passthrough mode - send directly to target pane
    fn handle_passthrough_mode_key(
        &mut self,
        code: KeyCode,
        modifiers: KeyModifiers,
    ) -> Result<()> {
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
                    self.tmux_client
                        .send_keys_literal(&target, &c.to_string())?;
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

    /// Handle keys in create process mode
    fn handle_create_process_mode_key(
        &mut self,
        code: KeyCode,
        _modifiers: KeyModifiers,
    ) -> Result<()> {
        // Get current state info
        let (step, is_input_mode, item_count) = {
            let state = self.state.read();
            let step = state
                .create_process
                .as_ref()
                .map(|s| s.step)
                .unwrap_or(CreateProcessStep::SelectAgent);
            let is_input = state
                .create_process
                .as_ref()
                .map(|s| s.is_input_mode)
                .unwrap_or(false);
            let count = CreateProcessPopup::item_count(&state);
            (step, is_input, count)
        };

        // Handle input mode for directory entry
        if is_input_mode {
            match code {
                KeyCode::Esc => {
                    let mut state = self.state.write();
                    if let Some(ref mut cs) = state.create_process {
                        cs.is_input_mode = false;
                        cs.input_buffer.clear();
                    }
                }
                KeyCode::Enter => {
                    let path = {
                        let state = self.state.read();
                        state
                            .create_process
                            .as_ref()
                            .map(|s| s.input_buffer.clone())
                            .unwrap_or_default()
                    };
                    if !path.is_empty() {
                        // Expand ~ to home directory
                        let expanded_path = if path.starts_with('~') {
                            dirs::home_dir()
                                .map(|h| path.replacen('~', &h.to_string_lossy(), 1))
                                .unwrap_or_else(|| path.clone())
                        } else {
                            path.clone()
                        };

                        // Validate path: canonicalize and check if it's a directory
                        let canonical = std::path::Path::new(&expanded_path).canonicalize().ok();

                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            if let Some(ref p) = canonical {
                                if p.is_dir() {
                                    cs.directory = Some(p.to_string_lossy().to_string());
                                    cs.is_input_mode = false;
                                    cs.input_buffer.clear();
                                    cs.step = CreateProcessStep::SelectAgent;
                                    cs.cursor = 0;
                                } else {
                                    // Path exists but is not a directory
                                    drop(state);
                                    let mut state = self.state.write();
                                    state.set_error(format!(
                                        "Path is not a directory: {}",
                                        expanded_path
                                    ));
                                }
                            } else {
                                // Path does not exist or cannot be resolved
                                drop(state);
                                let mut state = self.state.write();
                                state.set_error(format!(
                                    "Directory does not exist: {}",
                                    expanded_path
                                ));
                            }
                        }
                    }
                }
                KeyCode::Backspace => {
                    let mut state = self.state.write();
                    if let Some(ref mut cs) = state.create_process {
                        cs.input_buffer.pop();
                    }
                }
                KeyCode::Char(c) => {
                    let mut state = self.state.write();
                    if let Some(ref mut cs) = state.create_process {
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
                    .create_process
                    .as_ref()
                    .map(|cs| cs.step == CreateProcessStep::SelectTarget)
                    .unwrap_or(true);

                if should_cancel {
                    state.cancel_create_process();
                } else {
                    // Go back to previous step
                    if let Some(ref mut cs) = state.create_process {
                        let prev_step = match cs.step {
                            CreateProcessStep::SelectTarget => CreateProcessStep::SelectTarget,
                            CreateProcessStep::SelectDirectory => CreateProcessStep::SelectTarget,
                            CreateProcessStep::SelectAgent => CreateProcessStep::SelectDirectory,
                        };
                        cs.step = prev_step;
                        cs.cursor = 0;
                    }
                }
            }

            // Navigate up
            KeyCode::Up | KeyCode::Char('k') => {
                let mut state = self.state.write();
                state.create_process_cursor_up();
            }

            // Navigate down
            KeyCode::Down | KeyCode::Char('j') => {
                let mut state = self.state.write();
                state.create_process_cursor_down(item_count);
            }

            // Select / confirm
            KeyCode::Enter => {
                self.handle_create_process_select(step)?;
            }

            _ => {}
        }

        Ok(())
    }

    /// Handle selection in create process mode
    fn handle_create_process_select(&mut self, step: CreateProcessStep) -> Result<()> {
        match step {
            CreateProcessStep::SelectTarget => {
                let (cursor, tree_entries) = {
                    let state = self.state.read();
                    let cs = state.create_process.as_ref().unwrap();
                    (cs.cursor, cs.tree_entries.clone())
                };

                if cursor >= tree_entries.len() {
                    return Ok(());
                }

                let entry = &tree_entries[cursor];
                match entry {
                    TreeEntry::NewSession => {
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            cs.placement_type = Some(PlacementType::NewSession);
                            cs.step = CreateProcessStep::SelectDirectory;
                            cs.cursor = 0;
                        }
                    }
                    TreeEntry::Session { name, .. } => {
                        // Toggle session collapse
                        let key = name.clone();
                        let mut state = self.state.write();
                        state.toggle_tree_node(&key);
                    }
                    TreeEntry::NewWindow { session } => {
                        let session = session.clone();
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            cs.placement_type = Some(PlacementType::NewWindow);
                            cs.target_session = Some(session);
                            cs.step = CreateProcessStep::SelectDirectory;
                            cs.cursor = 0;
                        }
                    }
                    TreeEntry::Window { session, index, .. } => {
                        // Toggle window collapse
                        let key = format!("{}:{}", session, index);
                        let mut state = self.state.write();
                        state.toggle_tree_node(&key);
                    }
                    TreeEntry::SplitPane { target } => {
                        let target = target.clone();
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            cs.placement_type = Some(PlacementType::SplitPane);
                            cs.target_pane = Some(target);
                            cs.step = CreateProcessStep::SelectDirectory;
                            cs.cursor = 0;
                        }
                    }
                }
            }

            CreateProcessStep::SelectDirectory => {
                let (cursor, known_dirs) = {
                    let state = self.state.read();
                    let cs = state.create_process.as_ref();
                    (
                        cs.map(|s| s.cursor).unwrap_or(0),
                        cs.map(|s| s.known_directories.clone()).unwrap_or_default(),
                    )
                };

                match cursor {
                    0 => {
                        // "Enter path" - switch to input mode
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            cs.is_input_mode = true;
                        }
                    }
                    1 => {
                        // Home directory
                        let home = dirs::home_dir()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|| "~".to_string());
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            cs.directory = Some(home);
                            cs.step = CreateProcessStep::SelectAgent;
                            cs.cursor = 0;
                        }
                    }
                    2 => {
                        // Current directory
                        let cwd = std::env::current_dir()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|_| ".".to_string());
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            cs.directory = Some(cwd);
                            cs.step = CreateProcessStep::SelectAgent;
                            cs.cursor = 0;
                        }
                    }
                    n if n >= 3 => {
                        // Known directory from agents
                        let dir_idx = n - 3;
                        if let Some(dir) = known_dirs.get(dir_idx) {
                            let dir = dir.clone();
                            let mut state = self.state.write();
                            if let Some(ref mut cs) = state.create_process {
                                cs.directory = Some(dir);
                                cs.step = CreateProcessStep::SelectAgent;
                                cs.cursor = 0;
                            }
                        }
                    }
                    _ => {}
                }
            }

            CreateProcessStep::SelectAgent => {
                let cursor = {
                    let state = self.state.read();
                    state.create_process.as_ref().map(|s| s.cursor).unwrap_or(0)
                };

                let agents = AgentType::all_variants();
                if let Some(agent_type) = agents.get(cursor) {
                    self.execute_create_process(agent_type.clone())?;
                }
            }
        }

        Ok(())
    }

    /// Execute the process creation with the selected parameters
    fn execute_create_process(&mut self, agent_type: AgentType) -> Result<()> {
        let (placement_type, session, target_pane, directory) = {
            let state = self.state.read();
            let cs = state.create_process.as_ref().unwrap();
            (
                cs.placement_type.unwrap_or(PlacementType::SplitPane),
                cs.target_session
                    .clone()
                    .unwrap_or_else(|| "main".to_string()),
                cs.target_pane.clone(),
                cs.directory.clone().unwrap_or_else(|| ".".to_string()),
            )
        };

        // Create the target based on placement type
        let target = match placement_type {
            PlacementType::NewSession => {
                // Generate unique session name
                let session_name = format!("ai-{}", chrono::Utc::now().timestamp());
                if let Err(e) = self.tmux_client.create_session(&session_name, &directory) {
                    let mut state = self.state.write();
                    state.set_error(format!("Failed to create session: {}", e));
                    state.cancel_create_process();
                    return Ok(());
                }
                // New session starts with window 0, pane 0
                format!("{}:0.0", session_name)
            }
            PlacementType::NewWindow => match self.tmux_client.new_window(&session, &directory) {
                Ok(t) => t,
                Err(e) => {
                    let mut state = self.state.write();
                    state.set_error(format!("Failed to create window: {}", e));
                    state.cancel_create_process();
                    return Ok(());
                }
            },
            PlacementType::SplitPane => {
                // Use target_pane (currently selected pane) for splitting
                let pane = target_pane.unwrap_or_else(|| session.clone());
                match self.tmux_client.split_window(&pane, &directory) {
                    Ok(t) => t,
                    Err(e) => {
                        let mut state = self.state.write();
                        state.set_error(format!("Failed to create pane: {}", e));
                        state.cancel_create_process();
                        return Ok(());
                    }
                }
            }
        };

        // Run the agent command (wrapped with tmai wrap for PTY monitoring)
        let command = agent_type.command();
        if !command.is_empty() {
            // Use wrapped command for better state detection via PTY monitoring
            if let Err(e) = self.tmux_client.run_command_wrapped(&target, command) {
                let mut state = self.state.write();
                state.set_error(format!("Failed to start agent: {}", e));
            }
        }

        // Close the create process popup
        {
            let mut state = self.state.write();
            state.cancel_create_process();
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
