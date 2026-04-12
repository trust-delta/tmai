use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;

use crate::api::ActionOrigin;
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

    /// Send keys with an `ActionOrigin`. When the origin is `Human`, stamps
    /// `last_human_input_at` on the target agent so the orchestrator
    /// notifier can defer auto-injection while the operator is composing
    /// input (#399). Non-Human origins behave identically to `send_keys`.
    pub fn send_keys_with_origin(
        &self,
        target: &str,
        keys: &str,
        origin: &ActionOrigin,
    ) -> Result<()> {
        self.maybe_stamp_human_input(target, origin);
        self.send_keys(target, keys)
    }

    /// Origin-aware counterpart of `send_keys_literal`. See
    /// `send_keys_with_origin` for the "typing marker" semantics (#399).
    pub fn send_keys_literal_with_origin(
        &self,
        target: &str,
        keys: &str,
        origin: &ActionOrigin,
    ) -> Result<()> {
        self.maybe_stamp_human_input(target, origin);
        self.send_keys_literal(target, keys)
    }

    /// Origin-aware counterpart of `send_text_and_enter`. See
    /// `send_keys_with_origin` for the "typing marker" semantics (#399).
    pub fn send_text_and_enter_with_origin(
        &self,
        target: &str,
        text: &str,
        origin: &ActionOrigin,
    ) -> Result<()> {
        self.maybe_stamp_human_input(target, origin);
        self.send_text_and_enter(target, text)
    }

    /// Stamp `last_human_input_at` on the agent matching `target` iff the
    /// originating action is `ActionOrigin::Human`. Agent-originated and
    /// System-originated sends must NOT stamp — otherwise the notifier's
    /// auto-injection would be self-suppressing.
    fn maybe_stamp_human_input(&self, target: &str, origin: &ActionOrigin) {
        if !matches!(origin, ActionOrigin::Human { .. }) {
            return;
        }
        let mut state = self.app_state.write();
        if let Some(agent) = state.agents.get_mut(target) {
            agent.note_human_input();
            return;
        }
        // Fallback: match by tmux target field (when the caller passed a
        // tmux-style "session:win.pane" that isn't the agent map key).
        for agent in state.agents.values_mut() {
            if agent.target == target {
                agent.note_human_input();
                return;
            }
        }
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
    fn send_variant_keys_literal_preserves_newlines() {
        // Multi-line content must not be converted into multiple Enters — the
        // caller is responsible for appending Enter explicitly when submitting.
        let payload = "line1\nline2\n```\nfn main() {}\n```";
        let bytes = SendVariant::KeysLiteral.to_pty_bytes(payload);
        assert_eq!(bytes, payload.as_bytes());
    }

    #[test]
    fn send_variant_text_and_enter_single_trailing_cr_for_multiline() {
        // Exactly one trailing \r is appended, regardless of embedded newlines.
        let payload = "line1\nline2";
        let bytes = SendVariant::TextAndEnter.to_pty_bytes(payload);
        assert_eq!(bytes, b"line1\nline2\r");
        assert_eq!(bytes.iter().filter(|&&b| b == b'\r').count(), 1);
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

    /// Build a CommandSender wired to a fresh AppState containing one agent
    /// whose map key equals `target`. Used by the "typing marker" tests.
    fn sender_with_agent(target: &str) -> (CommandSender, SharedState) {
        use crate::agents::{AgentType, MonitoredAgent};
        use crate::runtime::StandaloneAdapter;
        use crate::state::AppState;
        use parking_lot::RwLock;

        let state: SharedState = Arc::new(RwLock::new(AppState::default()));
        {
            let mut s = state.write();
            let agent = MonitoredAgent::new(
                target.to_string(),
                AgentType::ClaudeCode,
                String::new(),
                "/tmp".to_string(),
                0,
                target.to_string(),
                String::new(),
                0,
                0,
            );
            s.agents.insert(target.to_string(), agent);
        }
        let runtime: Arc<dyn RuntimeAdapter> = Arc::new(StandaloneAdapter::new());
        let sender = CommandSender::new(None, runtime, state.clone());
        (sender, state)
    }

    #[test]
    fn human_origin_stamps_last_human_input_at() {
        // Human-originated send marks the agent as "operator is typing".
        let (sender, state) = sender_with_agent("orch:0.0");
        let origin = ActionOrigin::webui();
        // Send fails (no tiers wired) — but stamping runs regardless.
        let _ = sender.send_keys_literal_with_origin("orch:0.0", "hello", &origin);

        let s = state.read();
        let agent = s.agents.get("orch:0.0").expect("agent present");
        assert!(
            agent.last_human_input_at.is_some(),
            "Human origin must stamp last_human_input_at"
        );
        assert!(
            agent.is_operator_typing(std::time::Duration::from_secs(5)),
            "freshly stamped agent must be within typing grace"
        );
    }

    #[test]
    fn agent_origin_does_not_stamp_last_human_input_at() {
        // Agent-originated sends (tmai auto-injection) must NOT stamp the
        // typing marker — otherwise the notifier would self-suppress every
        // subsequent auto-injection.
        let (sender, state) = sender_with_agent("orch:0.0");
        let origin = ActionOrigin::agent("orchestrator", true);
        let _ = sender.send_keys_literal_with_origin("orch:0.0", "hello", &origin);

        let s = state.read();
        let agent = s.agents.get("orch:0.0").expect("agent present");
        assert!(
            agent.last_human_input_at.is_none(),
            "Agent origin must not stamp last_human_input_at"
        );
    }

    #[test]
    fn system_origin_does_not_stamp_last_human_input_at() {
        let (sender, state) = sender_with_agent("orch:0.0");
        let origin = ActionOrigin::system("pr_monitor");
        let _ = sender.send_keys_with_origin("orch:0.0", "Enter", &origin);

        let s = state.read();
        let agent = s.agents.get("orch:0.0").expect("agent present");
        assert!(agent.last_human_input_at.is_none());
    }

    #[test]
    fn stamp_falls_back_to_tmux_target_match() {
        // The agent map key ("orch:0.0") differs from the tmux target the
        // caller passes ("main:1.2"). The stamping fallback must match via
        // `agent.target`, so WebUI passthrough (which resolves to the tmux
        // target) still stamps the correct agent.
        use crate::agents::{AgentType, MonitoredAgent};
        use crate::runtime::StandaloneAdapter;
        use crate::state::AppState;
        use parking_lot::RwLock;

        let state: SharedState = Arc::new(RwLock::new(AppState::default()));
        {
            let mut s = state.write();
            let mut agent = MonitoredAgent::new(
                "main:1.2".to_string(),
                AgentType::ClaudeCode,
                String::new(),
                "/tmp".to_string(),
                0,
                "main".to_string(),
                String::new(),
                1,
                2,
            );
            agent.target = "main:1.2".to_string();
            s.agents.insert("orch:0.0".to_string(), agent);
        }
        let runtime: Arc<dyn RuntimeAdapter> = Arc::new(StandaloneAdapter::new());
        let sender = CommandSender::new(None, runtime, state.clone());

        let _ = sender.send_keys_literal_with_origin("main:1.2", "a", &ActionOrigin::webui());

        let s = state.read();
        let agent = s.agents.get("orch:0.0").expect("agent present");
        assert!(
            agent.last_human_input_at.is_some(),
            "stamping must find agent by tmux target field when map key differs"
        );
    }
}
