//! Runtime adapter abstraction for tmux decoupling.
//!
//! Provides [`RuntimeAdapter`] trait that abstracts agent discovery, observation,
//! and control. Two implementations:
//! - [`TmuxAdapter`]: wraps `TmuxClient` for traditional tmux-based operation
//! - [`StandaloneAdapter`]: hook/IPC-only mode, no tmux required

mod standalone;
mod tmux_adapter;

pub use standalone::StandaloneAdapter;
pub use tmux_adapter::TmuxAdapter;

use anyhow::Result;

use crate::tmux::PaneInfo;

/// Abstraction over the terminal multiplexer / process runtime.
///
/// Implementors provide agent discovery, screen observation, key control,
/// and optional session management. Methods are sync because `TmuxClient`
/// is subprocess-based (Poller already runs in a tokio blocking task).
pub trait RuntimeAdapter: Send + Sync {
    // =========================================================
    // Discovery
    // =========================================================

    /// List all panes/agents across all sessions (including detached).
    fn list_all_panes(&self) -> Result<Vec<PaneInfo>>;

    /// List panes from attached sessions only.
    fn list_panes(&self) -> Result<Vec<PaneInfo>>;

    /// List session names.
    fn list_sessions(&self) -> Result<Vec<String>>;

    /// Check if the runtime backend is available and operational.
    fn is_available(&self) -> bool;

    // =========================================================
    // Observation
    // =========================================================

    /// Capture pane content with ANSI escape codes (for preview rendering).
    fn capture_pane(&self, target: &str) -> Result<String>;

    /// Capture pane content as plain text (for detection analysis).
    fn capture_pane_plain(&self, target: &str) -> Result<String>;

    /// Get the title of a pane.
    fn get_pane_title(&self, target: &str) -> Result<String>;

    // =========================================================
    // Control
    // =========================================================

    /// Send interpreted keys to a pane (e.g., "Enter", "C-c").
    fn send_keys(&self, target: &str, keys: &str) -> Result<()>;

    /// Send literal text to a pane (no key interpretation).
    fn send_keys_literal(&self, target: &str, keys: &str) -> Result<()>;

    /// Send literal text followed by Enter.
    fn send_text_and_enter(&self, target: &str, text: &str) -> Result<()>;

    // =========================================================
    // Focus / Lifecycle
    // =========================================================

    /// Focus on a pane (bring to foreground in the runtime).
    fn focus_pane(&self, target: &str) -> Result<()>;

    /// Terminate a pane / agent process.
    fn kill_pane(&self, target: &str) -> Result<()>;

    // =========================================================
    // Session Management (optional capabilities)
    // =========================================================

    /// Create a new session. Not all runtimes support this.
    fn create_session(&self, _name: &str, _cwd: &str, _window_name: Option<&str>) -> Result<()> {
        anyhow::bail!("session creation not supported by {} runtime", self.name())
    }

    /// Create a new window in a session. Returns the new pane target.
    fn new_window(&self, _session: &str, _cwd: &str, _window_name: Option<&str>) -> Result<String> {
        anyhow::bail!("window creation not supported by {} runtime", self.name())
    }

    /// Split a window to create a new pane. Returns the new pane target.
    fn split_window(&self, _session: &str, _cwd: &str) -> Result<String> {
        anyhow::bail!("window splitting not supported by {} runtime", self.name())
    }

    /// Run a command in a pane (send text + Enter).
    fn run_command(&self, _target: &str, _command: &str) -> Result<()> {
        anyhow::bail!("command execution not supported by {} runtime", self.name())
    }

    /// Run a command wrapped with `tmai wrap` for PTY monitoring.
    fn run_command_wrapped(&self, _target: &str, _command: &str) -> Result<()> {
        anyhow::bail!("wrapped command not supported by {} runtime", self.name())
    }

    /// Get the user's current location (session name, window index).
    fn get_current_location(&self) -> Result<(String, u32)> {
        anyhow::bail!("current location not available in {} runtime", self.name())
    }

    // =========================================================
    // Metadata
    // =========================================================

    /// Runtime name for logging and display (e.g., "tmux", "standalone").
    fn name(&self) -> &str;
}
