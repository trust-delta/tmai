use std::fmt;

use serde::{Deserialize, Serialize};

use crate::auto_approve::AutoApprovePhase;
use crate::detectors::DetectionReason;
use crate::teams::TaskStatus;

/// Claude Code effort level detected from title icon (v2.1.72+)
///
/// Displayed as: ○=low, ◐=medium, ●=high
///
/// Note: ● (High) shares the same glyph as `DetectionSource::CapturePane` icon,
/// but they appear in different UI positions (effort is next to mode, detection
/// source is in the status column) so there is no visual ambiguity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffortLevel {
    /// Low effort (○)
    Low,
    /// Medium effort (◐) — default since v2.1.68 for Opus
    Medium,
    /// High effort (●)
    High,
}

impl fmt::Display for EffortLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EffortLevel::Low => write!(f, "○"),
            EffortLevel::Medium => write!(f, "◐"),
            EffortLevel::High => write!(f, "●"),
        }
    }
}

/// Claude Code permission mode detected from title icon
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentMode {
    /// Default mode - normal permissions
    #[default]
    Default,
    /// ⏸ Plan mode - read-only exploration, no tool execution
    Plan,
    /// ⇢ Delegate mode
    Delegate,
    /// ⏵⏵ Auto-approve mode (acceptEdits / bypassPermissions / dontAsk)
    AutoApprove,
}

impl fmt::Display for AgentMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentMode::Default => write!(f, ""),
            AgentMode::Plan => write!(f, "\u{23F8} Plan"),
            AgentMode::Delegate => write!(f, "\u{21E2} Delegate"),
            AgentMode::AutoApprove => write!(f, "\u{23F5}\u{23F5} Auto"),
        }
    }
}

/// Which communication channels are currently available for this agent.
/// Each channel is independently tracked (not mutually exclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ConnectionChannels {
    /// tmux pane exists (capture-pane and send-keys available)
    pub has_tmux: bool,
    /// IPC socket connected (PTY wrapper via Unix domain socket)
    pub has_ipc: bool,
    /// HTTP hook events being received (Claude Code Hooks)
    pub has_hook: bool,
    /// Codex CLI WebSocket connected
    pub has_websocket: bool,
}

/// Source of agent state detection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum DetectionSource {
    /// State detected via Claude Code HTTP hook (highest fidelity)
    HttpHook,
    /// State detected via IPC socket connection
    IpcSocket,
    /// State detected via Codex CLI app-server WebSocket
    WebSocket,
    /// State detected via tmux capture-pane
    #[default]
    CapturePane,
}

impl DetectionSource {
    /// Get icon for this detection source
    pub fn icon(&self) -> char {
        match self {
            DetectionSource::HttpHook => '◈',
            DetectionSource::IpcSocket => '⊙',
            DetectionSource::WebSocket => '◆',
            DetectionSource::CapturePane => '●',
        }
    }

    /// Get short label for this detection source
    pub fn label(&self) -> &'static str {
        match self {
            DetectionSource::HttpHook => "Hook",
            DetectionSource::IpcSocket => "IPC",
            DetectionSource::WebSocket => "WS",
            DetectionSource::CapturePane => "capture",
        }
    }
}

/// Best available method for sending keystrokes to this agent
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum SendCapability {
    /// Codex WebSocket bidirectional control (JSON-RPC turn/start, approve)
    CodexWebSocket,
    /// IPC connection available (PTY master held by tmai wrap)
    Ipc,
    /// tmux send-keys available (agent runs in a tmux pane)
    Tmux,
    /// PTY inject available (TIOCSTI via /proc/{pid}/fd/0, kernel support required)
    PtyInject,
    /// No send path available (detection only)
    #[default]
    None,
}

impl SendCapability {
    /// Get icon for this send capability
    pub fn icon(&self) -> char {
        match self {
            SendCapability::CodexWebSocket => '⇌',
            SendCapability::Ipc => '⇋',
            SendCapability::Tmux => '⇉',
            SendCapability::PtyInject => '⇝',
            SendCapability::None => '⊘',
        }
    }

    /// Get short label for this send capability
    pub fn label(&self) -> &'static str {
        match self {
            SendCapability::CodexWebSocket => "WS",
            SendCapability::Ipc => "IPC",
            SendCapability::Tmux => "tmux",
            SendCapability::PtyInject => "PTY",
            SendCapability::None => "none",
        }
    }

    /// Whether this agent can receive keystrokes
    pub fn can_send(&self) -> bool {
        !matches!(self, SendCapability::None)
    }
}

/// Type of AI agent being monitored
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AgentType {
    ClaudeCode,
    OpenCode,
    CodexCli,
    GeminiCli,
    Custom(String),
}

impl AgentType {
    /// Parse agent type from command name and detection strings
    /// Note: window_name is intentionally NOT used for detection because
    /// all panes in a window share the same window_name, causing false positives.
    pub fn from_detection(command: &str, title: &str, _window_name: &str) -> Option<Self> {
        Self::from_detection_with_cmdline(command, title, _window_name, None)
    }

