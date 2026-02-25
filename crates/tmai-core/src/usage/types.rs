//! Usage data types parsed from Claude Code `/usage` output.

use serde::Serialize;

/// A single usage meter (e.g., "Current session", "Current week")
#[derive(Debug, Clone, Serialize)]
pub struct UsageMeter {
    /// Label (e.g., "Current session", "Current week (all models)")
    pub label: String,
    /// Percentage used (0-100)
    pub percent: u8,
    /// Reset info (e.g., "Resets 1am (Asia/Tokyo)")
    pub reset_info: Option<String>,
    /// Spending detail (e.g., "$22.22 / $50.00 spent")
    pub spending: Option<String>,
}

/// Complete usage snapshot from Claude Code `/usage` command
#[derive(Debug, Clone, Default, Serialize)]
pub struct UsageSnapshot {
    /// Individual usage meters
    pub meters: Vec<UsageMeter>,
    /// When this snapshot was captured
    pub fetched_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Whether a fetch is currently in progress
    #[serde(skip)]
    pub fetching: bool,
    /// Error message from last fetch attempt
    pub error: Option<String>,
}
