use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;

use crate::codex_ws::CodexWsSender;
use crate::hooks::registry::HookRegistry;
use crate::ipc::server::IpcServer;
use crate::pty::registry::PtyRegistry;
use crate::runtime::RuntimeAdapter;
use crate::state::SharedState;
use crate::utils::keys::tmux_key_to_bytes;

/// Registry of CodexWsSender instances keyed by URL.
/// Used by CommandSender to route messages to the correct Codex WS connection.
pub type CodexWsSenderRegistry = Arc<parking_lot::RwLock<HashMap<String, CodexWsSender>>>;

/// Create a new CodexWsSenderRegistry from a map of senders
pub fn new_codex_ws_sender_registry(
    senders: &HashMap<String, CodexWsSender>,
) -> CodexWsSenderRegistry {
    Arc::new(parking_lot::RwLock::new(senders.clone()))
}

/// Dispatch variant for the 5-tier fallback — controls byte encoding and method selection per tier
enum SendVariant {
    /// tmux key names (e.g. "Enter", "C-c") → converted via tmux_key_to_bytes
    Keys,
    /// Literal text — raw bytes, no key name conversion
    KeysLiteral,
    /// Text followed by Enter (carriage return appended for PTY)
    TextAndEnter,
}

impl SendVariant {
    /// Convert payload to bytes for direct PTY session writes
    fn to_pty_bytes(&self, payload: &str) -> Vec<u8> {
        match self {
            SendVariant::Keys => tmux_key_to_bytes(payload),
            SendVariant::KeysLiteral => payload.as_bytes().to_vec(),
            SendVariant::TextAndEnter => {
                let mut data = payload.as_bytes().to_vec();
                data.push(b'\r');
                data
            }
        }
    }

    /// Human-readable name for error messages
    fn name(&self) -> &'static str {
        match self {
            SendVariant::Keys => "send_keys",
            SendVariant::KeysLiteral => "send_keys_literal",
            SendVariant::TextAndEnter => "send_text_and_enter",
        }
    }
}

