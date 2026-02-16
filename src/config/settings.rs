use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Command line arguments
#[derive(Parser, Debug)]
#[command(author, version, about = "Tmux Multi Agent Interface")]
pub struct Config {
    /// Enable debug mode
    #[arg(short, long, global = true)]
    pub debug: bool,

    /// Path to config file
    #[arg(short, long, global = true)]
    pub config: Option<PathBuf>,

    /// Polling interval in milliseconds
    #[arg(short = 'i', long)]
    pub poll_interval: Option<u64>,

    /// Number of lines to capture from panes
    #[arg(short = 'l', long)]
    pub capture_lines: Option<u32>,

    /// Only show panes from attached sessions
    #[arg(long, action = clap::ArgAction::Set)]
    pub attached_only: Option<bool>,

    /// Enable detection audit log (/tmp/tmai/audit/detection.ndjson)
    #[arg(long)]
    pub audit: bool,

    /// Subcommand
    #[command(subcommand)]
    pub command: Option<Command>,
}

/// Subcommands
#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Wrap an AI agent command with PTY monitoring
    Wrap {
        /// The command to wrap (e.g., "claude", "codex")
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Run interactive demo mode (no tmux required)
    Demo,
}

impl Config {
    /// Parse command line arguments
    pub fn parse_args() -> Self {
        Self::parse()
    }

    /// Check if running in wrap mode
    pub fn is_wrap_mode(&self) -> bool {
        matches!(self.command, Some(Command::Wrap { .. }))
    }

    /// Check if running in demo mode
    pub fn is_demo_mode(&self) -> bool {
        matches!(self.command, Some(Command::Demo))
    }

    /// Get wrap command and arguments
    pub fn get_wrap_args(&self) -> Option<(String, Vec<String>)> {
        match &self.command {
            Some(Command::Wrap { args }) if !args.is_empty() => {
                let command = args[0].clone();
                let cmd_args = args[1..].to_vec();
                Some((command, cmd_args))
            }
            _ => None,
        }
    }
}

/// Application settings (from config file)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Polling interval in milliseconds
    #[serde(default = "default_poll_interval")]
    pub poll_interval_ms: u64,

    /// Polling interval in passthrough mode (milliseconds)
    #[serde(default = "default_passthrough_poll_interval")]
    pub passthrough_poll_interval_ms: u64,

    /// Number of lines to capture from panes
    #[serde(default = "default_capture_lines")]
    pub capture_lines: u32,

    /// Only show panes from attached sessions
    #[serde(default = "default_attached_only")]
    pub attached_only: bool,

    /// Custom agent patterns
    #[serde(default)]
    pub agent_patterns: Vec<AgentPattern>,

    /// UI settings
    #[serde(default)]
    pub ui: UiSettings,

    /// Web server settings
    #[serde(default)]
    pub web: WebSettings,

    /// External transmission detection settings
    #[serde(default)]
    pub exfil_detection: ExfilDetectionSettings,

    /// Team detection settings
    #[serde(default)]
    pub teams: TeamSettings,

    /// Audit log settings
    #[serde(default)]
    pub audit: AuditSettings,

    /// Auto-approve settings
    #[serde(default)]
    pub auto_approve: AutoApproveSettings,
}

fn default_poll_interval() -> u64 {
    500
}

fn default_passthrough_poll_interval() -> u64 {
    10
}

fn default_capture_lines() -> u32 {
    100
}

fn default_attached_only() -> bool {
    true
}

/// Custom agent detection pattern
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPattern {
    /// Pattern to match (regex)
    pub pattern: String,
    /// Agent type name
    pub agent_type: String,
}

/// UI-related settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiSettings {
    /// Show preview panel
    #[serde(default = "default_show_preview")]
    pub show_preview: bool,

    /// Preview panel height (percentage)
    #[serde(default = "default_preview_height")]
    pub preview_height: u16,

    /// Enable color output
    #[serde(default = "default_color")]
    pub color: bool,

    /// Show activity name (tool name) during Processing instead of generic "Processing"
    /// When true (default): shows "Bash", "Compacting", etc.
    /// When false: always shows "Processing"
    #[serde(default = "default_show_activity_name")]
    pub show_activity_name: bool,
}

