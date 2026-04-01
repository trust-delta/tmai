//! Deferred tool call registry for hook-based auto-approve.
//!
//! When a PreToolUse hook returns `defer`, Claude Code pauses the tool call
//! and waits for the hook HTTP response to complete. This module tracks
//! pending deferred calls and provides resolution channels so the HTTP
//! handler can block until the call is resolved (by AI judge or human review).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;
use serde::Serialize;
use tokio::sync::oneshot;

use super::types::PermissionDecision;

/// Monotonically increasing ID generator for deferred calls
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// A tool call that has been deferred for external resolution
#[derive(Debug, Clone, Serialize)]
pub struct DeferredToolCall {
    /// Unique identifier for this deferred call
    pub id: u64,
    /// Session ID from Claude Code
    pub session_id: String,
    /// Resolved pane ID (for UI display)
    pub pane_id: String,
    /// Tool name (e.g., "Bash", "Edit", "Write")
    pub tool_name: String,
    /// Tool input parameters (structured JSON)
    pub tool_input: Option<serde_json::Value>,
    /// Working directory of the agent
    pub cwd: Option<String>,
    /// When the call was deferred
    #[serde(skip)]
    pub deferred_at: Instant,
    /// How long the call has been pending (in milliseconds, computed on serialization)
    pub pending_ms: u64,
}

/// Resolution for a deferred tool call
#[derive(Debug, Clone)]
pub struct DeferResolution {
    /// The permission decision (Allow or Deny)
    pub decision: PermissionDecision,
    /// Reason for the decision
    pub reason: String,
    /// Source of resolution (e.g., "ai:haiku", "human", "timeout")
    pub resolved_by: String,
}

/// Internal entry in the registry, pairing metadata with resolution channel
struct DeferEntry {
    /// Metadata about the deferred call (for API queries)
    call: DeferredToolCall,
    /// Oneshot sender to unblock the HTTP handler
    tx: Option<oneshot::Sender<DeferResolution>>,
}

/// Thread-safe registry for pending deferred tool calls
pub struct DeferRegistry {
    entries: RwLock<HashMap<u64, DeferEntry>>,
}

impl DeferRegistry {
    /// Create a new empty registry
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            entries: RwLock::new(HashMap::new()),
        })
    }

    /// Register a new deferred tool call and return (id, receiver).
    ///
    /// The caller should await the receiver to block until the call is resolved.
    pub fn defer(
        &self,
        session_id: String,
        pane_id: String,
        tool_name: String,
        tool_input: Option<serde_json::Value>,
        cwd: Option<String>,
    ) -> (u64, oneshot::Receiver<DeferResolution>) {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();

        let call = DeferredToolCall {
            id,
            session_id,
            pane_id,
            tool_name,
            tool_input,
            cwd,
            deferred_at: Instant::now(),
            pending_ms: 0,
        };

        self.entries
            .write()
            .insert(id, DeferEntry { call, tx: Some(tx) });

        (id, rx)
    }

    /// Resolve a deferred tool call by ID.
    ///
    /// Returns `true` if the call was found and resolved.
    pub fn resolve(&self, id: u64, resolution: DeferResolution) -> bool {
        let mut entries = self.entries.write();
        if let Some(entry) = entries.remove(&id) {
            if let Some(tx) = entry.tx {
                let _ = tx.send(resolution);
            }
            true
        } else {
            false
        }
    }

    /// List all pending deferred tool calls (with updated pending_ms)
    pub fn list_pending(&self) -> Vec<DeferredToolCall> {
        let entries = self.entries.read();
        entries
            .values()
            .map(|entry| {
                let mut call = entry.call.clone();
                call.pending_ms = call.deferred_at.elapsed().as_millis() as u64;
                call
            })
            .collect()
    }

    /// Get a specific deferred call by ID (with updated pending_ms)
    pub fn get(&self, id: u64) -> Option<DeferredToolCall> {
        let entries = self.entries.read();
        entries.get(&id).map(|entry| {
            let mut call = entry.call.clone();
            call.pending_ms = call.deferred_at.elapsed().as_millis() as u64;
            call
        })
    }

    /// Remove a deferred call without resolving (e.g., on timeout).
    ///
    /// The oneshot sender is dropped, causing the receiver to error.
    pub fn remove(&self, id: u64) {
        self.entries.write().remove(&id);
    }

    /// Number of pending deferred calls
    pub fn pending_count(&self) -> usize {
        self.entries.read().len()
    }
}

impl Default for DeferRegistry {
    fn default() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_defer_and_resolve() {
        let registry = DeferRegistry::new();

        let (id, mut rx) = registry.defer(
            "session-1".into(),
            "%1".into(),
            "Bash".into(),
            Some(serde_json::json!({"command": "npm install"})),
            Some("/tmp".into()),
        );

        assert_eq!(registry.pending_count(), 1);

        let resolution = DeferResolution {
            decision: PermissionDecision::Allow,
            reason: "approved by human".into(),
            resolved_by: "human".into(),
        };

        assert!(registry.resolve(id, resolution));
        assert_eq!(registry.pending_count(), 0);

        // Receiver should get the resolution
        let result = rx.try_recv().unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
    }

    #[test]
    fn test_resolve_nonexistent() {
        let registry = DeferRegistry::new();
        let resolution = DeferResolution {
            decision: PermissionDecision::Deny,
            reason: "test".into(),
            resolved_by: "test".into(),
        };
        assert!(!registry.resolve(999, resolution));
    }

    #[test]
    fn test_list_pending() {
        let registry = DeferRegistry::new();

        let (_id1, _rx1) = registry.defer("s1".into(), "%1".into(), "Bash".into(), None, None);
        let (_id2, _rx2) = registry.defer("s2".into(), "%2".into(), "Edit".into(), None, None);

        let pending = registry.list_pending();
        assert_eq!(pending.len(), 2);
    }

    #[test]
    fn test_remove_drops_sender() {
        let registry = DeferRegistry::new();
        let (id, mut rx) = registry.defer("s1".into(), "%1".into(), "Bash".into(), None, None);

        registry.remove(id);
        assert_eq!(registry.pending_count(), 0);

        // Receiver should error since sender was dropped
        assert!(rx.try_recv().is_err());
    }
}
