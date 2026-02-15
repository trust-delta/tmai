use regex::Regex;

use crate::agents::{AgentMode, AgentStatus, AgentType, ApprovalType};

use super::{DetectionConfidence, DetectionContext, DetectionResult, StatusDetector};

/// Title icon: ready/idle (diamond outline)
const TITLE_READY_ICON: char = '◇';

/// Title icon: working/processing (filled diamond)
const TITLE_WORKING_ICON: char = '✦';

/// Title icon: silent working (timer)
const TITLE_SILENT_WORKING_ICON: char = '⏲';

/// Title icon: action required (raised hand)
const TITLE_ACTION_REQUIRED_ICON: char = '✋';

/// Braille spinner characters used by Gemini CLI in content
const BRAILLE_SPINNERS: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/// Static braille character for "Waiting for user confirmation..."
const WAITING_SPINNER: char = '⠏';

/// Detector for Gemini CLI
///
/// Detects agent status from terminal title icons and content patterns.
/// Gemini CLI uses specific Unicode icons in the terminal title to indicate
/// its current state, and radio-button-style selection in content for approvals.
pub struct GeminiDetector {
    error_pattern: Regex,
    radio_selected_pattern: Regex,
    radio_unselected_pattern: Regex,
}

impl GeminiDetector {
    /// Create a new GeminiDetector with compiled regex patterns
    pub fn new() -> Self {
        Self {
            error_pattern: Regex::new(r"(?i)(?:^|\n)\s*(?:Error|ERROR|error:|✗|❌)").unwrap(),
            // Selected radio item: ● followed by number, dot, space, text
            radio_selected_pattern: Regex::new(r"^●\s*(\d+)\.\s+(.+)$").unwrap(),
            // Unselected radio item: number, dot, space, text (no bullet prefix)
            radio_unselected_pattern: Regex::new(r"^\s*(\d+)\.\s+(.+)$").unwrap(),
        }
    }

    /// Detect approval type and details from content patterns
    ///
    /// Checks for RadioButtonSelect patterns, header texts, confirmation questions,
    /// and WaitingForConfirmation patterns in the recent content lines.
    fn detect_content_approval(&self, content: &str) -> Option<(ApprovalType, String, &str)> {
        let lines: Vec<&str> = content.lines().collect();
        let check_start = lines.len().saturating_sub(30);
        let recent_lines = &lines[check_start..];

        // Check for WaitingForConfirmation pattern
        if let Some(result) = self.detect_waiting_for_confirmation(recent_lines) {
            return Some(result);
        }

        // Check for RadioButtonSelect pattern
        if let Some(result) = self.detect_radio_button_select(recent_lines) {
            return Some(result);
        }

        // Check for header-based approval detection
        if let Some(result) = self.detect_header_approval(recent_lines) {
            return Some(result);
        }

        // Check for confirmation question patterns
        if let Some(result) = self.detect_confirmation_question(recent_lines) {
            return Some(result);
        }

        None
    }

    /// Detect RadioButtonSelect pattern with `●` for selected and numbered items
    ///
    /// Extracts choices from patterns like:
    /// ```text
    /// ● 1. Allow once
    ///   2. Allow for this session
    ///   3. No, suggest changes
    /// ```
    fn detect_radio_button_select(
        &self,
        lines: &[&str],
    ) -> Option<(ApprovalType, String, &'static str)> {
        let mut choices: Vec<String> = Vec::new();
        let mut cursor_position: usize = 0;
        let mut found_any = false;

        for line in lines {
            let trimmed = line.trim();

            // Check selected item (● N. text)
            if let Some(caps) = self.radio_selected_pattern.captures(trimmed) {
                if let (Some(num_match), Some(text_match)) = (caps.get(1), caps.get(2)) {
                    let num: usize = num_match.as_str().parse().unwrap_or(0);
                    choices.push(text_match.as_str().to_string());
                    cursor_position = num;
                    found_any = true;
                }
            }
            // Check unselected item (N. text) - only if we already found at least one radio item
            // or if the line starts with a digit
            else if let Some(caps) = self.radio_unselected_pattern.captures(trimmed) {
                if let Some(text_match) = caps.get(2) {
                    // Only consider this a radio item if it looks like a choice
                    let text = text_match.as_str();
                    if Self::looks_like_choice(text) || found_any {
                        choices.push(text.to_string());
                        found_any = true;
                    }
                }
            }
        }

        if found_any && choices.len() >= 2 {
            let details = choices.join(" / ");
            return Some((
                ApprovalType::UserQuestion {
                    choices,
                    multi_select: false,
                    cursor_position,
                },
                details,
                "radio_button_select",
            ));
        }

        None
    }