    /// Parse agent type with optional cmdline from /proc
    pub fn from_detection_with_cmdline(
        command: &str,
        title: &str,
        _window_name: &str,
        cmdline: Option<&str>,
    ) -> Option<Self> {
        let cmd_lower = command.to_lowercase();
        let title_lower = title.to_lowercase();
        let cmdline_lower = cmdline.map(|s| s.to_lowercase());

        // First, check exact command matches (highest priority)
        if cmd_lower == "claude" {
            return Some(AgentType::ClaudeCode);
        }
        if cmd_lower == "opencode" {
            return Some(AgentType::OpenCode);
        }
        if cmd_lower == "codex" {
            return Some(AgentType::CodexCli);
        }
        if cmd_lower == "gemini" {
            return Some(AgentType::GeminiCli);
        }

        // Early exit for known non-agent commands
        // These should never be detected as agents even if title contains agent keywords
        if Self::is_known_non_agent_command(&cmd_lower) {
            return None;
        }

        // Check cmdline for agent keywords (e.g., "node /path/to/codex", "tmai wrap claude")
        // Uses helper that matches both "agent " (mid-string) and trailing "agent" (end-of-string)
        if let Some(ref cl) = cmdline_lower {
            if Self::cmdline_contains_agent(cl, "codex") {
                return Some(AgentType::CodexCli);
            }
            if Self::cmdline_contains_agent(cl, "gemini") {
                return Some(AgentType::GeminiCli);
            }
            if Self::cmdline_contains_agent(cl, "opencode") {
                return Some(AgentType::OpenCode);
            }
            if Self::cmdline_contains_agent(cl, "claude") {
                return Some(AgentType::ClaudeCode);
            }
        }

        // Claude Code detection via title indicators
        // version-like command (e.g., "2.1.11"), ✳ (idle), or braille spinners
        if Self::is_version_like(command) || title.contains('✳') || Self::has_braille_spinner(title)
        {
            return Some(AgentType::ClaudeCode);
        }

        // Title-based detection (lower priority)
        // Only match if title appears to be a CLI tool title, not just containing the keyword
        // (e.g., "Codex CLI" or "codex>" but not "editing codex.rs")
        if Self::is_likely_agent_title(&title_lower, "opencode") {
            return Some(AgentType::OpenCode);
        }
        if Self::is_likely_agent_title(&title_lower, "codex") {
            return Some(AgentType::CodexCli);
        }
        if Self::is_likely_agent_title(&title_lower, "gemini") {
            return Some(AgentType::GeminiCli);
        }

        None
    }

    /// Check if cmdline contains an agent name as a word boundary match.
    ///
    /// Matches `/agent`, `agent `, or `agent` at end-of-string.
    /// This handles cases like `tmai wrap claude` where the agent name
    /// appears at the end without a trailing space.
    fn cmdline_contains_agent(cmdline: &str, agent: &str) -> bool {
        cmdline.contains(&format!("/{}", agent))
            || cmdline.contains(&format!("{} ", agent))
            || cmdline.ends_with(agent)
    }

    /// Check if command is a known non-agent application
    fn is_known_non_agent_command(cmd_lower: &str) -> bool {
        const NON_AGENT_COMMANDS: &[&str] = &[
            // File managers
            "yazi", "ranger", "lf", "nnn", "mc", "vifm", // Editors
            "vim", "nvim", "nano", "emacs", "helix", "hx", "micro", "code", // Shells
            "bash", "zsh", "fish", "sh", "dash", "tcsh", "ksh", // Common utilities
            "less", "more", "man", "htop", "btop", "top", "tmux", "screen", "git", "tig",
            "lazygit", "docker", "kubectl", // Pagers and viewers
            "bat", "cat", "head", "tail",
        ];
        NON_AGENT_COMMANDS.contains(&cmd_lower)
    }

    /// Check if title looks like an agent CLI title rather than incidental keyword match
    fn is_likely_agent_title(title_lower: &str, agent_name: &str) -> bool {
        // Exact match or starts with agent name
        if title_lower == agent_name || title_lower.starts_with(&format!("{} ", agent_name)) {
            return true;
        }

        // Patterns that suggest this is actually the agent CLI
        // e.g., "Codex CLI", "codex>", "codex:", "Gemini CLI"
        let patterns = [
            format!("{} cli", agent_name),
            format!("{}>", agent_name),
            format!("{}:", agent_name),
            format!("{} -", agent_name), // e.g., "codex - working"
        ];

        for pattern in &patterns {
            if title_lower.contains(pattern) {
                return true;
            }
        }

        // Avoid false positives: if the keyword is part of a file path or filename
        // e.g., "codex.rs", "/path/to/codex/", "editing codex"
        if title_lower.contains(&format!("{}.rs", agent_name))
            || title_lower.contains(&format!("{}.py", agent_name))
            || title_lower.contains(&format!("{}.js", agent_name))
            || title_lower.contains(&format!("{}.ts", agent_name))
            || title_lower.contains(&format!("/{}/", agent_name))
        {
            return false;
        }

        // If title is just the agent name or very short with agent name at start, likely agent
        if title_lower.len() <= agent_name.len() + 20 && title_lower.starts_with(agent_name) {
            return true;
        }

        false
    }

