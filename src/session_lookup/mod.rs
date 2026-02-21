//! Session lookup for Claude Code .jsonl files.
//!
//! Identifies the Claude Code session ID for a running agent by matching
//! capture-pane content against session JSONL files, or by probe marker fallback.

mod lookup;
mod phrase;

pub use lookup::{find_session_id, probe_session_id};

/// Result of a session ID lookup attempt
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupResult {
    /// Session ID found (UUID string)
    Found(String),
    /// No matching session found — fallback to probe marker
    NotFound,
}
