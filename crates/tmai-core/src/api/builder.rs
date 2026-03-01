//! Builder for constructing a [`TmaiCore`] instance.
//!
//! ```ignore
//! let core = TmaiCoreBuilder::new(settings)
//!     .with_state(state)
//!     .with_ipc_server(ipc)
//!     .with_command_sender(cmd)
//!     .build();
//! ```

use std::sync::Arc;

use crate::audit::AuditEventSender;
use crate::command_sender::CommandSender;
use crate::config::Settings;
use crate::hooks::registry::{HookRegistry, SessionPaneMap};
use crate::ipc::server::IpcServer;
use crate::state::{AppState, SharedState};

use super::core::TmaiCore;

/// Builder for constructing a [`TmaiCore`] Facade instance
pub struct TmaiCoreBuilder {
    settings: Arc<Settings>,
    state: Option<SharedState>,
    command_sender: Option<Arc<CommandSender>>,
    ipc_server: Option<Arc<IpcServer>>,
    audit_tx: Option<AuditEventSender>,
    hook_registry: Option<HookRegistry>,
    session_pane_map: Option<SessionPaneMap>,
    hook_token: Option<String>,
}

impl TmaiCoreBuilder {
    /// Create a new builder with the given settings
    pub fn new(settings: Settings) -> Self {
        Self {
            settings: Arc::new(settings),
            state: None,
            command_sender: None,
            ipc_server: None,
            audit_tx: None,
            hook_registry: None,
            session_pane_map: None,
            hook_token: None,
        }
    }

    /// Create a new builder from an already-shared settings
    pub fn from_shared_settings(settings: Arc<Settings>) -> Self {
        Self {
            settings,
            state: None,
            command_sender: None,
            ipc_server: None,
            audit_tx: None,
            hook_registry: None,
            session_pane_map: None,
            hook_token: None,
        }
    }

    /// Use an existing shared state instead of creating a new one
    pub fn with_state(mut self, state: SharedState) -> Self {
        self.state = Some(state);
        self
    }

    /// Set the IPC server for PTY wrapper communication
    pub fn with_ipc_server(mut self, ipc_server: Arc<IpcServer>) -> Self {
        self.ipc_server = Some(ipc_server);
        self
    }

    /// Set the command sender
    pub fn with_command_sender(mut self, sender: Arc<CommandSender>) -> Self {
        self.command_sender = Some(sender);
        self
    }

    /// Set the audit event sender for emitting audit events
    pub fn with_audit_sender(mut self, tx: AuditEventSender) -> Self {
        self.audit_tx = Some(tx);
        self
    }

    /// Set the hook registry for HTTP hook-based agent state
    pub fn with_hook_registry(mut self, registry: HookRegistry) -> Self {
        self.hook_registry = Some(registry);
        self
    }

    /// Set the session → pane ID mapping for hook event routing
    pub fn with_session_pane_map(mut self, map: SessionPaneMap) -> Self {
        self.session_pane_map = Some(map);
        self
    }

    /// Set the authentication token for hook endpoints
    pub fn with_hook_token(mut self, token: String) -> Self {
        self.hook_token = Some(token);
        self
    }

    /// Build the `TmaiCore` instance
    ///
    /// If no state was provided, a fresh `AppState::shared()` is created.
    /// If no hook registry/session_pane_map was provided, empty ones are created.
    pub fn build(self) -> TmaiCore {
        let state = self.state.unwrap_or_else(AppState::shared);
        let hook_registry = self
            .hook_registry
            .unwrap_or_else(crate::hooks::new_hook_registry);
        let session_pane_map = self
            .session_pane_map
            .unwrap_or_else(crate::hooks::new_session_pane_map);

        TmaiCore::new(
            state,
            self.command_sender,
            self.settings,
            self.ipc_server,
            self.audit_tx,
            hook_registry,
            session_pane_map,
            self.hook_token,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builder_defaults() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();

        assert_eq!(core.settings().poll_interval_ms, 500);
        assert!(core.ipc_server().is_none());
        assert!(core.command_sender_ref().is_none());
    }

    #[test]
    fn test_builder_with_state() {
        let state = AppState::shared();
        let state_clone = state.clone();

        let core = TmaiCoreBuilder::new(Settings::default())
            .with_state(state)
            .build();

        #[allow(deprecated)]
        let raw = core.raw_state();
        assert!(Arc::ptr_eq(raw, &state_clone));
    }

    #[test]
    fn test_builder_from_shared_settings() {
        let settings = Arc::new(Settings::default());
        let settings_clone = settings.clone();

        let core = TmaiCoreBuilder::from_shared_settings(settings).build();

        // Settings should be the same Arc
        assert_eq!(
            core.settings().poll_interval_ms,
            settings_clone.poll_interval_ms
        );
    }
}
