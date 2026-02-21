//! Session ID lookup logic for Claude Code .jsonl files.
//!
//! Phase 1: Match capture-pane content against JSONL files (non-invasive).
//! Phase 2: Search for a probe marker string in JSONL files (fallback).

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use super::phrase;
use super::LookupResult;

/// Maximum number of recent JSONL files to search
const MAX_FILES_TO_SEARCH: usize = 10;

/// Maximum bytes to read from the tail of each JSONL file
const TAIL_READ_BYTES: u64 = 50 * 1024; // 50KB

/// Maximum phrases to extract from capture-pane content
const MAX_PHRASES: usize = 5;

/// Convert a CWD path to Claude Code's project directory hash.
///
/// Claude Code uses the path with `/` replaced by `-`:
/// `/home/user/works/tmai` → `-home-user-works-tmai`
fn cwd_to_project_hash(cwd: &str) -> String {
    cwd.replace('/', "-")
}

/// Get the Claude Code projects directory path.
///
/// Returns `~/.claude/projects/`
fn claude_projects_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

/// List JSONL files for a project, sorted by modification time (newest first).
///
/// Returns up to `max_count` files.
fn list_recent_jsonl_files(project_dir: &PathBuf, max_count: usize) -> Vec<(PathBuf, u64)> {
    let entries = match fs::read_dir(project_dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut files: Vec<(PathBuf, u64)> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let mtime = metadata
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some((path, mtime))
        })
        .collect();

    // Sort by mtime descending (newest first)
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files.truncate(max_count);
    files
}

/// Read the tail of a file (last `max_bytes` bytes).
///
/// Uses `from_utf8_lossy` to handle seeking into the middle of multi-byte characters.
fn read_tail(path: &Path, max_bytes: u64) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let file_size = file.metadata().ok()?.len();

    if file_size > max_bytes {
        file.seek(SeekFrom::End(-(max_bytes as i64))).ok()?;
    }

    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Extract session ID (UUID) from a JSONL file path.
///
/// `/path/to/abcd1234-5678-abcd-efgh-ijklmnop.jsonl` → `"abcd1234-5678-abcd-efgh-ijklmnop"`
///
/// Only returns IDs that match UUID-like format (alphanumeric + hyphens) to prevent
/// shell injection when used in `claude --resume <id>`.
fn extract_session_id(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    // Validate: only allow alphanumeric chars and hyphens (UUID format)
    if stem.is_empty() || !stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    Some(stem.to_string())
}

/// Phase 1: Find session ID by matching capture-pane content against JSONL files.
///
/// This is the non-invasive approach that reads existing data without modifying
/// the Claude Code conversation.
///
/// # Arguments
/// * `cwd` - Working directory of the agent (used to locate project JSONL files)
/// * `capture_content` - Current capture-pane content of the agent
///
/// # Returns
/// * `LookupResult::Found(session_id)` if a matching session was found
/// * `LookupResult::NotFound` if no match (caller should fall back to probe)
pub fn find_session_id(cwd: &str, capture_content: &str) -> LookupResult {
    let projects_dir = match claude_projects_dir() {
        Some(dir) => dir,
        None => return LookupResult::NotFound,
    };

    let project_hash = cwd_to_project_hash(cwd);
    let project_dir = projects_dir.join(&project_hash);

    if !project_dir.exists() {
        return LookupResult::NotFound;
    }

    // Extract distinctive phrases from capture-pane content
    let phrases = phrase::extract_phrases(capture_content, MAX_PHRASES);
    if phrases.is_empty() {
        return LookupResult::NotFound;
    }

    // Search recent JSONL files
    let files = list_recent_jsonl_files(&project_dir, MAX_FILES_TO_SEARCH);

    for (path, _mtime) in &files {
        let content = match read_tail(path, TAIL_READ_BYTES) {
            Some(c) => c,
            None => continue,
        };

        // Check if any phrase matches
        for phrase in &phrases {
            if content.contains(phrase.as_str()) {
                if let Some(session_id) = extract_session_id(path) {
                    return LookupResult::Found(session_id);
                }
            }
        }
    }

    LookupResult::NotFound
}

/// Phase 2: Find session ID by searching for a probe marker in JSONL files.
///
/// Called after sending a probe marker string to the Claude Code pane.
/// The marker appears in the JSONL as a user message.
///
/// # Arguments
/// * `cwd` - Working directory of the agent
/// * `marker` - The unique marker string to search for (e.g., "tmai-probe:<uuid>")
///
/// # Returns
/// * `LookupResult::Found(session_id)` if the marker was found
/// * `LookupResult::NotFound` if not found (caller should show error)
pub fn probe_session_id(cwd: &str, marker: &str) -> LookupResult {
    if marker.is_empty() {
        return LookupResult::NotFound;
    }

    let projects_dir = match claude_projects_dir() {
        Some(dir) => dir,
        None => return LookupResult::NotFound,
    };

    let project_hash = cwd_to_project_hash(cwd);
    let project_dir = projects_dir.join(&project_hash);

    if !project_dir.exists() {
        return LookupResult::NotFound;
    }

    // Search more broadly for probe marker (it was just written)
    let files = list_recent_jsonl_files(&project_dir, MAX_FILES_TO_SEARCH);

    for (path, _mtime) in &files {
        let content = match read_tail(path, TAIL_READ_BYTES) {
            Some(c) => c,
            None => continue,
        };

        if content.contains(marker) {
            if let Some(session_id) = extract_session_id(path) {
                return LookupResult::Found(session_id);
            }
        }
    }

    LookupResult::NotFound
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cwd_to_project_hash() {
        assert_eq!(
            cwd_to_project_hash("/home/user/works/tmai"),
            "-home-user-works-tmai"
        );
        assert_eq!(cwd_to_project_hash("/"), "-");
        assert_eq!(cwd_to_project_hash("/home/user"), "-home-user");
    }

    #[test]
    fn test_extract_session_id() {
        let path = PathBuf::from("/some/path/abcd1234-5678-abcd-efgh-ijklmnop.jsonl");
        assert_eq!(
            extract_session_id(&path),
            Some("abcd1234-5678-abcd-efgh-ijklmnop".to_string())
        );
    }

    #[test]
    fn test_extract_session_id_no_extension() {
        let path = PathBuf::from("/some/path/sessions-index.json");
        assert_eq!(
            extract_session_id(&path),
            Some("sessions-index".to_string())
        );
    }

    #[test]
    fn test_find_session_id_nonexistent_dir() {
        let result = find_session_id("/nonexistent/path/that/doesnt/exist", "some content");
        assert_eq!(result, LookupResult::NotFound);
    }

    #[test]
    fn test_probe_session_id_nonexistent_dir() {
        let result = probe_session_id("/nonexistent/path", "tmai-probe:test-uuid");
        assert_eq!(result, LookupResult::NotFound);
    }
}
