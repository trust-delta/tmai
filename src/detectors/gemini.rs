use regex::Regex;

use crate::agents::{AgentStatus, AgentType, ApprovalType};

use super::StatusDetector;

/// Detector for Gemini CLI
pub struct GeminiDetector {
    approval_pattern: Regex,
    error_pattern: Regex,
}

impl GeminiDetector {
    pub fn new() -> Self {
        Self {
            approval_pattern: Regex::new(
                r"(?i)\[y/n\]|\[Y/n\]|Yes\s*/\s*No|approve|confirm|allow|proceed",
            )
            .unwrap(),
            error_pattern: Regex::new(r"(?i)(?:^|\n)\s*(?:Error|ERROR|error:|✗|❌)").unwrap(),
        }
    }

    fn detect_approval(&self, content: &str) -> Option<(ApprovalType, String)> {
        let lines: Vec<&str> = content.lines().collect();
        let check_start = lines.len().saturating_sub(15);
        let recent = lines[check_start..].join("\n");

        if self.approval_pattern.is_match(&recent) {
            Some((
                ApprovalType::Other("Gemini approval".to_string()),
                String::new(),
            ))
        } else {
            None
        }
    }

    fn detect_error(&self, content: &str) -> Option<String> {
        let lines: Vec<&str> = content.lines().collect();
        let check_start = lines.len().saturating_sub(10);
        let recent = lines[check_start..].join("\n");

        if self.error_pattern.is_match(&recent) {
            for line in lines.iter().rev().take(10) {
                if line.to_lowercase().contains("error") {
                    return Some(line.trim().to_string());
                }
            }
            return Some("Error detected".to_string());
        }
        None
    }
}

impl Default for GeminiDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusDetector for GeminiDetector {
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus {
        // Check for approval requests
        if let Some((approval_type, details)) = self.detect_approval(content) {
            return AgentStatus::AwaitingApproval {
                approval_type,
                details,
            };
        }

        // Check for errors
        if let Some(message) = self.detect_error(content) {
            return AgentStatus::Error { message };
        }

        // Title-based detection
        let title_lower = title.to_lowercase();
        if title_lower.contains("idle") || title_lower.contains("ready") {
            return AgentStatus::Idle;
        }

        if title_lower.contains("working")
            || title_lower.contains("processing")
            || title_lower.contains("thinking")
        {
            return AgentStatus::Processing {
                activity: title.to_string(),
            };
        }

        // Default based on content heuristics
        let lines: Vec<&str> = content.lines().collect();
        if let Some(last) = lines.last() {
            let trimmed = last.trim();
            if trimmed.ends_with('>')
                || trimmed.ends_with('$')
                || trimmed.ends_with('❯')
                || trimmed.is_empty()
            {
                return AgentStatus::Idle;
            }
        }

        AgentStatus::Processing {
            activity: String::new(),
        }
    }

    fn agent_type(&self) -> AgentType {
        AgentType::GeminiCli
    }

    fn approval_keys(&self) -> &str {
        "Enter"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idle_detection() {
        let detector = GeminiDetector::new();
        let status = detector.detect_status("Gemini - Ready", "Some content\n> ");
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_thinking_detection() {
        let detector = GeminiDetector::new();
        let status = detector.detect_status("Gemini - Thinking...", "Processing request...");
        assert!(matches!(status, AgentStatus::Processing { .. }));
    }
}
