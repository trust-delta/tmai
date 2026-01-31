use anyhow::{Context, Result};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Command line arguments
#[derive(Parser, Debug)]
#[command(author, version, about = "Tmux Multi Agent Interface")]
pub struct Config {
    /// Enable debug mode
    #[arg(short, long)]
    pub debug: bool,

    /// Path to config file
    #[arg(short, long)]
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
}

impl Config {
    /// Parse command line arguments
    pub fn parse_args() -> Self {
        Self::parse()
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

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            show_preview: default_show_preview(),
            preview_height: default_preview_height(),
            color: default_color(),
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
