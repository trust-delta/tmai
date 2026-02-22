//! TmaiCore — the Facade entry-point for all consumers (TUI, Web, MCP, etc.)
//!
//! This struct owns every shared service and exposes high-level methods.
//! Consumers never need to acquire locks or wire services themselves.

use std::sync::Arc;

use tokio::sync::broadcast;

use crate::command_sender::CommandSender;
use crate::config::Settings;
use crate::ipc::server::IpcServer;
use crate::state::SharedState;

use super::events::CoreEvent;

/// Default broadcast channel capacity
const EVENT_CHANNEL_CAPACITY: usize = 256;

/// The Facade that wraps all tmai-core services.
///
/// Constructed via [`TmaiCoreBuilder`](super::builder::TmaiCoreBuilder).
pub struct TmaiCore {
    /// Shared application state (agents, teams, UI state)
    state: SharedState,
    /// Unified command sender (IPC + tmux fallback)
    command_sender: Option<Arc<CommandSender>>,
    /// Application settings
    settings: Arc<Settings>,
    /// IPC server for PTY wrapper communication
    ipc_server: Option<Arc<IpcServer>>,
    /// Broadcast sender for core events
    event_tx: broadcast::Sender<CoreEvent>,
}

impl TmaiCore {
    /// Create a new TmaiCore instance (prefer `TmaiCoreBuilder`)
    pub(crate) fn new(
        state: SharedState,
        command_sender: Option<Arc<CommandSender>>,
        settings: Arc<Settings>,
        ipc_server: Option<Arc<IpcServer>>,
    ) -> Self {
        let (event_tx, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            state,
            command_sender,
            settings,
            ipc_server,
            event_tx,
        }
    }

    // =========================================================
    // Escape hatches — for gradual migration from raw state access
    // =========================================================

    /// Access the raw shared state.
    ///
    /// **Deprecated**: prefer using typed query/action methods on `TmaiCore`.
    /// This escape hatch exists for incremental migration only.
    #[deprecated(note = "Use TmaiCore query/action methods instead of direct state access")]
    pub fn raw_state(&self) -> &SharedState {
        &self.state
    }

    /// Access the raw command sender.
    ///
    /// **Deprecated**: prefer using action methods on `TmaiCore`.
    /// This escape hatch exists for incremental migration only.
    #[deprecated(note = "Use TmaiCore action methods instead of direct CommandSender access")]
    pub fn raw_command_sender(&self) -> Option<&Arc<CommandSender>> {
        self.command_sender.as_ref()
    }

    /// Access application settings (read-only)
    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    /// Access the IPC server (if configured)
    pub fn ipc_server(&self) -> Option<&Arc<IpcServer>> {
        self.ipc_server.as_ref()
    }

    /// Get a clone of the broadcast event sender.
    ///
    /// Used internally by the poll bridge to emit events.
    pub(crate) fn event_sender(&self) -> broadcast::Sender<CoreEvent> {
        self.event_tx.clone()
    }

    // =========================================================
    // Internal accessors for query/action impls
    // =========================================================

    /// Borrow the shared state (for query/action modules)
    pub(crate) fn state(&self) -> &SharedState {
        &self.state
    }

    /// Borrow the command sender (for action modules in Phase 3)
    #[allow(dead_code)]
    pub(crate) fn command_sender_ref(&self) -> Option<&Arc<CommandSender>> {
        self.command_sender.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn test_tmai_core_creation() {
        let state = AppState::shared();
        let settings = Arc::new(Settings::default());
        let core = TmaiCore::new(state, None, settings.clone(), None);

        assert_eq!(core.settings().poll_interval_ms, 500);
        assert!(core.ipc_server().is_none());
        assert!(core.command_sender_ref().is_none());
    }

    #[test]
    #[allow(deprecated)]
    fn test_escape_hatches() {
        let state = AppState::shared();
        let settings = Arc::new(Settings::default());
        let core = TmaiCore::new(state.clone(), None, settings, None);

        // raw_state should return the same Arc
        let raw = core.raw_state();
        assert!(Arc::ptr_eq(raw, &state));

        // raw_command_sender should be None
        assert!(core.raw_command_sender().is_none());
    }
}