    /// Check if title contains braille spinner characters (Claude Code processing indicator)
    fn has_braille_spinner(title: &str) -> bool {
        // Braille pattern characters used by Claude Code spinner
        const BRAILLE_SPINNERS: &[char] = &[
            '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', '⠐', '⠠', '⠄', '⠂', '⠁', '⠈', '⠃',
            '⠉', '⠊', '⠑', '⠒', '⠓', '⠔', '⠕', '⠖', '⠗', '⠘', '⠚', '⠛', '⠜', '⠝', '⠞', '⠟', '⠡',
            '⠢', '⠣', '⠤', '⠥', '⠨', '⠩', '⠪', '⠫', '⠬', '⠭', '⠮', '⠯', '⠰', '⠱', '⠲', '⠳', '⠵',
            '⠶', '⠷', '⠺', '⠻', '⠽', '⠾', '⠿',
        ];
        title.chars().any(|c| BRAILLE_SPINNERS.contains(&c))
    }

    /// Check if a string looks like a version number (e.g., "2.1.11")
    /// Claude Code's pane_current_command often shows version number
    fn is_version_like(s: &str) -> bool {
        if s.is_empty() {
            return false;
        }
        let has_dot = s.contains('.');
        let all_valid = s.chars().all(|c| c.is_ascii_digit() || c == '.');
        has_dot
            && all_valid
            && s.chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
    }

    /// Short name for display
    pub fn short_name(&self) -> &str {
        match self {
            AgentType::ClaudeCode => "Claude",
            AgentType::OpenCode => "OpenCode",
            AgentType::CodexCli => "Codex",
            AgentType::GeminiCli => "Gemini",
            AgentType::Custom(name) => name,
        }
    }

    /// Get the command to launch this agent type
    pub fn command(&self) -> &str {
        match self {
            AgentType::ClaudeCode => "claude",
            AgentType::OpenCode => "opencode",
            AgentType::CodexCli => "codex",
            AgentType::GeminiCli => "gemini",
            AgentType::Custom(_) => "",
        }
    }

    /// Get all standard agent type variants (excluding Custom)
    pub fn all_variants() -> Vec<AgentType> {
        vec![
            AgentType::ClaudeCode,
            AgentType::OpenCode,
            AgentType::CodexCli,
            AgentType::GeminiCli,
        ]
    }
}

impl fmt::Display for AgentType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentType::ClaudeCode => write!(f, "Claude Code"),
            AgentType::OpenCode => write!(f, "OpenCode"),
            AgentType::CodexCli => write!(f, "Codex CLI"),
            AgentType::GeminiCli => write!(f, "Gemini CLI"),
            AgentType::Custom(name) => write!(f, "{}", name),
        }
    }
}

/// Category of approval being requested
///
/// Pure classification — no UI/interaction data embedded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApprovalCategory {
    /// File edit request
    FileEdit,
    /// File creation request
    FileCreate,
    /// File deletion request
    FileDelete,
    /// Shell command execution request
    ShellCommand,
    /// MCP tool invocation request
    McpTool,
    /// User question with selectable choices (AskUserQuestion)
    UserQuestion,
    /// Other/unknown approval type
    Other(String),
}

impl fmt::Display for ApprovalCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApprovalCategory::FileEdit => write!(f, "File Edit"),
            ApprovalCategory::FileCreate => write!(f, "File Create"),
            ApprovalCategory::FileDelete => write!(f, "File Delete"),
            ApprovalCategory::ShellCommand => write!(f, "Shell Command"),
            ApprovalCategory::McpTool => write!(f, "MCP Tool"),
            ApprovalCategory::UserQuestion => write!(f, "Question"),
            ApprovalCategory::Other(s) => write!(f, "{}", s),
        }
    }
}

/// How the user interacts with an approval prompt
///
/// Separated from `ApprovalCategory` so that categories and interaction
/// patterns can evolve independently.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum InteractionMode {
    /// Single-select list (radio buttons / numbered choices)
    SingleSelect {
        choices: Vec<String>,
        /// Current cursor position (1-indexed, 0 means unknown)
        cursor_position: usize,
    },
    /// Multi-select list (checkboxes)
    MultiSelect {
        choices: Vec<String>,
        /// Current cursor position (1-indexed, 0 means unknown)
        cursor_position: usize,
    },
}

/// Coarse-grained phase for orchestrator consumption.
///
/// Derived from `AgentStatus` — orchestrator tools operate on phase for simple,
/// stable categories suitable for decision-making.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Phase {
    /// Actively processing (tools, thinking, compacting)
    Working,
    /// Needs intervention (approval, error, user question)
    Blocked,
    /// Waiting for next instruction
    Idle,
    /// Not connected / not yet started
    Offline,
}

impl fmt::Display for Phase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Phase::Working => write!(f, "working"),
            Phase::Blocked => write!(f, "blocked"),
            Phase::Idle => write!(f, "idle"),
            Phase::Offline => write!(f, "offline"),
        }
    }
}

impl Phase {
    /// Parse from a string (case-insensitive)
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "working" => Some(Phase::Working),
            "blocked" => Some(Phase::Blocked),
            "idle" => Some(Phase::Idle),
            "offline" => Some(Phase::Offline),
            _ => None,
        }
    }
}

/// Fine-grained detail for UI display.
///
/// Provides rich information about what the agent is currently doing,
/// while `Phase` gives the coarse category for orchestrator logic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Detail {
    /// Executing a tool (Read, Edit, Bash, etc.)
    ToolExecution { tool_name: String },
    /// Compacting context window
    Compacting,
    /// Thinking / processing without a specific tool
    Thinking,
    /// Waiting for user approval on a tool or action
    AwaitingApproval {
        approval_type: ApprovalCategory,
        details: String,
        interaction: Option<InteractionMode>,
    },
    /// Agent encountered an error
    Error { message: String },
    /// Agent is idle, waiting for input
    Idle,
    /// Agent is offline / not connected
    Offline,
    /// Status could not be determined
    Unknown,
}

