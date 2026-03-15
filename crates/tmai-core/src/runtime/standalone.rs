//! StandaloneAdapter — hook/IPC-only runtime, no tmux required.
//!
//! Agents are registered via hook SessionStart events and unregistered
//! on SessionEnd. Discovery returns the internal agent registry.
//! Screen observation returns empty content (hooks provide status directly).
//! Control methods return errors (IPC handles control as primary path).

use anyhow::Result;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use super::RuntimeAdapter;
use crate::tmux::PaneInfo;

/// RuntimeAdapter for standalone (web-only) mode without tmux.
///
/// Agents are tracked via an internal registry populated by hook events.
/// Synthetic targets use the format `standalone:0.{id}` to satisfy
/// the `session:window.pane` pattern used throughout the codebase.
pub struct StandaloneAdapter {
    /// Registered agents keyed by session_id (from hook events)
    agents: Arc<RwLock<HashMap<String, PaneInfo>>>,
    /// Counter for generating unique pane indices
    next_id: AtomicU32,
}

impl StandaloneAdapter {
    /// Create a new empty StandaloneAdapter.
    pub fn new() -> Self {
        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
            next_id: AtomicU32::new(1),
        }
    }

    /// Register an agent from a hook SessionStart event.
    ///
    /// Creates a synthetic `PaneInfo` with a `standalone:0.{id}` target.
    /// Returns the generated target identifier.
    pub fn register_agent(
        &self,
        session_id: &str,
        cwd: &str,
        title: &str,
        command: &str,
        pid: u32,
    ) -> String {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let target = format!("standalone:0.{}", id);
        let pane_id = id.to_string();

        let pane = PaneInfo {
            target: target.clone(),
            session: "standalone".to_string(),
            window_index: 0,
            pane_index: id,
            pane_id,
            window_name: command.to_string(),
            command: command.to_string(),
            pid,
            title: title.to_string(),
            cwd: cwd.to_string(),
        };

        let mut agents = self.agents.write();
        agents.insert(session_id.to_string(), pane);
        target
    }

    /// Unregister an agent (hook SessionEnd event).
    pub fn unregister_agent(&self, session_id: &str) {
        let mut agents = self.agents.write();
        agents.remove(session_id);
    }

    /// Update agent metadata (cwd, title) from hook events.
    pub fn update_agent(&self, session_id: &str, cwd: Option<&str>, title: Option<&str>) {
        let mut agents = self.agents.write();
        if let Some(pane) = agents.get_mut(session_id) {
            if let Some(cwd) = cwd {
                pane.cwd = cwd.to_string();
            }
            if let Some(title) = title {
                pane.title = title.to_string();
            }
        }
    }

    /// Look up the synthetic target for a session_id.
    pub fn target_for_session(&self, session_id: &str) -> Option<String> {
        let agents = self.agents.read();
        agents.get(session_id).map(|p| p.target.clone())
    }

    /// Get a reference to the agent registry (for testing).
    pub fn agent_count(&self) -> usize {
        self.agents.read().len()
    }
}

impl Default for StandaloneAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeAdapter for StandaloneAdapter {
    // --- Discovery ---

    fn list_all_panes(&self) -> Result<Vec<PaneInfo>> {
        let agents = self.agents.read();
        Ok(agents.values().cloned().collect())
    }

    fn list_panes(&self) -> Result<Vec<PaneInfo>> {
        // Standalone has no concept of attached/detached; return all
        self.list_all_panes()
    }

    fn list_sessions(&self) -> Result<Vec<String>> {
        let agents = self.agents.read();
        if agents.is_empty() {
            Ok(vec![])
        } else {
            Ok(vec!["standalone".to_string()])
        }
    }

    fn is_available(&self) -> bool {
        // Standalone is always available (no external dependency)
        true
    }

    // --- Observation ---

    fn capture_pane(&self, _target: &str) -> Result<String> {
        // No screen capture in standalone mode; hooks provide status directly
        Ok(String::new())
    }

    fn capture_pane_plain(&self, _target: &str) -> Result<String> {
        Ok(String::new())
    }

    fn get_pane_title(&self, target: &str) -> Result<String> {
        let agents = self.agents.read();
        for pane in agents.values() {
            if pane.target == target {
                return Ok(pane.title.clone());
            }
        }
        Ok(String::new())
    }

    // --- Control ---

    fn send_keys(&self, _target: &str, _keys: &str) -> Result<()> {
        // In standalone mode, IPC is the primary control path.
        // If IPC fails, there is no tmux fallback.
        anyhow::bail!("send_keys not available in standalone mode (use IPC)")
    }

