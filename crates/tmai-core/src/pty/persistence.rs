//! PTY session persistence — saves/loads session metadata to disk
//! so that tmai can rediscover PTY-spawned agents after restart.

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::ipc::protocol::state_dir;

/// Persisted session metadata written to disk when a PTY session is spawned
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedSession {
    /// Unique session ID (same as PtySession.id)
    pub id: String,
    /// Child process PID
    pub pid: u32,
    /// Command that was spawned
    pub command: String,
    /// Working directory
    pub cwd: String,
    /// Unix socket path for the pty-hold daemon
    pub socket_path: String,
    /// Creation timestamp (Unix seconds)
    pub created_at: u64,
}

/// Get the directory for persisted PTY sessions
fn sessions_dir() -> PathBuf {
    state_dir().join("pty_sessions")
}

/// Save a session to disk
pub fn save_session(session: &PersistedSession) -> Result<()> {
    let dir = sessions_dir();
    std::fs::create_dir_all(&dir).context("Failed to create pty_sessions directory")?;

    let path = dir.join(format!("{}.json", session.id));
    let json = serde_json::to_string_pretty(session).context("Failed to serialize session")?;
    std::fs::write(&path, json).context("Failed to write session file")?;

    tracing::debug!(id = %session.id, path = %path.display(), "Persisted PTY session");
    Ok(())
}

/// Remove a session from disk
pub fn remove_session(id: &str) {
    let path = sessions_dir().join(format!("{}.json", id));
    if path.exists() {
        let _ = std::fs::remove_file(&path);
        tracing::debug!(id = %id, "Removed persisted PTY session");
    }
}

/// Load all persisted sessions from disk, filtering out stale ones
pub fn load_sessions() -> Vec<PersistedSession> {
    let dir = sessions_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut sessions = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let session: PersistedSession = match serde_json::from_str(&content) {
            Ok(s) => s,
            Err(e) => {
                tracing::debug!(path = %path.display(), error = %e, "Invalid session file, removing");
                let _ = std::fs::remove_file(&path);
                continue;
            }
        };

        // Check if the daemon socket still exists
        if !std::path::Path::new(&session.socket_path).exists() {
            tracing::debug!(id = %session.id, "Daemon socket gone, removing stale session");
            let _ = std::fs::remove_file(&path);
            continue;
        }

        sessions.push(session);
    }

    sessions
}

/// Get the socket path for a session's pty-hold daemon
pub fn daemon_socket_path(session_id: &str) -> PathBuf {
    state_dir()
        .join("pty_sessions")
        .join(format!("{}.sock", session_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_and_load() {
        let session = PersistedSession {
            id: "test-persistence-001".to_string(),
            pid: 12345,
            command: "bash".to_string(),
            cwd: "/tmp".to_string(),
            socket_path: "/nonexistent/socket".to_string(),
            created_at: 1700000000,
        };

        // Save
        save_session(&session).expect("save failed");

        // Verify file exists
        let path = sessions_dir().join("test-persistence-001.json");
        assert!(path.exists());

        // Load (socket doesn't exist, so it will be filtered as stale)
        let loaded = load_sessions();
        assert!(
            !loaded.iter().any(|s| s.id == "test-persistence-001"),
            "Stale session should be filtered out"
        );

        // Clean up
        remove_session("test-persistence-001");
        assert!(!path.exists());
    }
}