impl fmt::Display for Detail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Detail::ToolExecution { tool_name } => write!(f, "Tool: {}", tool_name),
            Detail::Compacting => write!(f, "Compacting context…"),
            Detail::Thinking => write!(f, "Thinking"),
            Detail::AwaitingApproval { approval_type, .. } => {
                write!(f, "Awaiting: {}", approval_type)
            }
            Detail::Error { message } => write!(f, "Error: {}", message),
            Detail::Idle => write!(f, "Idle"),
            Detail::Offline => write!(f, "Offline"),
            Detail::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Current status of an agent
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentStatus {
    /// Agent is idle, waiting for input
    Idle,
    /// Agent is actively processing
    Processing { activity: String },
    /// Agent is waiting for user approval
    AwaitingApproval {
        approval_type: ApprovalCategory,
        details: String,
        /// Interaction mode for user-facing prompts (e.g., single/multi-select)
        #[serde(skip_serializing_if = "Option::is_none", default)]
        interaction: Option<InteractionMode>,
    },
    /// Agent encountered an error
    Error { message: String },
    /// Team member whose pane is not found (not yet started or already exited)
    Offline,
    /// Status could not be determined
    #[default]
    Unknown,
}

impl AgentStatus {
    /// Derive the coarse-grained phase from this status
    pub fn phase(&self) -> Phase {
        match self {
            AgentStatus::Processing { .. } => Phase::Working,
            AgentStatus::AwaitingApproval { .. } | AgentStatus::Error { .. } => Phase::Blocked,
            AgentStatus::Idle => Phase::Idle,
            AgentStatus::Offline | AgentStatus::Unknown => Phase::Offline,
        }
    }

    /// Derive the fine-grained detail from this status
    pub fn detail(&self) -> Detail {
        match self {
            AgentStatus::Processing { activity } => {
                if activity.starts_with("Tool: ") {
                    Detail::ToolExecution {
                        tool_name: activity.trim_start_matches("Tool: ").to_string(),
                    }
                } else if activity.contains("Compacting") || activity.contains("compacting") {
                    Detail::Compacting
                } else if activity.is_empty() {
                    Detail::Thinking
                } else {
                    // General activity text — treat as tool execution with activity as name
                    Detail::ToolExecution {
                        tool_name: activity.clone(),
                    }
                }
            }
            AgentStatus::AwaitingApproval {
                approval_type,
                details,
                interaction,
            } => Detail::AwaitingApproval {
                approval_type: approval_type.clone(),
                details: details.clone(),
                interaction: interaction.clone(),
            },
            AgentStatus::Error { message } => Detail::Error {
                message: message.clone(),
            },
            AgentStatus::Idle => Detail::Idle,
            AgentStatus::Offline => Detail::Offline,
            AgentStatus::Unknown => Detail::Unknown,
        }
    }

    /// Check if the agent needs user attention
    pub fn needs_attention(&self) -> bool {
        matches!(
            self,
            AgentStatus::AwaitingApproval { .. } | AgentStatus::Error { .. }
        )
    }

    /// Check if the agent is idle
    pub fn is_idle(&self) -> bool {
        matches!(self, AgentStatus::Idle)
    }

    /// Check if the agent is processing
    pub fn is_processing(&self) -> bool {
        matches!(self, AgentStatus::Processing { .. })
    }

    /// Get a short status indicator
    pub fn indicator(&self) -> &str {
        match self {
            AgentStatus::Idle => "●",
            AgentStatus::Processing { .. } => "⠿",
            AgentStatus::AwaitingApproval { .. } => "⚠",
            AgentStatus::Error { .. } => "✗",
            AgentStatus::Offline => "○",
            AgentStatus::Unknown => "?",
        }
    }
}

impl fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentStatus::Idle => write!(f, "Idle"),
            AgentStatus::Processing { activity } => {
                if activity.is_empty() {
                    write!(f, "Processing")
                } else {
                    write!(f, "Processing: {}", activity)
                }
            }
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                write!(f, "Awaiting: {}", approval_type)
            }
            AgentStatus::Error { message } => write!(f, "Error: {}", message),
            AgentStatus::Offline => write!(f, "Offline"),
            AgentStatus::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Team information associated with an agent
#[derive(Debug, Clone, Serialize)]
pub struct AgentTeamInfo {
    /// Team name
    pub team_name: String,
    /// Member name within the team
    pub member_name: String,
    /// Agent type from team config (e.g., agent definition name)
    pub agent_type: Option<String>,
    /// Whether this agent is the team lead
    pub is_lead: bool,
    /// Currently assigned task (if any)
    pub current_task: Option<TeamTaskSummaryItem>,
}

/// Summary of a task for display purposes
#[derive(Debug, Clone, Serialize)]
pub struct TeamTaskSummaryItem {
    /// Task ID
    pub id: String,
    /// Task subject/title
    pub subject: String,
    /// Task status
    pub status: TaskStatus,
    /// Present continuous form shown while task is in progress (e.g., "Fixing bug...")
    pub active_form: Option<String>,
}

