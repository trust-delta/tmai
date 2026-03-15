//! Types for session auto-discovery.

use serde::Deserialize;

/// Raw session file format from `~/.claude/sessions/{pid}.json`
#[derive(Debug, Deserialize)]
pub struct ClaudeSessionFile {
    /// Process ID of the Claude Code instance
    pub pid: u32,
    /// Claude Code session ID
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// Working directory
    pub cwd: String,
    /// Session start timestamp (Unix millis)
    #[serde(rename = "startedAt", default)]
    pub started_at: u64,
}

/// A discovered Claude Code session
#[derive(Debug, Clone)]
pub struct DiscoveredSession {
    /// Process ID
    pub pid: u32,
    /// Claude Code session ID
    pub session_id: String,
    /// Working directory
    pub cwd: String,
    /// Path to transcript JSONL file (if derivable)
    pub transcript_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_session_file_deserialize() {
        let json = r#"{
            "pid": 12345,
            "sessionId": "abc-123-def",
            "cwd": "/home/user/project",
            "startedAt": 1700000000000
        }"#;
        let session: ClaudeSessionFile = serde_json::from_str(json).unwrap();
        assert_eq!(session.pid, 12345);
        assert_eq!(session.session_id, "abc-123-def");
        assert_eq!(session.cwd, "/home/user/project");
        assert_eq!(session.started_at, 1700000000000);
    }

    #[test]
    fn test_claude_session_file_missing_started_at() {
        let json = r#"{
            "pid": 12345,
            "sessionId": "abc-123",
            "cwd": "/tmp"
        }"#;
        let session: ClaudeSessionFile = serde_json::from_str(json).unwrap();
        assert_eq!(session.started_at, 0);
    }
}
