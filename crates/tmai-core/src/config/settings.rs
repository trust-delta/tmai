use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Command line arguments
#[derive(Parser, Debug)]
#[command(author, version, about = "Tactful Multi Agent Interface")]
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

    /// Enable detection audit log (~/.local/share/tmai/audit/detection.ndjson)
    #[arg(long)]
    pub audit: bool,

    /// Tmux TUI mode: use ratatui TUI with tmux backend (default is WebUI)
    #[arg(long)]
    pub tmux: bool,

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
    /// Analyze audit detection logs
    Audit {
        #[command(subcommand)]
        subcommand: AuditCommand,
    },
    /// Initialize Claude Code hooks integration
    Init {
        /// Force overwrite existing tmai hook entries
        #[arg(long)]
        force: bool,
        /// Also configure Codex CLI hooks
        #[arg(long)]
        codex: bool,
    },
    /// Remove tmai hooks from Claude Code settings
    Uninit {
        /// Also remove Codex CLI hooks
        #[arg(long)]
        codex: bool,
    },
    /// Bridge Codex CLI hook events to tmai (called by Codex, not by users)
    #[command(name = "codex-hook")]
    CodexHook,
    /// Run MCP server on stdio (spawned by Claude Code as an MCP server)
    Mcp,
    /// List all agents visible to tmai
    Agents,
    /// Get terminal output of another agent
    Output {
        /// Agent/session ID
        id: String,
    },
    /// Send text input to another agent
    Send {
        /// Target agent/session ID
        id: String,
        /// Text to send
        text: Vec<String>,
    },
}

/// Audit analysis subcommands
#[derive(Subcommand, Debug, Clone)]
pub enum AuditCommand {
    /// Show aggregate statistics from detection logs
    Stats {
        /// Number of top rules to display
        #[arg(long, default_value = "20")]
        top: usize,
    },
    /// Analyze potential misdetections (UserInputDuringProcessing events)
    Misdetections {
        /// Maximum number of individual records to display
        #[arg(long, short = 'n', default_value = "50")]
        limit: usize,
    },
    /// Analyze IPC/capture-pane disagreements
    Disagreements {
        /// Maximum number of individual records to display
        #[arg(long, short = 'n', default_value = "50")]
        limit: usize,
    },
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

    /// Check if running in audit mode
    pub fn is_audit_mode(&self) -> bool {
        matches!(self.command, Some(Command::Audit { .. }))
    }

    /// Check if running in init mode
    pub fn is_init_mode(&self) -> bool {
        matches!(self.command, Some(Command::Init { .. }))
    }

    /// Get init command force flag
    pub fn get_init_force(&self) -> bool {
        match &self.command {
            Some(Command::Init { force, .. }) => *force,
            _ => false,
        }
    }

    /// Get init command codex flag
    pub fn get_init_codex(&self) -> bool {
        match &self.command {
            Some(Command::Init { codex, .. }) => *codex,
            _ => false,
        }
    }

    /// Check if running in uninit mode
    pub fn is_uninit_mode(&self) -> bool {
        matches!(self.command, Some(Command::Uninit { .. }))
    }

    /// Get uninit command codex flag
    pub fn get_uninit_codex(&self) -> bool {
        match &self.command {
            Some(Command::Uninit { codex }) => *codex,
            _ => false,
        }
    }

    /// Check if running in codex-hook bridge mode
    pub fn is_codex_hook_mode(&self) -> bool {
        matches!(self.command, Some(Command::CodexHook))
    }

    /// Check if running in MCP server mode
    pub fn is_mcp_mode(&self) -> bool {
        matches!(self.command, Some(Command::Mcp))
    }