    fn send_keys_literal(&self, _target: &str, _keys: &str) -> Result<()> {
        anyhow::bail!("send_keys_literal not available in standalone mode (use IPC)")
    }

    fn send_text_and_enter(&self, _target: &str, _text: &str) -> Result<()> {
        anyhow::bail!("send_text_and_enter not available in standalone mode (use IPC)")
    }

    // --- Focus / Lifecycle ---

    fn focus_pane(&self, _target: &str) -> Result<()> {
        anyhow::bail!("focus_pane not available in standalone mode")
    }

    fn kill_pane(&self, _target: &str) -> Result<()> {
        anyhow::bail!("kill_pane not available in standalone mode")
    }

    // --- Metadata ---

    fn name(&self) -> &str {
        "standalone"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_standalone_creation() {
        let adapter = StandaloneAdapter::new();
        assert_eq!(adapter.name(), "standalone");
        assert!(adapter.is_available());
    }

    #[test]
    fn test_register_and_list() {
        let adapter = StandaloneAdapter::new();

        let target =
            adapter.register_agent("sess-1", "/home/user/project", "Working", "claude", 1234);
        assert!(target.starts_with("standalone:0."));

        let panes = adapter.list_all_panes().unwrap();
        assert_eq!(panes.len(), 1);
        assert_eq!(panes[0].cwd, "/home/user/project");
        assert_eq!(panes[0].command, "claude");
        assert_eq!(panes[0].pid, 1234);
    }

    #[test]
    fn test_register_multiple_and_unregister() {
        let adapter = StandaloneAdapter::new();

        adapter.register_agent("sess-1", "/path/a", "A", "claude", 100);
        adapter.register_agent("sess-2", "/path/b", "B", "codex", 200);
        assert_eq!(adapter.agent_count(), 2);

        adapter.unregister_agent("sess-1");
        assert_eq!(adapter.agent_count(), 1);

        let panes = adapter.list_all_panes().unwrap();
        assert_eq!(panes[0].command, "codex");
    }

    #[test]
    fn test_update_agent() {
        let adapter = StandaloneAdapter::new();
        adapter.register_agent("sess-1", "/old/path", "Old Title", "claude", 100);

        adapter.update_agent("sess-1", Some("/new/path"), Some("New Title"));

        let panes = adapter.list_all_panes().unwrap();
        assert_eq!(panes[0].cwd, "/new/path");
        assert_eq!(panes[0].title, "New Title");
    }

    #[test]
    fn test_target_for_session() {
        let adapter = StandaloneAdapter::new();
        assert!(adapter.target_for_session("nonexistent").is_none());

        let target = adapter.register_agent("sess-1", "/path", "T", "claude", 100);
        assert_eq!(adapter.target_for_session("sess-1"), Some(target));
    }

    #[test]
    fn test_observation_returns_empty() {
        let adapter = StandaloneAdapter::new();
        assert_eq!(adapter.capture_pane("standalone:0.1").unwrap(), "");
        assert_eq!(adapter.capture_pane_plain("standalone:0.1").unwrap(), "");
    }

    #[test]
    fn test_control_methods_error() {
        let adapter = StandaloneAdapter::new();
        assert!(adapter.send_keys("standalone:0.1", "Enter").is_err());
        assert!(adapter
            .send_keys_literal("standalone:0.1", "hello")
            .is_err());
        assert!(adapter
            .send_text_and_enter("standalone:0.1", "hello")
            .is_err());
        assert!(adapter.focus_pane("standalone:0.1").is_err());
        assert!(adapter.kill_pane("standalone:0.1").is_err());
    }

    #[test]
    fn test_session_management_not_supported() {
        let adapter = StandaloneAdapter::new();
        assert!(adapter.create_session("test", "/tmp", None).is_err());
        assert!(adapter.new_window("test", "/tmp", None).is_err());
        assert!(adapter.split_window("test", "/tmp").is_err());
        assert!(adapter.get_current_location().is_err());
    }

    #[test]
    fn test_list_sessions_empty_and_nonempty() {
        let adapter = StandaloneAdapter::new();
        assert!(adapter.list_sessions().unwrap().is_empty());

        adapter.register_agent("sess-1", "/path", "T", "claude", 100);
        let sessions = adapter.list_sessions().unwrap();
        assert_eq!(sessions, vec!["standalone"]);
    }

    #[test]
    fn test_get_pane_title_from_registry() {
        let adapter = StandaloneAdapter::new();
        let target = adapter.register_agent("sess-1", "/path", "My Title", "claude", 100);
        assert_eq!(adapter.get_pane_title(&target).unwrap(), "My Title");
        assert_eq!(adapter.get_pane_title("nonexistent:0.99").unwrap(), "");
    }
}
