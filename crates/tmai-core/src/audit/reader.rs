//! Audit log reader — reads ndjson audit events from current and rotated files

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

use crate::ipc::protocol::state_dir;

use super::events::AuditEvent;

const AUDIT_FILE: &str = "detection.ndjson";
const ROTATED_FILE: &str = "detection.ndjson.1";

/// Returns paths to the audit log files (rotated first, then current) for time-order reading
pub fn audit_log_paths() -> Vec<PathBuf> {
    let audit_dir = state_dir().join("audit");
    let mut paths = Vec::new();

    // Rotated file first (older events)
    let rotated = audit_dir.join(ROTATED_FILE);
    if rotated.exists() {
        paths.push(rotated);
    }

    // Current file second (newer events)
    let current = audit_dir.join(AUDIT_FILE);
    if current.exists() {
        paths.push(current);
    }

    paths
}

/// Read all audit events from available log files in chronological order
///
/// Reads rotated (.1) file first, then current file.
/// Malformed lines are skipped with a tracing::warn.
pub fn read_all_events() -> Vec<AuditEvent> {
    let paths = audit_log_paths();
    let mut events = Vec::new();

    for path in &paths {
        let file = match File::open(path) {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!("Failed to open audit log {:?}: {}", path, e);
                continue;
            }
        };

        let reader = BufReader::new(file);
        for (line_num, line) in reader.lines().enumerate() {
            let line = match line {
                Ok(l) => l,
                Err(e) => {
                    tracing::warn!("Failed to read line {} in {:?}: {}", line_num + 1, path, e);
                    continue;
                }
            };

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            match serde_json::from_str::<AuditEvent>(trimmed) {
                Ok(event) => events.push(event),
                Err(e) => {
                    tracing::warn!(
                        "Malformed audit event at {:?}:{}: {}",
                        path,
                        line_num + 1,
                        e
                    );
                }
            }
        }
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_empty_file_returns_no_events() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("empty.ndjson");
        File::create(&file_path).unwrap();

        let file = File::open(&file_path).unwrap();
        let reader = BufReader::new(file);
        let events: Vec<AuditEvent> = reader
            .lines()
            .filter_map(|l| l.ok())
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(&l).ok())
            .collect();

        assert!(events.is_empty());
    }

    #[test]
    fn test_malformed_lines_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("mixed.ndjson");
        let mut file = File::create(&file_path).unwrap();

        // Valid line
        writeln!(
            file,
            r#"{{"event":"AgentAppeared","ts":1000,"pane_id":"1","agent_type":"ClaudeCode","source":"capture_pane","initial_status":"idle"}}"#
        )
        .unwrap();
        // Malformed line
        writeln!(file, "not valid json").unwrap();
        // Another valid line
        writeln!(
            file,
            r#"{{"event":"AgentDisappeared","ts":2000,"pane_id":"1","agent_type":"ClaudeCode","last_status":"idle"}}"#
        )
        .unwrap();

        let file = File::open(&file_path).unwrap();
        let reader = BufReader::new(file);
        let events: Vec<AuditEvent> = reader
            .lines()
            .filter_map(|l| l.ok())
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(&l).ok())
            .collect();

        assert_eq!(events.len(), 2);
    }

    #[test]
    fn test_deserialize_state_changed_roundtrip() {
        use crate::detectors::{DetectionConfidence, DetectionReason};

        let event = AuditEvent::StateChanged {
            ts: 1234567890,
            pane_id: "5".to_string(),
            agent_type: "ClaudeCode".to_string(),
            source: "capture_pane".to_string(),
            prev_status: "idle".to_string(),
            new_status: "processing".to_string(),
            reason: DetectionReason {
                rule: "braille_spinner".to_string(),
                confidence: DetectionConfidence::Medium,
                matched_text: Some("Working".to_string()),
            },
            screen_context: None,
            prev_state_duration_ms: Some(5000),
            approval_type: None,
            approval_details: None,
        };

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: AuditEvent = serde_json::from_str(&json).unwrap();

        // Verify round-trip
        let json2 = serde_json::to_string(&deserialized).unwrap();
        assert_eq!(json, json2);
    }
}
