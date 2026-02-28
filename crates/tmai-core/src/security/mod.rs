//! Security scanner for Claude Code configuration files.
//!
//! Detects potential security risks in settings, MCP configs, and hook scripts.

pub mod rules;
pub mod scanner;
pub mod types;

pub use scanner::SecurityScanner;
pub use types::{ScanResult, SecurityCategory, SecurityRisk, SettingsSource, Severity};
