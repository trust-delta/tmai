//! Output analyzer for PTY wrapper
//!
//! Analyzes agent output to determine current state.

use regex::Regex;
use std::time::{Duration, Instant};

use crate::wrap::state_file::{WrapApprovalType, WrapState};

/// Thresholds for state detection
const PROCESSING_TIMEOUT_MS: u64 = 200; // Output within this time = Processing
const APPROVAL_SETTLE_MS: u64 = 500; // Wait this long after output stops before declaring Approval

/// Analyzer for PTY output
pub struct Analyzer {
    /// Last output timestamp
    last_output: Instant,
    /// Last input timestamp
    last_input: Instant,
    /// Recent output buffer (for pattern matching)
    output_buffer: String,
    /// Maximum buffer size
    max_buffer_size: usize,
    /// Current detected approval type (if any)
    pending_approval: Option<(WrapApprovalType, String)>,
    /// When pending approval was first detected
    pending_approval_at: Option<Instant>,
    /// Process ID
    pid: u32,
    /// Compiled patterns
    patterns: AnalyzerPatterns,
}

/// Pre-compiled regex patterns
struct AnalyzerPatterns {
    /// Numbered choice pattern: "1. Option" or "> 1. Option" or "❯ 1. Option"
    choice_pattern: Regex,
    /// Yes/No button pattern (kept for future use)
    #[allow(dead_code)]
    yes_no_pattern: Regex,
    /// General approval pattern [y/n], etc.
    general_approval: Regex,
    /// File edit/create/delete patterns
    file_edit: Regex,
    file_create: Regex,
    file_delete: Regex,
    /// Shell command pattern
    shell_command: Regex,
    /// MCP tool pattern
    mcp_tool: Regex,
}

impl Default for AnalyzerPatterns {
    fn default() -> Self {
        Self {
            choice_pattern: Regex::new(r"^\s*(?:[>❯]\s*)?(\d+)\.\s+(.+)$")
                .expect("Invalid choice_pattern"),
            yes_no_pattern: Regex::new(r"(?i)\b(Yes|No)\b")
                .expect("Invalid yes_no_pattern"),
            general_approval: Regex::new(
                r"(?i)\[y/n\]|\[Y/n\]|\[yes/no\]|\(Y\)es\s*/\s*\(N\)o|Yes\s*/\s*No|y/n|Allow\?|Do you want to"
            ).expect("Invalid general_approval"),
            file_edit: Regex::new(
                r"(?i)(Edit|Write|Modify)\s+.*?\?|Do you want to (edit|write|modify)|Allow.*?edit"
            ).expect("Invalid file_edit"),
            file_create: Regex::new(
                r"(?i)Create\s+.*?\?|Do you want to create|Allow.*?create"
            ).expect("Invalid file_create"),
            file_delete: Regex::new(
                r"(?i)Delete\s+.*?\?|Do you want to delete|Allow.*?delete"
            ).expect("Invalid file_delete"),
            shell_command: Regex::new(
                r"(?i)(Run|Execute)\s+(command|bash|shell)|Do you want to run|Allow.*?(command|bash)|run this command"
            ).expect("Invalid shell_command"),
            mcp_tool: Regex::new(r"(?i)MCP\s+tool|Do you want to use.*?MCP|Allow.*?MCP")
                .expect("Invalid mcp_tool"),
        }
    }
}

impl Analyzer {
    /// Create a new analyzer
    pub fn new(pid: u32) -> Self {
        let now = Instant::now();
        Self {
            last_output: now,
            last_input: now,
            output_buffer: String::with_capacity(8192),
            max_buffer_size: 16384,
            pending_approval: None,
            pending_approval_at: None,
            pid,
            patterns: AnalyzerPatterns::default(),
        }
    }

    /// Process output data
    pub fn process_output(&mut self, data: &str) {
        self.last_output = Instant::now();

        // Append to buffer, truncating old data if necessary
        self.output_buffer.push_str(data);
        if self.output_buffer.len() > self.max_buffer_size {
            let drain_to = self.output_buffer.len() - self.max_buffer_size / 2;
            // Find UTF-8 boundary
            let drain_to = self
                .output_buffer
                .char_indices()
                .map(|(i, _)| i)
                .find(|&i| i >= drain_to)
                .unwrap_or(drain_to);
            self.output_buffer.drain(..drain_to);
        }

        // Check for approval patterns
        self.detect_approval_pattern();
    }

