use regex::Regex;

use crate::agents::{AgentStatus, AgentType, ApprovalType};

use super::StatusDetector;

/// Idle indicator - ✳ appears when Claude Code is waiting for input
const IDLE_INDICATOR: char = '✳';

/// Processing spinner characters (Braille patterns)
const PROCESSING_SPINNERS: &[char] = &[
    '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', '⠿', '⠾', '⠽', '⠻', '⠟', '⠯', '⠷',
    '⠳', '⠱', '⠰', '◐', '◓', '◑', '◒',
];

/// Detector for Claude Code CLI
pub struct ClaudeCodeDetector {
    // Approval patterns
    file_edit_pattern: Regex,
    file_create_pattern: Regex,
    file_delete_pattern: Regex,
    bash_pattern: Regex,
    mcp_pattern: Regex,
    general_approval_pattern: Regex,
    // Choice pattern for AskUserQuestion
    choice_pattern: Regex,
    // Error patterns
    error_pattern: Regex,
}

impl ClaudeCodeDetector {
    pub fn new() -> Self {
        Self {
            file_edit_pattern: Regex::new(
                r"(?i)(Edit|Write|Modify)\s+.*?\?|Do you want to (edit|write|modify)|Allow.*?edit",
            )
            .unwrap(),
            file_create_pattern: Regex::new(
                r"(?i)Create\s+.*?\?|Do you want to create|Allow.*?create",
            )
            .unwrap(),
            file_delete_pattern: Regex::new(
                r"(?i)Delete\s+.*?\?|Do you want to delete|Allow.*?delete",
            )
            .unwrap(),
            bash_pattern: Regex::new(
                r"(?i)(Run|Execute)\s+(command|bash|shell)|Do you want to run|Allow.*?(command|bash)|run this command",
            )
            .unwrap(),
            mcp_pattern: Regex::new(r"(?i)MCP\s+tool|Do you want to use.*?MCP|Allow.*?MCP")
                .unwrap(),
            general_approval_pattern: Regex::new(
                r"(?i)\[y/n\]|\[Y/n\]|\[yes/no\]|\(Y\)es\s*/\s*\(N\)o|Yes\s*/\s*No|y/n|Allow\?|Do you want to (allow|proceed|continue|run|execute)",
            )
            .unwrap(),
            choice_pattern: Regex::new(r"^\s*(\d+)\.\s+(.+)$").unwrap(),
            error_pattern: Regex::new(r"(?i)(?:^|\n)\s*(?:Error|ERROR|error:|✗|❌)").unwrap(),
        }
    }

    /// Detect AskUserQuestion with numbered choices
    fn detect_user_question(&self, content: &str) -> Option<(ApprovalType, String)> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.is_empty() {
            return None;
        }

        // Find the last prompt marker (❯) - choices should be BEFORE it
        let last_prompt_idx = lines.iter().rposition(|line| {
            let trimmed = line.trim();
            // Only count ❯ at the start of a line (not as selection marker)
            trimmed == "❯" || (trimmed.starts_with('❯') && trimmed.len() < 3)
        });

        let search_end = last_prompt_idx.unwrap_or(lines.len());
        let search_start = search_end.saturating_sub(25);
        let check_lines = &lines[search_start..search_end];

        if check_lines.is_empty() {
            return None;
        }

        let mut choices = Vec::new();
        let mut question = String::new();
        let mut first_choice_idx = None;
        let mut last_choice_idx = None;

        for (i, line) in check_lines.iter().enumerate() {
            let trimmed = line.trim();

            // Skip UI elements
            if trimmed.starts_with('│')
                || trimmed.starts_with('├')
                || trimmed.starts_with('└')
                || trimmed.starts_with('┌')
                || trimmed.starts_with('─')
                || trimmed.starts_with('✻')
            {
                if !choices.is_empty() {
                    choices.clear();
                    first_choice_idx = None;
                    last_choice_idx = None;
                }
                continue;
            }

            // Check for numbered choices (e.g., "1. Option text")
            if let Some(cap) = self.choice_pattern.captures(line) {
                if let Ok(num) = cap[1].parse::<u32>() {
                    let choice_text = cap[2].trim();
                    if num as usize == choices.len() + 1 {
                        let label = choice_text
                            .split('（')
                            .next()
                            .unwrap_or(choice_text)
                            .trim()
                            .to_string();
                        choices.push(label);
                        if first_choice_idx.is_none() {
                            first_choice_idx = Some(i);
                        }
                        last_choice_idx = Some(i);
                    } else if !choices.is_empty() {
                        choices.clear();
                        first_choice_idx = None;
                        last_choice_idx = None;
                    }
                }
            } else if !choices.is_empty() && !trimmed.is_empty() && trimmed.len() > 30 {
                choices.clear();
                first_choice_idx = None;
                last_choice_idx = None;
            }
        }

