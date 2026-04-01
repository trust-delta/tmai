//! TmaiCore — the Facade entry-point for all consumers (TUI, Web, MCP, etc.)
//!
//! This struct owns every shared service and exposes high-level methods.
//! Consumers never need to acquire locks or wire services themselves.

use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::broadcast;

use crate::audit::helper::AuditHelper;
use crate::audit::AuditEventSender;
use crate::command_sender::CommandSender;
use crate::config::Settings;
use crate::hooks::registry::{HookRegistry, SessionPaneMap};
use crate::ipc::server::IpcServer;
use crate::pty::PtyRegistry;
use crate::runtime::RuntimeAdapter;
use crate::state::SharedState;
use crate::transcript::TranscriptRegistry;

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
    /// Application settings (hot-reloadable via `reload_settings()`)
    settings: RwLock<Arc<Settings>>,
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
    /// PTY session registry for spawned agents
    pty_registry: Arc<PtyRegistry>,
    /// Runtime adapter (tmux, standalone, etc.)
    runtime: Option<Arc<dyn RuntimeAdapter>>,
    /// Transcript registry for JSONL conversation log monitoring
    transcript_registry: Option<TranscriptRegistry>,
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
        pty_registry: Arc<PtyRegistry>,
        runtime: Option<Arc<dyn RuntimeAdapter>>,
        transcript_registry: Option<TranscriptRegistry>,
    ) -> Self {
        let (event_tx, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let audit_helper = AuditHelper::new(audit_tx, state.clone());
        Self {
            state,
            command_sender,
            settings: RwLock::new(settings),
            ipc_server,
            event_tx,
            audit_helper,
            hook_registry,
            session_pane_map,
            hook_token,
            pty_registry,
            runtime,
            transcript_registry,
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

    /// Access application settings (read-only snapshot)
    ///
    /// Returns a cheap `Arc` clone. The underlying settings can be
    /// hot-reloaded via [`reload_settings()`](Self::reload_settings).
    pub fn settings(&self) -> Arc<Settings> {
        self.settings.read().clone()
    }

    /// Re-read `config.toml` and replace the live settings.
    ///
    /// Called after PUT `/api/settings/*` handlers persist changes to disk.
    /// Returns `true` if the reload succeeded.
    pub fn reload_settings(&self) -> bool {
        match Settings::load(None) {
            Ok(new_settings) => {
                *self.settings.write() = Arc::new(new_settings);
                tracing::debug!("Settings reloaded from config.toml");
                true
            }
            Err(e) => {
                tracing::warn!(%e, "Failed to reload settings from config.toml");
                false
            }
        }
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

    /// Get the hook token (if configured)
    pub fn hook_token(&self) -> Option<&str> {
        self.hook_token.as_deref()
    }

    /// Access the PTY session registry
    pub fn pty_registry(&self) -> &Arc<PtyRegistry> {
        &self.pty_registry
    }

    /// Access the runtime adapter (if set)
    pub fn runtime(&self) -> Option<&Arc<dyn RuntimeAdapter>> {
        self.runtime.as_ref()
    }

    /// Access the transcript registry (if configured)
    pub fn transcript_registry(&self) -> Option<&TranscriptRegistry> {
        self.transcript_registry.as_ref()
    }

    /// Direct write access to settings (for testing)
    #[cfg(test)]
    pub(crate) fn settings_mut(&self) -> parking_lot::RwLockWriteGuard<'_, Arc<Settings>> {
        self.settings.write()
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
                let mut result: usize = expected_bytes.len() ^ token_bytes.len();
                for i in 0..expected_bytes.len() {
                    let token_byte = if i < token_bytes.len() {
                        token_bytes[i]
                    } else {
                        // Use a value that will never match to avoid short-circuit
                        0xFF
                    };
                    result |= (expected_bytes[i] ^ token_byte) as usize;
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
            crate::pty::PtyRegistry::new(),
            None,
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
            crate::pty::PtyRegistry::new(),
            None,
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
            crate::pty::PtyRegistry::new(),
            None,
            None,
        );

        assert!(core.validate_hook_token("test-token-123"));
        assert!(!core.validate_hook_token("wrong-token"));
    }

    #[test]
    fn test_settings_returns_arc_clone() {
        let mut custom = Settings::default();
        custom.poll_interval_ms = 1234;
        let core = crate::api::TmaiCoreBuilder::new(custom).build();

        let s1 = core.settings();
        let s2 = core.settings();
        assert_eq!(s1.poll_interval_ms, 1234);
        assert_eq!(s2.poll_interval_ms, 1234);
        // Both should point to the same underlying allocation
        assert!(Arc::ptr_eq(&s1, &s2));
    }

    #[test]
    fn test_reload_settings_with_tempdir() {
        // Create a temp config file with a custom poll_interval_ms
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.toml");
        std::fs::write(&config_path, "poll_interval_ms = 999\n").unwrap();

        let initial = Settings::load(Some(&config_path)).unwrap();
        assert_eq!(initial.poll_interval_ms, 999);

        let core = crate::api::TmaiCoreBuilder::new(initial).build();
        assert_eq!(core.settings().poll_interval_ms, 999);

        // Modify config on disk
        std::fs::write(&config_path, "poll_interval_ms = 2000\n").unwrap();

        // reload_settings() reads from the default config path, not our temp file,
        // so we test the mechanism indirectly: verify settings() returns an Arc
        // and that the RwLock swap works by calling the internal write path.
        {
            let new_settings = Settings::load(Some(&config_path)).unwrap();
            assert_eq!(new_settings.poll_interval_ms, 2000);
            *core.settings_mut() = Arc::new(new_settings);
        }
        assert_eq!(core.settings().poll_interval_ms, 2000);
    }
}
