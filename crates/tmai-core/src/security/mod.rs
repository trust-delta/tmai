//! Config audit scanner for Claude Code configuration files.
//!
//! Detects potential security risks in settings, MCP configs, hook scripts,
//! custom commands, and CLAUDE.md files.

pub mod rules;
pub mod scanner;
pub mod types;

pub use scanner::ConfigAuditScanner;
pub use types::{ScanResult, SecurityCategory, SecurityRisk, SettingsSource, Severity};