    /// Get audit subcommand
    pub fn get_audit_command(&self) -> Option<&AuditCommand> {
        match &self.command {
            Some(Command::Audit { subcommand }) => Some(subcommand),
            _ => None,
        }
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

    /// Check if running an inter-agent CLI command (agents/output/send)
    pub fn get_agent_command(&self) -> Option<&Command> {
        match &self.command {
            Some(cmd @ (Command::Agents | Command::Output { .. } | Command::Send { .. })) => {
                Some(cmd)
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

    /// Create process popup settings
    #[serde(default)]
    pub create_process: CreateProcessSettings,

    /// Usage monitoring settings
    #[serde(default)]
    pub usage: UsageSettings,

    /// Fresh Session Review settings
    #[serde(default)]
    pub review: ReviewSettings,

    /// Codex CLI app-server WebSocket settings
    #[serde(default)]
    pub codex_ws: CodexWsSettings,

    /// Git worktree settings
    #[serde(default)]
    pub worktree: WorktreeSettings,

    /// Workflow automation settings
    #[serde(default)]
    pub workflow: WorkflowSettings,

    /// Agent spawn settings
    #[serde(default)]
    pub spawn: SpawnSettings,

    /// Registered project directories (absolute paths)
    #[serde(default)]
    pub projects: Vec<String>,

    /// WebUI mode (default). False when --tmux flag is used.
    #[serde(skip)]
    pub webui: bool,
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

    /// Wrap long lines in preview pane instead of truncating with …
    #[serde(default)]
    pub line_wrap: bool,
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

    /// Show terminal cursor overlay in preview panel
    #[serde(default = "default_show_cursor")]
    pub show_cursor: bool,

    /// Send browser notification when an agent becomes idle
    #[serde(default = "default_notify_on_idle")]
    pub notify_on_idle: bool,

    /// Seconds of continuous idle before triggering a notification
    /// (filters out transient state flickers from capture-pane detection)
    #[serde(default = "default_notify_idle_threshold_secs")]
    pub notify_idle_threshold_secs: u64,

    /// Theme preference: "dark", "light", or "system"
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_web_enabled() -> bool {
    true
}

fn default_web_port() -> u16 {
    9876
}

fn default_show_cursor() -> bool {
    true
}

fn default_notify_on_idle() -> bool {
    true
}

fn default_notify_idle_threshold_secs() -> u64 {
    10
}

fn default_theme() -> String {
    "system".to_string()
}

impl Default for WebSettings {
    fn default() -> Self {
        Self {
            enabled: default_web_enabled(),
            port: default_web_port(),
            show_cursor: default_show_cursor(),
            notify_on_idle: default_notify_on_idle(),
            notify_idle_threshold_secs: default_notify_idle_threshold_secs(),
            theme: default_theme(),
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
    /// Enable auto-approve feature (legacy; prefer `mode`)
    #[serde(default)]
    pub enabled: bool,

    /// Operating mode: "off", "rules", "ai", "hybrid"
    /// When set, takes precedence over `enabled`.
    #[serde(default)]
    pub mode: Option<crate::auto_approve::types::AutoApproveMode>,

    /// Rule-based auto-approve settings
    #[serde(default)]
    pub rules: RuleSettings,

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

/// Rule-based auto-approve settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleSettings {
    /// Auto-approve Read operations (file reads, cat, head, ls, find, grep)
    #[serde(default = "default_true")]
    pub allow_read: bool,

    /// Auto-approve test execution (cargo test, npm test, pytest, go test)
    #[serde(default = "default_true")]
    pub allow_tests: bool,

    /// Auto-approve WebFetch/Search (curl GET without POST/data)
    #[serde(default = "default_true")]
    pub allow_fetch: bool,

    /// Auto-approve read-only git commands (status, log, diff, branch, show, blame)
    #[serde(default = "default_true")]
    pub allow_git_readonly: bool,

    /// Auto-approve format/lint commands (cargo fmt/clippy, prettier, eslint)
    #[serde(default = "default_true")]
    pub allow_format_lint: bool,

    /// Additional allow patterns (regex, matched against screen context)
    #[serde(default)]
    pub allow_patterns: Vec<String>,
}

/// Helper for serde default = true
fn default_true() -> bool {
    true
}

impl Default for RuleSettings {
    fn default() -> Self {
        Self {
            allow_read: true,
            allow_tests: true,
            allow_fetch: true,
            allow_git_readonly: true,
            allow_format_lint: true,
            allow_patterns: Vec::new(),
        }
    }
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

impl AutoApproveSettings {
    /// Resolve the effective operating mode.
    ///
    /// - If `mode` is explicitly set, use it directly.
    /// - Otherwise fall back to `enabled` for backward compatibility:
    ///   `enabled: true` → `Ai`, `enabled: false` → `Off`.
    pub fn effective_mode(&self) -> crate::auto_approve::types::AutoApproveMode {
        use crate::auto_approve::types::AutoApproveMode;
        match self.mode {
            Some(m) => m,
            None => {
                if self.enabled {
                    AutoApproveMode::Ai
                } else {
                    AutoApproveMode::Off
                }
            }
        }
    }
}

/// Usage monitoring settings
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UsageSettings {
    /// Auto-refresh interval in minutes (0 = disabled, manual `U` key only)
    #[serde(default)]
    pub auto_refresh_min: u32,
    /// Enable usage monitoring in WebUI
    #[serde(default)]
    pub enabled: bool,
}

/// Fresh Session Review settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSettings {
    /// Enable automatic review on agent Stop events
    #[serde(default)]
    pub enabled: bool,

    /// Agent to use for review (default: claude_code, options: claude_code, codex, gemini)
    #[serde(default)]
    pub agent: crate::review::types::ReviewAgent,

    /// Base branch to diff against (default: "main")
    #[serde(default = "default_review_base_branch")]
    pub base_branch: String,

    /// Custom review instructions appended to the review prompt
    #[serde(default)]
    pub custom_instructions: String,

    /// Auto-launch review when hook-detected agent completes (vs manual `R` key only)
    #[serde(default)]
    pub auto_launch: bool,

    /// Automatically send review results back to the original agent session
    #[serde(default = "default_true")]
    pub auto_feedback: bool,
}

/// Default base branch for review diff
fn default_review_base_branch() -> String {
    "main".to_string()
}

impl Default for ReviewSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            agent: crate::review::types::ReviewAgent::default(),
            base_branch: default_review_base_branch(),
            custom_instructions: String::new(),
            auto_launch: false,
            auto_feedback: true,
        }
    }
}

/// Settings for the create process popup
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CreateProcessSettings {
    /// Base directories - subdirectories are automatically listed
    #[serde(default)]
    pub base_directories: Vec<String>,

    /// Pinned directories - always shown as-is
    #[serde(default)]
    pub pinned: Vec<String>,
}

impl Default for AutoApproveSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: None,
            rules: RuleSettings::default(),
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
            line_wrap: false,
        }
    }
}

/// Git worktree settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeSettings {
    /// Commands to run after creating a new worktree (e.g., ["npm install", "cp .env.example .env"])
    #[serde(default)]
    pub setup_commands: Vec<String>,

