use anyhow::Result;
use std::sync::Arc;

use crate::ipc::server::IpcServer;
use crate::runtime::RuntimeAdapter;
use crate::state::SharedState;

/// Unified command sender that tries IPC first, falls back to runtime adapter
pub struct CommandSender {
    ipc_server: Option<Arc<IpcServer>>,
    runtime: Arc<dyn RuntimeAdapter>,
    app_state: SharedState,
}

impl CommandSender {
    /// Create a new CommandSender
    pub fn new(
        ipc_server: Option<Arc<IpcServer>>,
        runtime: Arc<dyn RuntimeAdapter>,
        app_state: SharedState,
    ) -> Self {
        Self {
            ipc_server,
            runtime,
            app_state,
        }
    }

    /// Send keys via IPC if connected, otherwise via runtime adapter
    pub fn send_keys(&self, target: &str, keys: &str) -> Result<()> {
        if let Some(ref ipc) = self.ipc_server {
            if let Some(pane_id) = self.get_pane_id_for_target(target) {
                if ipc.try_send_keys(&pane_id, keys, false) {
                    return Ok(());
                }
            }
        }
        self.runtime.send_keys(target, keys)
    }

    /// Send literal keys via IPC if connected, otherwise via runtime adapter
    pub fn send_keys_literal(&self, target: &str, keys: &str) -> Result<()> {
        if let Some(ref ipc) = self.ipc_server {
            if let Some(pane_id) = self.get_pane_id_for_target(target) {
                if ipc.try_send_keys(&pane_id, keys, true) {
                    return Ok(());
                }
            }
        }
        self.runtime.send_keys_literal(target, keys)
    }

    /// Send text + Enter via IPC if connected, otherwise via runtime adapter
    pub fn send_text_and_enter(&self, target: &str, text: &str) -> Result<()> {
        if let Some(ref ipc) = self.ipc_server {
            if let Some(pane_id) = self.get_pane_id_for_target(target) {
                if ipc.try_send_keys_and_enter(&pane_id, text) {
                    return Ok(());
                }
            }
        }
        self.runtime.send_text_and_enter(target, text)
    }

    /// Access the runtime adapter for direct operations (focus_pane, kill_pane, etc.)
    pub fn runtime(&self) -> &Arc<dyn RuntimeAdapter> {
        &self.runtime
    }

    /// Access the IPC server (needed for Poller registry)
    pub fn ipc_server(&self) -> Option<&Arc<IpcServer>> {
        self.ipc_server.as_ref()
    }

    /// Look up pane_id from target using the mapping in AppState
    fn get_pane_id_for_target(&self, target: &str) -> Option<String> {
        let state = self.app_state.read();
        state.target_to_pane_id.get(target).cloned()
    }
}
