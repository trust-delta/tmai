//! Types for transcript parsing and state tracking.

use serde::Serialize;

/// A parsed record from a Claude Code JSONL transcript
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TranscriptRecord {
    /// User message
    User { text: String },
    /// Assistant text output
    AssistantText { text: String },
    /// Tool use by the assistant
    ToolUse {
        tool_name: String,
        input_summary: String,
    },
    /// Tool result
    ToolResult { output_summary: String },
}

/// Maximum number of recent records to retain per transcript
pub const MAX_RECENT_RECORDS: usize = 50;

/// Tracked state for a single transcript file
#[derive(Debug, Clone)]
pub struct TranscriptState {
    /// Absolute path to the JSONL file
    pub path: String,
    /// Claude Code session ID
    pub session_id: String,
    /// Pane ID this transcript is associated with
    pub pane_id: String,
    /// Recent parsed records (last MAX_RECENT_RECORDS)
    pub recent_records: Vec<TranscriptRecord>,
    /// Last read position in the file (byte offset)
    pub last_read_pos: u64,
    /// Cached preview text (regenerated on new records)
    pub preview_text: String,
}

impl TranscriptState {
    /// Create a new TranscriptState
    pub fn new(path: String, session_id: String, pane_id: String) -> Self {
        Self {
            path,
            session_id,
            pane_id,
            recent_records: Vec::new(),
            last_read_pos: 0,
            preview_text: String::new(),
        }
    }

    /// Add records, maintaining the max limit
    pub fn push_records(&mut self, records: Vec<TranscriptRecord>) {
        self.recent_records.extend(records);
        if self.recent_records.len() > MAX_RECENT_RECORDS {
            let excess = self.recent_records.len() - MAX_RECENT_RECORDS;
            self.recent_records.drain(..excess);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transcript_state_push_records() {
        let mut state = TranscriptState::new(
            "/tmp/test.jsonl".to_string(),
            "sess".to_string(),
            "5".to_string(),
        );
        let records: Vec<TranscriptRecord> = (0..60)
            .map(|i| TranscriptRecord::User {
                text: format!("msg {}", i),
            })
            .collect();
        state.push_records(records);
        assert_eq!(state.recent_records.len(), MAX_RECENT_RECORDS);
    }
}