    /// Timeout for each setup command in seconds (default: 300 = 5 minutes)
    #[serde(default = "default_setup_timeout")]
    pub setup_timeout_secs: u64,

    /// Branch depth at which to show a warning (default: 3 = great-grandchild of main)
    #[serde(default = "default_branch_depth_warning")]
    pub branch_depth_warning: u32,
}

/// Default setup timeout (5 minutes)
fn default_setup_timeout() -> u64 {
    300
}

/// Default branch depth warning threshold
fn default_branch_depth_warning() -> u32 {
    3
}

impl Default for WorktreeSettings {
    fn default() -> Self {
        Self {
            setup_commands: Vec::new(),
            setup_timeout_secs: default_setup_timeout(),
            branch_depth_warning: default_branch_depth_warning(),
        }
    }
}

/// Workflow automation settings
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkflowSettings {
    /// Automatically rebase open worktree branches onto main after a PR merge
    /// (default: false)
    #[serde(default)]
    pub auto_rebase_on_merge: bool,
}

/// Agent spawn settings (how new agents are started from the Web UI)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnSettings {
    /// When true and tmux is available, spawn agents in a tmux window
    /// instead of an internal PTY session. The agent appears as a normal
    /// tmux pane detected by the poller.
    #[serde(default)]
    pub use_tmux_window: bool,

    /// Name of the tmux window for spawned agents
    #[serde(default = "default_spawn_window_name")]
    pub tmux_window_name: String,
}

