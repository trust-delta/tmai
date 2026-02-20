use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::agents::AgentType;
use crate::audit::helper::AuditHelper;
use crate::audit::{AuditEvent, AuditEventSender};
use crate::command_sender::CommandSender;
use crate::config::Settings;
use crate::demo::poller::{DemoAction, DemoPoller};
use crate::ipc::server::IpcServer;
use crate::monitor::{PollMessage, Poller};
use crate::state::{
    AppState, ConfirmAction, CreateProcessStep, DirItem, PlacementType, SharedState, TreeEntry,
};
use crate::tmux::TmuxClient;

use super::key_handler::{self, KeyAction};

use super::components::{
    ConfirmationPopup, CreateProcessPopup, HelpScreen, InputWidget, ListEntry, PanePreview,
    QrScreen, SessionList, StatusBar, TaskOverlay, TeamOverview,
};
use super::Layout;

/// Main application
pub struct App {
    state: SharedState,
    settings: Settings,
    command_sender: CommandSender,
    layout: Layout,
    /// Helper for emitting audit events
    audit_helper: AuditHelper,
    /// Receiver passed to Poller on start (consumed once)
    audit_event_rx: Option<tokio::sync::mpsc::UnboundedReceiver<AuditEvent>>,
    /// Debounce: last passthrough audit emission per target
    audit_last_passthrough: std::collections::HashMap<String, std::time::Instant>,
    /// Sender for demo actions (only set in demo mode)
    demo_action_tx: Option<mpsc::Sender<DemoAction>>,
}

impl App {
    /// Create a new application
    pub fn new(
        settings: Settings,
        ipc_server: Option<Arc<IpcServer>>,
        audit_tx: Option<AuditEventSender>,
        audit_event_rx: Option<tokio::sync::mpsc::UnboundedReceiver<AuditEvent>>,
    ) -> Self {
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.show_activity_name = settings.ui.show_activity_name;
        }
        let tmux_client = TmuxClient::with_capture_lines(settings.capture_lines);
        let command_sender = CommandSender::new(ipc_server, tmux_client, state.clone());
        let audit_helper = AuditHelper::new(audit_tx, state.clone());
        let layout = Layout::new().with_preview_height(settings.ui.preview_height);

