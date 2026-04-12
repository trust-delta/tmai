use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use std::fmt;
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

    /// Orchestrator agent settings
    #[serde(default)]
    pub orchestrator: OrchestratorSettings,

    /// Legacy project paths (plain string array, migrated to `project` on load)
    #[serde(default, skip_serializing)]
    projects: Vec<String>,

    /// Project configurations with optional per-project orchestrator override
    #[serde(default)]
    pub project: Vec<ProjectConfig>,

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

    /// Preview polling interval (ms) when the browser tab is focused
    #[serde(default = "default_preview_poll_focused_ms")]
    pub preview_poll_focused_ms: u64,

    /// Preview polling interval (ms) when the browser tab is unfocused
    #[serde(default = "default_preview_poll_unfocused_ms")]
    pub preview_poll_unfocused_ms: u64,

    /// Preview polling interval (ms) during active input (passthrough typing)
    #[serde(default = "default_preview_poll_active_input_ms")]
    pub preview_poll_active_input_ms: u64,

    /// Duration (ms) to stay in fast polling mode after the last input event
    #[serde(default = "default_preview_active_input_window_ms")]
    pub preview_active_input_window_ms: u64,
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

fn default_preview_poll_focused_ms() -> u64 {
    500
}

fn default_preview_poll_unfocused_ms() -> u64 {
    2000
}

fn default_preview_poll_active_input_ms() -> u64 {
    100
}

fn default_preview_active_input_window_ms() -> u64 {
    2000
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
            preview_poll_focused_ms: default_preview_poll_focused_ms(),
            preview_poll_unfocused_ms: default_preview_poll_unfocused_ms(),
            preview_poll_active_input_ms: default_preview_poll_active_input_ms(),
            preview_active_input_window_ms: default_preview_active_input_window_ms(),
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

    /// Auto-approve tmai MCP tools (list_agents, approve, spawn_agent, etc.)
    #[serde(default = "default_true")]
    pub allow_tmai_mcp: bool,

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
            allow_tmai_mcp: true,
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

/// Project configuration with path and optional orchestrator override
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectConfig {
    /// Absolute path to the project directory
    pub path: String,
    /// Per-project orchestrator settings (overrides global if set)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orchestrator: Option<OrchestratorSettings>,
}

/// Orchestrator agent settings
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OrchestratorSettings {
    /// Enable orchestrator functionality
    #[serde(default)]
    pub enabled: bool,

    /// Role description for the orchestrator agent (system prompt preamble)
    #[serde(default = "default_orchestrator_role")]
    pub role: String,

    /// Workflow rules that guide the orchestrator's behavior
    #[serde(default)]
    pub rules: OrchestratorRules,

    /// Notification settings for sub-agent state changes
    #[serde(default)]
    pub notify: OrchestratorNotifySettings,

    /// Guardrail limits to prevent infinite loops
    #[serde(default)]
    pub guardrails: GuardrailsSettings,

    /// Enable automatic PR/CI status monitoring with notifications
    #[serde(default)]
    pub pr_monitor_enabled: bool,

    /// Polling interval for PR/CI status checks (seconds)
    #[serde(default = "default_pr_monitor_interval")]
    pub pr_monitor_interval_secs: u64,
}

/// Tri-state handling for orchestrator-observable events.
///
/// - `Off`: ignore the event entirely.
/// - `NotifyOrchestrator`: current behaviour — push a notification to the
///   orchestrator via `OrchestratorNotifier`.
/// - `AutoAction`: tmai handles the event directly (see `AutoActionExecutor`,
///   implemented in a follow-up PR).  `OrchestratorNotifier` skips these
///   events so they are not double-handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum EventHandling {
    #[default]
    Off,
    NotifyOrchestrator,
    AutoAction,
}

/// Serde default helper: events that default to notifying the orchestrator.
fn default_notify() -> EventHandling {
    EventHandling::NotifyOrchestrator
}

impl<'de> Deserialize<'de> for EventHandling {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct EventHandlingVisitor;

        impl<'de> Visitor<'de> for EventHandlingVisitor {
            type Value = EventHandling;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str(
                    "a bool or one of \"off\", \"notify\", \"notify_orchestrator\", \"auto_action\"",
                )
            }