        // Choices must be near the end
        if let Some(last_idx) = last_choice_idx {
            if check_lines.len() - last_idx > 8 {
                return None;
            }
        }

        // Find the question before choices
        if let Some(first_idx) = first_choice_idx {
            for j in (0..first_idx).rev() {
                let prev = check_lines[j].trim();
                if prev.is_empty() {
                    continue;
                }
                if prev.ends_with('?') || prev.ends_with('？') {
                    question = prev.to_string();
                    break;
                }
                if question.is_empty() {
                    question = prev.to_string();
                }
                if first_idx - j > 5 {
                    break;
                }
            }
        }

        if choices.len() >= 2 {
            Some((
                ApprovalType::UserQuestion {
                    choices,
                    multi_select: false,
                },
                question,
            ))
        } else {
            None
        }
    }

    /// Detect Yes/No button-style approval
    fn detect_yes_no_buttons(&self, lines: &[&str]) -> bool {
        let check_lines: Vec<&str> = lines.iter().rev().take(8).copied().collect();

        let mut has_yes = false;
        let mut has_no = false;
        let mut yes_line_idx: Option<usize> = None;
        let mut no_line_idx: Option<usize> = None;

        for (idx, line) in check_lines.iter().enumerate() {
            let trimmed = line.trim();

            if trimmed.is_empty() || trimmed.len() > 50 {
                continue;
            }

            // Check for "Yes" button
            if (trimmed == "Yes" || trimmed.starts_with("Yes,") || trimmed.starts_with("Yes "))
                && trimmed.len() < 40
            {
                has_yes = true;
                yes_line_idx = Some(idx);
            }

            // Check for "No" button
            if (trimmed == "No" || trimmed.starts_with("No,") || trimmed.starts_with("No "))
                && trimmed.len() < 40
            {
                has_no = true;
                no_line_idx = Some(idx);
            }
        }

        // Both Yes and No must be present and close together (within 4 lines)
        if has_yes && has_no {
            if let (Some(y_idx), Some(n_idx)) = (yes_line_idx, no_line_idx) {
                let distance = y_idx.abs_diff(n_idx);
                return distance <= 4;
            }
        }

        false
    }

    /// Detect approval request in content
    fn detect_approval(&self, content: &str) -> Option<(ApprovalType, String)> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.is_empty() {
            return None;
        }

        // Check last ~20 lines
        let check_start = lines.len().saturating_sub(20);
        let recent_lines = &lines[check_start..];
        let _recent = recent_lines.join("\n");

        // Check for AskUserQuestion first (highest priority)
        if let Some(result) = self.detect_user_question(content) {
            return Some(result);
        }

        // Check for button-style approval
        let has_yes_no_buttons = self.detect_yes_no_buttons(recent_lines);

        // Check for text-format approval
        let last_lines: Vec<&str> = recent_lines.iter().rev().take(10).copied().collect();
        let last_text = last_lines.join("\n");
        let has_text_approval = self.general_approval_pattern.is_match(&last_text);

        if !has_yes_no_buttons && !has_text_approval {
            return None;
        }

        // Determine approval type
        let context = safe_tail(content, 1500);

        if self.file_edit_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileEdit, details));
        }

        if self.file_create_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileCreate, details));
        }

        if self.file_delete_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileDelete, details));
        }

        if self.bash_pattern.is_match(context) {
            let details = self.extract_command(context).unwrap_or_default();
            return Some((ApprovalType::ShellCommand, details));
        }

        if self.mcp_pattern.is_match(context) {
            return Some((ApprovalType::McpTool, "MCP tool call".to_string()));
        }

        Some((
            ApprovalType::Other("Pending approval".to_string()),
            String::new(),
        ))
    }

    /// Detect error in content
    fn detect_error(&self, content: &str) -> Option<String> {
        let recent = safe_tail(content, 500);
        if self.error_pattern.is_match(recent) {
            // Extract error message
            for line in recent.lines().rev() {
                let trimmed = line.trim();
                if trimmed.to_lowercase().contains("error")
                    || trimmed.contains('✗')
                    || trimmed.contains('❌')
                {
                    return Some(trimmed.to_string());
                }
            }
            return Some("Error detected".to_string());
        }
        None
    }

    fn extract_file_path(&self, content: &str) -> Option<String> {
        let path_pattern =
            Regex::new(r"(?m)(?:file|path)[:\s]+([^\s\n]+)|([./][\w/.-]+\.\w+)").ok()?;
        path_pattern
            .captures(content)
            .and_then(|c| c.get(1).or(c.get(2)))
            .map(|m| m.as_str().to_string())
    }

    fn extract_command(&self, content: &str) -> Option<String> {
        let cmd_pattern =
            Regex::new(r"(?m)(?:command|run)[:\s]+`([^`]+)`|```(?:bash|sh)?\n([^`]+)```").ok()?;
        cmd_pattern
            .captures(content)
            .and_then(|c| c.get(1).or(c.get(2)))
            .map(|m| m.as_str().trim().to_string())
    }
}

