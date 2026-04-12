//! TmuxAdapter — delegates all RuntimeAdapter methods to TmuxClient.
//!
//! This is the default runtime for TUI mode. It wraps the existing
//! `TmuxClient` with zero behavioral change.

use anyhow::Result;

use super::RuntimeAdapter;
use crate::tmux::{PaneInfo, PaneView, TmuxClient};

/// RuntimeAdapter implementation backed by tmux.
pub struct TmuxAdapter {
    client: TmuxClient,
}

impl TmuxAdapter {
    /// Create a new TmuxAdapter with the given capture line count.
    pub fn new(capture_lines: u32) -> Self {
        Self {
            client: TmuxClient::with_capture_lines(capture_lines),
        }
    }
}

impl RuntimeAdapter for TmuxAdapter {
    // --- Discovery ---

    fn list_all_panes(&self) -> Result<Vec<PaneInfo>> {
        self.client.list_all_panes()
    }

    fn list_panes(&self) -> Result<Vec<PaneInfo>> {
        self.client.list_panes()
    }

    fn list_sessions(&self) -> Result<Vec<String>> {
        self.client.list_sessions()
    }

    fn is_available(&self) -> bool {
        self.client.is_available()
    }

    // --- Observation ---

    fn capture_pane(&self, target: &str) -> Result<String> {
        self.client.capture_pane(target)
    }

    fn capture_pane_full(&self, target: &str) -> Result<String> {
        self.client.capture_pane_full(target)
    }

    fn capture_pane_plain(&self, target: &str) -> Result<String> {
        self.client.capture_pane_plain(target)
    }

    fn get_pane_title(&self, target: &str) -> Result<String> {
        self.client.get_pane_title(target)
    }

    fn get_cursor_position(&self, target: &str) -> Result<Option<(u32, u32)>> {
        self.client.get_cursor_position(target).map(Some)
    }

    fn get_pane_view_info(&self, target: &str) -> Result<Option<PaneView>> {
        self.client.get_pane_view_info(target).map(Some)
    }

    // --- Control ---

    fn send_keys(&self, target: &str, keys: &str) -> Result<()> {
        self.client.send_keys(target, keys)
    }

    fn send_keys_literal(&self, target: &str, keys: &str) -> Result<()> {
        self.client.send_keys_literal(target, keys)
    }

    fn send_text_and_enter(&self, target: &str, text: &str) -> Result<()> {
        self.client.send_text_and_enter(target, text)
    }

    // --- Focus / Lifecycle ---

    fn focus_pane(&self, target: &str) -> Result<()> {
        self.client.focus_pane(target)
    }

    fn kill_pane(&self, target: &str) -> Result<()> {
        self.client.kill_pane(target)
    }

    fn kill_pane_by_id(&self, pane_id: &str) -> Result<()> {
        self.client.kill_pane_by_id(pane_id)
    }

    // --- Session Management ---

    fn create_session(&self, name: &str, cwd: &str, window_name: Option<&str>) -> Result<()> {
        self.client.create_session(name, cwd, window_name)
    }

    fn new_window(&self, session: &str, cwd: &str, window_name: Option<&str>) -> Result<String> {
        self.client.new_window(session, cwd, window_name)
    }

    fn split_window(&self, session: &str, cwd: &str) -> Result<String> {
        self.client.split_window(session, cwd)
    }

    fn split_window_tiled(&self, session: &str, cwd: &str) -> Result<String> {
        self.client.split_window_tiled(session, cwd)
    }

    fn select_layout(&self, target: &str, layout: &str) -> Result<()> {
        self.client.select_layout(target, layout)
    }

    fn count_panes(&self, target: &str) -> Result<usize> {
        self.client.count_panes(target)
    }

    fn run_command(&self, target: &str, command: &str) -> Result<()> {
        self.client.run_command(target, command)
    }

    fn run_command_wrapped(&self, target: &str, command: &str) -> Result<()> {
        self.client.run_command_wrapped(target, command)
    }

    fn get_current_location(&self) -> Result<(String, u32)> {
        self.client.get_current_location()
    }

    // --- Metadata ---

    fn name(&self) -> &str {
        "tmux"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tmux_adapter_creation() {
        let adapter = TmuxAdapter::new(200);
        assert_eq!(adapter.name(), "tmux");
    }
}