    /// Process input data
    ///
    /// Clears pending approval and output buffer to prevent re-triggering
    /// approval detection from stale output after user input.
    pub fn process_input(&mut self, _data: &str) {
        self.last_input = Instant::now();
        // Clear pending approval on input (user responded)
        self.pending_approval = None;
        self.pending_approval_at = None;
        // Clear output buffer to prevent re-detecting approval from old output
        self.output_buffer.clear();
    }

    /// Get current state
    pub fn get_state(&self) -> WrapState {
        let now = Instant::now();
        let since_output = now.duration_since(self.last_output);
        let _since_input = now.duration_since(self.last_input);

        // If output is still flowing, we're processing
        if since_output < Duration::from_millis(PROCESSING_TIMEOUT_MS) {
            return WrapState::processing(self.pid);
        }

        // Check for approval that has settled
        if let Some((ref approval_type, ref details)) = self.pending_approval {
            if let Some(detected_at) = self.pending_approval_at {
                let since_detected = now.duration_since(detected_at);
                if since_detected >= Duration::from_millis(APPROVAL_SETTLE_MS) {
                    // Approval has settled, return it
                    return match approval_type {
                        WrapApprovalType::UserQuestion => {
                            let (choices, multi_select, cursor_pos) = self.extract_choices();
                            WrapState::user_question(self.pid, choices, multi_select, cursor_pos)
                        }
                        _ => WrapState::awaiting_approval(
                            self.pid,
                            approval_type.clone(),
                            Some(details.clone()),
                        ),
                    };
                } else {
                    // Still settling, show as processing
                    return WrapState::processing(self.pid);
                }
            }
        }

        // No approval detected, output stopped - we're idle
        let mut state = WrapState::idle(self.pid);
        state.last_output = instant_to_millis(self.last_output);
        state.last_input = instant_to_millis(self.last_input);
        state
    }

    /// Detect approval patterns in the output buffer
    fn detect_approval_pattern(&mut self) {
        let content = &self.output_buffer;

        // Check for AskUserQuestion first (highest priority)
        if self.detect_user_question(content) {
            if self.pending_approval.is_none()
                || !matches!(
                    self.pending_approval,
                    Some((WrapApprovalType::UserQuestion, _))
                )
            {
                self.pending_approval = Some((WrapApprovalType::UserQuestion, String::new()));
                self.pending_approval_at = Some(Instant::now());
            }
            return;
        }

        // Check for Yes/No buttons
        if self.detect_yes_no_approval(content) {
            let approval_type = self.determine_approval_type(content);
            if self.pending_approval.is_none() {
                self.pending_approval = Some((approval_type, String::new()));
                self.pending_approval_at = Some(Instant::now());
            }
            return;
        }

        // Check for general approval patterns
        if self.patterns.general_approval.is_match(content) {
            let lines: Vec<&str> = content.lines().collect();
            if let Some(last_few) = lines.get(lines.len().saturating_sub(10)..) {
                let recent = last_few.join("\n");
                if self.patterns.general_approval.is_match(&recent) {
                    let approval_type = self.determine_approval_type(content);
                    if self.pending_approval.is_none() {
                        self.pending_approval = Some((approval_type, String::new()));
                        self.pending_approval_at = Some(Instant::now());
                    }
                    return;
                }
            }
        }

        // No approval pattern found
        self.pending_approval = None;
        self.pending_approval_at = None;
    }

    /// Detect AskUserQuestion with numbered choices
    fn detect_user_question(&self, content: &str) -> bool {
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() < 3 {
            return false;
        }

        // Look for numbered choices with cursor marker in recent lines
        let check_start = lines.len().saturating_sub(25);
        let check_lines = &lines[check_start..];

        let mut consecutive_choices = 0;
        let mut has_cursor = false;
        let mut expected_num = 1u32;

        for line in check_lines {
            if let Some(cap) = self.patterns.choice_pattern.captures(line) {
                if let Ok(num) = cap[1].parse::<u32>() {
                    if num == expected_num {
                        consecutive_choices += 1;
                        expected_num += 1;

                        // Check for cursor marker
                        let trimmed = line.trim();
                        if trimmed.starts_with('❯') || trimmed.starts_with('>') {
                            has_cursor = true;
                        }
                    } else if num == 1 {
                        // New choice set
                        consecutive_choices = 1;
                        expected_num = 2;
                        has_cursor = line.trim().starts_with('❯') || line.trim().starts_with('>');
                    }
                }
            }
        }

        // Need at least 2 choices with cursor marker
        consecutive_choices >= 2 && has_cursor
    }