            fn visit_bool<E>(self, v: bool) -> Result<EventHandling, E>
            where
                E: de::Error,
            {
                Ok(if v {
                    EventHandling::NotifyOrchestrator
                } else {
                    EventHandling::Off
                })
            }

            fn visit_str<E>(self, v: &str) -> Result<EventHandling, E>
            where
                E: de::Error,
            {
                match v {
                    "off" => Ok(EventHandling::Off),
                    "notify" | "notify_orchestrator" => Ok(EventHandling::NotifyOrchestrator),
                    "auto_action" => Ok(EventHandling::AutoAction),
                    other => Err(E::custom(format!(
                        "invalid EventHandling value {other:?}: expected bool or one of \"off\", \"notify\", \"notify_orchestrator\", \"auto_action\""
                    ))),
                }
            }

            fn visit_string<E>(self, v: String) -> Result<EventHandling, E>
            where
                E: de::Error,
            {
                self.visit_str(&v)
            }
        }

        deserializer.deserialize_any(EventHandlingVisitor)
    }
}

/// Settings controlling which sub-agent events notify the orchestrator.
///
/// Each event type has an independent handling mode (`EventHandling`) and an
/// optional prompt template override.  When a mode is `Off` the event is
/// silently recorded in task-meta milestones but never forwarded to the
/// orchestrator.  `AutoAction` routes the event to `AutoActionExecutor`
/// instead (see PR-B); `OrchestratorNotifier` treats `AutoAction` the same
/// as `Off`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OrchestratorNotifySettings {
    // ── Agent events ────────────────────────────────────────
    /// Notify when a sub-agent stops normally
    #[serde(default = "default_notify")]
    pub on_agent_stopped: EventHandling,

    /// Notify when a sub-agent enters error state
    #[serde(default = "default_notify")]
    pub on_agent_error: EventHandling,

    /// Notify on rebase/merge conflicts
    #[serde(default = "default_notify")]
    pub on_rebase_conflict: EventHandling,

    // ── CI events ───────────────────────────────────────────
    /// Notify when CI passes (default: off — normal flow needs no action)
    #[serde(default)]
    pub on_ci_passed: EventHandling,

    /// Notify when CI fails (requires action)
    #[serde(default = "default_notify")]
    pub on_ci_failed: EventHandling,

    // ── PR events ───────────────────────────────────────────
    /// Notify when a new PR is created
    #[serde(default = "default_notify")]
    pub on_pr_created: EventHandling,

    /// Notify on new PR review comments / feedback
    #[serde(default = "default_notify")]
    pub on_pr_comment: EventHandling,

    /// Notify when a PR is closed or merged
    #[serde(default = "default_notify")]
    pub on_pr_closed: EventHandling,

    // ── Guardrail events ────────────────────────────────────
    /// Notify when a guardrail limit is exceeded (CI retries, review loops, etc.)
    #[serde(default = "default_notify")]
    pub on_guardrail_exceeded: EventHandling,

    // ── Template overrides ──────────────────────────────────
    /// Per-event prompt template overrides (empty = use built-in default)
    #[serde(default)]
    pub templates: NotifyTemplates,
}

impl Default for OrchestratorNotifySettings {
    fn default() -> Self {
        Self {
            on_agent_stopped: EventHandling::NotifyOrchestrator,
            on_agent_error: EventHandling::NotifyOrchestrator,
            on_rebase_conflict: EventHandling::NotifyOrchestrator,
            on_ci_passed: EventHandling::Off,
            on_ci_failed: EventHandling::NotifyOrchestrator,
            on_pr_created: EventHandling::NotifyOrchestrator,
            on_pr_comment: EventHandling::NotifyOrchestrator,
            on_pr_closed: EventHandling::NotifyOrchestrator,
            on_guardrail_exceeded: EventHandling::NotifyOrchestrator,
            templates: NotifyTemplates::default(),
        }
    }
}