/// Web server settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSettings {
    /// Enable web server
    #[serde(default = "default_web_enabled")]
    pub enabled: bool,

    /// Web server port
    #[serde(default = "default_web_port")]
    pub port: u16,
}

fn default_web_enabled() -> bool {
    true
}

fn default_web_port() -> u16 {
    9876
}

impl Default for WebSettings {
    fn default() -> Self {
        Self {
            enabled: default_web_enabled(),
            port: default_web_port(),
        }
    }
}

/// External transmission detection settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExfilDetectionSettings {
    /// Enable detection
    #[serde(default = "default_exfil_enabled")]
    pub enabled: bool,

    /// Additional commands to detect (beyond built-in list)
    #[serde(default)]
    pub additional_commands: Vec<String>,
}

fn default_exfil_enabled() -> bool {
    true
}

impl Default for ExfilDetectionSettings {
    fn default() -> Self {
        Self {
            enabled: default_exfil_enabled(),
            additional_commands: Vec::new(),
        }
    }
}

/// Team detection settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamSettings {
    /// Enable team detection
    #[serde(default = "default_team_enabled")]
    pub enabled: bool,

    /// Scan interval in poll cycles (default: 5 = ~2.5s at 500ms poll)
    #[serde(default = "default_scan_interval")]
    pub scan_interval: u32,
}

/// Default for team enabled
fn default_team_enabled() -> bool {
    true
}

/// Default scan interval
fn default_scan_interval() -> u32 {
    5
}

impl Default for TeamSettings {
    fn default() -> Self {
        Self {
            enabled: default_team_enabled(),
            scan_interval: default_scan_interval(),
        }
    }
}

/// Audit log settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditSettings {
    /// Enable audit logging
    #[serde(default = "default_audit_enabled")]
    pub enabled: bool,

    /// Maximum log file size in bytes before rotation
    #[serde(default = "default_audit_max_size")]
    pub max_size_bytes: u64,

    /// Log source disagreement events
    #[serde(default)]
    pub log_source_disagreement: bool,
}

/// Default for audit enabled
fn default_audit_enabled() -> bool {
    false
}

/// Default audit max size (10MB)
fn default_audit_max_size() -> u64 {
    10_485_760
}

impl Default for AuditSettings {
    fn default() -> Self {
        Self {
            enabled: default_audit_enabled(),
            max_size_bytes: default_audit_max_size(),
            log_source_disagreement: false,
        }
    }
}

/// Auto-approve settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoApproveSettings {
    /// Enable auto-approve feature
    #[serde(default)]
    pub enabled: bool,

    /// Judgment provider (currently only "claude_haiku")
    #[serde(default = "default_aa_provider")]
    pub provider: String,

    /// Model to use for judgment
    #[serde(default = "default_aa_model")]
    pub model: String,

    /// Timeout for each judgment in seconds
    #[serde(default = "default_aa_timeout")]
    pub timeout_secs: u64,

    /// Cooldown after judgment before re-evaluating the same target (seconds)
    #[serde(default = "default_aa_cooldown")]
    pub cooldown_secs: u64,

    /// Interval between checking for new approval candidates (milliseconds)
    #[serde(default = "default_aa_interval")]
    pub check_interval_ms: u64,

    /// Allowed approval types (empty = all types except UserQuestion)
    #[serde(default)]
    pub allowed_types: Vec<String>,

    /// Maximum concurrent judgments
    #[serde(default = "default_aa_max_concurrent")]
    pub max_concurrent: usize,

    /// Custom command to use instead of "claude" (for alternative providers)
    #[serde(default)]
    pub custom_command: Option<String>,
}

fn default_aa_provider() -> String {
    "claude_haiku".to_string()
}

fn default_aa_model() -> String {
    "haiku".to_string()
}

fn default_aa_timeout() -> u64 {
    30
}

fn default_aa_cooldown() -> u64 {
    10
}

fn default_aa_interval() -> u64 {
    1000
}

