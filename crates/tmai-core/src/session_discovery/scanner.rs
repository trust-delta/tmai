//! Session discovery scanner — finds running Claude Code instances
//! by scanning `~/.claude/sessions/`.

use std::collections::HashSet;
use std::path::PathBuf;

use tracing::debug;

use super::types::{ClaudeSessionFile, DiscoveredSession};

/// Scanner for discovering Claude Code sessions from the filesystem
pub struct SessionDiscoveryScanner {
    /// Previously known PIDs (to diff against)
    known_pids: HashSet<u32>,
    /// Claude sessions directory path
    sessions_dir: PathBuf,
}

impl Default for SessionDiscoveryScanner {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionDiscoveryScanner {
    /// Create a new scanner
    pub fn new() -> Self {
        let sessions_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".claude")
            .join("sessions");

        Self {
            known_pids: HashSet::new(),
            sessions_dir,
        }
    }

    /// Scan for sessions, returning (new sessions, disappeared PIDs)
    pub fn scan(&mut self) -> (Vec<DiscoveredSession>, Vec<u32>) {
        let mut current_pids = HashSet::new();
        let mut new_sessions = Vec::new();

        let entries = match std::fs::read_dir(&self.sessions_dir) {
            Ok(entries) => entries,
            Err(e) => {
                debug!(
                    path = %self.sessions_dir.display(),
                    error = %e,
                    "Cannot read sessions directory"
                );
                // Return disappeared PIDs (all known become disappeared)
                let disappeared: Vec<u32> = self.known_pids.drain().collect();
                return (Vec::new(), disappeared);
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            // Read and parse session file
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let session: ClaudeSessionFile = match serde_json::from_str(&content) {
                Ok(s) => s,
                Err(e) => {
                    debug!(path = %path.display(), error = %e, "Failed to parse session file");
                    continue;
                }
            };

            // Check if PID is still alive
            if !is_pid_alive(session.pid) {
                // Stale session file — skip but don't clean up (not our responsibility)
                continue;
            }

            current_pids.insert(session.pid);

            // If this is a new PID, report it
            if !self.known_pids.contains(&session.pid) {
                let transcript_path = derive_transcript_path(&session.cwd, &session.session_id);
                debug!(
                    pid = session.pid,
                    session_id = %session.session_id,
                    cwd = %session.cwd,
                    transcript = ?transcript_path,
                    "Discovered new Claude Code session"
                );
                new_sessions.push(DiscoveredSession {
                    pid: session.pid,
                    session_id: session.session_id,
                    cwd: session.cwd,
                    transcript_path,
                });
            }
        }

        // Find disappeared PIDs
        let disappeared: Vec<u32> = self.known_pids.difference(&current_pids).copied().collect();

        if !disappeared.is_empty() {
            debug!(?disappeared, "Sessions disappeared");
        }

        // Update known set
        self.known_pids = current_pids;

        (new_sessions, disappeared)
    }

    /// Get currently known PIDs
    pub fn known_pids(&self) -> &HashSet<u32> {
        &self.known_pids
    }
}

/// Check if a PID is still alive
fn is_pid_alive(pid: u32) -> bool {
    // Use /proc on Linux (most reliable)
    let proc_path = format!("/proc/{}", pid);
    if std::path::Path::new(&proc_path).exists() {
        return true;
    }

    // Fallback: kill(pid, 0) — checks if process exists without sending signal
    use nix::sys::signal;
    use nix::unistd::Pid;
    signal::kill(Pid::from_raw(pid as i32), None).is_ok()
}

/// Derive transcript path from cwd and session_id
///
/// Claude Code stores transcripts at:
/// `~/.claude/projects/{cwd_hash}/{session_id}.jsonl`
///
/// where cwd_hash is the absolute path with `/` replaced by `-` and leading `-` removed.
fn derive_transcript_path(cwd: &str, session_id: &str) -> Option<String> {
    let home = dirs::home_dir()?;
    let cwd_hash = cwd.replace('/', "-");
    // Remove leading '-' (from leading '/')
    let cwd_hash = cwd_hash.trim_start_matches('-');

    let path = home
        .join(".claude")
        .join("projects")
        .join(cwd_hash)
        .join(format!("{}.jsonl", session_id));

    if path.exists() {
        Some(path.to_string_lossy().to_string())
    } else {
        // Path might not exist yet if session just started
        debug!(
            path = %path.display(),
            "Transcript path does not exist yet"
        );
        Some(path.to_string_lossy().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_pid_alive_current_process() {
        let pid = std::process::id();
        assert!(is_pid_alive(pid));
    }

    #[test]
    fn test_is_pid_alive_nonexistent() {
        // PID 999999999 almost certainly doesn't exist
        assert!(!is_pid_alive(999_999_999));
    }

    #[test]
    fn test_derive_transcript_path() {
        let path = derive_transcript_path("/home/user/project", "session-abc");
        assert!(path.is_some());
        let path = path.unwrap();
        assert!(path.contains("home-user-project"));
        assert!(path.ends_with("session-abc.jsonl"));
    }

    #[test]
    fn test_scanner_empty_dir() {
        let mut scanner = SessionDiscoveryScanner::new();
        // Point to a temp dir that's empty
        scanner.sessions_dir = std::env::temp_dir().join("tmai_test_nonexistent_sessions");
        let (new, disappeared) = scanner.scan();
        assert!(new.is_empty());
        assert!(disappeared.is_empty());
    }

    #[test]
    fn test_scanner_with_session_file() {
        let tmp = tempfile::tempdir().unwrap();
        let sessions_dir = tmp.path().to_path_buf();

        // Create a session file for the current PID (guaranteed alive)
        let pid = std::process::id();
        let session_file = sessions_dir.join(format!("{}.json", pid));
        std::fs::write(
            &session_file,
            serde_json::json!({
                "pid": pid,
                "sessionId": "test-session-id",
                "cwd": "/tmp/test-project",
                "startedAt": 1700000000000u64
            })
            .to_string(),
        )
        .unwrap();

        let mut scanner = SessionDiscoveryScanner::new();
        scanner.sessions_dir = sessions_dir;

        // First scan: should discover the session
        let (new, disappeared) = scanner.scan();
        assert_eq!(new.len(), 1);
        assert_eq!(new[0].pid, pid);
        assert_eq!(new[0].session_id, "test-session-id");
        assert_eq!(new[0].cwd, "/tmp/test-project");
        assert!(disappeared.is_empty());

        // Second scan: no new sessions
        let (new, disappeared) = scanner.scan();
        assert!(new.is_empty());
        assert!(disappeared.is_empty());

        // Remove session file: PID disappears
        std::fs::remove_file(&session_file).unwrap();
        let (new, disappeared) = scanner.scan();
        assert!(new.is_empty());
        assert_eq!(disappeared.len(), 1);
        assert_eq!(disappeared[0], pid);
    }
}