    /// Check if text looks like a typical approval choice
    fn looks_like_choice(text: &str) -> bool {
        let lower = text.to_lowercase();
        lower.contains("allow")
            || lower.contains("deny")
            || lower.contains("yes")
            || lower.contains("no")
            || lower.contains("suggest")
            || lower.contains("cancel")
            || lower.contains("proceed")
            || lower.contains("approve")
            || lower.contains("reject")
            || lower.contains("accept")
            || lower.contains("session")
            || lower.contains("once")
            || lower.contains("always")
    }

    /// Detect header-based approval patterns like "Action Required" and "Answer Questions"
    fn detect_header_approval(
        &self,
        lines: &[&str],
    ) -> Option<(ApprovalType, String, &'static str)> {
        for line in lines {
            let trimmed = line.trim();

            if trimmed.contains("Answer Questions") || trimmed.contains("answer questions") {
                return Some((
                    ApprovalType::UserQuestion {
                        choices: Vec::new(),
                        multi_select: false,
                        cursor_position: 0,
                    },
                    "Answer Questions".to_string(),
                    "answer_questions_header",
                ));
            }

            if trimmed.contains("Action Required") || trimmed.contains("action required") {
                // Try to determine specific type from surrounding context
                let context_text = lines.iter().map(|l| l.trim()).collect::<Vec<_>>().join(" ");
                let approval_type = Self::determine_tool_approval_type(&context_text);
                return Some((
                    approval_type,
                    "Action Required".to_string(),
                    "action_required_header",
                ));
            }
        }
        None
    }

    /// Detect specific confirmation question patterns
    fn detect_confirmation_question(
        &self,
        lines: &[&str],
    ) -> Option<(ApprovalType, String, &'static str)> {
        for line in lines {
            let trimmed = line.trim();

            if trimmed.contains("Apply this change?") {
                return Some((
                    ApprovalType::FileEdit,
                    "Apply this change?".to_string(),
                    "confirmation_question",
                ));
            }

            if trimmed.contains("Allow execution of") {
                return Some((
                    ApprovalType::ShellCommand,
                    trimmed.to_string(),
                    "confirmation_question",
                ));
            }

            if trimmed.contains("Do you want to proceed?") {
                let context_text = lines.iter().map(|l| l.trim()).collect::<Vec<_>>().join(" ");
                let approval_type = Self::determine_tool_approval_type(&context_text);
                return Some((
                    approval_type,
                    "Do you want to proceed?".to_string(),
                    "confirmation_question",
                ));
            }

            if trimmed.contains("Ready to start implementation?") {
                return Some((
                    ApprovalType::Other("Plan execution".to_string()),
                    "Ready to start implementation?".to_string(),
                    "confirmation_question",
                ));
            }
        }
        None
    }

    /// Detect "Waiting for user confirmation..." pattern with static spinner
    fn detect_waiting_for_confirmation(
        &self,
        lines: &[&str],
    ) -> Option<(ApprovalType, String, &'static str)> {
        for line in lines.iter().rev().take(10) {
            let trimmed = line.trim();
            if trimmed.contains(WAITING_SPINNER)
                && trimmed.contains("Waiting for user confirmation")
            {
                return Some((
                    ApprovalType::Other("Gemini approval".to_string()),
                    "Waiting for user confirmation".to_string(),
                    "waiting_for_confirmation",
                ));
            }
        }
        None
    }

