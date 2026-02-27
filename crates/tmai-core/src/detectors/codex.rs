use regex::Regex;

use crate::agents::{AgentStatus, AgentType, ApprovalType};

use super::{DetectionConfidence, DetectionContext, DetectionResult, StatusDetector};

/// Detector for Codex CLI
pub struct CodexDetector {
    approval_pattern: Regex,
    working_elapsed_pattern: Regex,
    context_left_pattern: Regex,
}

impl CodexDetector {
    /// Create a new CodexDetector with compiled regex patterns
    pub fn new() -> Self {
        Self {
            // Only match explicit approval prompts, not general text containing these words
            approval_pattern: Regex::new(
                r"(?i)\[y/n\]|\[Y/n\]|\[yes/no\]|^\s*Yes\s*/\s*No\s*$|\[Approve\]|\[Confirm\]|\[Allow\]|\[Proceed\]",
            )
            .unwrap(),
            working_elapsed_pattern: Regex::new(r"Working.*\(\d+[smh]").unwrap(),
            context_left_pattern: Regex::new(r"(\d+)% context left").unwrap(),
        }
    }

    /// Detect approval patterns in content, returning (ApprovalType, details) if found
    fn detect_approval(&self, content: &str) -> Option<(ApprovalType, String, &'static str)> {
        let lines: Vec<&str> = content.lines().collect();
        let check_start = lines.len().saturating_sub(30);
        let recent_lines = &lines[check_start..];

        // Check for confirm footer as a reinforcing signal
        let has_confirm_footer = recent_lines
            .iter()
            .any(|l| l.contains("Press Enter to confirm or Esc to cancel"));

        // 1. Specific approval patterns (High confidence)
        for line in recent_lines {
            let trimmed = line.trim();
            if trimmed.contains("Would you like to run the following command?") {
                return Some((
                    ApprovalType::ShellCommand,
                    trimmed.to_string(),
                    "exec_approval",
                ));
            }
            if trimmed.contains("Would you like to make the following edits?") {
                return Some((
                    ApprovalType::FileEdit,
                    trimmed.to_string(),
                    "patch_approval",
                ));
            }
            if trimmed.contains("needs your approval") {
                return Some((ApprovalType::McpTool, trimmed.to_string(), "mcp_approval"));
            }
            if trimmed.contains("Do you want to approve access to") {
                return Some((
                    ApprovalType::Other("Network".to_string()),
                    trimmed.to_string(),
                    "network_approval",
                ));
            }
        }

        // 2. Codex approval choices pattern (High confidence)
        //    "Yes, proceed" with [y], "Yes, and don't ask again" with [p]/[a],
        //    "No, and tell Codex" with [Esc/n]
        if let Some(rule) = self.detect_codex_choices(recent_lines) {
            return Some((
                ApprovalType::Other("Codex approval".to_string()),
                String::new(),
                rule,
            ));
        }

        // 3. Numbered choices (user question pattern)
        if let Some(question) = self.detect_numbered_choices(recent_lines) {
            return Some((question.0, question.1, "codex_numbered_choices"));
        }

        // 4. Generic [y/n] approval patterns
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
                    "codex_approval_pattern",
                ));
            }
        }

        // 5. Confirm footer alone (without other approval signals) as a weaker signal
        if has_confirm_footer {
            return Some((
                ApprovalType::Other("Codex approval".to_string()),
                String::new(),
                "confirm_footer",
            ));
        }

        None
    }

    /// Detect Codex-specific approval choice lines
    ///
    /// Looks for patterns like:
    /// - "Yes, proceed" with `[y]`
    /// - "Yes, and don't ask again" with `[p]` or `[a]`
    /// - "No, and tell Codex" with `[Esc/n]`
    fn detect_codex_choices(&self, lines: &[&str]) -> Option<&'static str> {
        let mut has_yes_proceed = false;
        let mut has_no_tell = false;

        for line in lines {
            let trimmed = line.trim();
            if (trimmed.contains("Yes, proceed") || trimmed.contains("Yes, and don't ask again"))
                && (trimmed.contains("[y]") || trimmed.contains("[p]") || trimmed.contains("[a]"))
            {
                has_yes_proceed = true;
            }
            if trimmed.contains("No, and tell Codex") && trimmed.contains("[Esc/n]") {
                has_no_tell = true;
            }
        }

        if has_yes_proceed || has_no_tell {
            Some("codex_choice_pattern")
        } else {
            None
        }
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
        super::common::detect_error_common(content, 500)
    }
}

