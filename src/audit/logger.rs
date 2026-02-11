use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use super::events::AuditEvent;
use crate::ipc::protocol::state_dir;

const AUDIT_FILE: &str = "detection.ndjson";

/// Logger for audit events in ndjson format
pub struct AuditLogger {
    enabled: bool,
    max_size_bytes: u64,
    file_path: PathBuf,
    writer: Option<BufWriter<File>>,
}

impl AuditLogger {
    /// Create a new audit logger
    ///
    /// If `enabled` is false, all log calls are no-ops.
    pub fn new(enabled: bool, max_size_bytes: u64) -> Self {
        let file_path = state_dir().join("audit").join(AUDIT_FILE);
        let writer = if enabled {
            Self::open_writer(&file_path)
        } else {
            None
        };

        Self {
            enabled,
            max_size_bytes,
            file_path,
            writer,
        }
    }

    /// Log an audit event
    ///
    /// Serializes the event as a single JSON line and appends to the log file.
    pub fn log(&mut self, event: &AuditEvent) {
        if !self.enabled {
            return;
        }

        // Ensure writer is open
        if self.writer.is_none() {
            self.writer = Self::open_writer(&self.file_path);
        }

        let writer = match self.writer.as_mut() {
            Some(w) => w,
            None => return,
        };

        // Serialize and write
        if let Ok(json) = serde_json::to_string(event) {
            if writeln!(writer, "{}", json).is_ok() {
                let _ = writer.flush();
            } else {
                // Write failed, try to reopen on next call
                self.writer = None;
            }
        }

        // Check rotation
        self.maybe_rotate();
    }

    /// Open or create the log file for appending
    fn open_writer(file_path: &Path) -> Option<BufWriter<File>> {
        // Ensure directory exists
        if let Some(dir) = file_path.parent() {
            if let Err(e) = fs::create_dir_all(dir) {
                eprintln!("Failed to create audit directory: {}", e);
                return None;
            }
        }

        match OpenOptions::new().create(true).append(true).open(file_path) {
            Ok(file) => Some(BufWriter::new(file)),
            Err(e) => {
                eprintln!("Failed to open audit log: {}", e);
                None
            }
        }
    }

    /// Rotate the log file if it exceeds max_size_bytes
    fn maybe_rotate(&mut self) {
        let metadata = match fs::metadata(&self.file_path) {
            Ok(m) => m,
            Err(_) => return,
        };

        if metadata.len() >= self.max_size_bytes {
            // Close current writer
            self.writer = None;

            // Rename current to .1
            let rotated = self.file_path.with_extension("ndjson.1");
            let _ = fs::rename(&self.file_path, &rotated);

            // Reopen fresh file
            self.writer = Self::open_writer(&self.file_path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detectors::{DetectionConfidence, DetectionReason};

    #[test]
    fn test_disabled_logger_is_noop() {
        let mut logger = AuditLogger::new(false, 1024);
        let event = AuditEvent::AgentAppeared {
            ts: 1234567890,
            pane_id: "1".to_string(),
            agent_type: "ClaudeCode".to_string(),
            source: "capture_pane".to_string(),
            initial_status: "idle".to_string(),
        };
        // Should not panic or create files
        logger.log(&event);
    }

    #[test]
    fn test_ndjson_output() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.ndjson");

        let mut logger = AuditLogger {
            enabled: true,
            max_size_bytes: 10_485_760,
            file_path: file_path.clone(),
            writer: None,
        };

        let event = AuditEvent::AgentAppeared {
            ts: 1234567890,
            pane_id: "1".to_string(),
            agent_type: "ClaudeCode".to_string(),
            source: "capture_pane".to_string(),
            initial_status: "idle".to_string(),
        };
        logger.log(&event);

        let content = fs::read_to_string(&file_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(parsed["event"], "AgentAppeared");
        assert_eq!(parsed["pane_id"], "1");
    }

    #[test]
    fn test_rotation() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.ndjson");

        let mut logger = AuditLogger {
            enabled: true,
            max_size_bytes: 100, // Very small for testing
            file_path: file_path.clone(),
            writer: None,
        };

        // Write enough to trigger rotation
        for i in 0..10 {
            let event = AuditEvent::AgentAppeared {
                ts: i,
                pane_id: format!("pane-{}", i),
                agent_type: "ClaudeCode".to_string(),
                source: "capture_pane".to_string(),
                initial_status: "idle".to_string(),
            };
            logger.log(&event);
        }

        // Rotated file should exist
        let rotated = file_path.with_extension("ndjson.1");
        assert!(rotated.exists(), "Rotated file should exist");
    }

    #[test]
    fn test_state_changed_event_serialization() {
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
                matched_text: Some("⠋ Working".to_string()),
            },
            screen_context: None,
            prev_state_duration_ms: None,
        };

        let json = serde_json::to_string(&event).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["event"], "StateChanged");
        assert_eq!(parsed["reason"]["rule"], "braille_spinner");
        assert_eq!(parsed["reason"]["confidence"], "Medium");
    }
}