/// A monitored agent instance
#[derive(Debug, Clone)]
pub struct MonitoredAgent {
    /// Unique identifier (session:window.pane)
    pub id: String,
    /// Stable identifier that persists across tmux pane recycling (UUID short hash)
    pub stable_id: String,
    /// tmux target identifier
    pub target: String,
    /// Type of agent
    pub agent_type: AgentType,
    /// Current status
    pub status: AgentStatus,
    /// Pane title
    pub title: String,
    /// Last captured content (plain text for detection)
    pub last_content: String,
    /// Last captured content with ANSI codes (for preview)
    pub last_content_ansi: String,
    /// Working directory
    pub cwd: String,
    /// Process ID
    pub pid: u32,
    /// Session name
    pub session: String,
    /// Window name
    pub window_name: String,
    /// Window index
    pub window_index: u32,
    /// Pane index
    pub pane_index: u32,
    /// Whether this agent is selected in the UI
    pub selected: bool,
    /// Last update timestamp
    pub last_update: chrono::DateTime<chrono::Utc>,
    /// Context warning percentage (e.g., "11%" remaining until auto-compact)
    pub context_warning: Option<u8>,
    /// How the agent state was detected
    pub detection_source: DetectionSource,
    /// Team information (if this agent is part of a team)
    pub team_info: Option<AgentTeamInfo>,
    /// Whether this is a virtual agent (team member without detected pane)
    pub is_virtual: bool,
    /// Detection reason from the last status detection
    pub detection_reason: Option<DetectionReason>,
    /// Permission mode (Plan, Delegate, AutoApprove, etc.)
    pub mode: AgentMode,
    /// Git branch name (if in a git repo)
    pub git_branch: Option<String>,
    /// Whether the git working tree has uncommitted changes
    pub git_dirty: Option<bool>,
    /// Whether this directory is a git worktree (not the main repo)
    pub is_worktree: Option<bool>,
    /// Effort level (Low/Medium/High, from Claude Code v2.1.72+ title icons)
    pub effort_level: Option<EffortLevel>,
    /// Auto-approve judgment phase (set by AutoApproveService)
    pub auto_approve_phase: Option<AutoApprovePhase>,
    /// Absolute path to the shared git common directory (for repository grouping)
    pub git_common_dir: Option<String>,
    /// Worktree name extracted from `.claude/worktrees/{name}` in cwd
    pub worktree_name: Option<String>,
    /// Base branch the worktree was forked from (set at spawn time)
    pub worktree_base_branch: Option<String>,
    /// Number of active subagents (from hook SubagentStart/Stop tracking)
    pub active_subagents: u32,
    /// Number of context compactions in this session (from hook PreCompact tracking)
    pub compaction_count: u32,
    /// PTY session ID if this agent was spawned via the PTY spawn API
    pub pty_session_id: Option<String>,
    /// Best available method for sending keystrokes to this agent
    pub send_capability: SendCapability,
    /// Per-agent auto-approve override: None = follow global setting, Some(bool) = override
    pub auto_approve_override: Option<bool>,
    /// Which communication channels are currently available
    pub connection_channels: ConnectionChannels,
    /// Model ID extracted from transcript (e.g., "claude-opus-4-6")
    pub model_id: Option<String>,
    /// Tool name from hook event (for structured auto-approve in slow path)
    pub hook_tool_name: Option<String>,
    /// Tool input from hook event (for structured auto-approve in slow path)
    pub hook_tool_input: Option<serde_json::Value>,
    /// Terminal cursor column (0-indexed)
    pub cursor_x: Option<u32>,
    /// Terminal cursor row (0-indexed, absolute within full capture output)
    pub cursor_y: Option<u32>,
    /// Session cost in USD (from statusline hook)
    pub cost_usd: Option<f64>,
    /// Session uptime in milliseconds (from statusline hook)
    pub duration_ms: Option<u64>,
    /// Total lines added (from statusline hook)
    pub lines_added: Option<u64>,
    /// Total lines removed (from statusline hook)
    pub lines_removed: Option<u64>,
    /// Context window used percentage (from statusline hook, more reliable than capture-pane)
    pub context_used_pct: Option<u8>,
    /// Context window size (from statusline hook)
    pub context_window_size: Option<u64>,
    /// Claude Code version string (from statusline hook)
    pub claude_version: Option<String>,
    /// Human-readable session name set via /rename (from statusline hook)
    pub session_name: Option<String>,
    /// Whether this agent was spawned as an orchestrator
    pub is_orchestrator: bool,
}