impl Default for CodexDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusDetector for CodexDetector {
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
        // 1-4. Check for approval requests (specific patterns, codex choices, numbered choices, generic [y/n])
        if let Some((approval_type, details, rule)) = self.detect_approval(content) {
            return DetectionResult::new(
                AgentStatus::AwaitingApproval {
                    approval_type,
                    details: details.clone(),
                },
                rule,
                DetectionConfidence::High,
            )
            .with_matched_text(&details);
        }

        // 5. Check for errors
        if let Some(message) = self.detect_error(content) {
            return DetectionResult::new(
                AgentStatus::Error {
                    message: message.clone(),
                },
                "codex_error_pattern",
                DetectionConfidence::High,
            )
            .with_matched_text(&message);
        }

        // Content-based detection for Codex CLI
        let lines: Vec<&str> = content.lines().collect();
        let recent_lines: Vec<&str> = lines.iter().rev().take(15).copied().collect();

        // 6. Working + elapsed time pattern (High confidence)
        for line in &recent_lines {
            let trimmed = line.trim();
            if self.working_elapsed_pattern.is_match(trimmed) {
                return DetectionResult::new(
                    AgentStatus::Processing {
                        activity: trimmed.to_string(),
                    },
                    "working_elapsed_time",
                    DetectionConfidence::High,
                )
                .with_matched_text(trimmed);
            }
        }