fn default_aa_max_concurrent() -> usize {
    3
}

impl Default for AutoApproveSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: default_aa_provider(),
            model: default_aa_model(),
            timeout_secs: default_aa_timeout(),
            cooldown_secs: default_aa_cooldown(),
            check_interval_ms: default_aa_interval(),
            allowed_types: Vec::new(),
            max_concurrent: default_aa_max_concurrent(),
            custom_command: None,
        }
    }
}

fn default_show_preview() -> bool {
    true
}

fn default_preview_height() -> u16 {
    40
}

fn default_color() -> bool {
    true
}

fn default_show_activity_name() -> bool {
    true
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            show_preview: default_show_preview(),
            preview_height: default_preview_height(),
            color: default_color(),
            show_activity_name: default_show_activity_name(),
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            poll_interval_ms: default_poll_interval(),
            passthrough_poll_interval_ms: default_passthrough_poll_interval(),
            capture_lines: default_capture_lines(),
            attached_only: default_attached_only(),
            agent_patterns: Vec::new(),
            ui: UiSettings::default(),
            web: WebSettings::default(),
            exfil_detection: ExfilDetectionSettings::default(),
            teams: TeamSettings::default(),
            audit: AuditSettings::default(),
            auto_approve: AutoApproveSettings::default(),
        }
    }
}

impl Settings {
    /// Load settings from config file or use defaults
    pub fn load(path: Option<&PathBuf>) -> Result<Self> {
        // Try custom path first
        if let Some(p) = path {
            if p.exists() {
                let content = std::fs::read_to_string(p)
                    .with_context(|| format!("Failed to read config file: {:?}", p))?;
                return toml::from_str(&content)
                    .with_context(|| format!("Failed to parse config file: {:?}", p));
            }
        }

        // Try default config locations
        let default_paths = [
            dirs::config_dir().map(|p| p.join("tmai/config.toml")),
            dirs::home_dir().map(|p| p.join(".config/tmai/config.toml")),
            dirs::home_dir().map(|p| p.join(".tmai.toml")),
        ];

        for path in default_paths.iter().flatten() {
            if path.exists() {
                let content = std::fs::read_to_string(path)
                    .with_context(|| format!("Failed to read config file: {:?}", path))?;
                return toml::from_str(&content)
                    .with_context(|| format!("Failed to parse config file: {:?}", path));
            }
        }

        // Return defaults if no config file found
        Ok(Self::default())
    }

    /// Merge CLI config into settings (CLI takes precedence)
    pub fn merge_cli(&mut self, cli: &Config) {
        if let Some(poll_interval) = cli.poll_interval {
            self.poll_interval_ms = poll_interval;
        }
        if let Some(capture_lines) = cli.capture_lines {
            self.capture_lines = capture_lines;
        }
        if let Some(attached_only) = cli.attached_only {
            self.attached_only = attached_only;
        }
        if cli.audit {
            self.audit.enabled = true;
        }
    }

    /// Validate and normalize settings values
    ///
    /// Ensures poll intervals have a minimum value to prevent CPU exhaustion.
    pub fn validate(&mut self) {
        const MIN_POLL_INTERVAL: u64 = 1;

        if self.poll_interval_ms < MIN_POLL_INTERVAL {
            self.poll_interval_ms = MIN_POLL_INTERVAL;
        }
        if self.passthrough_poll_interval_ms < MIN_POLL_INTERVAL {
            self.passthrough_poll_interval_ms = MIN_POLL_INTERVAL;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = Settings::default();
        assert_eq!(settings.poll_interval_ms, 500);
        assert_eq!(settings.capture_lines, 100);
        assert!(settings.attached_only);
        assert!(settings.ui.show_preview);
    }

    #[test]
    fn test_parse_toml() {
        let toml = r#"
            poll_interval_ms = 1000
            capture_lines = 200

            [ui]
            show_preview = false
        "#;

        let settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        assert_eq!(settings.poll_interval_ms, 1000);
        assert_eq!(settings.capture_lines, 200);
        assert!(!settings.ui.show_preview);
    }
}
