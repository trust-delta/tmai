use regex::Regex;

use crate::agents::{AgentStatus, AgentType, ApprovalType};

use super::StatusDetector;

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

        // Title-based heuristics
        let title_lower = title.to_lowercase();
        if title_lower.contains("idle")
            || title_lower.contains("ready")
            || title_lower.contains("waiting")
        {
            return AgentStatus::Idle;
        }

        if title_lower.contains("working")
            || title_lower.contains("processing")
            || title_lower.contains("running")
        {
            return AgentStatus::Processing {
                activity: title.to_string(),
            };
        }

        // Content-based heuristics
        let lines: Vec<&str> = content.lines().collect();
        if let Some(last) = lines.last() {
            let trimmed = last.trim();
            // Common prompt endings
            if trimmed.ends_with('>')
                || trimmed.ends_with('$')
                || trimmed.ends_with('#')
                || trimmed.ends_with('❯')
                || trimmed.ends_with(':')
                || trimmed.is_empty()
            {
                return AgentStatus::Idle;
            }
        }

        // Default to unknown
        AgentStatus::Unknown
    }

    fn agent_type(&self) -> AgentType {
        self.agent_type.clone()
    }

    fn approval_keys(&self) -> &str {
        "y"
    }

    fn rejection_keys(&self) -> &str {
        "n"
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
