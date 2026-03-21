use anyhow::Result;
use std::sync::Arc;

use crate::hooks::registry::HookRegistry;
use crate::ipc::server::IpcServer;
use crate::runtime::RuntimeAdapter;
use crate::state::SharedState;

/// Unified command sender with 3-tier fallback: IPC → RuntimeAdapter (tmux) → PTY inject
///
/// Tier priority follows reliability:
/// - **IPC**: `tmai wrap` provides PTY master — most reliable
/// - **tmux send-keys**: tmux native mechanism — reliable when tmux is available
/// - **PTY inject**: TIOCSTI via `/proc/{pid}/fd/0` — last resort, requires kernel support
pub struct CommandSender {
    ipc_server: Option<Arc<IpcServer>>,
    runtime: Arc<dyn RuntimeAdapter>,
    app_state: SharedState,
    hook_registry: Option<HookRegistry>,
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
            hook_registry: None,
        }
    }

    /// Attach a HookRegistry for PTY injection PID resolution
    pub fn with_hook_registry(mut self, registry: HookRegistry) -> Self {
        self.hook_registry = Some(registry);
        self
    }

    /// Send keys via IPC → tmux send-keys → PTY inject
    pub fn send_keys(&self, target: &str, keys: &str) -> Result<()> {
        // Tier 1: IPC
        if let Some(ref ipc) = self.ipc_server {
            if let Some(pane_id) = self.get_pane_id_for_target(target) {
                if ipc.try_send_keys(&pane_id, keys, false) {
                    return Ok(());
                }
            }
        }
        // Tier 2: RuntimeAdapter (tmux send-keys)
        if self.runtime.send_keys(target, keys).is_ok() {
            return Ok(());
        }
        // Tier 3: PTY injection via /proc/{pid}/fd/0 (TIOCSTI)
        if let Some(pid) = self.resolve_pid_for_target(target) {
            if pid > 0 {
                return crate::pty_inject::inject_text(pid, keys);
            }
        }
        anyhow::bail!("All send_keys tiers failed for target {}", target)
    }

    /// Send literal keys via IPC → tmux send-keys → PTY inject
    pub fn send_keys_literal(&self, target: &str, keys: &str) -> Result<()> {
        // Tier 1: IPC
        if let Some(ref ipc) = self.ipc_server {
            if let Some(pane_id) = self.get_pane_id_for_target(target) {
                if ipc.try_send_keys(&pane_id, keys, true) {
                    return Ok(());
                }
            }
        }
        // Tier 2: RuntimeAdapter (tmux send-keys)
        if self.runtime.send_keys_literal(target, keys).is_ok() {
            return Ok(());
        }
        // Tier 3: PTY injection (literal text)
        if let Some(pid) = self.resolve_pid_for_target(target) {
            if pid > 0 {
                return crate::pty_inject::inject_text_literal(pid, keys);
            }
        }
        anyhow::bail!("All send_keys_literal tiers failed for target {}", target)
    }

    /// Send text + Enter via IPC → tmux send-keys → PTY inject
    pub fn send_text_and_enter(&self, target: &str, text: &str) -> Result<()> {
        // Tier 1: IPC
        if let Some(ref ipc) = self.ipc_server {
            if let Some(pane_id) = self.get_pane_id_for_target(target) {
                if ipc.try_send_keys_and_enter(&pane_id, text) {
                    return Ok(());
                }
            }
        }
        // Tier 2: RuntimeAdapter (tmux send-keys)
        if self.runtime.send_text_and_enter(target, text).is_ok() {
            return Ok(());
        }
        // Tier 3: PTY injection (text + Enter)
        if let Some(pid) = self.resolve_pid_for_target(target) {
            if pid > 0 {
                return crate::pty_inject::inject_text_and_enter(pid, text);
            }
        }
        anyhow::bail!("All send_text_and_enter tiers failed for target {}", target)
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

    /// Resolve the PID for a target agent via HookRegistry or AppState
    fn resolve_pid_for_target(&self, target: &str) -> Option<u32> {
        // Try HookRegistry: target → pane_id → HookState.pid
        if let Some(ref registry) = self.hook_registry {
            let pane_id = {
                let state = self.app_state.read();
                state.target_to_pane_id.get(target).cloned()
            };
            if let Some(pane_id) = pane_id {
                let reg = registry.read();
                if let Some(hook_state) = reg.get(&pane_id) {
                    if let Some(pid) = hook_state.pid {
                        return Some(pid);
                    }
                }
            }
        }

        // Fallback: check MonitoredAgent.pid in AppState
        let state = self.app_state.read();
        for agent in state.agents.values() {
            if agent.target == target && agent.pid > 0 {
                return Some(agent.pid);
            }
        }
        None
    }
}
