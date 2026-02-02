use std::fmt;

use serde::{Deserialize, Serialize};

/// Source of agent state detection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum DetectionSource {
    /// State detected via PTY state file (/tmp/tmai/*.state)
    PtyStateFile,
    /// State detected via tmux capture-pane
    #[default]
    CapturePane,
}

impl DetectionSource {
    /// Get icon for this detection source
    pub fn icon(&self) -> char {
        match self {
            DetectionSource::PtyStateFile => '●',
            DetectionSource::CapturePane => '○',
        }
    }

    /// Get short label for this detection source
    pub fn label(&self) -> &'static str {
        match self {
            DetectionSource::PtyStateFile => "PTY",
            DetectionSource::CapturePane => "capture",
        }
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

        // Check cmdline for agent keywords (e.g., "node /path/to/codex")
        if let Some(ref cl) = cmdline_lower {
            if cl.contains("/codex") || cl.contains("codex ") {
                return Some(AgentType::CodexCli);
            }
            if cl.contains("/gemini") || cl.contains("gemini ") {
                return Some(AgentType::GeminiCli);
            }
            if cl.contains("/opencode") || cl.contains("opencode ") {
                return Some(AgentType::OpenCode);
            }
            // Claude check via cmdline
            if cl.contains("/claude") || cl.contains("claude ") {
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

    /// Check if command is a known non-agent application
    fn is_known_non_agent_command(cmd_lower: &str) -> bool {
        const NON_AGENT_COMMANDS: &[&str] = &[
            // File managers
            "yazi",
            "ranger",
            "lf",
            "nnn",
            "mc",
            "vifm",
            // Editors
            "vim",
            "nvim",
            "nano",
            "emacs",
            "helix",
            "hx",
            "micro",
            "code",
            // Shells
            "bash",
            "zsh",
            "fish",
            "sh",
            "dash",
            "tcsh",
            "ksh",
            // Common utilities
            "less",
            "more",
            "man",
            "htop",
            "btop",
            "top",
            "tmux",
            "screen",
            "git",
            "tig",
            "lazygit",
            "docker",
            "kubectl",
            // Pagers and viewers
            "bat",
            "cat",
            "head",
            "tail",
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

/// Type of approval being requested
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApprovalType {
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
    UserQuestion {
        choices: Vec<String>,
        multi_select: bool,
        /// Current cursor position (1-indexed, 0 means unknown)
        cursor_position: usize,
    },
    /// Other/unknown approval type
    Other(String),
}

impl fmt::Display for ApprovalType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApprovalType::FileEdit => write!(f, "File Edit"),
            ApprovalType::FileCreate => write!(f, "File Create"),
            ApprovalType::FileDelete => write!(f, "File Delete"),
            ApprovalType::ShellCommand => write!(f, "Shell Command"),
            ApprovalType::McpTool => write!(f, "MCP Tool"),
            ApprovalType::UserQuestion { .. } => write!(f, "Question"),
            ApprovalType::Other(s) => write!(f, "{}", s),
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
        approval_type: ApprovalType,
        details: String,
    },
    /// Agent encountered an error
    Error { message: String },
    /// Status could not be determined
    #[default]
    Unknown,
}

impl AgentStatus {
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
            AgentStatus::Unknown => write!(f, "Unknown"),
        }
    }
}

/// A monitored agent instance
#[derive(Debug, Clone)]
pub struct MonitoredAgent {
    /// Unique identifier (session:window.pane)
    pub id: String,
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
        Self {
            id: target.clone(),
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

    /// Get the display name for the agent
    pub fn display_name(&self) -> String {
        format!("{}:{}.{}", self.session, self.window_index, self.pane_index)
    }
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
    fn test_agent_status_needs_attention() {
        assert!(AgentStatus::AwaitingApproval {
            approval_type: ApprovalType::FileEdit,
            details: String::new()
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
        assert!(!AgentType::is_likely_agent_title("/path/to/codex/file", "codex"));
        assert!(!AgentType::is_likely_agent_title("editing codex.py", "codex"));

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
}