        Self {
            state,
            settings,
            command_sender,
            layout,
            audit_helper,
            audit_event_rx,
            audit_last_passthrough: std::collections::HashMap::new(),
            demo_action_tx: None,
        }
    }

    /// Get a clone of the shared state
    pub fn shared_state(&self) -> SharedState {
        self.state.clone()
    }

    /// Run the application
    pub async fn run(&mut self) -> Result<()> {
        // Check if tmux is available
        if !self.command_sender.tmux_client().is_available() {
            anyhow::bail!("tmux is not running or not available");
        }

        // Capture current location for scope filtering display
        if let Ok((session, window)) = self.command_sender.tmux_client().get_current_location() {
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
        let ipc_registry = self
            .command_sender
            .ipc_server()
            .map(|s| s.registry())
            .unwrap_or_else(|| {
                Arc::new(parking_lot::RwLock::new(std::collections::HashMap::new()))
            });
        let poller = Poller::new(
            self.settings.clone(),
            self.state.clone(),
            ipc_registry,
            self.audit_event_rx.take(),
        );
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

    /// Run the application in demo mode (no tmux required)
    pub async fn run_demo(&mut self) -> Result<()> {
        // Pre-populate state with demo agents so they appear on the first frame
        {
            let initial_agents = DemoPoller::build_initial_agents();
            let mut state = self.state.write();
            state.current_session = Some("demo".to_string());
            state.update_agents(initial_agents);
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

        // Start demo poller
        let (demo_poller, action_tx) = DemoPoller::new(self.state.clone());
        self.demo_action_tx = Some(action_tx);
        let mut poll_rx = demo_poller.start();

        // Main loop (shared with normal mode)
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
                let (selectable_count, agent_index) = {
                    let state = self.state.read();
                    let (_, _, count, idx) = SessionList::build_entries(&state);
                    (count, idx)
                };
                let mut state = self.state.write();
                state.update_selectable_entries(selectable_count, agent_index);
            }

            // Draw UI
            terminal.draw(|frame| {
                let state = self.state.read();

                // Full-screen help mode
                if state.view.show_help {
                    HelpScreen::render(frame, frame.area(), &state);
                    return;
                }

                // QR code screen (overlay popup)
                if state.view.show_qr {
                    QrScreen::render(frame, frame.area(), &state);
                    return;
                }

                // Team overview (full-screen, like help)
                if state.view.show_team_overview {
                    TeamOverview::render(frame, frame.area(), &state);
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

                // Task overlay popup
                if state.view.show_task_overlay {
                    TaskOverlay::render(frame, frame.area(), &state);
                }
            })?;

            // Tick spinner and marquee animations
            {
                let mut state = self.state.write();
                state.tick_spinner();
                state.tick_marquee();
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
            show_task_overlay,
            show_team_overview,
            is_input_mode,
            is_passthrough_mode,
            is_create_process_mode,
            is_showing_confirmation,
        ) = {
            let state = self.state.read();
            (
                state.view.show_help,
                state.view.show_qr,
                state.view.show_task_overlay,
                state.view.show_team_overview,
                state.is_input_mode(),
                state.is_passthrough_mode(),
                state.is_create_process_mode(),
                state.is_showing_confirmation(),
            )
        };

        // Normalize full-width ASCII to half-width for shortcut modes.
        // Skip for passthrough (direct terminal input) and input mode (text entry).
        let code = if is_passthrough_mode || is_input_mode {
            code
        } else {
            key_handler::normalize_keycode(code)
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

        // Handle task overlay
        if show_task_overlay {
            return self.handle_task_overlay_key(code);
        }

        // Handle team overview
        if show_team_overview {
            return self.handle_team_overview_key(code, modifiers);
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
        match code {
            // === Arms that need CommandSender (KeyAction pattern) ===

            // Number selection (for AskUserQuestion, skip for virtual agents)
            // Full-width digits are normalized to half-width before reaching here
            KeyCode::Char(c) if matches!(c, '1'..='9') => {
                let num = key_handler::char_to_digit(c);
                let result = {
                    let state = self.state.read();
                    key_handler::resolve_number_selection(&state, num)
                };
                self.execute_key_action(result.action)?;
                if result.enter_input_mode {
                    self.state.write().enter_input_mode();
                }
            }

            // Space key for toggle in multi-select UserQuestion
            KeyCode::Char(' ') => {
                let result = {
                    let state = self.state.read();
                    key_handler::resolve_space_toggle(&state)
                };
                self.execute_key_action(result.action)?;
                if result.enter_input_mode {
                    self.state.write().enter_input_mode();
                }
            }

            // Approval key (y) / Rejection key (n)
            KeyCode::Char('y') | KeyCode::Char('n') => {
                let key = if code == KeyCode::Char('y') { 'y' } else { 'n' };
                let action = {
                    let state = self.state.read();
                    key_handler::resolve_yes_no(&state, key)
                };
                self.execute_key_action(action)?;
            }

            // Enter key - handle CreateNew, GroupHeader, or multi-select submit
            KeyCode::Enter => {
                // First check for CreateNew / GroupHeader (needs mut state + tmux)
                let entry_action = {
                    let state = self.state.read();
                    match SessionList::get_selected_entry(&state) {
                        Some(ListEntry::CreateNew { group_key }) => Some((true, group_key.clone())),
                        Some(ListEntry::GroupHeader { key, .. }) => Some((false, key.clone())),
                        _ => None,
                    }
                };
                if let Some((is_create, key)) = entry_action {
                    let mut state = self.state.write();
                    if is_create {
                        let panes = self
                            .command_sender
                            .tmux_client()
                            .list_all_panes()
                            .unwrap_or_default();
                        state.start_create_process(key, panes, &self.settings.create_process);
                    } else {
                        state.toggle_group_collapse(&key);
                    }
                    return Ok(());
                }

                // Multi-select submit or audit
                let action = {
                    let state = self.state.read();
                    key_handler::resolve_enter_submit(&state)
                };
                self.execute_key_action(action)?;
            }

            // Focus pane (skip for virtual agents)
            KeyCode::Char('f') => {
                let action = {
                    let state = self.state.read();
                    key_handler::resolve_focus_pane(&state)
                };
                self.execute_key_action(action)?;
            }

            // === Arms that only need state mutation (simple write lock) ===

            // Quit
            KeyCode::Char('q') | KeyCode::Esc => {
                self.state.write().quit();
            }

            // Enter input mode (requires a real agent selected)
            KeyCode::Char('i') | KeyCode::Char('/') => {
                let mut state = self.state.write();
                if !state.selection.is_on_create_new
                    && state.selected_agent().is_some_and(|a| !a.is_virtual)
                {
                    state.enter_input_mode();
                }
            }

            // Note: 'o' key for "Other" input removed — use input mode ('i') or
            // Space on "Type something" to enter text input instead.

            // Navigation
            KeyCode::Char('j') | KeyCode::Down => self.state.write().select_next(),
            KeyCode::Char('k') | KeyCode::Up => self.state.write().select_previous(),
            KeyCode::Char('g') => self.state.write().select_first(),
            KeyCode::Char('G') => self.state.write().select_last(),

            // Preview scroll
            KeyCode::Char('d') if modifiers.contains(KeyModifiers::CONTROL) => {
                self.state.write().scroll_preview_down(10);
            }
            KeyCode::Char('u') if modifiers.contains(KeyModifiers::CONTROL) => {
                self.state.write().scroll_preview_up(10);
            }

            // Cycle view mode (Both -> AgentsOnly -> PreviewOnly)
            KeyCode::Tab => self.layout.cycle_view_mode(),

            // Toggle split direction (Horizontal <-> Vertical)
            KeyCode::Char('l') => self.layout.toggle_split_direction(),

            // Sort/scope cycling temporarily disabled
            KeyCode::Char('s') | KeyCode::Char('m') => {}

            // Enter passthrough mode (requires a real agent selected)
            KeyCode::Char('p') | KeyCode::Right => {
                let mut state = self.state.write();
                if !state.selection.is_on_create_new
                    && state.selected_agent().is_some_and(|a| !a.is_virtual)
                {
                    state.enter_passthrough_mode();
                }
            }

            // Help
            KeyCode::Char('h') | KeyCode::Char('?') => self.state.write().toggle_help(),

            // QR code screen
            KeyCode::Char('r') => self.state.write().toggle_qr(),

            // Kill pane (with confirmation, skip for virtual agents)
            KeyCode::Char('x') => {
                let mut state = self.state.write();
                if let Some(agent) = state.selected_agent() {
                    if !agent.is_virtual {
                        let target = agent.target.clone();
                        state.show_confirmation(
                            ConfirmAction::KillPane {
                                target: target.clone(),
                            },
                            format!("Kill pane {}?", target),
                        );
                    }
                }
            }

            // Task overlay (only if selected agent has team_info)
            KeyCode::Char('t') => {
                let mut state = self.state.write();
                let has_team = state
                    .selected_agent()
                    .is_some_and(|a| a.team_info.is_some());
                if has_team {
                    state.view.show_task_overlay = !state.view.show_task_overlay;
                    if state.view.show_task_overlay {
                        state.view.task_overlay_scroll = 0;
                    }
                }
            }

            // Team overview (Shift+T)
            KeyCode::Char('T') => {
                let mut state = self.state.write();
                state.view.show_team_overview = !state.view.show_team_overview;
                if state.view.show_team_overview {
                    state.view.team_overview_scroll = 0;
                }
            }

            _ => {}
        }

        Ok(())
    }

    /// Execute a KeyAction from the key handler (called after state lock is released)
    fn execute_key_action(&self, action: KeyAction) -> Result<()> {
        // Demo mode intercept: translate key actions into DemoActions
        if let Some(ref tx) = self.demo_action_tx {
            match &action {
                KeyAction::SendKeys { target, keys } if keys.contains('y') => {
                    let _ = tx.try_send(DemoAction::Approve {
                        target: target.clone(),
                    });
                    return Ok(());
                }
                KeyAction::SendKeys { target, keys } if keys.contains('n') => {
                    let _ = tx.try_send(DemoAction::Reject {
                        target: target.clone(),
                    });
                    return Ok(());
                }
                KeyAction::NavigateSelection {
                    target, confirm, ..
                } if *confirm => {
                    let _ = tx.try_send(DemoAction::SelectChoice {
                        target: target.clone(),
                        choice_num: 1,
                    });
                    return Ok(());
                }
                // In demo mode, skip actions that require tmux (FocusPane, SendKeysLiteral, etc.)
                KeyAction::FocusPane { .. }
                | KeyAction::EmitAudit { .. }
                | KeyAction::SendKeysLiteral { .. }
                | KeyAction::MultiSelectSubmit { .. }
                | KeyAction::MultiSelectSubmitTab { .. } => return Ok(()),
                KeyAction::None => return Ok(()),
                // For NavigateSelection without confirm (just number key → selection), send SelectChoice
                KeyAction::NavigateSelection { target, .. } => {
                    // Number key press resolves as NavigateSelection; extract choice from steps
                    let _ = tx.try_send(DemoAction::SelectChoice {
                        target: target.clone(),
                        choice_num: 1,
                    });
                    return Ok(());
                }
                _ => return Ok(()),
            }
        }

        match action {
            KeyAction::None => {}
            KeyAction::SendKeys { target, keys } => {
                let _ = self.command_sender.send_keys(&target, &keys);
            }
            KeyAction::SendKeysLiteral { target, keys } => {
                let _ = self.command_sender.send_keys_literal(&target, &keys);
            }
            KeyAction::MultiSelectSubmit {
                target,
                downs_needed,
            } => {
                for _ in 0..downs_needed {
                    let _ = self.command_sender.send_keys(&target, "Down");
                }
                let _ = self.command_sender.send_keys(&target, "Enter");
            }
            KeyAction::MultiSelectSubmitTab { target } => {
                let _ = self.command_sender.send_keys(&target, "Right");
                let _ = self.command_sender.send_keys(&target, "Enter");
            }
            KeyAction::NavigateSelection {
                target,
                steps,
                confirm,
            } => {
                let key = if steps > 0 { "Down" } else { "Up" };
                for _ in 0..steps.unsigned_abs() {
                    let _ = self.command_sender.send_keys(&target, key);
                }
                if confirm {
                    let _ = self.command_sender.send_keys(&target, "Enter");
                }
            }
            KeyAction::FocusPane { target } => {
                let _ = self.command_sender.tmux_client().focus_pane(&target);
            }
            KeyAction::EmitAudit { target, action } => {
                self.maybe_emit_normal_audit(&target, &action);
            }
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
        let (input, target) = {
            let mut state = self.state.write();
            let input = state.take_input();
            let target = state.selected_target().map(|s| s.to_string());
            state.exit_input_mode();
            (input, target)
        };

        if !input.is_empty() {
            if let Some(ref target) = target {
                // Send text as literal (preserves special characters)
                self.command_sender.send_keys_literal(target, &input)?;
                // Brief delay so Enter arrives in a separate PTY read() from the text.
                // Without this, Claude Code (ink) treats the burst as paste and Enter = newline.
                std::thread::sleep(std::time::Duration::from_millis(50));
                // Send Enter to submit
                self.command_sender.send_keys(target, "Enter")?;
                // Audit: check for potential false negative
                self.audit_helper
                    .maybe_emit_input(target, "input_text", "tui_input_mode", None);
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
                            if let Err(e) = self.command_sender.tmux_client().kill_pane(&target) {
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
                state.view.show_qr = false;
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
                state.view.show_help = false;
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
                state.view.help_scroll = 0;
            }
            // Jump to bottom
            KeyCode::Char('G') => {
                state.view.help_scroll = u16::MAX; // Will be clamped in render
            }
            _ => {}
        }

        Ok(())
    }

    /// Handle keys in task overlay mode
    fn handle_task_overlay_key(&mut self, code: KeyCode) -> Result<()> {
        match code {
            // Close task overlay
            KeyCode::Char('t') | KeyCode::Esc => {
                let mut state = self.state.write();
                state.view.show_task_overlay = false;
            }
            // Scroll down
            KeyCode::Char('j') | KeyCode::Down => {
                let mut state = self.state.write();
                state.view.task_overlay_scroll = state.view.task_overlay_scroll.saturating_add(1);
            }
            // Scroll up
            KeyCode::Char('k') | KeyCode::Up => {
                let mut state = self.state.write();
                state.view.task_overlay_scroll = state.view.task_overlay_scroll.saturating_sub(1);
            }
            // Jump to top
            KeyCode::Char('g') => {
                let mut state = self.state.write();
                state.view.task_overlay_scroll = 0;
            }
            // Jump to bottom
            KeyCode::Char('G') => {
                let mut state = self.state.write();
                state.view.task_overlay_scroll = u16::MAX;
            }
            _ => {}
        }
        Ok(())
    }

    /// Handle keys in team overview mode
    fn handle_team_overview_key(&mut self, code: KeyCode, modifiers: KeyModifiers) -> Result<()> {
        let mut state = self.state.write();

        match code {
            // Close team overview
            KeyCode::Char('T') | KeyCode::Esc => {
                state.view.show_team_overview = false;
            }
            // Scroll down
            KeyCode::Char('j') | KeyCode::Down => {
                state.view.team_overview_scroll = state.view.team_overview_scroll.saturating_add(1);
            }
            // Scroll up
            KeyCode::Char('k') | KeyCode::Up => {
                state.view.team_overview_scroll = state.view.team_overview_scroll.saturating_sub(1);
            }
            // Page down
            KeyCode::Char('d') if modifiers.contains(KeyModifiers::CONTROL) => {
                state.view.team_overview_scroll =
                    state.view.team_overview_scroll.saturating_add(10);
            }
            KeyCode::PageDown => {
                state.view.team_overview_scroll =
                    state.view.team_overview_scroll.saturating_add(10);
            }
            // Page up
            KeyCode::Char('u') if modifiers.contains(KeyModifiers::CONTROL) => {
                state.view.team_overview_scroll =
                    state.view.team_overview_scroll.saturating_sub(10);
            }
            KeyCode::PageUp => {
                state.view.team_overview_scroll =
                    state.view.team_overview_scroll.saturating_sub(10);
            }
            // Jump to top
            KeyCode::Char('g') => {
                state.view.team_overview_scroll = 0;
            }
            // Jump to bottom
            KeyCode::Char('G') => {
                state.view.team_overview_scroll = u16::MAX; // Will be clamped in render
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
                    self.command_sender
                        .send_keys_literal(&target, &c.to_string())?;
                    // Audit: log interaction keys before early return (y/Y, digits)
                    if matches!(c, 'y' | 'Y' | 'ｙ' | 'Ｙ' | '1'..='9' | '１'..='９') {
                        self.maybe_emit_passthrough_audit(&target);
                    }
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
        let _ = self.command_sender.send_keys(&target, &key_str);

        // Audit: log Enter key (y/digits handled above before early return)
        if code == KeyCode::Enter {
            self.maybe_emit_passthrough_audit(&target);
        }
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
                // Read the current DirItem at cursor position
                let dir_item = {
                    let state = self.state.read();
                    let cs = state.create_process.as_ref().unwrap();
                    cs.directory_items.get(cs.cursor).cloned()
                };

                match dir_item {
                    Some(DirItem::EnterPath) => {
                        // Switch to input mode
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            cs.is_input_mode = true;
                        }
                    }
                    Some(DirItem::Home) => {
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
                    Some(DirItem::Current) => {
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
                    Some(DirItem::Directory { path, .. }) => {
                        let mut state = self.state.write();
                        if let Some(ref mut cs) = state.create_process {
                            cs.directory = Some(path);
                            cs.step = CreateProcessStep::SelectAgent;
                            cs.cursor = 0;
                        }
                    }
                    Some(DirItem::Header(_)) | None => {
                        // Header or out-of-bounds: do nothing
                    }
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
        let window_name = agent_type.command();
        let target = match placement_type {
            PlacementType::NewSession => {
                // Generate unique session name
                // Get existing tmux session names for collision check
                let existing_sessions = self
                    .command_sender
                    .tmux_client()
                    .list_sessions()
                    .unwrap_or_default();
                let session_name = crate::utils::namegen::generate_unique_name(&existing_sessions);
                if let Err(e) = self.command_sender.tmux_client().create_session(
                    &session_name,
                    &directory,
                    Some(window_name),
                ) {
                    let mut state = self.state.write();
                    state.set_error(format!("Failed to create session: {}", e));
                    state.cancel_create_process();
                    return Ok(());
                }
                // New session starts with window 0, pane 0
                format!("{}:0.0", session_name)
            }
            PlacementType::NewWindow => match self.command_sender.tmux_client().new_window(
                &session,
                &directory,
                Some(window_name),
            ) {
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
                match self
                    .command_sender
                    .tmux_client()
                    .split_window(&pane, &directory)
                {
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
            if let Err(e) = self
                .command_sender
                .tmux_client()
                .run_command_wrapped(&target, command)
            {
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

    /// Emit a passthrough audit event with debounce (max once per 5 seconds per target)
    fn maybe_emit_passthrough_audit(&mut self, target: &str) {
        if !self.audit_helper.is_enabled() {
            return;
        }

        let now = std::time::Instant::now();
        if let Some(last) = self.audit_last_passthrough.get(target) {
            if now.duration_since(*last) < Duration::from_secs(5) {
                return;
            }
        }
        self.audit_last_passthrough.insert(target.to_string(), now);
        self.audit_helper
            .maybe_emit_input(target, "passthrough_key", "tui_passthrough", None);
    }

    /// Emit audit event for normal-mode interaction keys (y, numbers, Enter)
    /// No debounce — each press is a deliberate interaction attempt
    fn maybe_emit_normal_audit(&self, target: &str, action: &str) {
        self.audit_helper
            .maybe_emit_input(target, action, "tui_normal_mode", None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_creation() {
        let settings = Settings::default();
        let _app = App::new(settings, None, None, None);
    }
}