    /// Determine ApprovalType from tool name context in content
    fn determine_tool_approval_type(context: &str) -> ApprovalType {
        let lower = context.to_lowercase();

        if lower.contains("write_file")
            || lower.contains("edit_file")
            || lower.contains("patch_file")
        {
            return ApprovalType::FileEdit;
        }

        if lower.contains("exec") || lower.contains("shell") || lower.contains("run_command") {
            return ApprovalType::ShellCommand;
        }

        if lower.contains("mcp") {
            return ApprovalType::McpTool;
        }

        ApprovalType::Other("Gemini approval".to_string())
    }

    /// Detect error patterns in recent content lines
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

    /// Detect braille spinner characters in content (Processing indicator)
    fn detect_content_spinner(&self, content: &str) -> bool {
        let lines: Vec<&str> = content.lines().collect();
        for line in lines.iter().rev().take(5) {
            let trimmed = line.trim();
            if let Some(first_char) = trimmed.chars().next() {
                if BRAILLE_SPINNERS.contains(&first_char)
                    && first_char != WAITING_SPINNER
                    && !trimmed.contains("Waiting for user confirmation")
                {
                    return true;
                }
            }
        }
        false
    }

    /// Detect input prompt at end of content (Idle indicator)
    ///
    /// Gemini CLI uses different prompt prefixes for different modes:
    /// - `> ` for normal mode
    /// - `! ` for shell mode
    /// - `* ` for YOLO mode
    /// - `(r:` prefix for reverse search
    fn detect_input_prompt(content: &str) -> bool {
        let lines: Vec<&str> = content.lines().collect();
        if let Some(last) = lines.last() {
            let trimmed = last.trim();
            // Check for Gemini CLI prompt patterns
            if trimmed == ">"
                || trimmed == "!"
                || trimmed == "*"
                || trimmed.ends_with("> ")
                || trimmed.ends_with("! ")
                || trimmed.ends_with("* ")
                || trimmed.starts_with("(r:")
            {
                return true;
            }
        }
        false
    }

    /// Detect agent mode from content
    ///
    /// Gemini CLI modes:
    /// - `* ` prompt or "YOLO mode" in footer → AutoApprove
    /// - "Plan mode" in footer → Plan
    /// - Default otherwise
    pub fn detect_mode(content: &str) -> AgentMode {
        let lines: Vec<&str> = content.lines().collect();

        // Check footer lines (last 5 lines) for mode indicators
        let footer_start = lines.len().saturating_sub(5);
        let footer_lines = &lines[footer_start..];

        for line in footer_lines {
            let trimmed = line.trim();
            if trimmed.contains("YOLO mode") {
                return AgentMode::AutoApprove;
            }
            if trimmed.contains("Plan mode") {
                return AgentMode::Plan;
            }
        }

        // Check for YOLO mode via `* ` prompt prefix
        if let Some(last) = lines.last() {
            let trimmed = last.trim();
            if trimmed == "*" || trimmed.ends_with("* ") {
                return AgentMode::AutoApprove;
            }
        }

        AgentMode::Default
    }
}

impl Default for GeminiDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusDetector for GeminiDetector {
    /// Detect agent status from title and content (simple version)
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus {
        self.detect_status_with_reason(title, content, &DetectionContext::default())
            .status
    }

    /// Detect agent status with detailed reason for audit logging
    ///
    /// Detection flow (priority order):
    /// 1. Title `✋` icon → AwaitingApproval (also check content for specific type)
    /// 2. Content-based approval (RadioButtonSelect, headers, WaitingForConfirmation)
    /// 3. Error patterns
    /// 4. Title `✦` or `⏲` → Processing
    /// 5. Title `◇` → Idle
    /// 6. Content braille spinner → Processing
    /// 7. Content input prompt → Idle
    /// 8. Fallback → Processing (Low confidence)
    fn detect_status_with_reason(
        &self,
        title: &str,
        content: &str,
        _context: &DetectionContext,
    ) -> DetectionResult {
        // 1. Title ✋ icon → AwaitingApproval (highest priority)
        if title.contains(TITLE_ACTION_REQUIRED_ICON) {
            // Also check content for specific ApprovalType
            if let Some((approval_type, details, rule)) = self.detect_content_approval(content) {
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
            // Title says action required but content doesn't specify type
            return DetectionResult::new(
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::Other("Gemini approval".to_string()),
                    details: String::new(),
                },
                "title_action_required_icon",
                DetectionConfidence::High,
            )
            .with_matched_text(title);
        }

        // 2. Content-based approval detection (without title icon)
        if let Some((approval_type, details, rule)) = self.detect_content_approval(content) {
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

        // 3. Error detection
        if let Some(message) = self.detect_error(content) {
            return DetectionResult::new(
                AgentStatus::Error {
                    message: message.clone(),
                },
                "error_pattern",
                DetectionConfidence::High,
            )
            .with_matched_text(&message);
        }

        // 4. Title ✦ or ⏲ → Processing
        if title.contains(TITLE_WORKING_ICON) {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: String::new(),
                },
                "title_working_icon",
                DetectionConfidence::High,
            )
            .with_matched_text(title);
        }