/// Unified command sender with 5-tier fallback:
/// PTY session → Codex WebSocket → IPC → RuntimeAdapter (tmux) → PTY inject
///
/// Tier priority follows reliability:
/// - **PTY session**: Direct write to spawned PTY session — most reliable for WebUI-spawned agents
/// - **Codex WebSocket**: JSON-RPC turn/start for Codex CLI agents — structured bidirectional control
/// - **IPC**: `tmai wrap` provides PTY master — most reliable for wrapped agents
/// - **tmux send-keys**: tmux native mechanism — reliable when tmux is available
/// - **PTY inject**: TIOCSTI via `/proc/{pid}/fd/0` — last resort, requires kernel support
pub struct CommandSender {
    ipc_server: Option<Arc<IpcServer>>,
    runtime: Arc<dyn RuntimeAdapter>,
    app_state: SharedState,
    hook_registry: Option<HookRegistry>,
    pty_registry: Option<Arc<PtyRegistry>>,
    codex_ws_senders: Option<CodexWsSenderRegistry>,
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
            pty_registry: None,
            codex_ws_senders: None,
        }
    }

    /// Attach a HookRegistry for PTY injection PID resolution
    pub fn with_hook_registry(mut self, registry: HookRegistry) -> Self {
        self.hook_registry = Some(registry);
        self
    }

    /// Attach a PtyRegistry for direct PTY session writes
    pub fn with_pty_registry(mut self, registry: Arc<PtyRegistry>) -> Self {
        self.pty_registry = Some(registry);
        self
    }

    /// Attach Codex WebSocket senders for bidirectional Codex CLI control
    pub fn with_codex_ws_senders(mut self, senders: CodexWsSenderRegistry) -> Self {
        self.codex_ws_senders = Some(senders);
        self
    }

    /// Get the Codex WS sender registry (for direct approve/deny operations)
    pub fn codex_ws_senders(&self) -> Option<&CodexWsSenderRegistry> {
        self.codex_ws_senders.as_ref()
    }

    /// Try writing directly to a PTY session (for WebUI-spawned agents)
    fn try_pty_session_write(&self, target: &str, data: &[u8]) -> bool {
        if let Some(ref registry) = self.pty_registry {
            // target may be the session_id directly
            if let Some(session) = registry.get(target) {
                if session.is_running() {
                    return session.write_input(data).is_ok();
                }
            }
            // Also check via pty_session_id in agent state
            let session_id = {
                let state = self.app_state.read();
                state
                    .agents
                    .get(target)
                    .and_then(|a| a.pty_session_id.clone())
            };
            if let Some(sid) = session_id {
                if let Some(session) = registry.get(&sid) {
                    if session.is_running() {
                        return session.write_input(data).is_ok();
                    }
                }
            }
        }
        false
    }

    /// Send keys via PTY session → IPC → tmux send-keys → PTY inject
    pub fn send_keys(&self, target: &str, keys: &str) -> Result<()> {
        self.try_send_via_tiers(target, keys, SendVariant::Keys)
    }

    /// Send literal keys via PTY session → IPC → tmux send-keys → PTY inject
    pub fn send_keys_literal(&self, target: &str, keys: &str) -> Result<()> {
        self.try_send_via_tiers(target, keys, SendVariant::KeysLiteral)
    }

    /// Send text + Enter via PTY session → IPC → tmux send-keys → PTY inject
    pub fn send_text_and_enter(&self, target: &str, text: &str) -> Result<()> {
        self.try_send_via_tiers(target, text, SendVariant::TextAndEnter)
    }

    /// Generic 4-tier fallback: PTY session → IPC → RuntimeAdapter → PTY inject
    fn try_send_via_tiers(&self, target: &str, payload: &str, variant: SendVariant) -> Result<()> {
        // Tier 0: Direct PTY session write
        let pty_bytes = variant.to_pty_bytes(payload);
        if self.try_pty_session_write(target, &pty_bytes) {
            return Ok(());
        }
        // Tier 1: IPC
        if let Some(ref ipc) = self.ipc_server {
            if let Some(pane_id) = self.get_pane_id_for_target(target) {
                let ok = match variant {
                    SendVariant::Keys => ipc.try_send_keys(&pane_id, payload, false),
                    SendVariant::KeysLiteral => ipc.try_send_keys(&pane_id, payload, true),
                    SendVariant::TextAndEnter => ipc.try_send_keys_and_enter(&pane_id, payload),
                };
                if ok {
                    return Ok(());
                }
            }
        }
        // Tier 2: RuntimeAdapter (tmux send-keys)
        let runtime_result = match variant {
            SendVariant::Keys => self.runtime.send_keys(target, payload),
            SendVariant::KeysLiteral => self.runtime.send_keys_literal(target, payload),
            SendVariant::TextAndEnter => self.runtime.send_text_and_enter(target, payload),
        };
        if runtime_result.is_ok() {
            return Ok(());
        }
        // Tier 3: PTY injection via /proc/{pid}/fd/0
        if let Some(pid) = self.resolve_pid_for_target(target) {
            if pid > 0 {
                return match variant {
                    SendVariant::Keys => crate::pty_inject::inject_text(pid, payload),
                    SendVariant::KeysLiteral => {
                        crate::pty_inject::inject_text_literal(pid, payload)
                    }
                    SendVariant::TextAndEnter => {
                        crate::pty_inject::inject_text_and_enter(pid, payload)
                    }
                };
            }
        }
        anyhow::bail!("All {} tiers failed for target {}", variant.name(), target)
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

        // Fallback: check MonitoredAgent.pid in AppState (direct lookup by agent ID)
        let state = self.app_state.read();
        if let Some(agent) = state.agents.get(target) {
            if agent.pid > 0 {
                return Some(agent.pid);
            }
        }
        // Also try matching by target field (for tmux-based agents)
        for agent in state.agents.values() {
            if agent.target == target && agent.pid > 0 {
                return Some(agent.pid);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_variant_keys_converts_via_tmux_key_to_bytes() {
        let bytes = SendVariant::Keys.to_pty_bytes("Enter");
        assert_eq!(bytes, tmux_key_to_bytes("Enter"));
    }

    #[test]
    fn send_variant_keys_literal_uses_raw_bytes() {
        let bytes = SendVariant::KeysLiteral.to_pty_bytes("hello");
        assert_eq!(bytes, b"hello");
    }

    #[test]
    fn send_variant_text_and_enter_appends_cr() {
        let bytes = SendVariant::TextAndEnter.to_pty_bytes("ls");
        assert_eq!(bytes, b"ls\r");
    }

    #[test]
    fn send_variant_names() {
        assert_eq!(SendVariant::Keys.name(), "send_keys");
        assert_eq!(SendVariant::KeysLiteral.name(), "send_keys_literal");
        assert_eq!(SendVariant::TextAndEnter.name(), "send_text_and_enter");
    }

    #[test]
    fn all_tiers_fail_returns_descriptive_error() {
        use crate::runtime::StandaloneAdapter;
        use crate::state::AppState;
        use parking_lot::RwLock;

        let state: SharedState = Arc::new(RwLock::new(AppState::default()));
        let runtime: Arc<dyn RuntimeAdapter> = Arc::new(StandaloneAdapter::new());
        let sender = CommandSender::new(None, runtime, state);

        let err = sender.send_keys("no-such-target", "Enter").unwrap_err();
        assert!(err.to_string().contains("send_keys"));
        assert!(err.to_string().contains("no-such-target"));

        let err = sender.send_keys_literal("no-such-target", "x").unwrap_err();
        assert!(err.to_string().contains("send_keys_literal"));

        let err = sender
            .send_text_and_enter("no-such-target", "echo hi")
            .unwrap_err();
        assert!(err.to_string().contains("send_text_and_enter"));
    }
}