/// Per-event prompt template overrides.
///
/// Empty string means "use the built-in default template".
/// Templates support `{{variable}}` placeholders that are expanded at
/// notification time.  Available variables depend on the event type:
///
/// - All events: `{{name}}`, `{{branch}}`
/// - Agent events: `{{summary}}`
/// - CI/PR events: `{{pr_number}}`, `{{title}}`
/// - CI failed: `{{failed_details}}`
/// - PR comment: `{{comments_summary}}`
/// - Rebase conflict: `{{error}}`
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct NotifyTemplates {
    #[serde(default)]
    pub agent_stopped: String,
    #[serde(default)]
    pub agent_error: String,
    #[serde(default)]
    pub ci_passed: String,
    #[serde(default)]
    pub ci_failed: String,
    #[serde(default)]
    pub pr_created: String,
    #[serde(default)]
    pub pr_comment: String,
    #[serde(default)]
    pub rebase_conflict: String,
    #[serde(default)]
    pub pr_closed: String,
    #[serde(default)]
    pub guardrail_exceeded: String,
}

impl NotifyTemplates {
    /// Returns built-in default templates using `{{variable}}` placeholder syntax.
    /// These are shown as placeholder text in the UI so users know the format.
    pub fn defaults() -> Self {
        Self {
            agent_stopped: "[tmai] Agent \"{{name}}\" has stopped.\n  Branch: {{branch}}\n  Last message: {{summary}}".into(),
            agent_error: "[tmai] Agent \"{{name}}\" is now Error.\n  Branch: {{branch}}".into(),
            ci_passed: "[PR Monitor] PR #{{pr_number}} \"{{title}}\" CI passed. Ready to merge. {{summary}}".into(),
            ci_failed: "[PR Monitor] PR #{{pr_number}} \"{{title}}\" CI failed. {{failed_details}}".into(),
            pr_created: "[PR Monitor] PR #{{pr_number}} created: \"{{title}}\" (branch: {{branch}})".into(),
            pr_comment: "[PR Monitor] PR #{{pr_number}} \"{{title}}\" has review feedback: {{comments_summary}}".into(),
            rebase_conflict: "[tmai] Rebase conflict on branch \"{{branch}}\".\n  Error: {{error}}".into(),
            pr_closed: "[PR Monitor] PR #{{pr_number}} \"{{title}}\" closed (branch: {{branch}})".into(),
            guardrail_exceeded: "[tmai] Guardrail exceeded: {{guardrail}} on branch \"{{branch}}\".\n  Count: {{count}} / limit: {{limit}}\n  Action required: please review and intervene.".into(),
        }
    }
}

/// Guardrail limits to prevent infinite loops and enable human escalation.
///
/// When a limit is hit, a `GuardrailExceeded` CoreEvent is emitted so the
/// notification system can alert the orchestrator (or a human).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GuardrailsSettings {
    /// Max CI fix attempts per PR before escalation
    #[serde(default = "default_max_ci_retries")]
    pub max_ci_retries: u64,

    /// Max review→fix cycles per PR before escalation
    #[serde(default = "default_max_review_loops")]
    pub max_review_loops: u64,

    /// Consecutive failures before notifying human
    #[serde(default = "default_escalate_to_human_after")]
    pub escalate_to_human_after: u64,
}

impl Default for GuardrailsSettings {
    fn default() -> Self {
        Self {
            max_ci_retries: default_max_ci_retries(),
            max_review_loops: default_max_review_loops(),
            escalate_to_human_after: default_escalate_to_human_after(),
        }
    }
}

fn default_max_ci_retries() -> u64 {
    3
}

fn default_max_review_loops() -> u64 {
    5
}

fn default_escalate_to_human_after() -> u64 {
    3
}

/// Workflow rules for the orchestrator agent
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct OrchestratorRules {
    /// Branch naming convention (e.g., "Use {issue_number}-{slug} format")
    #[serde(default)]
    pub branch: String,

    /// Merge strategy (e.g., "squash merge to main, delete branch after merge")
    #[serde(default)]
    pub merge: String,

    /// Review process (e.g., "check CI status and run tests before merge")
    #[serde(default)]
    pub review: String,

    /// Custom rules (free-form instructions appended to the prompt)
    #[serde(default)]
    pub custom: String,
}

