//! TmaiCore — the Facade entry-point for all consumers (TUI, Web, MCP, etc.)
//!
//! This struct owns every shared service and exposes high-level methods.
//! Consumers never need to acquire locks or wire services themselves.

use std::sync::Arc;

use tokio::sync::broadcast;

use crate::audit::helper::AuditHelper;
use crate::audit::AuditEventSender;
use crate::command_sender::CommandSender;
use crate::config::Settings;
use crate::hooks::registry::{HookRegistry, SessionPaneMap};
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
    /// Audit helper for emitting user-input-during-processing events
    audit_helper: AuditHelper,
    /// Hook registry for HTTP hook-based agent state
    hook_registry: HookRegistry,
    /// Session ID → pane ID mapping for hook event routing
    session_pane_map: SessionPaneMap,
    /// Authentication token for hook endpoints
    hook_token: Option<String>,
}

impl TmaiCore {
    /// Create a new TmaiCore instance (prefer `TmaiCoreBuilder`)
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        state: SharedState,
        command_sender: Option<Arc<CommandSender>>,
        settings: Arc<Settings>,
        ipc_server: Option<Arc<IpcServer>>,
        audit_tx: Option<AuditEventSender>,
        hook_registry: HookRegistry,
        session_pane_map: SessionPaneMap,
        hook_token: Option<String>,
    ) -> Self {
        let (event_tx, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let audit_helper = AuditHelper::new(audit_tx, state.clone());
        Self {
            state,
            command_sender,
            settings,
            ipc_server,
            event_tx,
            audit_helper,
            hook_registry,
            session_pane_map,
            hook_token,
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
    /// Used by the Poller to emit TeammateIdle/TaskCompleted events,
    /// and by the SSE handler to subscribe to events.
    pub fn event_sender(&self) -> broadcast::Sender<CoreEvent> {
        self.event_tx.clone()
    }

    // =========================================================
    // Internal accessors for query/action impls
    // =========================================================

    /// Borrow the shared state (for query/action modules)
    pub(crate) fn state(&self) -> &SharedState {
        &self.state
    }

    /// Borrow the command sender (for action modules)
    pub(crate) fn command_sender_ref(&self) -> Option<&Arc<CommandSender>> {
        self.command_sender.as_ref()
    }

    /// Borrow the audit helper (for action modules)
    pub(crate) fn audit_helper(&self) -> &AuditHelper {
        &self.audit_helper
    }

    // =========================================================
    // Hook accessors
    // =========================================================

    /// Access the hook registry for HTTP hook-based agent state
    pub fn hook_registry(&self) -> &HookRegistry {
        &self.hook_registry
    }

    /// Access the session → pane ID mapping
    pub fn session_pane_map(&self) -> &SessionPaneMap {
        &self.session_pane_map
    }

    /// Validate a hook authentication token (constant-time comparison)
    pub fn validate_hook_token(&self, token: &str) -> bool {
        match &self.hook_token {
            Some(expected) => {
                // Constant-time comparison to prevent timing side-channel attacks.
                // We always iterate over the expected token length to avoid
                // leaking length information via timing.
                let expected_bytes = expected.as_bytes();
                let token_bytes = token.as_bytes();
                let mut result = (expected_bytes.len() ^ token_bytes.len()) as u8;
                for i in 0..expected_bytes.len() {
                    let token_byte = if i < token_bytes.len() {
                        token_bytes[i]
                    } else {
                        // Use a value that will never match to avoid short-circuit
                        0xFF
                    };
                    result |= expected_bytes[i] ^ token_byte;
                }
                result == 0
            }
            None => false,
        }
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
        let hook_registry = crate::hooks::new_hook_registry();
        let session_pane_map = crate::hooks::new_session_pane_map();
        let core = TmaiCore::new(
            state,
            None,
            settings.clone(),
            None,
            None,
            hook_registry,
            session_pane_map,
            None,
        );

        assert_eq!(core.settings().poll_interval_ms, 500);
        assert!(core.ipc_server().is_none());
        assert!(core.command_sender_ref().is_none());
    }

    #[test]
    #[allow(deprecated)]
    fn test_escape_hatches() {
        let state = AppState::shared();
        let settings = Arc::new(Settings::default());
        let hook_registry = crate::hooks::new_hook_registry();
        let session_pane_map = crate::hooks::new_session_pane_map();
        let core = TmaiCore::new(
            state.clone(),
            None,
            settings,
            None,
            None,
            hook_registry,
            session_pane_map,
            None,
        );

        // raw_state should return the same Arc
        let raw = core.raw_state();
        assert!(Arc::ptr_eq(raw, &state));

        // raw_command_sender should be None
        assert!(core.raw_command_sender().is_none());
    }

    #[test]
    fn test_hook_token_validation() {
        let state = AppState::shared();
        let settings = Arc::new(Settings::default());
        let hook_registry = crate::hooks::new_hook_registry();
        let session_pane_map = crate::hooks::new_session_pane_map();
        let core = TmaiCore::new(
            state,
            None,
            settings,
            None,
            None,
            hook_registry,
            session_pane_map,
            Some("test-token-123".to_string()),
        );

        assert!(core.validate_hook_token("test-token-123"));
        assert!(!core.validate_hook_token("wrong-token"));
    }
}