impl MonitoredAgent {
    /// Create a new monitored agent
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        target: String,
        agent_type: AgentType,
        title: String,
        cwd: String,
        pid: u32,
        session: String,
        window_name: String,
        window_index: u32,
        pane_index: u32,
    ) -> Self {
        let stable_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
        Self {
            id: target.clone(),
            stable_id,
            target,
            agent_type,
            status: AgentStatus::Unknown,
            title,
            last_content: String::new(),
            last_content_ansi: String::new(),
            cwd,
            pid,
            session,
            window_name,
            window_index,
            pane_index,
            selected: false,
            last_update: chrono::Utc::now(),
            context_warning: None,
            detection_source: DetectionSource::default(),
            team_info: None,
            is_virtual: false,
            detection_reason: None,
            mode: AgentMode::Default,
            git_branch: None,
            git_dirty: None,
            is_worktree: None,
            effort_level: None,
            auto_approve_phase: None,
            git_common_dir: None,
            worktree_name: None,
            worktree_base_branch: None,
            active_subagents: 0,
            compaction_count: 0,
            pty_session_id: None,
            send_capability: SendCapability::default(),
            auto_approve_override: None,
            connection_channels: ConnectionChannels::default(),
            model_id: None,
            hook_tool_name: None,
            hook_tool_input: None,
            cursor_x: None,
            cursor_y: None,
            cost_usd: None,
            duration_ms: None,
            lines_added: None,
            lines_removed: None,
            context_used_pct: None,
            context_window_size: None,
            claude_version: None,
            session_name: None,
            is_orchestrator: false,
        }
    }

    /// Set the detection source
    pub fn with_detection_source(mut self, source: DetectionSource) -> Self {
        self.detection_source = source;
        self
    }

    /// Update the agent's status and content
    pub fn update(
        &mut self,
        status: AgentStatus,
        content: String,
        content_ansi: String,
        title: String,
        context_warning: Option<u8>,
    ) {
        self.status = status;
        self.last_content = content;
        self.last_content_ansi = content_ansi;
        self.title = title;
        self.last_update = chrono::Utc::now();
        self.context_warning = context_warning;
    }

    /// Get the cwd with $HOME replaced by ~
    pub fn display_cwd(&self) -> String {
        shorten_home_dir(&self.cwd)
    }

    /// Get the display name for the agent
    ///
    /// For non-tmux agents (hook or PTY-spawned), derives a readable name
    /// from the working directory (project name) instead of "hook:0.N" or "pty:0.0".
    /// Uses worktree name or git branch as qualifier when available.
    pub fn display_name(&self) -> String {
        if self.session == "hook" || self.session == "pty" {
            let project = std::path::Path::new(&self.cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| self.session.clone());

            // Prefer worktree name, then git branch as qualifier
            if let Some(wt) = &self.worktree_name {
                format!("{} [{}]", project, wt)
            } else if let Some(branch) = &self.git_branch {
                format!("{} [{}]", project, branch)
            } else {
                project
            }
        } else {
            format!("{}:{}.{}", self.session, self.window_index, self.pane_index)
        }
    }
}

