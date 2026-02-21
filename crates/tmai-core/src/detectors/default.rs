use regex::Regex;

use crate::agents::{AgentStatus, AgentType, ApprovalType};

use super::{DetectionConfidence, DetectionContext, DetectionResult, StatusDetector};

/// Default detector for unknown or custom agents
pub struct DefaultDetector {
    agent_type: AgentType,
    approval_pattern: Regex,
    error_pattern: Regex,
}

impl DefaultDetector {
    pub fn new(agent_type: AgentType) -> Self {
        Self {
            agent_type,
            approval_pattern: Regex::new(
                r"(?i)\[y/n\]|\[Y/n\]|Yes\s*/\s*No|approve|confirm|allow|proceed\?",
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
                ApprovalType::Other("Pending approval".to_string()),
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

impl StatusDetector for DefaultDetector {
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus {
        self.detect_status_with_reason(title, content, &DetectionContext::default())
            .status
    }

    fn detect_status_with_reason(
        &self,
        title: &str,
        content: &str,
        _context: &DetectionContext,
    ) -> DetectionResult {
        // Check for approval requests
        if let Some((approval_type, details)) = self.detect_approval(content) {
            return DetectionResult::new(
                AgentStatus::AwaitingApproval {
                    approval_type,
                    details,
                },
                "default_approval_pattern",
                DetectionConfidence::High,
            );
        }

        // Check for errors
        if let Some(message) = self.detect_error(content) {
            return DetectionResult::new(
                AgentStatus::Error {
                    message: message.clone(),
                },
                "default_error_pattern",
                DetectionConfidence::High,
            )
            .with_matched_text(&message);
        }

        // Title-based heuristics
        let title_lower = title.to_lowercase();
        if title_lower.contains("idle")
            || title_lower.contains("ready")
            || title_lower.contains("waiting")
        {
            return DetectionResult::new(
                AgentStatus::Idle,
                "default_title_idle",
                DetectionConfidence::Medium,
            )
            .with_matched_text(title);
        }

        if title_lower.contains("working")
            || title_lower.contains("processing")
            || title_lower.contains("running")
        {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: title.to_string(),
                },
                "default_title_processing",
                DetectionConfidence::Medium,
            )
            .with_matched_text(title);
        }

        // Content-based heuristics
        let lines: Vec<&str> = content.lines().collect();
        if let Some(last) = lines.last() {
            let trimmed = last.trim();
            if trimmed.ends_with('>')
                || trimmed.ends_with('$')
                || trimmed.ends_with('#')
                || trimmed.ends_with('❯')
                || trimmed.ends_with(':')
                || trimmed.is_empty()
            {
                return DetectionResult::new(
                    AgentStatus::Idle,
                    "default_prompt_ending",
                    DetectionConfidence::Medium,
                );
            }
        }

        DetectionResult::new(
            AgentStatus::Unknown,
            "default_fallback_unknown",
            DetectionConfidence::Low,
        )
    }

    fn agent_type(&self) -> AgentType {
        self.agent_type.clone()
    }

    fn approval_keys(&self) -> &str {
        "Enter"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_detector() {
        let detector = DefaultDetector::new(AgentType::OpenCode);
        assert_eq!(detector.agent_type(), AgentType::OpenCode);
    }

    #[test]
    fn test_approval_detection() {
        let detector = DefaultDetector::new(AgentType::OpenCode);
        let content = "Do you want to proceed? [y/n]";
        let status = detector.detect_status("OpenCode", content);
        assert!(matches!(status, AgentStatus::AwaitingApproval { .. }));
    }

    #[test]
    fn test_idle_from_prompt() {
        let detector = DefaultDetector::new(AgentType::OpenCode);
        let status = detector.detect_status("OpenCode", "Ready\n> ");
        assert!(matches!(status, AgentStatus::Idle));
    }
}
