mod claude_code;
mod codex;
mod default;
mod gemini;

pub use claude_code::ClaudeCodeDetector;
pub use codex::CodexDetector;
pub use default::DefaultDetector;
pub use gemini::GeminiDetector;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::agents::{AgentStatus, AgentType};
use crate::config::ClaudeSettingsCache;

/// Detection confidence level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DetectionConfidence {
    /// Explicit pattern match
    High,
    /// Heuristic-based detection
    Medium,
    /// Fallback detection
    Low,
}

/// Reason for a detection result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionReason {
    /// Rule name (e.g., "user_question_numbered_choices")
    pub rule: String,
    /// Confidence level
    pub confidence: DetectionConfidence,
    /// Matched text (truncated)
    pub matched_text: Option<String>,
}

/// Detection result combining status and reason
#[derive(Debug, Clone)]
pub struct DetectionResult {
    /// Detected agent status
    pub status: AgentStatus,
    /// Reason for this detection
    pub reason: DetectionReason,
}

impl DetectionResult {
    /// Create a new detection result
    pub fn new(status: AgentStatus, rule: &str, confidence: DetectionConfidence) -> Self {
        Self {
            status,
            reason: DetectionReason {
                rule: rule.to_string(),
                confidence,
                matched_text: None,
            },
        }
    }

    /// Add matched text to the detection result
    pub fn with_matched_text(mut self, text: &str) -> Self {
        // Truncate to 200 chars
        let truncated = if text.len() > 200 {
            format!("{}...", &text[..text.floor_char_boundary(197)])
        } else {
            text.to_string()
        };
        self.reason.matched_text = Some(truncated);
        self
    }
}

/// Context passed to detectors for additional information
#[derive(Default)]
pub struct DetectionContext<'a> {
    /// Current working directory of the pane
    pub cwd: Option<&'a str>,
    /// Settings cache for Claude Code configuration
    pub settings_cache: Option<&'a ClaudeSettingsCache>,
}

/// Trait for detecting agent status from pane content and title
pub trait StatusDetector: Send + Sync {
    /// Detect the current status of the agent
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus;

    /// Detect the current status with additional context
    ///
    /// Default implementation falls back to `detect_status`.
    /// Override this for detectors that need context (e.g., ClaudeCodeDetector for spinnerVerbs).
    fn detect_status_with_context(
        &self,
        title: &str,
        content: &str,
        _context: &DetectionContext,
    ) -> AgentStatus {
        self.detect_status(title, content)
    }

    /// Get the agent type this detector handles
    fn agent_type(&self) -> AgentType;

    /// Detect context warning (e.g., "Context left until auto-compact: XX%")
    /// Returns the percentage remaining if warning is present
    fn detect_context_warning(&self, _content: &str) -> Option<u8> {
        None
    }

    /// Detect status with reason for audit logging
    ///
    /// Default implementation wraps `detect_status_with_context` with a legacy fallback reason.
    fn detect_status_with_reason(
        &self,
        title: &str,
        content: &str,
        context: &DetectionContext,
    ) -> DetectionResult {
        let status = self.detect_status_with_context(title, content, context);
        DetectionResult::new(status, "legacy_fallback", DetectionConfidence::Low)
    }

    /// Keys to send for approval (Enter for cursor-based UI)
    fn approval_keys(&self) -> &str {
        "Enter"
    }
}

// Static detector instances for caching
static CLAUDE_DETECTOR: Lazy<ClaudeCodeDetector> = Lazy::new(ClaudeCodeDetector::new);
static CODEX_DETECTOR: Lazy<CodexDetector> = Lazy::new(CodexDetector::new);
static GEMINI_DETECTOR: Lazy<GeminiDetector> = Lazy::new(GeminiDetector::new);
static OPENCODE_DETECTOR: Lazy<DefaultDetector> =
    Lazy::new(|| DefaultDetector::new(AgentType::OpenCode));

/// Cache for custom agent detectors to avoid repeated Box::leak allocations
static CUSTOM_DETECTORS: Lazy<Mutex<HashMap<String, &'static dyn StatusDetector>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Get the appropriate detector for an agent type
/// Returns a static reference to avoid repeated allocations
pub fn get_detector(agent_type: &AgentType) -> &'static dyn StatusDetector {
    match agent_type {
        AgentType::ClaudeCode => &*CLAUDE_DETECTOR,
        AgentType::CodexCli => &*CODEX_DETECTOR,
        AgentType::GeminiCli => &*GEMINI_DETECTOR,
        AgentType::OpenCode => &*OPENCODE_DETECTOR,
        AgentType::Custom(name) => {
            // Use cached detector if available, otherwise create and cache
            let mut cache = CUSTOM_DETECTORS.lock();
            if let Some(&detector) = cache.get(name) {
                detector
            } else {
                // Only leak once per unique custom agent name
                let detector: &'static dyn StatusDetector = Box::leak(Box::new(
                    DefaultDetector::new(AgentType::Custom(name.clone())),
                ));
                cache.insert(name.clone(), detector);
                detector
            }
        }
    }
}
