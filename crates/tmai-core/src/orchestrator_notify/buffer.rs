//! Buffer for notifications targeted at busy orchestrators.
//!
//! When the orchestrator is processing another task, outbound notifications
//! from `OrchestratorNotifier` would otherwise be dropped. This buffer keeps
//! them per-orchestrator and flushes on transition to idle (or on
//! orchestrator re-appearance).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;

/// A single buffered notification waiting for its target orchestrator to
/// become idle.
#[derive(Debug, Clone)]
pub struct BufferedNotification {
    /// The fully-rendered notification message
    pub message: String,
    /// Source identifier for deduplication (e.g. "action-kill_agent",
    /// "sub:0.0", "pr-42"). Appending a notification whose `source` matches
    /// an existing entry replaces that entry (latest wins).
    pub source: String,
    /// When the entry was buffered. Used for TTL expiry.
    pub timestamp: Instant,
}

/// Shared buffer keyed by orchestrator target ID.
///
/// Shared via an `Arc<RwLock<_>>` between producers (`OrchestratorNotifier`'s
/// busy branch) and consumers (flush-on-idle path, also in the notifier).
pub type SharedNotifyBuffer = Arc<RwLock<HashMap<String, Vec<BufferedNotification>>>>;

/// Create an empty shared buffer.
pub fn new_shared_buffer() -> SharedNotifyBuffer {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Append a notification to the buffer for a given orchestrator target,
/// applying dedup (replace entry with matching `source`), TTL expiry, and
/// overflow (drop oldest when at capacity).
pub fn append(
    buffer: &SharedNotifyBuffer,
    target: &str,
    notification: BufferedNotification,
    ttl: Duration,
    max_messages: usize,
) {
    let mut map = buffer.write();
    let entries = map.entry(target.to_string()).or_default();

    // TTL sweep
    entries.retain(|n| n.timestamp.elapsed() <= ttl);

    // Dedup by source — replace existing
    if let Some(pos) = entries.iter().position(|n| n.source == notification.source) {
        entries[pos] = notification;
        return;
    }

    // Overflow: drop oldest until we have room
    while entries.len() >= max_messages {
        entries.remove(0);
    }

    entries.push(notification);
}

/// Take and remove all non-expired entries for a target, sorted by timestamp
/// ascending. Returns empty vec if nothing is buffered.
pub fn take_for_flush(
    buffer: &SharedNotifyBuffer,
    target: &str,
    ttl: Duration,
) -> Vec<BufferedNotification> {
    let mut map = buffer.write();
    let Some(entries) = map.remove(target) else {
        return Vec::new();
    };
    let mut valid: Vec<BufferedNotification> = entries
        .into_iter()
        .filter(|n| n.timestamp.elapsed() <= ttl)
        .collect();
    valid.sort_by_key(|n| n.timestamp);
    valid
}

/// Combine buffered messages into a single prompt using the standard
/// separator.
pub fn combine_messages(entries: &[BufferedNotification]) -> String {
    entries
        .iter()
        .map(|n| n.message.as_str())
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(source: &str, msg: &str) -> BufferedNotification {
        BufferedNotification {
            message: msg.to_string(),
            source: source.to_string(),
            timestamp: Instant::now(),
        }
    }

    #[test]
    fn append_accumulates() {
        let buf = new_shared_buffer();
        append(&buf, "orch", make("a", "m1"), Duration::from_secs(600), 20);
        append(&buf, "orch", make("b", "m2"), Duration::from_secs(600), 20);
        let entries = take_for_flush(&buf, "orch", Duration::from_secs(600));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "m1");
        assert_eq!(entries[1].message, "m2");
    }

    #[test]
    fn dedup_replaces_by_source() {
        let buf = new_shared_buffer();
        append(&buf, "orch", make("a", "m1"), Duration::from_secs(600), 20);
        append(
            &buf,
            "orch",
            make("a", "m1-updated"),
            Duration::from_secs(600),
            20,
        );
        let entries = take_for_flush(&buf, "orch", Duration::from_secs(600));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].message, "m1-updated");
    }

    #[test]
    fn overflow_drops_oldest() {
        let buf = new_shared_buffer();
        for i in 0..5 {
            append(
                &buf,
                "orch",
                make(&format!("s{i}"), &format!("m{i}")),
                Duration::from_secs(600),
                3,
            );
        }
        let entries = take_for_flush(&buf, "orch", Duration::from_secs(600));
        assert_eq!(entries.len(), 3);
        // Oldest two (s0, s1) dropped
        assert_eq!(entries[0].source, "s2");
        assert_eq!(entries[2].source, "s4");
    }

    #[test]
    fn ttl_expires_on_append_sweep() {
        let buf = new_shared_buffer();
        let expired = BufferedNotification {
            message: "old".to_string(),
            source: "a".to_string(),
            timestamp: Instant::now() - Duration::from_secs(10),
        };
        buf.write()
            .entry("orch".to_string())
            .or_default()
            .push(expired);

        append(&buf, "orch", make("b", "new"), Duration::from_secs(5), 20);
        let entries = take_for_flush(&buf, "orch", Duration::from_secs(5));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "b");
    }

    #[test]
    fn take_removes_key() {
        let buf = new_shared_buffer();
        append(&buf, "orch", make("a", "m1"), Duration::from_secs(600), 20);
        let _ = take_for_flush(&buf, "orch", Duration::from_secs(600));
        assert!(buf.read().get("orch").is_none());
    }

    #[test]
    fn combine_uses_separator() {
        let entries = vec![make("a", "first"), make("b", "second")];
        assert_eq!(combine_messages(&entries), "first\n\n---\n\nsecond");
    }

    #[test]
    fn multiple_targets_isolated() {
        let buf = new_shared_buffer();
        append(&buf, "o1", make("a", "m1"), Duration::from_secs(600), 20);
        append(&buf, "o2", make("a", "m2"), Duration::from_secs(600), 20);
        let e1 = take_for_flush(&buf, "o1", Duration::from_secs(600));
        assert_eq!(e1.len(), 1);
        assert_eq!(e1[0].message, "m1");
        let e2 = take_for_flush(&buf, "o2", Duration::from_secs(600));
        assert_eq!(e2.len(), 1);
        assert_eq!(e2[0].message, "m2");
    }
}
