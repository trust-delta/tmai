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

use crate::command_sender::CommandSender;
use crate::config::Settings;
use crate::ipc::server::IpcServer;
use crate::state::{AppState, SharedState};

use super::core::TmaiCore;

/// Builder for constructing a [`TmaiCore`] Facade instance
pub struct TmaiCoreBuilder {
    settings: Arc<Settings>,
    state: Option<SharedState>,
    command_sender: Option<Arc<CommandSender>>,
    ipc_server: Option<Arc<IpcServer>>,
}

impl TmaiCoreBuilder {
    /// Create a new builder with the given settings
    pub fn new(settings: Settings) -> Self {
        Self {
            settings: Arc::new(settings),
            state: None,
            command_sender: None,
            ipc_server: None,
        }
    }

    /// Create a new builder from an already-shared settings
    pub fn from_shared_settings(settings: Arc<Settings>) -> Self {
        Self {
            settings,
            state: None,
            command_sender: None,
            ipc_server: None,
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

    /// Build the `TmaiCore` instance
    ///
    /// If no state was provided, a fresh `AppState::shared()` is created.
    pub fn build(self) -> TmaiCore {
        let state = self.state.unwrap_or_else(AppState::shared);

        TmaiCore::new(state, self.command_sender, self.settings, self.ipc_server)
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