/// Replace the home directory prefix with ~ for display
fn shorten_home_dir(path: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        if let Some(rest) = path.strip_prefix(home_str.as_ref()) {
            return format!("~{rest}");
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_type_detection() {
        // Claude Code via command
        assert_eq!(
            AgentType::from_detection("claude", "", ""),
            Some(AgentType::ClaudeCode)
        );

        // Claude Code via title with idle icon
        assert_eq!(
            AgentType::from_detection("node", "✳ Working", ""),
            Some(AgentType::ClaudeCode)
        );

        // Claude Code via title with braille spinner
        assert_eq!(
            AgentType::from_detection("node", "⠐ Processing", ""),
            Some(AgentType::ClaudeCode)
        );

        // Claude Code via version number
        assert_eq!(
            AgentType::from_detection("2.1.11", "Some Title", ""),
            Some(AgentType::ClaudeCode)
        );

        // OpenCode
        assert_eq!(
            AgentType::from_detection("opencode", "", ""),
            Some(AgentType::OpenCode)
        );

        // Codex CLI
        assert_eq!(
            AgentType::from_detection("codex", "", ""),
            Some(AgentType::CodexCli)
        );

        // Gemini CLI
        assert_eq!(
            AgentType::from_detection("gemini", "", ""),
            Some(AgentType::GeminiCli)
        );

        // Unknown - bash is not an agent even if window_name contains "claude"
        assert_eq!(AgentType::from_detection("bash", "", "claude"), None);

        // Unknown
        assert_eq!(AgentType::from_detection("fish", "~", "fish"), None);
    }

    #[test]
    fn test_agent_type_detection_with_cmdline() {
        // Codex CLI via cmdline (node running codex)
        assert_eq!(
            AgentType::from_detection_with_cmdline(
                "node",
                "DESKTOP-LG7DUPN",
                "",
                Some("node /home/user/.nvm/versions/node/v24.9.0/bin/codex")
            ),
            Some(AgentType::CodexCli)
        );

        // Gemini CLI via cmdline
        assert_eq!(
            AgentType::from_detection_with_cmdline(
                "node",
                "",
                "",
                Some("node /usr/local/bin/gemini")
            ),
            Some(AgentType::GeminiCli)
        );

        // Claude via cmdline
        assert_eq!(
            AgentType::from_detection_with_cmdline(
                "node",
                "",
                "",
                Some("node /home/user/.local/bin/claude")
            ),
            Some(AgentType::ClaudeCode)
        );

        // Node without agent cmdline - should not detect
        assert_eq!(
            AgentType::from_detection_with_cmdline(
                "node",
                "DESKTOP",
                "",
                Some("node /home/user/app/server.js")
            ),
            None
        );

        // tmai wrap claude - agent name at end of cmdline (no trailing space)
        assert_eq!(
            AgentType::from_detection_with_cmdline(
                "tmai",
                "",
                "",
                Some("/home/user/tmai/target/debug/tmai wrap claude")
            ),
            Some(AgentType::ClaudeCode)
        );

        // tmai wrap with flags
        assert_eq!(
            AgentType::from_detection_with_cmdline(
                "tmai",
                "",
                "",
                Some("tmai wrap codex --model o3")
            ),
            Some(AgentType::CodexCli)
        );
    }

    #[test]
    fn test_has_braille_spinner() {
        assert!(AgentType::has_braille_spinner("⠋ Working"));
        assert!(AgentType::has_braille_spinner("⠿ Done"));
        assert!(AgentType::has_braille_spinner("⠐ tmaiフォーカス外れ問題"));
        assert!(!AgentType::has_braille_spinner("✳ Idle"));
        assert!(!AgentType::has_braille_spinner("Normal title"));
    }

    #[test]
    fn test_is_version_like() {
        assert!(AgentType::is_version_like("2.1.11"));
        assert!(AgentType::is_version_like("1.0.0"));
        assert!(!AgentType::is_version_like("fish"));
        assert!(!AgentType::is_version_like(""));
    }

    #[test]
    fn test_phase_from_agent_status() {
        assert_eq!(
            AgentStatus::Processing {
                activity: "Tool: Bash".to_string()
            }
            .phase(),
            Phase::Working
        );
        assert_eq!(
            AgentStatus::Processing {
                activity: String::new()
            }
            .phase(),
            Phase::Working
        );
        assert_eq!(
            AgentStatus::Processing {
                activity: "Compacting context…".to_string()
            }
            .phase(),
            Phase::Working
        );
        assert_eq!(
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalCategory::FileEdit,
                details: String::new(),
                interaction: None,
            }
            .phase(),
            Phase::Blocked
        );
        assert_eq!(
            AgentStatus::Error {
                message: "test".to_string()
            }
            .phase(),
            Phase::Blocked
        );
        assert_eq!(AgentStatus::Idle.phase(), Phase::Idle);
        assert_eq!(AgentStatus::Offline.phase(), Phase::Offline);
        assert_eq!(AgentStatus::Unknown.phase(), Phase::Offline);
    }

    #[test]
    fn test_detail_from_agent_status() {
        // Tool execution
        let detail = AgentStatus::Processing {
            activity: "Tool: Bash".to_string(),
        }
        .detail();
        assert_eq!(
            detail,
            Detail::ToolExecution {
                tool_name: "Bash".to_string()
            }
        );

        // Compacting
        let detail = AgentStatus::Processing {
            activity: "Compacting context…".to_string(),
        }
        .detail();
        assert_eq!(detail, Detail::Compacting);

        // Thinking (empty activity)
        let detail = AgentStatus::Processing {
            activity: String::new(),
        }
        .detail();
        assert_eq!(detail, Detail::Thinking);

        // Awaiting approval
        let detail = AgentStatus::AwaitingApproval {
            approval_type: ApprovalCategory::ShellCommand,
            details: "rm -rf /tmp".to_string(),
            interaction: None,
        }
        .detail();
        assert_eq!(
            detail,
            Detail::AwaitingApproval {
                approval_type: ApprovalCategory::ShellCommand,
                details: "rm -rf /tmp".to_string(),
                interaction: None,
            }
        );

        // Error
        let detail = AgentStatus::Error {
            message: "timeout".to_string(),
        }
        .detail();
        assert_eq!(
            detail,
            Detail::Error {
                message: "timeout".to_string()
            }
        );

        // Simple variants
        assert_eq!(AgentStatus::Idle.detail(), Detail::Idle);
        assert_eq!(AgentStatus::Offline.detail(), Detail::Offline);
        assert_eq!(AgentStatus::Unknown.detail(), Detail::Unknown);
    }

    #[test]
    fn test_phase_display_and_parse() {
        assert_eq!(Phase::Working.to_string(), "working");
        assert_eq!(Phase::Blocked.to_string(), "blocked");
        assert_eq!(Phase::Idle.to_string(), "idle");
        assert_eq!(Phase::Offline.to_string(), "offline");

        assert_eq!(Phase::from_str_loose("Working"), Some(Phase::Working));
        assert_eq!(Phase::from_str_loose("BLOCKED"), Some(Phase::Blocked));
        assert_eq!(Phase::from_str_loose("idle"), Some(Phase::Idle));
        assert_eq!(Phase::from_str_loose("Offline"), Some(Phase::Offline));
        assert_eq!(Phase::from_str_loose("unknown"), None);
    }

    #[test]
    fn test_phase_serialization() {
        let json = serde_json::to_string(&Phase::Working).unwrap();
        assert_eq!(json, "\"Working\"");
        let deserialized: Phase = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, Phase::Working);
    }

    #[test]
    fn test_detail_serialization() {
        let detail = Detail::ToolExecution {
            tool_name: "Read".to_string(),
        };
        let json = serde_json::to_string(&detail).unwrap();
        assert!(json.contains("ToolExecution"));
        assert!(json.contains("Read"));

        let detail = Detail::Compacting;
        let json = serde_json::to_string(&detail).unwrap();
        assert_eq!(json, "\"Compacting\"");
    }

    #[test]
    fn test_agent_status_needs_attention() {
        assert!(AgentStatus::AwaitingApproval {
            approval_type: ApprovalCategory::FileEdit,
            details: String::new(),
            interaction: None,
        }
        .needs_attention());

        assert!(AgentStatus::Error {
            message: "test".to_string()
        }
        .needs_attention());

        assert!(!AgentStatus::Idle.needs_attention());
        assert!(!AgentStatus::Processing {
            activity: String::new()
        }
        .needs_attention());
    }

    #[test]
    fn test_known_non_agent_commands() {
        // File managers should never be detected as agents
        assert_eq!(
            AgentType::from_detection("yazi", "codex.rs", ""),
            None,
            "yazi showing codex.rs should not be detected as Codex"
        );
        assert_eq!(
            AgentType::from_detection("ranger", "gemini", ""),
            None,
            "ranger with gemini in title should not be detected"
        );

        // Editors should never be detected as agents
        assert_eq!(
            AgentType::from_detection("nvim", "codex.rs", ""),
            None,
            "nvim editing codex.rs should not be detected as Codex"
        );
        assert_eq!(
            AgentType::from_detection("vim", "opencode.py", ""),
            None,
            "vim editing opencode.py should not be detected"
        );

        // Shells should not be detected
        assert_eq!(AgentType::from_detection("bash", "codex", ""), None);
        assert_eq!(AgentType::from_detection("fish", "gemini", ""), None);
    }

    #[test]
    fn test_is_likely_agent_title() {
        // Should match: exact agent name or agent CLI patterns
        assert!(AgentType::is_likely_agent_title("codex", "codex"));
        assert!(AgentType::is_likely_agent_title("codex cli", "codex"));
        assert!(AgentType::is_likely_agent_title("codex>", "codex"));
        assert!(AgentType::is_likely_agent_title("codex:", "codex"));
        assert!(AgentType::is_likely_agent_title("codex - working", "codex"));

        // Should NOT match: file paths or filenames containing agent name
        assert!(!AgentType::is_likely_agent_title("codex.rs", "codex"));
        assert!(!AgentType::is_likely_agent_title(
            "/path/to/codex/file",
            "codex"
        ));
        assert!(!AgentType::is_likely_agent_title(
            "editing codex.py",
            "codex"
        ));

        // Gemini tests
        assert!(AgentType::is_likely_agent_title("gemini", "gemini"));
        assert!(AgentType::is_likely_agent_title("gemini cli", "gemini"));
        assert!(!AgentType::is_likely_agent_title("gemini.js", "gemini"));
    }

    #[test]
    fn test_title_based_detection_stricter() {
        // Title containing "codex" as a file should not match when command is node
        assert_eq!(
            AgentType::from_detection("node", "codex.rs", ""),
            None,
            "node with codex.rs title should not be detected as Codex"
        );

        // But actual Codex CLI title patterns should still work
        assert_eq!(
            AgentType::from_detection("node", "codex cli", ""),
            Some(AgentType::CodexCli),
            "node with 'codex cli' title should be detected as Codex"
        );
    }

    #[test]
    fn test_display_name_tmux_agent() {
        let agent = MonitoredAgent::new(
            "main:0.1".to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/home/user/works/tmai".to_string(),
            1234,
            "main".to_string(),
            "claude".to_string(),
            0,
            1,
        );
        assert_eq!(agent.display_name(), "main:0.1");
    }

    #[test]
    fn test_display_name_hook_agent_project_name() {
        let agent = MonitoredAgent::new(
            "hook:0.1".to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/home/user/works/tmai".to_string(),
            1234,
            "hook".to_string(),
            "claude".to_string(),
            0,
            1,
        );
        assert_eq!(agent.display_name(), "tmai");
    }

    #[test]
    fn test_display_name_hook_agent_with_branch() {
        let mut agent = MonitoredAgent::new(
            "hook:0.1".to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/home/user/works/tmai".to_string(),
            1234,
            "hook".to_string(),
            "claude".to_string(),
            0,
            1,
        );
        agent.git_branch = Some("feat/hooks".to_string());
        assert_eq!(agent.display_name(), "tmai [feat/hooks]");
    }

    #[test]
    fn test_display_name_hook_agent_with_worktree() {
        let mut agent = MonitoredAgent::new(
            "hook:0.1".to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/home/user/works/tmai".to_string(),
            1234,
            "hook".to_string(),
            "claude".to_string(),
            0,
            1,
        );
        agent.worktree_name = Some("feat-auth".to_string());
        agent.git_branch = Some("feat/auth".to_string());
        // worktree_name takes priority over git_branch
        assert_eq!(agent.display_name(), "tmai [feat-auth]");
    }

    #[test]
    fn test_display_name_hook_agent_unknown_cwd() {
        let agent = MonitoredAgent::new(
            "hook:0.1".to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/unknown".to_string(),
            1234,
            "hook".to_string(),
            "claude".to_string(),
            0,
            1,
        );
        assert_eq!(agent.display_name(), "unknown");
    }

    #[test]
    fn test_display_name_pty_agent_project_name() {
        let mut agent = MonitoredAgent::new(
            "some-uuid".to_string(),
            AgentType::ClaudeCode,
            "bash".to_string(),
            "/home/user/works/tmai".to_string(),
            5678,
            "pty".to_string(),
            "bash".to_string(),
            0,
            0,
        );
        agent.git_branch = Some("dev/tmai-app".to_string());
        assert_eq!(agent.display_name(), "tmai [dev/tmai-app]");
    }

    #[test]
    fn test_display_name_pty_agent_no_branch() {
        let agent = MonitoredAgent::new(
            "some-uuid".to_string(),
            AgentType::Custom("bash".to_string()),
            "bash".to_string(),
            "/home/user/works/myproject".to_string(),
            5678,
            "pty".to_string(),
            "bash".to_string(),
            0,
            0,
        );
        assert_eq!(agent.display_name(), "myproject");
    }
}