/// Default tmux window name for spawned agents
fn default_spawn_window_name() -> String {
    "tmai-agents".to_string()
}

impl Default for SpawnSettings {
    fn default() -> Self {
        Self {
            use_tmux_window: false,
            tmux_window_name: default_spawn_window_name(),
        }
    }
}

/// Codex CLI app-server WebSocket connection settings
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CodexWsSettings {
    /// WebSocket connections to Codex CLI app-server instances
    #[serde(default)]
    pub connections: Vec<CodexWsConnection>,
}

/// A single Codex CLI app-server WebSocket connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexWsConnection {
    /// WebSocket URL (e.g., "ws://127.0.0.1:15710")
    pub url: String,

    /// Optional tmux pane_id to associate with this connection.
    /// If omitted, pane is resolved via cwd matching.
    #[serde(default)]
    pub pane_id: Option<String>,
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
            create_process: CreateProcessSettings::default(),
            usage: UsageSettings::default(),
            review: ReviewSettings::default(),
            codex_ws: CodexWsSettings::default(),
            worktree: WorktreeSettings::default(),
            workflow: WorkflowSettings::default(),
            spawn: SpawnSettings::default(),
            projects: Vec::new(),
            webui: true,
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
        if cli.tmux {
            self.webui = false;
        }
    }

    /// Resolve the config file path (first existing, or default location).
    pub fn config_path() -> Option<std::path::PathBuf> {
        let candidates = [
            dirs::config_dir().map(|p| p.join("tmai/config.toml")),
            dirs::home_dir().map(|p| p.join(".config/tmai/config.toml")),
            dirs::home_dir().map(|p| p.join(".tmai.toml")),
        ];
        for path in candidates.iter().flatten() {
            if path.exists() {
                return Some(path.clone());
            }
        }
        // Default to XDG config dir (create on first save)
        dirs::config_dir().map(|p| p.join("tmai/config.toml"))
    }

    /// Update a single key within a TOML section, preserving comments/formatting.
    /// Creates the file and section if they don't exist.
    pub fn save_value(section: &str, key: &str, value: i64) {
        let Some(path) = Self::config_path() else {
            tracing::debug!("No config path available, skipping save");
            return;
        };
        let content = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            tracing::debug!(?path, %e, "Could not read config, starting fresh");
            String::new()
        });
        let mut doc = match content.parse::<toml_edit::DocumentMut>() {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(?path, %e, "Failed to parse config, starting fresh");
                toml_edit::DocumentMut::default()
            }
        };

        // Ensure section exists
        if !doc.contains_table(section) {
            doc[section] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        doc[section][key] = toml_edit::value(value);

        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                tracing::warn!(?path, %e, "Failed to create config directory");
                return;
            }
        }
        if let Err(e) = std::fs::write(&path, doc.to_string()) {
            tracing::warn!(?path, %e, "Failed to write config file");
        }
    }

    /// Update a string or bool value within a TOML section, preserving formatting.
    pub fn save_toml_value(section: &str, key: &str, value: toml_edit::Value) {
        let Some(path) = Self::config_path() else {
            return;
        };
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let mut doc = content
            .parse::<toml_edit::DocumentMut>()
            .unwrap_or_default();
        if !doc.contains_table(section) {
            doc[section] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        doc[section][key] = toml_edit::value(value);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&path, doc.to_string()) {
            tracing::warn!(?path, %e, "Failed to write config file");
        }
    }

    /// Update a value within a nested TOML subsection (e.g. `[auto_approve.rules]`).
    pub fn save_toml_nested_value(
        section: &str,
        subsection: &str,
        key: &str,
        value: toml_edit::Value,
    ) {
        let Some(path) = Self::config_path() else {
            return;
        };
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let mut doc = content
            .parse::<toml_edit::DocumentMut>()
            .unwrap_or_default();
        if !doc.contains_table(section) {
            doc[section] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        if doc[section]
            .as_table()
            .is_none_or(|t| !t.contains_table(subsection))
        {
            doc[section][subsection] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        doc[section][subsection][key] = toml_edit::value(value);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&path, doc.to_string()) {
            tracing::warn!(?path, %e, "Failed to write config file");
        }
    }

    /// Persist the projects list to config.toml
    pub fn save_projects(projects: &[String]) {
        let Some(path) = Self::config_path() else {
            tracing::debug!("No config path available, skipping save");
            return;
        };
        let content = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            tracing::debug!(?path, %e, "Could not read config, starting fresh");
            String::new()
        });
        let mut doc = match content.parse::<toml_edit::DocumentMut>() {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(?path, %e, "Failed to parse config, starting fresh");
                toml_edit::DocumentMut::default()
            }
        };

        let mut arr = toml_edit::Array::new();
        for p in projects {
            arr.push(p.as_str());
        }
        doc["projects"] = toml_edit::value(arr);

        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                tracing::warn!(?path, %e, "Failed to create config directory");
                return;
            }
        }
        if let Err(e) = std::fs::write(&path, doc.to_string()) {
            tracing::warn!(?path, %e, "Failed to write config file");
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

        // Validate auto-approve settings to prevent dangerous edge cases
        if self.auto_approve.check_interval_ms < 100 {
            self.auto_approve.check_interval_ms = 100;
        }
        if self.auto_approve.max_concurrent == 0 {
            self.auto_approve.max_concurrent = 1;
        }
        if self.auto_approve.timeout_secs == 0 {
            self.auto_approve.timeout_secs = 5;
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
    fn test_worktree_settings_default() {
        let settings = WorktreeSettings::default();
        assert!(settings.setup_commands.is_empty());
        assert_eq!(settings.setup_timeout_secs, 300);
    }

    #[test]
    fn test_worktree_settings_deserialization() {
        let toml = r#"
            [worktree]
            setup_commands = ["npm install", "cp .env.example .env"]
            setup_timeout_secs = 120
        "#;
        let settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        assert_eq!(settings.worktree.setup_commands.len(), 2);
        assert_eq!(settings.worktree.setup_commands[0], "npm install");
        assert_eq!(settings.worktree.setup_timeout_secs, 120);
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

    #[test]
    fn test_auto_approve_rules_defaults() {
        let rules = RuleSettings::default();
        assert!(rules.allow_read);
        assert!(rules.allow_tests);
        assert!(rules.allow_fetch);
        assert!(rules.allow_git_readonly);
        assert!(rules.allow_format_lint);
        assert!(rules.allow_patterns.is_empty());
    }

    #[test]
    fn test_auto_approve_rules_deserialization() {
        let toml = r#"
            [auto_approve]
            mode = "rules"

            [auto_approve.rules]
            allow_read = true
            allow_tests = false
            allow_fetch = true
            allow_git_readonly = false
            allow_format_lint = true
            allow_patterns = ["cargo build.*", "npm run build"]
        "#;

        let settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        let rules = &settings.auto_approve.rules;
        assert!(rules.allow_read);
        assert!(!rules.allow_tests);
        assert!(rules.allow_fetch);
        assert!(!rules.allow_git_readonly);
        assert!(rules.allow_format_lint);
        assert_eq!(rules.allow_patterns.len(), 2);
        assert_eq!(rules.allow_patterns[0], "cargo build.*");
    }
}
