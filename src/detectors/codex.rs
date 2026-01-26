use regex::Regex;

use crate::agents::{AgentStatus, AgentType, ApprovalType};

use super::StatusDetector;

/// Detector for Codex CLI
pub struct CodexDetector {
    approval_pattern: Regex,
    error_pattern: Regex,
}

impl CodexDetector {
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
                ApprovalType::Other("Codex approval".to_string()),
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

impl Default for CodexDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusDetector for CodexDetector {
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

        if title_lower.contains("working") || title_lower.contains("processing") {
            return AgentStatus::Processing {
                activity: title.to_string(),
            };
        }

        // Content-based detection for Codex CLI
        let lines: Vec<&str> = content.lines().collect();
        let recent_lines: Vec<&str> = lines.iter().rev().take(10).copied().collect();

        // Check for Codex-specific idle indicators
        for line in &recent_lines {
            let trimmed = line.trim();

            // "› " prompt indicates idle (waiting for input)
            if trimmed.starts_with('›') {
                return AgentStatus::Idle;
            }

            // "XX% context left" footer indicates idle
            if trimmed.contains("% context left") {
                return AgentStatus::Idle;
            }
        }

        // Default based on last line heuristics
        if let Some(last) = lines.last() {
            let trimmed = last.trim();
            // If ends with prompt, likely idle
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
        AgentType::CodexCli
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
    fn test_idle_detection() {
        let detector = CodexDetector::new();
        let status = detector.detect_status("Codex - Idle", "Some content\n> ");
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_idle_with_prompt() {
        let detector = CodexDetector::new();
        // Codex uses › as input prompt
        let content = r#"
Some suggestions here

› Improve documentation in @filename

  98% context left · ? for shortcuts"#;
        let status = detector.detect_status("DESKTOP-LG7DUPN", content);
        assert!(
            matches!(status, AgentStatus::Idle),
            "Expected Idle, got {:?}",
            status
        );
    }

    #[test]
    fn test_idle_with_context_footer() {
        let detector = CodexDetector::new();
        let content = "Some content\n  50% context left · ? for shortcuts";
        let status = detector.detect_status("", content);
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_approval_detection() {
        let detector = CodexDetector::new();
        let content = "Do you want to proceed? [y/n]";
        let status = detector.detect_status("Codex", content);
        assert!(matches!(status, AgentStatus::AwaitingApproval { .. }));
    }
}