    /// Detect Yes/No button-style approval
    fn detect_yes_no_approval(&self, content: &str) -> bool {
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() < 2 {
            return false;
        }

        let check_start = lines.len().saturating_sub(8);
        let check_lines = &lines[check_start..];

        let mut has_yes = false;
        let mut has_no = false;
        let mut yes_line_idx = None;
        let mut no_line_idx = None;

        for (idx, line) in check_lines.iter().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.len() > 50 {
                continue;
            }

            if (trimmed == "Yes" || trimmed.starts_with("Yes,") || trimmed.starts_with("Yes "))
                && trimmed.len() < 40
            {
                has_yes = true;
                yes_line_idx = Some(idx);
            }

            if (trimmed == "No" || trimmed.starts_with("No,") || trimmed.starts_with("No "))
                && trimmed.len() < 40
            {
                has_no = true;
                no_line_idx = Some(idx);
            }
        }

        // Both Yes and No must be present and close together
        if has_yes && has_no {
            if let (Some(y_idx), Some(n_idx)) = (yes_line_idx, no_line_idx) {
                let distance = y_idx.abs_diff(n_idx);
                return distance <= 4;
            }
        }

        false
    }

    /// Determine the type of approval being requested
    ///
    /// Note: File create and delete operations are intentionally classified as `FileEdit`
    /// for UI simplicity. The distinction between edit/create/delete is not significant
    /// for user interaction - all require the same y/n approval flow.
    fn determine_approval_type(&self, content: &str) -> WrapApprovalType {
        // Get recent content for matching (respecting UTF-8 boundaries)
        let recent = if content.len() > 2000 {
            let start = content.len() - 2000;
            // Find UTF-8 character boundary
            let start = content
                .char_indices()
                .map(|(i, _)| i)
                .find(|&i| i >= start)
                .unwrap_or(start);
            &content[start..]
        } else {
            content
        };

        if self.patterns.file_edit.is_match(recent) {
            return WrapApprovalType::FileEdit;
        }
        // File create/delete are intentionally grouped with FileEdit for UI consistency
        if self.patterns.file_create.is_match(recent) {
            return WrapApprovalType::FileEdit;
        }
        if self.patterns.file_delete.is_match(recent) {
            return WrapApprovalType::FileEdit;
        }
        if self.patterns.shell_command.is_match(recent) {
            return WrapApprovalType::ShellCommand;
        }
        if self.patterns.mcp_tool.is_match(recent) {
            return WrapApprovalType::McpTool;
        }

        WrapApprovalType::YesNo
    }

    /// Extract choices from AskUserQuestion
    fn extract_choices(&self) -> (Vec<String>, bool, usize) {
        let lines: Vec<&str> = self.output_buffer.lines().collect();
        let check_start = lines.len().saturating_sub(25);
        let check_lines = &lines[check_start..];

        let mut choices = Vec::new();
        let mut multi_select = false;
        let mut cursor_position = 0usize;
        let mut expected_num = 1u32;

        // Check for multi-select indicators
        for line in check_lines {
            let lower = line.to_lowercase();
            if lower.contains("space to") || lower.contains("toggle") || lower.contains("multi") {
                multi_select = true;
                break;
            }
        }

        // Extract choices
        for line in check_lines {
            if let Some(cap) = self.patterns.choice_pattern.captures(line) {
                if let Ok(num) = cap[1].parse::<u32>() {
                    if num == expected_num {
                        let choice_text = cap[2].trim();
                        // Strip Japanese description in parentheses
                        let label = choice_text
                            .split('（')
                            .next()
                            .unwrap_or(choice_text)
                            .trim()
                            .to_string();
                        choices.push(label);

                        // Check for cursor
                        let trimmed = line.trim();
                        if trimmed.starts_with('❯') || trimmed.starts_with('>') {
                            cursor_position = num as usize;
                        }

                        expected_num += 1;
                    } else if num == 1 {
                        // New choice set, start over
                        choices.clear();
                        let choice_text = cap[2].trim();
                        let label = choice_text
                            .split('（')
                            .next()
                            .unwrap_or(choice_text)
                            .trim()
                            .to_string();
                        choices.push(label);
                        cursor_position =
                            if line.trim().starts_with('❯') || line.trim().starts_with('>') {
                                1
                            } else {
                                0
                            };
                        expected_num = 2;
                    }
                }
            }
        }

        // Default cursor to 1 if not detected
        if cursor_position == 0 && !choices.is_empty() {
            cursor_position = 1;
        }

        (choices, multi_select, cursor_position)
    }

    /// Clear the output buffer
    pub fn clear_buffer(&mut self) {
        self.output_buffer.clear();
        self.pending_approval = None;
        self.pending_approval_at = None;
    }
}

