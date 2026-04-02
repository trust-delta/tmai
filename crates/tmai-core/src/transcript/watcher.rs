//! Transcript file watcher — monitors JSONL files for changes
//! and maintains parsed transcript state per agent.

use std::collections::HashMap;
use std::io::{BufRead, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;

use parking_lot::RwLock;
use tracing::debug;

use super::parser::parse_jsonl_line;
use super::renderer::render_preview;
use super::types::TranscriptState;

/// Shared transcript registry: pane_id → TranscriptState
pub type TranscriptRegistry = Arc<RwLock<HashMap<String, TranscriptState>>>;

/// Create a new empty transcript registry
pub fn new_transcript_registry() -> TranscriptRegistry {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Maximum preview lines to render
const MAX_PREVIEW_LINES: usize = 80;

/// Number of tail lines to read on initial file open.
/// Set high to load full session history for hybrid scrollback preview.
const INITIAL_TAIL_LINES: usize = 50_000;

/// Transcript watcher that monitors JSONL files for changes
pub struct TranscriptWatcher {
    /// Shared transcript state
    registry: TranscriptRegistry,
}

impl TranscriptWatcher {
    /// Create a new TranscriptWatcher
    pub fn new(registry: TranscriptRegistry) -> Self {
        Self { registry }
    }

    /// Start watching a transcript file for a given pane_id
    ///
    /// Performs initial tail read, then subsequent calls to `poll_updates()`
    /// will read new content.
    pub fn start_watching(&self, pane_id: &str, path: &str, session_id: &str) {
        // Check if already watching
        {
            let reg = self.registry.read();
            if reg.contains_key(pane_id) {
                return;
            }
        }

        debug!(pane_id, path, "Starting transcript watch");

        let mut state = TranscriptState::new(
            path.to_string(),
            session_id.to_string(),
            pane_id.to_string(),
        );

        // Initial read: tail of file
        if let Err(e) = read_tail_lines(path, &mut state) {
            debug!(path, error = %e, "Failed initial transcript read (file may not exist yet)");
        }

        // Generate initial preview
        state.preview_text = render_preview(&state.recent_records, MAX_PREVIEW_LINES);

        let mut reg = self.registry.write();
        reg.insert(pane_id.to_string(), state);
    }

    /// Stop watching a transcript file
    pub fn stop_watching(&self, pane_id: &str) {
        let mut reg = self.registry.write();
        if reg.remove(pane_id).is_some() {
            debug!(pane_id, "Stopped transcript watch");
        }
    }

    /// Poll for updates on all watched transcripts
    ///
    /// Reads new lines since last_read_pos and updates preview text.
    pub fn poll_updates(&self) {
        let pane_ids: Vec<String> = {
            let reg = self.registry.read();
            reg.keys().cloned().collect()
        };

        for pane_id in pane_ids {
            let mut reg = self.registry.write();
            if let Some(state) = reg.get_mut(&pane_id) {
                if let Err(e) = read_new_lines(state) {
                    debug!(
                        pane_id,
                        path = %state.path,
                        error = %e,
                        "Failed to read transcript updates"
                    );
                }
            }
        }
    }

    /// Get the shared registry
    pub fn registry(&self) -> &TranscriptRegistry {
        &self.registry
    }
}

/// Read tail lines from a file for initial display
fn read_tail_lines(path: &str, state: &mut TranscriptState) -> std::io::Result<()> {
    let file = std::fs::File::open(path)?;
    let metadata = file.metadata()?;
    let file_size = metadata.len();

    // Read last N lines by seeking backward
    let reader = std::io::BufReader::new(&file);
    let all_lines: Vec<String> = reader.lines().collect::<Result<_, _>>()?;

    let start = all_lines.len().saturating_sub(INITIAL_TAIL_LINES);
    let mut records = Vec::new();
    for line in &all_lines[start..] {
        records.extend(parse_jsonl_line(line));
    }

    state.push_records(records);
    state.last_read_pos = file_size;

    Ok(())
}

/// Read new lines since last_read_pos
fn read_new_lines(state: &mut TranscriptState) -> std::io::Result<()> {
    let path = Path::new(&state.path);
    if !path.exists() {
        return Ok(());
    }

    let file = std::fs::File::open(path)?;
    let metadata = file.metadata()?;
    let current_size = metadata.len();

    // No new data
    if current_size <= state.last_read_pos {
        // File might have been truncated/rotated
        if current_size < state.last_read_pos {
            debug!(
                path = %state.path,
                "Transcript file truncated, resetting position"
            );
            state.last_read_pos = 0;
            state.recent_records.clear();
        } else {
            return Ok(());
        }
    }

    let mut reader = std::io::BufReader::new(file);
    reader.seek(SeekFrom::Start(state.last_read_pos))?;

    let mut new_records = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        let bytes_read = reader.read_line(&mut line)?;
        if bytes_read == 0 {
            break;
        }
        new_records.extend(parse_jsonl_line(&line));
    }

    if !new_records.is_empty() {
        debug!(
            path = %state.path,
            new_records = new_records.len(),
            "Read new transcript records"
        );
        state.push_records(new_records);
        state.preview_text = render_preview(&state.recent_records, MAX_PREVIEW_LINES);
    }

    state.last_read_pos = current_size;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_transcript_watcher_start_stop() {
        let registry = new_transcript_registry();
        let watcher = TranscriptWatcher::new(registry.clone());

        // Start watching a non-existent file (should not crash)
        watcher.start_watching("5", "/tmp/nonexistent_transcript.jsonl", "sess1");

        {
            let reg = registry.read();
            assert!(reg.contains_key("5"));
        }

        watcher.stop_watching("5");

        {
            let reg = registry.read();
            assert!(!reg.contains_key("5"));
        }
    }

    #[test]
    fn test_transcript_watcher_reads_file() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();

        // Write some JSONL content
        {
            let mut file = std::fs::File::create(&path).unwrap();
            writeln!(file, r#"{{"type":"user","message":{{"content":"Hello"}}}}"#).unwrap();
            writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"Hi there!"}}]}}}}"#).unwrap();
        }

        let registry = new_transcript_registry();
        let watcher = TranscriptWatcher::new(registry.clone());
        watcher.start_watching("5", &path, "sess1");

        {
            let reg = registry.read();
            let state = reg.get("5").unwrap();
            assert_eq!(state.recent_records.len(), 2);
            assert!(state.preview_text.contains("▶ User: Hello"));
            assert!(state.preview_text.contains("◀ Hi there!"));
        }
    }

    #[test]
    fn test_transcript_watcher_incremental_read() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();

        // Write initial content
        {
            let mut file = std::fs::File::create(&path).unwrap();
            writeln!(file, r#"{{"type":"user","message":{{"content":"First"}}}}"#).unwrap();
        }

        let registry = new_transcript_registry();
        let watcher = TranscriptWatcher::new(registry.clone());
        watcher.start_watching("5", &path, "sess1");

        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().recent_records.len(), 1);
        }

        // Append new content
        {
            let mut file = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .unwrap();
            writeln!(
                file,
                r#"{{"type":"user","message":{{"content":"Second"}}}}"#
            )
            .unwrap();
        }

        // Poll for updates
        watcher.poll_updates();

        {
            let reg = registry.read();
            let state = reg.get("5").unwrap();
            assert_eq!(state.recent_records.len(), 2);
            assert!(state.preview_text.contains("Second"));
        }
    }
}
