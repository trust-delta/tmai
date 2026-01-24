use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::agents::ApprovalType;
use crate::config::Settings;
use crate::detectors::get_detector;
use crate::monitor::{PollMessage, Poller};
use crate::state::{AppState, SharedState};
use crate::tmux::TmuxClient;

use super::components::{HelpPopup, PanePreview, SelectionPopup, SessionList, StatusBar};
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

            // Draw UI
            terminal.draw(|frame| {
                let state = self.state.read();
                let areas = self.layout.calculate(frame.area());

                // Render main components
                SessionList::render(frame, areas.session_list, &state);

                if let Some(preview_area) = areas.preview {
                    PanePreview::render(frame, preview_area, &state);
                }

                StatusBar::render(frame, areas.status_bar, &state);

                // Render popups
                if state.show_help {
                    let popup_area = self.layout.popup_area(frame.area(), 60, 70);
                    HelpPopup::render(frame, popup_area);
                }

                // Selection popup for AskUserQuestion
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
            })?;

            // Handle events with timeout
            if event::poll(Duration::from_millis(50))? {
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
        let mut state = self.state.write();

        // Handle help popup
        if state.show_help {
            state.show_help = false;
            return Ok(());
        }

        match code {
            // Quit
            KeyCode::Char('q') | KeyCode::Esc => {
                state.quit();
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
                    // Check if it's a UserQuestion and get choice count
                    let choice_count = state.agents.get(&target).and_then(|agent| {
                        if let crate::agents::AgentStatus::AwaitingApproval {
                            approval_type: ApprovalType::UserQuestion { choices, .. },
                            ..
                        } = &agent.status
                        {
                            Some(choices.len())
                        } else {
                            None
                        }
                    });

                    if let Some(count) = choice_count {
                        if num <= count {
                            drop(state);
                            // Navigate to the option and select
                            // First, send up arrows to go to first option, then down to desired
                            for _ in 0..count {
                                let _ = self.tmux_client.send_keys(&target, "Up");
                            }
                            for _ in 1..num {
                                let _ = self.tmux_client.send_keys(&target, "Down");
                            }
                            let _ = self.tmux_client.send_keys(&target, "Enter");
                        }
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

            // Help
            KeyCode::Char('?') => {
                state.toggle_help();
            }

            _ => {}
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