/// Convert Instant to Unix milliseconds (approximate)
fn instant_to_millis(instant: Instant) -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now_instant = Instant::now();
    let now_system = SystemTime::now();
    let elapsed = now_instant.duration_since(instant);
    let system_time = now_system - elapsed;
    system_time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analyzer_creation() {
        let analyzer = Analyzer::new(1234);
        assert_eq!(analyzer.pid, 1234);
    }

    #[test]
    fn test_process_output_updates_timestamp() {
        let mut analyzer = Analyzer::new(1234);
        let before = analyzer.last_output;
        std::thread::sleep(std::time::Duration::from_millis(10));
        analyzer.process_output("test");
        assert!(analyzer.last_output > before);
    }

    #[test]
    fn test_process_input_clears_approval() {
        let mut analyzer = Analyzer::new(1234);
        analyzer.pending_approval = Some((WrapApprovalType::YesNo, String::new()));
        analyzer.pending_approval_at = Some(Instant::now());
        analyzer.process_input("y");
        assert!(analyzer.pending_approval.is_none());
    }

    #[test]
    fn test_process_input_clears_output_buffer() {
        let mut analyzer = Analyzer::new(1234);
        analyzer.process_output("some output data");
        assert!(!analyzer.output_buffer.is_empty());
        analyzer.process_input("y");
        assert!(analyzer.output_buffer.is_empty());
    }

    #[test]
    fn test_detect_user_question() {
        let mut analyzer = Analyzer::new(1234);
        let content = r#"
Which option?

❯ 1. Option A
  2. Option B
  3. Option C
"#;
        analyzer.process_output(content);
        assert!(analyzer.detect_user_question(&analyzer.output_buffer));
    }

    #[test]
    fn test_detect_yes_no_buttons() {
        let mut analyzer = Analyzer::new(1234);
        let content = r#"
Do you want to proceed?

  Yes
  No
"#;
        analyzer.process_output(content);
        assert!(analyzer.detect_yes_no_approval(&analyzer.output_buffer));
    }

    #[test]
    fn test_extract_choices() {
        let mut analyzer = Analyzer::new(1234);
        let content = r#"
Which option?

❯ 1. Option A
  2. Option B
  3. Option C
"#;
        analyzer.process_output(content);
        let (choices, multi_select, cursor) = analyzer.extract_choices();
        assert_eq!(choices, vec!["Option A", "Option B", "Option C"]);
        assert!(!multi_select);
        assert_eq!(cursor, 1);
    }

    #[test]
    fn test_simple_yes_no_user_question() {
        let mut analyzer = Analyzer::new(1234);
        // Exact format reported by user
        let content = r#" Do you want to proceed?
 ❯ 1. Yes
   2. No"#;
        analyzer.process_output(content);

        // Debug: print choice pattern match
        let lines: Vec<&str> = content.lines().collect();
        for line in &lines {
            let matched = analyzer.patterns.choice_pattern.captures(line);
            eprintln!("Line: {:?} -> Match: {:?}", line, matched.map(|c| c[0].to_string()));
        }

        let detected = analyzer.detect_user_question(&analyzer.output_buffer);
        assert!(detected, "Should detect as UserQuestion");
    }
}