/// Default orchestrator role
fn default_orchestrator_role() -> String {
    "You are an orchestrator agent managing a team of AI coding agents. \
     Coordinate work by dispatching issues to worktree agents, monitoring their progress, \
     and ensuring quality through reviews.\n\n\
     Use tmai MCP tools to manage agents: list_agents, spawn_worktree, dispatch_issue, \
     get_agent_output, send_prompt, approve, etc.\n\n\
     Operation mode: Use /loop for periodic self-paced monitoring (check agent status, CI, PRs). \
     tmai also sends you push notifications for critical events (agent stopped, CI failure, etc.). \
     Combine both: /loop for situational awareness, push notifications for immediate response."
        .to_string()
}

impl Default for OrchestratorSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            role: default_orchestrator_role(),
            rules: OrchestratorRules::default(),
            notify: OrchestratorNotifySettings::default(),
            guardrails: GuardrailsSettings::default(),
            pr_monitor_enabled: false,
            pr_monitor_interval_secs: default_pr_monitor_interval(),
        }
    }
}

/// Default PR monitor polling interval (60 seconds)
fn default_pr_monitor_interval() -> u64 {
    60
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
            codex_ws: CodexWsSettings::default(),
            worktree: WorktreeSettings::default(),
            workflow: WorkflowSettings::default(),
            spawn: SpawnSettings::default(),
            orchestrator: OrchestratorSettings::default(),
            projects: Vec::new(),
            project: Vec::new(),
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

    /// Persist the projects list to config.toml.
    /// Preserves per-project orchestrator overrides for paths that still exist.
    pub fn save_projects(projects: &[String]) {
        let Some(path) = Self::config_path() else {
            tracing::debug!("No config path available, skipping save");
            return;
        };
        let content = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            tracing::debug!(?path, %e, "Could not read config, starting fresh");
            String::new()
        });

        // Load existing config to preserve orchestrator overrides
        let existing: Settings = toml::from_str(&content).unwrap_or_default();
        let mut configs: Vec<ProjectConfig> = Vec::new();
        for proj_path in projects {
            // Preserve existing orchestrator override if the path was already configured
            let orch = existing
                .project
                .iter()
                .find(|p| &p.path == proj_path)
                .and_then(|p| p.orchestrator.clone());
            configs.push(ProjectConfig {
                path: proj_path.clone(),
                orchestrator: orch,
            });
        }
        Self::save_project_configs(&configs);
    }

    /// Return project paths (from the canonical `project` array).
    pub fn project_paths(&self) -> Vec<String> {
        self.project.iter().map(|p| p.path.clone()).collect()
    }

    /// Find project config by path.
    pub fn find_project(&self, path: &str) -> Option<&ProjectConfig> {
        self.project.iter().find(|p| p.path == path)
    }

    /// Resolve effective orchestrator settings for a project.
    /// Returns per-project override if set, otherwise global settings.
    pub fn resolve_orchestrator(&self, project_path: Option<&str>) -> &OrchestratorSettings {
        if let Some(path) = project_path {
            if let Some(proj) = self.find_project(path) {
                if let Some(ref orch) = proj.orchestrator {
                    return orch;
                }
            }
        }
        &self.orchestrator
    }

    /// Persist project configs to config.toml as `[[project]]` table array.
    /// Preserves orchestrator overrides for paths that remain in the list.
    pub fn save_project_configs(configs: &[ProjectConfig]) {
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

        // Remove legacy `projects = [...]` key if present
        doc.remove("projects");

        // Build [[project]] array of tables
        let mut arr = toml_edit::ArrayOfTables::new();
        for cfg in configs {
            let mut tbl = toml_edit::Table::new();
            tbl["path"] = toml_edit::value(cfg.path.as_str());
            if let Some(ref orch) = cfg.orchestrator {
                let mut orch_tbl = toml_edit::Table::new();
                orch_tbl["enabled"] = toml_edit::value(orch.enabled);
                if orch.role != default_orchestrator_role() {
                    orch_tbl["role"] = toml_edit::value(orch.role.as_str());
                }
                let rules = &orch.rules;
                if !rules.branch.is_empty()
                    || !rules.merge.is_empty()
                    || !rules.review.is_empty()
                    || !rules.custom.is_empty()
                {
                    let mut rules_tbl = toml_edit::Table::new();
                    if !rules.branch.is_empty() {
                        rules_tbl["branch"] = toml_edit::value(rules.branch.as_str());
                    }
                    if !rules.merge.is_empty() {
                        rules_tbl["merge"] = toml_edit::value(rules.merge.as_str());
                    }
                    if !rules.review.is_empty() {
                        rules_tbl["review"] = toml_edit::value(rules.review.as_str());
                    }
                    if !rules.custom.is_empty() {
                        rules_tbl["custom"] = toml_edit::value(rules.custom.as_str());
                    }
                    orch_tbl["rules"] = toml_edit::Item::Table(rules_tbl);
                }
                tbl["orchestrator"] = toml_edit::Item::Table(orch_tbl);
            }
            arr.push(tbl);
        }
        doc["project"] = toml_edit::Item::ArrayOfTables(arr);

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

    /// Save orchestrator settings for a specific project (or global if path is None).
    pub fn save_project_orchestrator(project_path: Option<&str>, orch: &OrchestratorSettings) {
        match project_path {
            None => {
                // Save to global [orchestrator] section
                Self::save_toml_value(
                    "orchestrator",
                    "enabled",
                    toml_edit::Value::from(orch.enabled),
                );
                Self::save_toml_value(
                    "orchestrator",
                    "role",
                    toml_edit::Value::from(orch.role.as_str()),
                );
                Self::save_toml_nested_value(
                    "orchestrator",
                    "rules",
                    "branch",
                    toml_edit::Value::from(orch.rules.branch.as_str()),
                );
                Self::save_toml_nested_value(
                    "orchestrator",
                    "rules",
                    "merge",
                    toml_edit::Value::from(orch.rules.merge.as_str()),
                );
                Self::save_toml_nested_value(
                    "orchestrator",
                    "rules",
                    "review",
                    toml_edit::Value::from(orch.rules.review.as_str()),
                );
                Self::save_toml_nested_value(
                    "orchestrator",
                    "rules",
                    "custom",
                    toml_edit::Value::from(orch.rules.custom.as_str()),
                );
            }
            Some(proj_path) => {
                // Save per-project orchestrator by rewriting [[project]] array
                let Some(path) = Self::config_path() else {
                    return;
                };
                let content = std::fs::read_to_string(&path).unwrap_or_default();
                let settings: Settings = toml::from_str(&content).unwrap_or_default();

                let configs: Vec<ProjectConfig> = settings
                    .project
                    .into_iter()
                    .map(|mut p| {
                        if p.path == proj_path {
                            p.orchestrator = Some(orch.clone());
                        }
                        p
                    })
                    .collect();
                Self::save_project_configs(&configs);
            }
        }
    }

    /// Validate and normalize settings values
    ///
    /// Ensures poll intervals have a minimum value to prevent CPU exhaustion.
    /// Also migrates legacy `projects` string array into `project` configs.
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

        // Migrate legacy `projects = ["..."]` into `project` configs
        if !self.projects.is_empty() {
            let legacy = std::mem::take(&mut self.projects);
            let existing_paths: std::collections::HashSet<String> =
                self.project.iter().map(|p| p.path.clone()).collect();
            for path in legacy {
                if !existing_paths.contains(&path) {
                    self.project.push(ProjectConfig {
                        path,
                        orchestrator: None,
                    });
                }
            }
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

    // ── EventHandling / OrchestratorNotifySettings migration tests ──
    //
    // These cover the backward-compat path added in PR-A of #364: old
    // `bool` config values must still deserialize, while the new `string`
    // form unlocks the forthcoming `AutoAction` state.

    #[derive(Debug, Deserialize)]
    struct OneField {
        on_ci_failed: EventHandling,
    }

    #[test]
    fn event_handling_legacy_bool_true_becomes_notify() {
        let v: OneField = toml::from_str("on_ci_failed = true").unwrap();
        assert_eq!(v.on_ci_failed, EventHandling::NotifyOrchestrator);
    }

    #[test]
    fn event_handling_legacy_bool_false_becomes_off() {
        let v: OneField = toml::from_str("on_ci_failed = false").unwrap();
        assert_eq!(v.on_ci_failed, EventHandling::Off);
    }

    #[test]
    fn event_handling_string_auto_action() {
        let v: OneField = toml::from_str(r#"on_ci_failed = "auto_action""#).unwrap();
        assert_eq!(v.on_ci_failed, EventHandling::AutoAction);
    }

    #[test]
    fn event_handling_string_notify() {
        let v: OneField = toml::from_str(r#"on_ci_failed = "notify""#).unwrap();
        assert_eq!(v.on_ci_failed, EventHandling::NotifyOrchestrator);
    }

    #[test]
    fn event_handling_string_notify_orchestrator_alias() {
        let v: OneField = toml::from_str(r#"on_ci_failed = "notify_orchestrator""#).unwrap();
        assert_eq!(v.on_ci_failed, EventHandling::NotifyOrchestrator);
    }

    #[test]
    fn event_handling_string_off() {
        let v: OneField = toml::from_str(r#"on_ci_failed = "off""#).unwrap();
        assert_eq!(v.on_ci_failed, EventHandling::Off);
    }

    #[test]
    fn event_handling_invalid_string_errors() {
        let err = toml::from_str::<OneField>(r#"on_ci_failed = "wrong""#).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("wrong") || msg.to_lowercase().contains("invalid"),
            "expected error mentioning the invalid value, got: {msg}"
        );
    }

    #[test]
    fn orchestrator_notify_settings_defaults_match_legacy_semantics() {
        let s = OrchestratorNotifySettings::default();
        assert_eq!(s.on_ci_passed, EventHandling::Off);
        assert_eq!(s.on_ci_failed, EventHandling::NotifyOrchestrator);
        assert_eq!(s.on_agent_stopped, EventHandling::NotifyOrchestrator);
        assert_eq!(s.on_agent_error, EventHandling::NotifyOrchestrator);
        assert_eq!(s.on_rebase_conflict, EventHandling::NotifyOrchestrator);
        assert_eq!(s.on_pr_created, EventHandling::NotifyOrchestrator);
        assert_eq!(s.on_pr_comment, EventHandling::NotifyOrchestrator);
        assert_eq!(s.on_pr_closed, EventHandling::NotifyOrchestrator);
        assert_eq!(s.on_guardrail_exceeded, EventHandling::NotifyOrchestrator);
    }

    #[test]
    fn event_handling_round_trip_auto_action() {
        let encoded = serde_json::to_string(&EventHandling::AutoAction).unwrap();
        assert_eq!(encoded, "\"auto_action\"");
        let decoded: EventHandling = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, EventHandling::AutoAction);
    }

    #[test]
    fn event_handling_round_trip_notify_orchestrator() {
        let encoded = serde_json::to_string(&EventHandling::NotifyOrchestrator).unwrap();
        assert_eq!(encoded, "\"notify_orchestrator\"");
        let decoded: EventHandling = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, EventHandling::NotifyOrchestrator);
    }

    #[test]
    fn orchestrator_notify_settings_mixed_toml_migration() {
        // Some fields legacy bool, some new string — must all coexist.
        let toml_text = r#"
            on_ci_failed = "auto_action"
            on_ci_passed = true
            on_pr_comment = false
            on_pr_created = "notify"
        "#;
        let s: OrchestratorNotifySettings = toml::from_str(toml_text).unwrap();
        assert_eq!(s.on_ci_failed, EventHandling::AutoAction);
        assert_eq!(s.on_ci_passed, EventHandling::NotifyOrchestrator);
        assert_eq!(s.on_pr_comment, EventHandling::Off);
        assert_eq!(s.on_pr_created, EventHandling::NotifyOrchestrator);
        // unset fields fall back to defaults
        assert_eq!(s.on_pr_closed, EventHandling::NotifyOrchestrator);
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
    fn test_orchestrator_settings_default() {
        let settings = OrchestratorSettings::default();
        assert!(!settings.enabled);
        assert!(!settings.role.is_empty());
        assert!(settings.rules.branch.is_empty());
        assert!(settings.rules.merge.is_empty());
        assert!(settings.rules.review.is_empty());
        assert!(settings.rules.custom.is_empty());
    }

    #[test]
    fn test_orchestrator_settings_deserialization() {
        let toml = r#"
            [orchestrator]
            enabled = true
            role = "Custom orchestrator role"

            [orchestrator.rules]
            branch = "Use {issue_number}-{slug} format"
            merge = "squash merge to main"
            review = "check CI before merge"
            custom = "always create PR with description"
        "#;
        let settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        assert!(settings.orchestrator.enabled);
        assert_eq!(settings.orchestrator.role, "Custom orchestrator role");
        assert_eq!(
            settings.orchestrator.rules.branch,
            "Use {issue_number}-{slug} format"
        );
        assert_eq!(settings.orchestrator.rules.merge, "squash merge to main");
        assert_eq!(settings.orchestrator.rules.review, "check CI before merge");
        assert_eq!(
            settings.orchestrator.rules.custom,
            "always create PR with description"
        );
    }

    #[test]
    fn test_orchestrator_partial_deserialization() {
        let toml = r#"
            [orchestrator]
            enabled = true
        "#;
        let settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        assert!(settings.orchestrator.enabled);
        // role should get the default value
        assert!(!settings.orchestrator.role.is_empty());
        // rules should be empty defaults
        assert!(settings.orchestrator.rules.branch.is_empty());
    }

    #[test]
    fn test_legacy_projects_migration() {
        let toml = r#"
            projects = ["/home/user/project-a", "/home/user/project-b"]
        "#;
        let mut settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        settings.validate();
        // Legacy projects should be migrated to project configs
        assert_eq!(settings.project.len(), 2);
        assert_eq!(settings.project[0].path, "/home/user/project-a");
        assert_eq!(settings.project[1].path, "/home/user/project-b");
        assert!(settings.project[0].orchestrator.is_none());
        assert!(settings.project[1].orchestrator.is_none());
        // Legacy field should be empty after migration
        assert!(settings.projects.is_empty());
    }

    #[test]
    fn test_project_config_deserialization() {
        let toml = r#"
            [[project]]
            path = "/home/user/project-a"

            [[project]]
            path = "/home/user/project-b"
            [project.orchestrator]
            enabled = true
            role = "Custom orchestrator for project B"
        "#;
        let settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        assert_eq!(settings.project.len(), 2);
        assert_eq!(settings.project[0].path, "/home/user/project-a");
        assert!(settings.project[0].orchestrator.is_none());
        assert_eq!(settings.project[1].path, "/home/user/project-b");
        let orch = settings.project[1].orchestrator.as_ref().unwrap();
        assert!(orch.enabled);
        assert_eq!(orch.role, "Custom orchestrator for project B");
    }

    #[test]
    fn test_resolve_orchestrator_global_fallback() {
        let mut settings = Settings::default();
        settings.orchestrator.enabled = true;
        settings.orchestrator.role = "Global role".to_string();
        settings.project.push(ProjectConfig {
            path: "/home/user/proj".to_string(),
            orchestrator: None,
        });

        // No project override → global
        let orch = settings.resolve_orchestrator(Some("/home/user/proj"));
        assert_eq!(orch.role, "Global role");
        assert!(orch.enabled);
    }

    #[test]
    fn test_resolve_orchestrator_project_override() {
        let mut settings = Settings::default();
        settings.orchestrator.enabled = true;
        settings.orchestrator.role = "Global role".to_string();
        settings.project.push(ProjectConfig {
            path: "/home/user/proj".to_string(),
            orchestrator: Some(OrchestratorSettings {
                enabled: true,
                role: "Project-specific role".to_string(),
                rules: OrchestratorRules::default(),
                ..Default::default()
            }),
        });

        // Project override exists → per-project
        let orch = settings.resolve_orchestrator(Some("/home/user/proj"));
        assert_eq!(orch.role, "Project-specific role");

        // Unknown project → global
        let orch = settings.resolve_orchestrator(Some("/unknown"));
        assert_eq!(orch.role, "Global role");

        // No project → global
        let orch = settings.resolve_orchestrator(None);
        assert_eq!(orch.role, "Global role");
    }

    #[test]
    fn test_project_paths_helper() {
        let mut settings = Settings::default();
        settings.project.push(ProjectConfig {
            path: "/a".to_string(),
            orchestrator: None,
        });
        settings.project.push(ProjectConfig {
            path: "/b".to_string(),
            orchestrator: None,
        });
        assert_eq!(settings.project_paths(), vec!["/a", "/b"]);
    }

    #[test]
    fn test_legacy_and_new_projects_merge() {
        let toml = r#"
            projects = ["/legacy-path"]

            [[project]]
            path = "/new-path"
        "#;
        let mut settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        settings.validate();
        // Both should be present, no duplicates
        assert_eq!(settings.project.len(), 2);
        let paths: Vec<&str> = settings.project.iter().map(|p| p.path.as_str()).collect();
        assert!(paths.contains(&"/new-path"));
        assert!(paths.contains(&"/legacy-path"));
    }

    #[test]
    fn test_legacy_duplicate_not_duplicated() {
        let toml = r#"
            projects = ["/same-path"]

            [[project]]
            path = "/same-path"
            [project.orchestrator]
            enabled = true
        "#;
        let mut settings: Settings = toml::from_str(toml).expect("Should parse TOML");
        settings.validate();
        // Should not duplicate
        assert_eq!(settings.project.len(), 1);
        assert_eq!(settings.project[0].path, "/same-path");
        // Orchestrator from [[project]] should be preserved
        assert!(settings.project[0].orchestrator.is_some());
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

    #[test]
    fn test_guardrails_defaults() {
        let g = GuardrailsSettings::default();
        assert_eq!(g.max_ci_retries, 3);
        assert_eq!(g.max_review_loops, 5);
        assert_eq!(g.escalate_to_human_after, 3);
    }

    #[test]
    fn test_guardrails_serde_defaults() {
        // Empty TOML should produce defaults
        let toml = "";
        let g: GuardrailsSettings = toml::from_str(toml).unwrap();
        assert_eq!(g.max_ci_retries, 3);
        assert_eq!(g.max_review_loops, 5);
        assert_eq!(g.escalate_to_human_after, 3);
    }

    #[test]
    fn test_guardrails_serde_partial() {
        let toml = "max_ci_retries = 10";
        let g: GuardrailsSettings = toml::from_str(toml).unwrap();
        assert_eq!(g.max_ci_retries, 10);
        assert_eq!(g.max_review_loops, 5); // default
        assert_eq!(g.escalate_to_human_after, 3); // default
    }

    #[test]
    fn test_orchestrator_settings_includes_guardrails() {
        let toml = r#"
            enabled = true
            [guardrails]
            max_ci_retries = 7
            max_review_loops = 10
            escalate_to_human_after = 5
        "#;
        let orch: OrchestratorSettings = toml::from_str(toml).unwrap();
        assert!(orch.enabled);
        assert_eq!(orch.guardrails.max_ci_retries, 7);
        assert_eq!(orch.guardrails.max_review_loops, 10);
        assert_eq!(orch.guardrails.escalate_to_human_after, 5);
    }

    #[test]
    fn test_notify_settings_guardrail_exceeded_default() {
        let n = OrchestratorNotifySettings::default();
        assert_eq!(
            n.on_guardrail_exceeded,
            EventHandling::NotifyOrchestrator,
            "on_guardrail_exceeded should default to NotifyOrchestrator"
        );
    }

    #[test]
    fn test_notify_templates_defaults_non_empty() {
        let d = NotifyTemplates::defaults();
        assert!(!d.agent_stopped.is_empty());
        assert!(!d.agent_error.is_empty());
        assert!(!d.ci_passed.is_empty());
        assert!(!d.ci_failed.is_empty());
        assert!(!d.pr_created.is_empty());
        assert!(!d.pr_comment.is_empty());
        assert!(!d.rebase_conflict.is_empty());
        assert!(!d.pr_closed.is_empty());
        assert!(!d.guardrail_exceeded.is_empty());
    }

    #[test]
    fn test_notify_templates_defaults_contain_placeholders() {
        let d = NotifyTemplates::defaults();
        assert!(d.agent_stopped.contains("{{name}}"));
        assert!(d.agent_stopped.contains("{{summary}}"));
        assert!(d.ci_failed.contains("{{failed_details}}"));
        assert!(d.pr_comment.contains("{{comments_summary}}"));
        assert!(d.guardrail_exceeded.contains("{{guardrail}}"));
    }
}
