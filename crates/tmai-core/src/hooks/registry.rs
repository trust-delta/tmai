//! Registry for hook-based agent state tracking.
//!
//! Mirrors the `IpcRegistry` pattern but stores `HookState` instead of `WrapState`.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;

use super::types::HookState;

/// Registry mapping pane_id → HookState (analogous to IpcRegistry)
pub type HookRegistry = Arc<RwLock<HashMap<String, HookState>>>;

/// Mapping of Claude Code session_id → pane_id for resolving hook events
pub type SessionPaneMap = Arc<RwLock<HashMap<String, String>>>;

/// Create a new empty HookRegistry
pub fn new_hook_registry() -> HookRegistry {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Create a new empty SessionPaneMap
pub fn new_session_pane_map() -> SessionPaneMap {
    Arc::new(RwLock::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hooks::types::HookStatus;

    #[test]
    fn test_hook_registry_crud() {
        let registry = new_hook_registry();

        // Insert
        {
            let mut reg = registry.write();
            reg.insert(
                "5".to_string(),
                HookState::new("sess-1".into(), Some("/tmp".into())),
            );
        }

        // Read
        {
            let reg = registry.read();
            let state = reg.get("5").unwrap();
            assert_eq!(state.status, HookStatus::Idle);
            assert_eq!(state.session_id, "sess-1");
        }

        // Remove
        {
            let mut reg = registry.write();
            reg.remove("5");
        }

        {
            let reg = registry.read();
            assert!(reg.get("5").is_none());
        }
    }

    #[test]
    fn test_session_pane_map() {
        let map = new_session_pane_map();

        {
            let mut m = map.write();
            m.insert("sess-abc".to_string(), "5".to_string());
        }

        {
            let m = map.read();
            assert_eq!(m.get("sess-abc").map(|s| s.as_str()), Some("5"));
        }
    }

    #[test]
    fn test_registry_shared_across_threads() {
        let registry = new_hook_registry();
        let registry_clone = registry.clone();

        let handle = std::thread::spawn(move || {
            let mut reg = registry_clone.write();
            reg.insert("10".to_string(), HookState::new("sess-2".into(), None));
        });

        handle.join().unwrap();

        let reg = registry.read();
        assert!(reg.contains_key("10"));
    }
}