        // 7. Spinner detection (Medium confidence)
        for line in &recent_lines {
            let trimmed = line.trim();

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
                return DetectionResult::new(
                    AgentStatus::Processing {
                        activity: trimmed.to_string(),
                    },
                    "codex_spinner",
                    DetectionConfidence::Medium,
                )
                .with_matched_text(trimmed);
            }
        }

        // 8. "esc to interrupt" (Medium confidence)
        for line in &recent_lines {
            let trimmed = line.trim();
            if trimmed.contains("esc to interrupt") {
                return DetectionResult::new(
                    AgentStatus::Processing {
                        activity: String::new(),
                    },
                    "codex_esc_to_interrupt",
                    DetectionConfidence::Medium,
                )
                .with_matched_text(trimmed);
            }
        }

        // 9. Thinking/Generating text (Medium confidence)
        for line in &recent_lines {
            let trimmed = line.trim();
            if trimmed.contains("Thinking") || trimmed.contains("Generating") {
                return DetectionResult::new(
                    AgentStatus::Processing {
                        activity: trimmed.to_string(),
                    },
                    "codex_thinking",
                    DetectionConfidence::Medium,
                )
                .with_matched_text(trimmed);
            }
        }

        // Title-based detection
        let title_lower = title.to_lowercase();
        if title_lower.contains("idle") || title_lower.contains("ready") {
            return DetectionResult::new(
                AgentStatus::Idle,
                "codex_title_idle",
                DetectionConfidence::Medium,
            )
            .with_matched_text(title);
        }

        if title_lower.contains("working") || title_lower.contains("processing") {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: title.to_string(),
                },
                "codex_title_processing",
                DetectionConfidence::Medium,
            )
            .with_matched_text(title);
        }

        // 10. Idle detection indicators
        let mut prompt_line_idx: Option<usize> = None;
        let mut footer_line_idx: Option<usize> = None;

        for (idx, line) in recent_lines.iter().enumerate() {
            let trimmed = line.trim();
            if trimmed.contains("% context left") {
                footer_line_idx = Some(idx);
            }
            if trimmed.starts_with('›') {
                prompt_line_idx = Some(idx);
                break;
            }
        }

        // Prompt + footer together
        if let (Some(prompt_idx), Some(footer_idx)) = (prompt_line_idx, footer_line_idx) {
            if prompt_idx > footer_idx {
                let between = &recent_lines[footer_idx + 1..prompt_idx];
                let only_empty_or_hints = between
                    .iter()
                    .all(|l| l.trim().is_empty() || l.trim().starts_with('?'));
                if only_empty_or_hints {
                    return DetectionResult::new(
                        AgentStatus::Idle,
                        "codex_prompt_footer",
                        DetectionConfidence::Medium,
                    );
                }
            }
        }

        // Slash menu
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
            return DetectionResult::new(
                AgentStatus::Idle,
                "codex_slash_menu",
                DetectionConfidence::Medium,
            );
        }

        // Prompt only
        if prompt_line_idx.is_some() {
            return DetectionResult::new(
                AgentStatus::Idle,
                "codex_prompt_only",
                DetectionConfidence::Medium,
            );
        }

        // Footer only
        if footer_line_idx.is_some() {
            DetectionResult::new(
                AgentStatus::Idle,
                "codex_footer_only",
                DetectionConfidence::Low,
            )
        } else {
            // 11. Fallback - Processing (Low confidence)
            DetectionResult::new(
                AgentStatus::Processing {
                    activity: String::new(),
                },
                "codex_fallback_processing",
                DetectionConfidence::Low,
            )
        }
    }

    fn agent_type(&self) -> AgentType {
        AgentType::CodexCli
    }

    fn approval_keys(&self) -> &str {
        "Enter"
    }

    /// Detect context warning from Codex footer (e.g., "83% context left")
    fn detect_context_warning(&self, content: &str) -> Option<u8> {
        let lines: Vec<&str> = content.lines().collect();
        let check_start = lines.len().saturating_sub(5);
        for line in &lines[check_start..] {
            if let Some(caps) = self.context_left_pattern.captures(line) {
                if let Some(m) = caps.get(1) {
                    if let Ok(pct) = m.as_str().parse::<u8>() {
                        return Some(pct);
                    }
                }
            }
        }
        None
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

    #[test]
    fn test_working_elapsed_time() {
        let detector = CodexDetector::new();
        let content = "Working (3s \u{2022} esc to interrupt)";
        let result = detector.detect_status_with_reason("", content, &DetectionContext::default());
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "working_elapsed_time");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_exec_approval() {
        let detector = CodexDetector::new();
        let content = "Would you like to run the following command?\n\n  ls -la\n\nPress Enter to confirm or Esc to cancel";
        let status = detector.detect_status("", content);
        assert!(
            matches!(
                status,
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::ShellCommand,
                    ..
                }
            ),
            "Expected AwaitingApproval with ShellCommand, got {:?}",
            status
        );
    }

    #[test]
    fn test_patch_approval() {
        let detector = CodexDetector::new();
        let content = "Would you like to make the following edits?\n\n  src/main.rs\n  + fn new_function() {}";
        let status = detector.detect_status("", content);
        assert!(
            matches!(
                status,
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::FileEdit,
                    ..
                }
            ),
            "Expected AwaitingApproval with FileEdit, got {:?}",
            status
        );
    }

    #[test]
    fn test_mcp_approval() {
        let detector = CodexDetector::new();
        let content = "The tool 'web_search' needs your approval to run.";
        let status = detector.detect_status("", content);
        assert!(
            matches!(
                status,
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::McpTool,
                    ..
                }
            ),
            "Expected AwaitingApproval with McpTool, got {:?}",
            status
        );
    }

    #[test]
    fn test_network_approval() {
        let detector = CodexDetector::new();
        let content = "Do you want to approve access to api.example.com?";
        let status = detector.detect_status("", content);
        assert!(
            matches!(
                status,
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::Other(ref s),
                    ..
                } if s == "Network"
            ),
            "Expected AwaitingApproval with Other(Network), got {:?}",
            status
        );
    }

    #[test]
    fn test_codex_choice_pattern() {
        let detector = CodexDetector::new();
        let content = r#"
Would you like to run the following command?

  npm install express

  Yes, proceed                      [y]
  Yes, and don't ask again          [a]
  No, and tell Codex why            [Esc/n]
"#;
        let status = detector.detect_status("", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_context_warning() {
        let detector = CodexDetector::new();
        let content =
            "Some output\n\n  ? for shortcuts                                 83% context left";
        let result = detector.detect_context_warning(content);
        assert_eq!(result, Some(83));
    }

    #[test]
    fn test_context_warning_none() {
        let detector = CodexDetector::new();
        let content = "Some output without context info";
        let result = detector.detect_context_warning(content);
        assert_eq!(result, None);
    }

    #[test]
    fn test_confirm_footer() {
        let detector = CodexDetector::new();
        // Confirm footer alone should trigger approval detection
        let content = "Some content here\n\nPress Enter to confirm or Esc to cancel";
        let result = detector.detect_status_with_reason("", content, &DetectionContext::default());
        assert!(
            matches!(result.status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "confirm_footer");
    }
}
