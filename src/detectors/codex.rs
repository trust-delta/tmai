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
            // Only match explicit approval prompts, not general text containing these words
            approval_pattern: Regex::new(
                r"(?i)\[y/n\]|\[Y/n\]|\[yes/no\]|^\s*Yes\s*/\s*No\s*$|\[Approve\]|\[Confirm\]|\[Allow\]|\[Proceed\]",
            )
            .unwrap(),
            error_pattern: Regex::new(r"(?i)(?:^|\n)\s*(?:Error|ERROR|error:|✗|❌)").unwrap(),
        }
    }

    fn detect_approval(&self, content: &str) -> Option<(ApprovalType, String)> {
        let lines: Vec<&str> = content.lines().collect();
        let check_start = lines.len().saturating_sub(30);
        let recent_lines = &lines[check_start..];

        // First check for numbered choices (user question pattern)
        if let Some(question) = self.detect_numbered_choices(recent_lines) {
            return Some(question);
        }

        // Then check for y/n approval patterns
        for line in recent_lines {
            // Skip tip/hint lines and footer
            if line.contains("Tip:")
                || line.contains("Tips:")
                || line.contains("% context left")
                || line.contains("? for shortcuts")
            {
                continue;
            }

            if self.approval_pattern.is_match(line) {
                return Some((
                    ApprovalType::Other("Codex approval".to_string()),
                    String::new(),
                ));
            }
        }
        None
    }

    /// Detect numbered choices pattern (e.g., "1. Option", "2. Option")
    fn detect_numbered_choices(&self, lines: &[&str]) -> Option<(ApprovalType, String)> {
        let mut choices: Vec<String> = Vec::new();
        let mut question_text = String::new();
        let mut found_prompt = false;

        // Scan from end to find prompt, then look for choices above it
        for line in lines.iter().rev() {
            let trimmed = line.trim();

            // Skip footer lines
            if trimmed.contains("% context left") || trimmed.starts_with('?') || trimmed.is_empty()
            {
                continue;
            }

            // Found input prompt - mark and continue looking for choices above
            if trimmed.starts_with('›') {
                found_prompt = true;
                continue;
            }

            // Look for numbered choices (1. xxx, 2. xxx, etc.)
            if let Some(choice) = self.parse_numbered_choice(trimmed) {
                choices.push(choice);
            } else if !choices.is_empty() {
                // We've collected choices, now check for question text
                if trimmed.ends_with('?') || trimmed.ends_with('？') {
                    question_text = trimmed.to_string();
                }
                break;
            }
        }

        // If we found numbered choices with a prompt, return as UserQuestion
        if choices.len() >= 2 && found_prompt {
            // Reverse choices since we collected them bottom-up
            choices.reverse();
            return Some((
                ApprovalType::UserQuestion {
                    choices,
                    multi_select: false,
                    cursor_position: 0,
                },
                question_text,
            ));
        }

        None
    }

    /// Parse a numbered choice line (e.g., "1. Fix bug" -> "Fix bug")
    fn parse_numbered_choice(&self, line: &str) -> Option<String> {
        let trimmed = line.trim();
        // Match patterns like "1. text", "2. text", etc.
        if trimmed.len() >= 3 {
            let first_char = trimmed.chars().next()?;
            if first_char.is_ascii_digit() {
                let rest = &trimmed[1..];
                if rest.starts_with(". ") || rest.starts_with("．") {
                    let choice_text = rest.trim_start_matches(['.', '．', ' ']).trim();
                    if !choice_text.is_empty() {
                        return Some(choice_text.to_string());
                    }
                }
            }
        }
        None
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
        let recent_lines: Vec<&str> = lines.iter().rev().take(15).copied().collect();

        // Check for processing indicators first (e.g., spinners, "thinking...")
        for line in &recent_lines {
            let trimmed = line.trim();

            // Spinner patterns (Codex uses various spinners during processing)
            if trimmed.starts_with('⠋')
                || trimmed.starts_with('⠙')
                || trimmed.starts_with('⠹')
                || trimmed.starts_with('⠸')
                || trimmed.starts_with('⠼')
                || trimmed.starts_with('⠴')
                || trimmed.starts_with('⠦')
                || trimmed.starts_with('⠧')
                || trimmed.starts_with('⠇')
                || trimmed.starts_with('⠏')
            {
                return AgentStatus::Processing {
                    activity: trimmed.to_string(),
                };
            }

            // "Thinking..." or similar processing indicators
            if trimmed.contains("Thinking") || trimmed.contains("Generating") {
                return AgentStatus::Processing {
                    activity: trimmed.to_string(),
                };
            }

            // "esc to interrupt" indicates processing
            if trimmed.contains("esc to interrupt") {
                return AgentStatus::Processing {
                    activity: String::new(),
                };
            }
        }

        // Check for idle indicators
        // Codex shows "› " prompt when waiting for input
        // The prompt line should be followed only by footer (? for shortcuts... % context left)
        let mut prompt_line_idx: Option<usize> = None;
        let mut footer_line_idx: Option<usize> = None;

        for (idx, line) in recent_lines.iter().enumerate() {
            let trimmed = line.trim();

            // Footer line with "% context left"
            if trimmed.contains("% context left") {
                footer_line_idx = Some(idx);
            }

            // Prompt line starting with "› "
            if trimmed.starts_with('›') {
                prompt_line_idx = Some(idx);
                break; // Prompt is above footer, stop searching
            }
        }

        // Idle if: prompt exists and is right above footer (with maybe empty lines between)
        if let (Some(prompt_idx), Some(footer_idx)) = (prompt_line_idx, footer_line_idx) {
            // In reversed order: footer is at lower index, prompt at higher
            // Check if there's only empty lines between them
            if prompt_idx > footer_idx {
                let between = &recent_lines[footer_idx + 1..prompt_idx];
                let only_empty_or_hints = between
                    .iter()
                    .all(|l| l.trim().is_empty() || l.trim().starts_with('?'));
                if only_empty_or_hints {
                    return AgentStatus::Idle;
                }
            }
        }

        // Fallback: if we see the footer but no clear processing indicator,
        // check for selection choices which indicate response completed
        for line in &recent_lines {
            let trimmed = line.trim();
            // Numbered choices pattern (e.g., "1. Fix bug" or "  1  Fix bug")
            if trimmed.starts_with("1.") || trimmed.starts_with("2.") || trimmed.starts_with("3.") {
                return AgentStatus::Idle;
            }
        }

        // Check for slash command menu (shown when user types "/")
        // Pattern: lines starting with "/" followed by command name
        let has_slash_menu = recent_lines.iter().any(|line| {
            let trimmed = line.trim();
            trimmed.starts_with("/model")
                || trimmed.starts_with("/permissions")
                || trimmed.starts_with("/experimental")
                || trimmed.starts_with("/skills")
                || trimmed.starts_with("/review")
                || trimmed.starts_with("/rename")
                || trimmed.starts_with("/new")
                || trimmed.starts_with("/resume")
                || trimmed.starts_with("/help")
        });

        if has_slash_menu {
            return AgentStatus::Idle;
        }

        // If prompt is visible, likely idle (even without footer)
        if prompt_line_idx.is_some() {
            return AgentStatus::Idle;
        }

        // Default to unknown/processing based on context
        if footer_line_idx.is_some() {
            // Footer visible but unclear state - likely idle after response
            AgentStatus::Idle
        } else {
            AgentStatus::Processing {
                activity: String::new(),
            }
        }
    }

    fn agent_type(&self) -> AgentType {
        AgentType::CodexCli
    }

    fn approval_keys(&self) -> &str {
        "Enter"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idle_detection_with_title() {
        let detector = CodexDetector::new();
        let status = detector.detect_status("Codex - Idle", "Some content");
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_idle_with_prompt_and_footer() {
        let detector = CodexDetector::new();
        // Codex uses › as input prompt, followed by footer
        let content = r#"
Some suggestions here

› Improve documentation in @filename

  ? for shortcuts                                                                                   98% context left"#;
        let status = detector.detect_status("DESKTOP-LG7DUPN", content);
        assert!(
            matches!(status, AgentStatus::Idle),
            "Expected Idle, got {:?}",
            status
        );
    }

    #[test]
    fn test_user_question_with_numbered_choices() {
        let detector = CodexDetector::new();
        // Codex shows numbered choices when asking user a question
        let content = r#"
次に進めるなら、どれから着手しますか？

  1. Fix the bug
  2. Add new feature
  3. Refactor code
  4. Write tests

›

  ? for shortcuts                                                                                   83% context left"#;
        let status = detector.detect_status("", content);
        assert!(
            matches!(
                status,
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::UserQuestion { .. },
                    ..
                }
            ),
            "Expected AwaitingApproval with UserQuestion, got {:?}",
            status
        );

        // Verify choices are extracted
        if let AgentStatus::AwaitingApproval {
            approval_type: ApprovalType::UserQuestion { choices, .. },
            ..
        } = status
        {
            assert_eq!(choices.len(), 4);
            assert_eq!(choices[0], "Fix the bug");
        }
    }

    #[test]
    fn test_processing_with_spinner() {
        let detector = CodexDetector::new();
        // Codex shows spinner during processing
        let content = r#"
› Generate a summary

⠋ Thinking...

  ? for shortcuts                                                                                   83% context left"#;
        let status = detector.detect_status("", content);
        assert!(
            matches!(status, AgentStatus::Processing { .. }),
            "Expected Processing, got {:?}",
            status
        );
    }

    #[test]
    fn test_processing_with_esc_to_interrupt() {
        let detector = CodexDetector::new();
        // Codex shows "esc to interrupt" during processing
        let content = r#"
› Fix the bug

  Reading files...

  esc to interrupt                                                                                   83% context left"#;
        let status = detector.detect_status("", content);
        assert!(
            matches!(status, AgentStatus::Processing { .. }),
            "Expected Processing, got {:?}",
            status
        );
    }

    #[test]
    fn test_idle_with_footer_only() {
        let detector = CodexDetector::new();
        // Footer visible without clear prompt - assume idle
        let content = "Some content\n  ? for shortcuts                        50% context left";
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

    #[test]
    fn test_idle_with_slash_command_menu() {
        let detector = CodexDetector::new();
        // When user types "/" the slash command menu appears
        let content = r#"
› /

  /model         choose what model and reasoning effort to use
  /permissions   choose what Codex is allowed to do
  /experimental  toggle experimental features
  /skills        use skills to improve how Codex performs specific tasks
  /review        review my current changes and find issues
  /rename        rename the current thread
  /new           start a new chat during a conversation
  /resume        resume a saved chat"#;
        let status = detector.detect_status("", content);
        assert!(
            matches!(status, AgentStatus::Idle),
            "Expected Idle when slash menu is shown, got {:?}",
            status
        );
    }

    #[test]
    fn test_idle_with_prompt_only() {
        let detector = CodexDetector::new();
        // Prompt visible but footer scrolled out
        let content = r#"
Some long response text...

› "#;
        let status = detector.detect_status("", content);
        assert!(
            matches!(status, AgentStatus::Idle),
            "Expected Idle when prompt is visible, got {:?}",
            status
        );
    }
}
