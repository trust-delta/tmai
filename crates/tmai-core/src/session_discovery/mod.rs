//! Session Auto-Discovery for Claude Code instances.
//!
//! Scans `~/.claude/sessions/*.json` to discover running Claude Code sessions
//! without requiring hook setup. Enables web-only mode to find agents automatically.

pub mod scanner;
pub mod types;

pub use scanner::{resolve_pid_for_session, SessionDiscoveryScanner};
pub use types::DiscoveredSession;
