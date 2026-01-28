use regex::Regex;

use crate::agents::{AgentStatus, AgentType, ApprovalType};

use super::StatusDetector;

/// Idle indicator - ✳ appears when Claude Code is waiting for input
const IDLE_INDICATOR: char = '✳';

/// Processing spinner characters (Braille patterns)
const PROCESSING_SPINNERS: &[char] = &[
    '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', '⠿', '⠾', '⠽', '⠻', '⠟', '⠯', '⠷', '⠳', '⠱',
    '⠰', '◐', '◓', '◑', '◒',
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
            .expect("Invalid file_edit_pattern regex"),
            file_create_pattern: Regex::new(
                r"(?i)Create\s+.*?\?|Do you want to create|Allow.*?create",
            )
            .expect("Invalid file_create_pattern regex"),
            file_delete_pattern: Regex::new(
                r"(?i)Delete\s+.*?\?|Do you want to delete|Allow.*?delete",
            )
            .expect("Invalid file_delete_pattern regex"),
            bash_pattern: Regex::new(
                r"(?i)(Run|Execute)\s+(command|bash|shell)|Do you want to run|Allow.*?(command|bash)|run this command",
            )
            .expect("Invalid bash_pattern regex"),
            mcp_pattern: Regex::new(r"(?i)MCP\s+tool|Do you want to use.*?MCP|Allow.*?MCP")
                .expect("Invalid mcp_pattern regex"),
            general_approval_pattern: Regex::new(
                r"(?i)\[y/n\]|\[Y/n\]|\[yes/no\]|\(Y\)es\s*/\s*\(N\)o|Yes\s*/\s*No|y/n|Allow\?|Do you want to (allow|proceed|continue|run|execute)",
            )
            .expect("Invalid general_approval_pattern regex"),
            // Choice pattern: handles "> 1. Option" or "  1. Option" or "❯ 1. Option"
            choice_pattern: Regex::new(r"^\s*(?:[>❯]\s*)?(\d+)\.\s+(.+)$")
                .expect("Invalid choice_pattern regex"),
            error_pattern: Regex::new(r"(?i)(?:^|\n)\s*(?:Error|ERROR|error:|✗|❌)")
                .expect("Invalid error_pattern regex"),
        }
    }

    /// Detect AskUserQuestion with numbered choices
    fn detect_user_question(&self, content: &str) -> Option<(ApprovalType, String)> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.is_empty() {
            return None;
        }

        // Find the last prompt marker (❯) - choices should be BEFORE it
        // Note: ❯ followed by number is a selection cursor, not a prompt
        let last_prompt_idx = lines.iter().rposition(|line| {
            let trimmed = line.trim();
            // Only count ❯ as prompt if it's alone or followed by space (not "❯ 1." pattern)
            if trimmed == "❯" || trimmed == "❯ " {
                return true;
            }
            // Check if ❯ is followed by a number (selection cursor)
            if trimmed.starts_with('❯') {
                let after_marker = trimmed.trim_start_matches('❯').trim_start();
                // If followed by digit, it's a selection cursor, not a prompt
                if after_marker
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false)
                {
                    return false;
                }
                // Very short ❯ line could be prompt
                return trimmed.len() < 3;
            }
            false
        });

        // If no prompt found, search entire content; otherwise search before prompt
        let search_end = last_prompt_idx.unwrap_or(lines.len());
        // Also search the entire content if prompt is at the very end
        let search_start = if search_end == lines.len() {
            lines.len().saturating_sub(30)
        } else {
            search_end.saturating_sub(25)
        };
        let check_lines = &lines[search_start..lines.len().max(search_end)];

        if check_lines.is_empty() {
            return None;
        }

        let mut choices = Vec::new();
        let mut question = String::new();
        let mut first_choice_idx = None;
        let mut last_choice_idx = None;
        let mut is_multi_select = false;
        let mut cursor_position: usize = 0;

        // Check for multi-select indicators in the content
        for line in check_lines.iter() {
            let lower = line.to_lowercase();
            if lower.contains("space to")
                || lower.contains("toggle")
                || lower.contains("select all")
                || lower.contains("multi")
            {
                is_multi_select = true;
                break;
            }
        }

        // Store all found choice sets, keep the last valid one
        let mut best_choices: Vec<String> = Vec::new();
        let mut best_first_idx: Option<usize> = None;
        let mut best_last_idx: Option<usize> = None;
        let mut best_cursor_position: usize = 0;

        for (i, line) in check_lines.iter().enumerate() {
            let trimmed = line.trim();

            // Skip UI elements (box drawing characters)
            if trimmed.starts_with('│')
                || trimmed.starts_with('├')
                || trimmed.starts_with('└')
                || trimmed.starts_with('┌')
                || trimmed.starts_with('─')
                || trimmed.starts_with('✻')
                || trimmed.starts_with('╌')
            {
                continue;
            }

            // Check for numbered choices (e.g., "1. Option text" or "> 1. Option text")
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

                        // Check if this line has cursor marker (❯ or >)
                        if trimmed.starts_with('❯') || trimmed.starts_with('>') {
                            cursor_position = num as usize;
                        }
                    } else if num == 1 {
                        // New choice set starting - save current if valid (must have cursor marker)
                        if choices.len() >= 2 && cursor_position > 0 {
                            best_choices = choices.clone();
                            best_first_idx = first_choice_idx;
                            best_last_idx = last_choice_idx;
                            best_cursor_position = cursor_position;
                        }
                        // Start new choice set
                        choices.clear();
                        let label = choice_text
                            .split('（')
                            .next()
                            .unwrap_or(choice_text)
                            .trim()
                            .to_string();
                        choices.push(label);
                        first_choice_idx = Some(i);
                        last_choice_idx = Some(i);
                        cursor_position = if trimmed.starts_with('❯') || trimmed.starts_with('>')
                        {
                            1
                        } else {
                            0
                        };
                    }
                }
            }
        }

        // Use the last valid choice set (must have cursor marker to be AskUserQuestion)
        if choices.len() >= 2 && cursor_position > 0 {
            best_choices = choices;
            best_first_idx = first_choice_idx;
            best_last_idx = last_choice_idx;
            best_cursor_position = cursor_position;
        }

        // Restore best choices
        choices = best_choices;
        first_choice_idx = best_first_idx;
        last_choice_idx = best_last_idx;
        cursor_position = best_cursor_position;

        // Choices must be near the end (allow for UI hints like "Enter to select")
        if let Some(last_idx) = last_choice_idx {
            if check_lines.len() - last_idx > 15 {
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
            // Default cursor to 1 if not detected
            let cursor = if cursor_position == 0 {
                1
            } else {
                cursor_position
            };
            Some((
                ApprovalType::UserQuestion {
                    choices,
                    multi_select: is_multi_select,
                    cursor_position: cursor,
                },
                question,
            ))
        } else {
            None
        }
    }

    /// Detect "Do you want to proceed?" style approval (1. Yes / 2. Yes, don't ask / 3. No)
    fn detect_proceed_prompt(content: &str) -> bool {
        // Filter out empty lines and take last 15 non-empty lines
        let check_lines: Vec<&str> = content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .take(15)
            .collect();

        let mut has_yes = false;
        let mut has_no = false;

        for line in &check_lines {
            let trimmed = line.trim();
            // Pattern: "1. Yes" or "❯ 1. Yes" or "> 1. Yes"
            if trimmed.contains("1.") && trimmed.contains("Yes") {
                has_yes = true;
            }
            // Pattern: "2. No" or "3. No"
            if (trimmed.contains("2. No") || trimmed.contains("3. No")) && trimmed.len() < 20 {
                has_no = true;
            }
        }

        has_yes && has_no
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

        // Check for "1. Yes / 2. ... / 3. No" style proceed prompt
        let has_proceed_prompt = Self::detect_proceed_prompt(content);

        // Check for button-style approval
        let has_yes_no_buttons = self.detect_yes_no_buttons(recent_lines);

        // Check for text-format approval
        let last_lines: Vec<&str> = recent_lines.iter().rev().take(10).copied().collect();
        let last_text = last_lines.join("\n");
        let has_text_approval = self.general_approval_pattern.is_match(&last_text);

        if !has_proceed_prompt && !has_yes_no_buttons && !has_text_approval {
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

    /// Check if content contains Tasks list with in-progress tasks
    /// ◼ indicates an in-progress task in Claude Code's task list
    fn has_in_progress_tasks(content: &str) -> bool {
        // Look for the Tasks header pattern and in-progress indicator
        let recent = safe_tail(content, 2000);

        // Check for Tasks header with in_progress count > 0
        for line in recent.lines() {
            let trimmed = line.trim();
            // Match "Tasks (X done, Y in progress, Z open)"
            if trimmed.starts_with("Tasks (") && trimmed.contains("in progress") {
                // Check if there's at least 1 in progress
                if let Some(start) = trimmed.find(", ") {
                    if let Some(end) = trimmed[start + 2..].find(" in progress") {
                        let num_str = &trimmed[start + 2..start + 2 + end];
                        if let Ok(count) = num_str.parse::<u32>() {
                            if count > 0 {
                                return true;
                            }
                        }
                    }
                }
            }
            // Also check for ◼ #N pattern (in-progress task indicator)
            if trimmed.starts_with("◼ #") {
                return true;
            }
        }
        false
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

        // 3. Check for Tasks list with in-progress tasks (◼)
        // This takes priority over title-based Idle detection
        if Self::has_in_progress_tasks(content) {
            return AgentStatus::Processing {
                activity: "Tasks running".to_string(),
            };
        }

        // 4. Check for Compacting (✽ Compacting conversation)
        if title.contains('✽') && title.to_lowercase().contains("compacting") {
            return AgentStatus::Processing {
                activity: "Compacting...".to_string(),
            };
        }

        // 5. Title-based detection
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

    fn detect_context_warning(&self, content: &str) -> Option<u8> {
        // Look for "Context left until auto-compact: XX%"
        for line in content.lines().rev().take(30) {
            if line.contains("Context left until auto-compact:") {
                // Extract percentage
                if let Some(pct_str) = line.split(':').last() {
                    let pct_str = pct_str.trim().trim_end_matches('%');
                    if let Ok(pct) = pct_str.parse::<u8>() {
                        return Some(pct);
                    }
                }
            }
        }
        None
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
        // AskUserQuestion always has ❯ cursor on the selected option line
        let content = r#"
Which option do you prefer?

❯ 1. Option A
  2. Option B
  3. Option C
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                assert!(matches!(approval_type, ApprovalType::UserQuestion { .. }));
            }
            _ => panic!("Expected AwaitingApproval with UserQuestion"),
        }
    }

    #[test]
    fn test_numbered_list_not_detected_as_question() {
        let detector = ClaudeCodeDetector::new();
        // Regular numbered list without ❯ cursor should NOT be detected as AskUserQuestion
        let content = r#"
Here are the changes:

1. Fixed the bug
2. Added tests
3. Updated docs
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        // Should be Idle, not AwaitingApproval
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_numbered_choices_with_cursor() {
        let detector = ClaudeCodeDetector::new();
        // Format with > cursor marker on selected option
        let content = r#"
Which option do you prefer?

> 1. Option A
  2. Option B
  3. Option C

❯
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 3);
                } else {
                    panic!("Expected UserQuestion");
                }
            }
            _ => panic!("Expected AwaitingApproval with UserQuestion"),
        }
    }

    #[test]
    fn test_numbered_choices_with_descriptions() {
        let detector = ClaudeCodeDetector::new();
        // Real AskUserQuestion format with multi-line options
        let content = r#"
───────────────────────────────────────────────────────────────────────────────
 ☐ 動作確認

数字キーで選択できますか？

❯ 1. 1番: 動作した
     数字キーで1を押して選択できた
  2. 2番: まだ動かない
     数字キーが反応しない
  3. 3番: 別の問題
     他の問題が発生した
  4. Type something.
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 4, "Expected 4 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_would_you_like_to_proceed() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"Would you like to proceed?

 ❯ 1. Yes, clear context and auto-accept edits (shift+tab)
   2. Yes, auto-accept edits
   3. Yes, manually approve edits
   4. Type here to tell Claude what to change"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 4, "Expected 4 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_would_you_like_to_proceed_with_footer() {
        let detector = ClaudeCodeDetector::new();
        // Real captured content with UI footer
        let content = r#"   - 環境変数未設定時に警告ログが出ることを確認

 ---
 完了条件

 - getInvitationLink ヘルパー関数を作成
 - queries.ts と mutations.ts でヘルパー関数を使用
 - 型チェック・リント・テストがパス
 - Issue #62 の関連項目をクローズ
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

 Would you like to proceed?

 ❯ 1. Yes, clear context and auto-accept edits (shift+tab)
   2. Yes, auto-accept edits
   3. Yes, manually approve edits
   4. Type here to tell Claude what to change

 ctrl-g to edit in Micro · .claude/plans/eventual-humming-hellman.md"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 4, "Expected 4 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_numbered_choices_with_ui_hints() {
        let detector = ClaudeCodeDetector::new();
        // Real format with UI hints at the bottom
        let content = r#"
───────────────────────────────────────────────────────────────────────────────
 ☐ コンテンツ取得

デバッグのため、コンテンツを貼り付けてもらえますか？

❯ 1. 貼り付ける
     「その他」でコンテンツを入力
  2. 別のアプローチ
     デバッグモードを追加して原因を特定
  3. Type something.

───────────────────────────────────────────────────────────────────────────────
  Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 3, "Expected 3 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_tasks_in_progress_detected_as_processing() {
        let detector = ClaudeCodeDetector::new();
        // Tasks list with in_progress tasks should be Processing, not Idle
        let content = r#"
  Tasks (0 done, 2 in progress, 8 open) · ctrl+t to hide tasks
  ◼ #1 T1: helpers仕様書の作成
  ◼ #2 T2: Result型仕様書の作成
  ◻ #3 T3: past-medication-record-edit更新
  ◻ #4 T4: medication-history更新
  ◻ #10 T10: OVERVIEW更新 › blocked by #9
"#;
        // Even with ✳ in title, should be Processing due to in-progress tasks
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::Processing { .. }),
            "Expected Processing, got {:?}",
            status
        );
    }

    #[test]
    fn test_tasks_all_done_is_idle() {
        let detector = ClaudeCodeDetector::new();
        // Tasks list with all done (no in_progress) should be Idle
        let content = r#"
  Tasks (10 done, 0 in progress, 0 open) · ctrl+t to hide tasks
  ✔ #1 T1: helpers仕様書の作成
  ✔ #2 T2: Result型仕様書の作成
  ✔ #3 T3: past-medication-record-edit更新
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::Idle),
            "Expected Idle, got {:?}",
            status
        );
    }

    #[test]
    fn test_web_search_approval() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"● Web Search("MCP Apps iframe UI Model Context Protocol 2026")

