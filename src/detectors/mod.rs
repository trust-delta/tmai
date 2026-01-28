mod claude_code;
mod codex;
mod default;
mod gemini;

pub use claude_code::ClaudeCodeDetector;
pub use codex::CodexDetector;
pub use default::DefaultDetector;
pub use gemini::GeminiDetector;

use once_cell::sync::Lazy;

use crate::agents::{AgentStatus, AgentType};

/// Trait for detecting agent status from pane content and title
pub trait StatusDetector: Send + Sync {
    /// Detect the current status of the agent
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus;

    /// Get the agent type this detector handles
    fn agent_type(&self) -> AgentType;

    /// Detect context warning (e.g., "Context left until auto-compact: XX%")
    /// Returns the percentage remaining if warning is present
    fn detect_context_warning(&self, _content: &str) -> Option<u8> {
        None
    }

    /// Keys to send for approval
    fn approval_keys(&self) -> &str {
        "y"
    }

    /// Keys to send for rejection
    fn rejection_keys(&self) -> &str {
        "n"
    }
}

// Static detector instances for caching
static CLAUDE_DETECTOR: Lazy<ClaudeCodeDetector> = Lazy::new(ClaudeCodeDetector::new);
static CODEX_DETECTOR: Lazy<CodexDetector> = Lazy::new(CodexDetector::new);
static GEMINI_DETECTOR: Lazy<GeminiDetector> = Lazy::new(GeminiDetector::new);
static OPENCODE_DETECTOR: Lazy<DefaultDetector> =
    Lazy::new(|| DefaultDetector::new(AgentType::OpenCode));

/// Get the appropriate detector for an agent type
/// Returns a static reference to avoid repeated allocations
pub fn get_detector(agent_type: &AgentType) -> &'static dyn StatusDetector {
    match agent_type {
        AgentType::ClaudeCode => &*CLAUDE_DETECTOR,
        AgentType::CodexCli => &*CODEX_DETECTOR,
        AgentType::GeminiCli => &*GEMINI_DETECTOR,
        AgentType::OpenCode => &*OPENCODE_DETECTOR,
        // For custom agents, we still need to return a boxed detector
        // but since get_detector now returns &'static, we use a leaked box
        AgentType::Custom(name) => {
            // Leak memory for custom detectors (acceptable as they're rare and long-lived)
            Box::leak(Box::new(DefaultDetector::new(AgentType::Custom(
                name.clone(),
            ))))
        }
    }
}