        if title.contains(TITLE_SILENT_WORKING_ICON) {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: String::new(),
                },
                "title_silent_working_icon",
                DetectionConfidence::High,
            )
            .with_matched_text(title);
        }

        // 5. Title ◇ → Idle
        if title.contains(TITLE_READY_ICON) {
            return DetectionResult::new(
                AgentStatus::Idle,
                "title_ready_icon",
                DetectionConfidence::High,
            )
            .with_matched_text(title);
        }

        // 6. Content braille spinner → Processing
        if self.detect_content_spinner(content) {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: String::new(),
                },
                "braille_spinner",
                DetectionConfidence::Medium,
            );
        }

        // 7. Content input prompt → Idle
        if Self::detect_input_prompt(content) {
            return DetectionResult::new(
                AgentStatus::Idle,
                "input_prompt",
                DetectionConfidence::Medium,
            );
        }

        // 8. Fallback → Processing
        DetectionResult::new(
            AgentStatus::Processing {
                activity: String::new(),
            },
            "fallback_processing",
            DetectionConfidence::Low,
        )
    }

    /// Get the agent type this detector handles
    fn agent_type(&self) -> AgentType {
        AgentType::GeminiCli
    }

    /// Keys to send for approval
    fn approval_keys(&self) -> &str {
        "Enter"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detect(title: &str, content: &str) -> DetectionResult {
        let detector = GeminiDetector::new();
        detector.detect_status_with_reason(title, content, &DetectionContext::default())
    }

    // --- Title icon detection ---

    #[test]
    fn test_title_ready_icon_idle() {
        let result = detect("◇ Gemini", "Some content\n> ");
        assert!(matches!(result.status, AgentStatus::Idle));
        assert_eq!(result.reason.rule, "title_ready_icon");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_title_working_icon_processing() {
        let result = detect("✦ Gemini", "Working on something...");
        assert!(matches!(result.status, AgentStatus::Processing { .. }));
        assert_eq!(result.reason.rule, "title_working_icon");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_title_silent_working_icon_processing() {
        let result = detect("⏲ Gemini", "Waiting for response...");
        assert!(matches!(result.status, AgentStatus::Processing { .. }));
        assert_eq!(result.reason.rule, "title_silent_working_icon");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_title_action_required_icon_generic() {
        let result = detect("✋ Gemini", "Some content without specific pattern");
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval { .. }
        ));
        assert_eq!(result.reason.rule, "title_action_required_icon");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_title_action_required_with_radio_buttons() {
        let content = "Some tool output\n● 1. Allow once\n  2. Allow for this session\n  3. No, suggest changes\n";
        let result = detect("✋ Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::UserQuestion { .. },
                ..
            }
        ));
        assert_eq!(result.reason.rule, "radio_button_select");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    // --- RadioButtonSelect detection ---

    #[test]
    fn test_radio_button_select() {
        let content =
            "Tool wants to do something\n● 1. Allow once\n  2. Allow for this session\n  3. No, suggest changes\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::UserQuestion { .. },
                ..
            }
        ));
        assert_eq!(result.reason.rule, "radio_button_select");

        if let AgentStatus::AwaitingApproval {
            approval_type:
                ApprovalType::UserQuestion {
                    choices,
                    cursor_position,
                    multi_select,
                },
            ..
        } = &result.status
        {
            assert_eq!(choices.len(), 3);
            assert_eq!(choices[0], "Allow once");
            assert_eq!(choices[1], "Allow for this session");
            assert_eq!(choices[2], "No, suggest changes");
            assert_eq!(*cursor_position, 1);
            assert!(!multi_select);
        }
    }

    // --- Header-based detection ---

    #[test]
    fn test_action_required_header() {
        let content = "Some output\nAction Required\nwrite_file: src/main.rs\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::FileEdit,
                ..
            }
        ));
        assert_eq!(result.reason.rule, "action_required_header");
    }

    #[test]
    fn test_answer_questions_header() {
        let content = "Some output\nAnswer Questions\nWhat should we do?\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::UserQuestion { .. },
                ..
            }
        ));
        assert_eq!(result.reason.rule, "answer_questions_header");
    }

    #[test]
    fn test_confirmation_question_apply_change() {
        let content = "Diff output here\nApply this change?\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::FileEdit,
                ..
            }
        ));
        assert_eq!(result.reason.rule, "confirmation_question");
    }

    #[test]
    fn test_confirmation_question_allow_execution() {
        let content = "Command preview\nAllow execution of `ls -la`\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::ShellCommand,
                ..
            }
        ));
        assert_eq!(result.reason.rule, "confirmation_question");
    }

    #[test]
    fn test_confirmation_question_ready_to_implement() {
        let content = "Plan summary here\nReady to start implementation?\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::Other(_),
                ..
            }
        ));
        if let AgentStatus::AwaitingApproval {
            approval_type: ApprovalType::Other(ref s),
            ..
        } = result.status
        {
            assert_eq!(s, "Plan execution");
        }
    }

    // --- WaitingForConfirmation detection ---

    #[test]
    fn test_waiting_for_confirmation() {
        let content = "Some output\n⠏ Waiting for user confirmation...\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval { .. }
        ));
        assert_eq!(result.reason.rule, "waiting_for_confirmation");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    // --- Input prompt idle detection ---

    #[test]
    fn test_input_prompt_normal_mode() {
        let content = "Previous output\n> ";
        let result = detect("Gemini", content);
        assert!(matches!(result.status, AgentStatus::Idle));
        assert_eq!(result.reason.rule, "input_prompt");
        assert_eq!(result.reason.confidence, DetectionConfidence::Medium);
    }

    #[test]
    fn test_input_prompt_shell_mode() {
        let content = "Previous output\n! ";
        let result = detect("Gemini", content);
        assert!(matches!(result.status, AgentStatus::Idle));
        assert_eq!(result.reason.rule, "input_prompt");
    }

    #[test]
    fn test_input_prompt_yolo_mode() {
        let content = "Previous output\n* ";
        let result = detect("Gemini", content);
        assert!(matches!(result.status, AgentStatus::Idle));
        assert_eq!(result.reason.rule, "input_prompt");
    }

    #[test]
    fn test_input_prompt_reverse_search() {
        let content = "Previous output\n(r:search term) ";
        let result = detect("Gemini", content);
        assert!(matches!(result.status, AgentStatus::Idle));
        assert_eq!(result.reason.rule, "input_prompt");
    }

    // --- Braille spinner detection ---

    #[test]
    fn test_braille_spinner_processing() {
        let content = "Working on task\n⠋ Thinking...";
        let result = detect("Gemini", content);
        assert!(matches!(result.status, AgentStatus::Processing { .. }));
        assert_eq!(result.reason.rule, "braille_spinner");
        assert_eq!(result.reason.confidence, DetectionConfidence::Medium);
    }

    #[test]
    fn test_braille_spinner_not_confused_with_waiting() {
        // ⠏ + "Waiting for user confirmation" should be approval, not spinner
        let content = "Some output\n⠏ Waiting for user confirmation...\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval { .. }
        ));
        assert_eq!(result.reason.rule, "waiting_for_confirmation");
    }

    // --- Error detection ---

    #[test]
    fn test_error_detection() {
        let content = "Processing...\nError: something went wrong\n";
        let result = detect("Gemini", content);
        assert!(matches!(result.status, AgentStatus::Error { .. }));
        assert_eq!(result.reason.rule, "error_pattern");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    // --- Fallback detection ---

    #[test]
    fn test_fallback_processing() {
        let content = "Some random output without any indicators";
        let result = detect("Gemini", content);
        assert!(matches!(result.status, AgentStatus::Processing { .. }));
        assert_eq!(result.reason.rule, "fallback_processing");
        assert_eq!(result.reason.confidence, DetectionConfidence::Low);
    }

    // --- Mode detection ---

    #[test]
    fn test_mode_yolo_prompt() {
        let content = "Some output\n* ";
        let mode = GeminiDetector::detect_mode(content);
        assert_eq!(mode, AgentMode::AutoApprove);
    }

    #[test]
    fn test_mode_yolo_footer() {
        let content = "Some output\nStatus bar | YOLO mode\n> ";
        let mode = GeminiDetector::detect_mode(content);
        assert_eq!(mode, AgentMode::AutoApprove);
    }

    #[test]
    fn test_mode_plan() {
        let content = "Some output\nStatus bar | Plan mode\n> ";
        let mode = GeminiDetector::detect_mode(content);
        assert_eq!(mode, AgentMode::Plan);
    }

    #[test]
    fn test_mode_default() {
        let content = "Some output\n> ";
        let mode = GeminiDetector::detect_mode(content);
        assert_eq!(mode, AgentMode::Default);
    }

    // --- Priority tests ---

    #[test]
    fn test_title_action_required_overrides_content_spinner() {
        // Title says action required, content has spinner - title should win
        let content = "⠋ Processing something\n";
        let result = detect("✋ Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval { .. }
        ));
    }

    #[test]
    fn test_content_approval_overrides_title_working() {
        // Title says working but content shows radio buttons - content approval should win
        // because content approval (step 2) is checked before title working (step 4)
        let content =
            "Tool output\n● 1. Allow once\n  2. Allow for this session\n  3. No, suggest changes\n";
        let result = detect("✦ Gemini", content);
        // Title ✋ is step 1, but ✦ is step 4 - content approval (step 2) should be checked
        // However, title ✋ check (step 1) only fires for ✋, not ✦
        // So flow goes: step 1 (no ✋) → step 2 (content approval found) → return
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval { .. }
        ));
        assert_eq!(result.reason.rule, "radio_button_select");
    }

    #[test]
    fn test_error_overrides_title_ready() {
        // Error takes priority over title idle
        let content = "Error: connection refused\n";
        let result = detect("◇ Gemini", content);
        assert!(matches!(result.status, AgentStatus::Error { .. }));
    }

    #[test]
    fn test_title_working_overrides_input_prompt() {
        // Title working icon should override content-based idle
        let content = "Previous output\n> ";
        let result = detect("✦ Gemini", content);
        assert!(matches!(result.status, AgentStatus::Processing { .. }));
        assert_eq!(result.reason.rule, "title_working_icon");
    }

    // --- Tool type detection ---

    #[test]
    fn test_action_required_shell_command() {
        let content = "Action Required\nexec: ls -la /tmp\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::ShellCommand,
                ..
            }
        ));
    }

    #[test]
    fn test_action_required_mcp_tool() {
        let content = "Action Required\nmcp_tool: read_file\n";
        let result = detect("Gemini", content);
        assert!(matches!(
            result.status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::McpTool,
                ..
            }
        ));
    }

    #[test]
    fn test_agent_type() {
        let detector = GeminiDetector::new();
        assert_eq!(detector.agent_type(), AgentType::GeminiCli);
    }

    #[test]
    fn test_approval_keys() {
        let detector = GeminiDetector::new();
        assert_eq!(detector.approval_keys(), "Enter");
    }

    // --- Backward compatibility ---

    #[test]
    fn test_detect_status_delegates_to_with_reason() {
        let detector = GeminiDetector::new();
        let status = detector.detect_status("◇ Gemini", "Some content\n> ");
        assert!(matches!(status, AgentStatus::Idle));
    }
}