● Explore(プロジェクト構造の調査)
  ⎿  Done (11 tool uses · 85.3k tokens · 51s)

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Tool use

   Web Search("MCP Apps iframe UI Model Context Protocol 2026")
   Claude wants to search the web for: MCP Apps iframe UI Model Context Protocol 2026

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for Web Search commands in /home/trustdelta/works/conversation-handoff-mcp
   3. No

 Esc to cancel · Tab to add additional instructions"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_proceed_prompt_detection() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for Web Search commands
   3. No

 Esc to cancel"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_actual_captured_content() {
        let detector = ClaudeCodeDetector::new();
        // Content with ❯ appearing both as user prompt and selection cursor
        let content = "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\n\
❯ MCP Appsが公開された、テスト\n\
Line8\nLine9\nLine10\n\
Line11\nLine12\nLine13\nLine14\nLine15\n\
 Tool use\n\
   Web Search(\"test\")\n\
\n\
 Do you want to proceed?\n\
 ❯ 1. Yes\n\
   2. No\n\
\n\
 Esc to cancel";
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_web_search_with_full_capture() {
        let detector = ClaudeCodeDetector::new();
        // Full capture from actual tmux pane - includes welcome screen
        let content = r#"╭─── Claude Code v2.1.17 ─────────────────────────────────────────────────────────────────────────────────────────────╮
│                                                     │ Tips for getting started                                      │
│             Welcome back trust.delta!               │ Run /init to create a CLAUDE.md file with instructions for Cl…│
│                                                     │                                                               │
│                                                     │ ───────────────────────────────────────────────────────────── │
│                      ▐▛███▜▌                        │ Recent activity                                               │
│                     ▝▜█████▛▘                       │ No recent activity                                            │
│                       ▘▘ ▝▝                         │                                                               │
│  Opus 4.5 · Claude Max · trust.delta@gmail.com's    │                                                               │
│  Organization                                       │                                                               │
│          ~/works/conversation-handoff-mcp           │                                                               │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

❯ MCP Appsが公開された、mcpにiframeでuiを追加できる様子。実験がてらアプデが止まってたconversation-handoff-mcpに組
  み込んでみようと思います

● MCP Appsは興味深い新機能ですね。まずMCP Appsの仕様と現在のconversation-handoff-mcpの状態を調査しましょう。

● Web Search("MCP Apps iframe UI Model Context Protocol 2026")

● Explore(プロジェクト構造の調査)
  ⎿  Done (11 tool uses · 85.3k tokens · 51s)

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Tool use

   Web Search("MCP Apps iframe UI Model Context Protocol 2026")
   Claude wants to search the web for: MCP Apps iframe UI Model Context Protocol 2026

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for Web Search commands in /home/trustdelta/works/conversation-handoff-mcp
   3. No

 Esc to cancel · Tab to add additional instructions"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }
}
