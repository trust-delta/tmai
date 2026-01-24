mod claude_code;
mod codex;
mod default;
mod gemini;

pub use claude_code::ClaudeCodeDetector;
pub use codex::CodexDetector;
pub use default::DefaultDetector;
pub use gemini::GeminiDetector;

use crate::agents::{AgentStatus, AgentType};

/// Trait for detecting agent status from pane content and title
pub trait StatusDetector: Send + Sync {
    /// Detect the current status of the agent
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus;

    /// Get the agent type this detector handles
    fn agent_type(&self) -> AgentType;

    /// Keys to send for approval
    fn approval_keys(&self) -> &str {
        "y"
    }

    /// Keys to send for rejection
    fn rejection_keys(&self) -> &str {
        "n"
    }
}

/// Get the appropriate detector for an agent type
pub fn get_detector(agent_type: &AgentType) -> Box<dyn StatusDetector> {
    match agent_type {
        AgentType::ClaudeCode => Box::new(ClaudeCodeDetector::new()),
        AgentType::CodexCli => Box::new(CodexDetector::new()),
        AgentType::GeminiCli => Box::new(GeminiDetector::new()),
        AgentType::OpenCode => Box::new(DefaultDetector::new(AgentType::OpenCode)),
        AgentType::Custom(name) => Box::new(DefaultDetector::new(AgentType::Custom(name.clone()))),
    }
}
