use std::fmt;

use serde::{Deserialize, Serialize};

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
    pub fn from_detection(command: &str, title: &str, cmdline: &str) -> Option<Self> {
        let cmd_lower = command.to_lowercase();
        let title_lower = title.to_lowercase();
        let cmdline_lower = cmdline.to_lowercase();

        // Claude Code detection
        if cmd_lower.contains("claude")
            || title_lower.contains("claude")
            || cmdline_lower.contains("claude")
            || title.contains('✳')
            || Self::is_version_like(command)
        {
            return Some(AgentType::ClaudeCode);
        }

        // OpenCode detection
        if cmd_lower.contains("opencode")
            || title_lower.contains("opencode")
            || cmdline_lower.contains("opencode")
        {
            return Some(AgentType::OpenCode);
        }

        // Codex CLI detection
        if cmd_lower.contains("codex")
            || title_lower.contains("codex")
            || cmdline_lower.contains("codex")
        {
            return Some(AgentType::CodexCli);
        }

        // Gemini CLI detection
        if cmd_lower.contains("gemini")
            || title_lower.contains("gemini")
            || cmdline_lower.contains("gemini")
        {
            return Some(AgentType::GeminiCli);
        }

        None
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
            AgentStatus::Idle => "✳",
            AgentStatus::Processing { .. } => "⠿",
            AgentStatus::AwaitingApproval { .. } => "⚠",
            AgentStatus::Error { .. } => "✗",
            AgentStatus::Unknown => "?",
        }
    }
}

impl Default for AgentStatus {
    fn default() -> Self {
        AgentStatus::Unknown
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
    /// Last captured content
    pub last_content: String,
    /// Working directory
    pub cwd: String,
    /// Process ID
    pub pid: u32,
    /// Session name
    pub session: String,
    /// Window index
    pub window_index: u32,
    /// Pane index
    pub pane_index: u32,
    /// Whether this agent is selected in the UI
    pub selected: bool,
    /// Last update timestamp
    pub last_update: chrono::DateTime<chrono::Utc>,
}

impl MonitoredAgent {
    /// Create a new monitored agent
    pub fn new(
        target: String,
        agent_type: AgentType,
        title: String,
        cwd: String,
        pid: u32,
        session: String,
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
            cwd,
            pid,
            session,
            window_index,
            pane_index,
            selected: false,
            last_update: chrono::Utc::now(),
        }
    }

    /// Update the agent's status and content
    pub fn update(&mut self, status: AgentStatus, content: String, title: String) {
        self.status = status;
        self.last_content = content;
        self.title = title;
        self.last_update = chrono::Utc::now();
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

        // Claude Code via title with icon
        assert_eq!(
            AgentType::from_detection("node", "✳ Working", ""),
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

        // Unknown
        assert_eq!(AgentType::from_detection("fish", "~", "fish"), None);
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
}