impl Default for ClaudeCodeDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusDetector for ClaudeCodeDetector {
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus {
        // 1. Check for AskUserQuestion or approval (highest priority)
        if let Some((approval_type, details)) = self.detect_approval(content) {
            return AgentStatus::AwaitingApproval {
                approval_type,
                details,
            };
        }

        // 2. Check for errors
        if let Some(message) = self.detect_error(content) {
            return AgentStatus::Error { message };
        }

        // 3. Title-based detection
        // ✳ in title = Idle (waiting for input)
        if title.contains(IDLE_INDICATOR) {
            return AgentStatus::Idle;
        }

        // Braille spinner in title = Processing
        if title.chars().any(|c| PROCESSING_SPINNERS.contains(&c)) {
            // Try to extract activity from title
            let activity = title
                .chars()
                .skip_while(|c| PROCESSING_SPINNERS.contains(c) || c.is_whitespace())
                .collect::<String>();
            return AgentStatus::Processing { activity };
        }

        // No indicator - default to Processing
        AgentStatus::Processing {
            activity: String::new(),
        }
    }

    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn approval_keys(&self) -> &str {
        "y"
    }

    fn rejection_keys(&self) -> &str {
        "n"
    }
}

/// Get the last n bytes of a string safely
fn safe_tail(s: &str, n: usize) -> &str {
    if s.len() <= n {
        s
    } else {
        let start = s.len() - n;
        // Find a valid UTF-8 boundary
        let start = s
            .char_indices()
            .map(|(i, _)| i)
            .find(|&i| i >= start)
            .unwrap_or(s.len());
        &s[start..]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idle_with_asterisk() {
        let detector = ClaudeCodeDetector::new();
        let status = detector.detect_status("✳ Claude Code", "some content");
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_processing_with_spinner() {
        let detector = ClaudeCodeDetector::new();
        let status = detector.detect_status("⠋ Processing task", "some content");
        assert!(matches!(status, AgentStatus::Processing { .. }));
    }

    #[test]
    fn test_yes_no_button_approval() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"
Do you want to allow this action?

  Yes
  Yes, and don't ask again for this session
  No
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(matches!(status, AgentStatus::AwaitingApproval { .. }));
    }

    #[test]
    fn test_no_false_positive_for_prompt() {
        let detector = ClaudeCodeDetector::new();
        // ❯ alone should not trigger approval
        let content = "Some previous output\n\n❯ ";
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_numbered_choices() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"
Which option do you prefer?

1. Option A
2. Option B
3. Option C

❯
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                assert!(matches!(approval_type, ApprovalType::UserQuestion { .. }));
            }
            _ => panic!("Expected AwaitingApproval with UserQuestion"),
        }
    }
}
