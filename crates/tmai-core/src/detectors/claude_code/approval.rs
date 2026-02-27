use regex::Regex;
use tracing::trace;

use crate::agents::ApprovalType;

use super::ClaudeCodeDetector;
use crate::detectors::common::{safe_tail, strip_box_drawing};

/// Approval detection methods for ClaudeCodeDetector
impl ClaudeCodeDetector {
    /// Check if a line is a horizontal separator (─── pattern)
    /// Claude Code's TUI uses these to delimit the input area.
    pub(super) fn is_horizontal_separator(line: &str) -> bool {
        let trimmed = line.trim();
        // Must be long enough to be a real separator (not a short dash)
        trimmed.len() >= 10 && trimmed.chars().all(|c| c == '─')
    }

    /// Detect AskUserQuestion with numbered choices
    pub(super) fn detect_user_question(&self, content: &str) -> Option<(ApprovalType, String)> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.is_empty() {
            return None;
        }

        // Strip trailing empty lines (tmux capture-pane pads with blank lines)
        let effective_len = lines
            .iter()
            .rposition(|line| !line.trim().is_empty())
            .map(|i| i + 1)
            .unwrap_or(lines.len());
        let lines = &lines[..effective_len];

        // Strategy: Use horizontal separator lines (───) as boundaries.
        // Claude Code's TUI encloses the input area between two ─── separators.
        // When AskUserQuestion is displayed, choices appear between these separators.
        // This is robust regardless of preview box size.
        let separator_indices: Vec<usize> = lines
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, line)| Self::is_horizontal_separator(line))
            .map(|(i, _)| i)
            .take(2)
            .collect();

        let check_lines = if separator_indices.len() == 2 {
            // 1st from bottom = lower separator, 2nd from bottom = upper separator
            let lower_sep = separator_indices[0];
            let upper_sep = separator_indices[1];
            if lower_sep > upper_sep + 1 {
                &lines[upper_sep + 1..lower_sep]
            } else {
                &lines[lines.len().saturating_sub(25)..lines.len()]
            }
        } else {
            // Fallback: no separators found (e.g. wrap mode output without TUI chrome).
            // Use window-based approach with prompt detection.
            let last_prompt_idx = lines.iter().rposition(|line| {
                let trimmed = line.trim();
                if trimmed == "❯" || trimmed == "›" {
                    return true;
                }
                if trimmed.starts_with('❯') || trimmed.starts_with('›') {
                    let after_marker = trimmed
                        .trim_start_matches('❯')
                        .trim_start_matches('›')
                        .trim_start();
                    if after_marker
                        .chars()
                        .next()
                        .map(|c| c.is_ascii_digit())
                        .unwrap_or(false)
                    {
                        return false;
                    }
                    return trimmed.len() < 3;
                }
                false
            });
            let search_end = last_prompt_idx.unwrap_or(lines.len());
            let search_start = if search_end == lines.len() {
                lines.len().saturating_sub(25)
            } else {
                search_end.saturating_sub(25)
            };
            &lines[search_start..search_end]
        };

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

        // [ ] checkbox format detection
        if !is_multi_select {
            for line in check_lines.iter() {
                if let Some(cap) = self.choice_pattern.captures(line) {
                    let choice_text = cap[2].trim();
                    if choice_text.starts_with("[ ]")
                        || choice_text.starts_with("[x]")
                        || choice_text.starts_with("[X]")
                        || choice_text.starts_with("[×]")
                        || choice_text.starts_with("[✔]")
                    {
                        is_multi_select = true;
                        break;
                    }
                }
            }
        }

        if !is_multi_select {
            for line in check_lines.iter() {
                let lower = line.to_lowercase();
                // "Enter to select" in preview-mode footer is NOT multi-select
                // Multi-select footer uses "space to toggle" (already detected above)
                if lower.contains("複数選択") {
                    is_multi_select = true;
                    break;
                }
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
                    // Strip preview box content (box-drawing chars) before extracting label
                    let choice_text = strip_box_drawing(cap[2].trim());
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

                        // Check if this line has cursor marker (❯, ›, or >)
                        if trimmed.starts_with('❯')
                            || trimmed.starts_with('›')
                            || trimmed.starts_with('>')
                        {
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
                        cursor_position = if trimmed.starts_with('❯')
                            || trimmed.starts_with('›')
                            || trimmed.starts_with('>')
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

        // Choices must be near the end (allow for UI hints like "Enter to select").
        // When separator-bounded, the region is already precise so distance is measured
        // within that bounded area. For fallback (no separators), use a tighter threshold.
        let used_separators = separator_indices.len() == 2;
        let max_distance: usize = if used_separators {
            // Separator-bounded: the entire region is the input area, so large
            // preview boxes are expected. Allow generous distance.
            check_lines.len()
        } else {
            // Fallback: use the last non-empty line as effective end
            20
        };
        if let Some(last_idx) = last_choice_idx {
            let effective_end = check_lines
                .iter()
                .rposition(|line| !line.trim().is_empty())
                .map(|i| i + 1)
                .unwrap_or(check_lines.len());
            if effective_end - last_idx > max_distance {
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
            // Filter out Claude Code settings menus (model selection, etc.)
            // These show "Enter to confirm" footer instead of "Esc to cancel · Tab to amend"
            let tail_lines: Vec<&str> = lines
                .iter()
                .rev()
                .filter(|l| !l.trim().is_empty())
                .take(8)
                .copied()
                .collect();
            let tail_text = tail_lines.join(" ");
            if tail_text.contains("Enter to confirm") {
                return None;
            }

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
    ///
    /// Returns extracted choices when found. This allows number key navigation
    /// even when the cursor marker (❯) is not captured by tmux capture-pane.
    pub(super) fn detect_proceed_prompt(content: &str) -> Option<Vec<String>> {
        // Filter out empty lines and take last 15 non-empty lines (in original order)
        let check_lines: Vec<&str> = content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .take(15)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
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

        if !(has_yes && has_no) {
            return None;
        }

        // Extract numbered choices
        let mut choices = Vec::new();
        for line in &check_lines {
            let clean = line
                .trim()
                .trim_start_matches('❯')
                .trim_start_matches('›')
                .trim_start_matches('>')
                .trim();
            if let Some(dot_pos) = clean.find(". ") {
                if let Ok(num) = clean[..dot_pos].trim().parse::<usize>() {
                    if num == choices.len() + 1 {
                        // Strip preview box content (box-drawing chars) before extracting label
                        let choice_text = strip_box_drawing(clean[dot_pos + 2..].trim());
                        let label = choice_text
                            .split('（')
                            .next()
                            .unwrap_or(choice_text)
                            .trim()
                            .to_string();
                        choices.push(label);
                    }
                }
            }
        }

        if choices.len() >= 2 {
            Some(choices)
        } else {
            None
        }
    }

    /// Extract question text from content (e.g., "Do you want to proceed?")
    pub(super) fn extract_question_text(content: &str) -> String {
        content
            .lines()
            .rev()
            .take(20)
            .find(|line| {
                let t = line.trim();
                !t.is_empty() && (t.ends_with('?') || t.ends_with('？'))
            })
            .map(|l| l.trim().to_string())
            .unwrap_or_else(|| "Do you want to proceed?".to_string())
    }

    /// Detect Yes/No button-style approval
    pub(super) fn detect_yes_no_buttons(&self, lines: &[&str]) -> bool {
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

    /// Detect approval request in content, returning the rule name that matched
    pub(super) fn detect_approval(
        &self,
        content: &str,
    ) -> Option<(ApprovalType, String, &'static str)> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.is_empty() {
            return None;
        }

        // Strip trailing empty lines (tmux capture-pane pads with blank lines)
        let effective_len = lines
            .iter()
            .rposition(|line| !line.trim().is_empty())
            .map(|i| i + 1)
            .unwrap_or(lines.len());
        let lines = &lines[..effective_len];

        // Check last ~12 lines (narrowed from 20 to reduce false positives)
        let check_start = lines.len().saturating_sub(12);
        let recent_lines = &lines[check_start..];
        let _recent = recent_lines.join("\n");

        // Check for AskUserQuestion first (highest priority)
        if let Some((approval_type, details)) = self.detect_user_question(content) {
            return Some((approval_type, details, "user_question_numbered_choices"));
        }

        // Check for "1. Yes / 2. ... / 3. No" style proceed prompt
        let proceed_choices = Self::detect_proceed_prompt(content);
        let has_proceed_prompt = proceed_choices.is_some();

        // Check for button-style approval
        let has_yes_no_buttons = self.detect_yes_no_buttons(recent_lines);

        // Check for text-format approval
        let last_lines: Vec<&str> = recent_lines.iter().rev().take(10).copied().collect();
        let last_text = last_lines.join("\n");
        let has_text_approval = self.general_approval_pattern.is_match(&last_text);

        if !has_proceed_prompt && !has_yes_no_buttons && !has_text_approval {
            trace!(
                "detect_approval: no approval pattern found (user_question=None, proceed={}, buttons={}, text={})",
                has_proceed_prompt, has_yes_no_buttons, has_text_approval
            );
            return None;
        }

        // If proceed_prompt extracted choices, return as UserQuestion for number key support
        if let Some(choices) = proceed_choices {
            let question = Self::extract_question_text(content);
            return Some((
                ApprovalType::UserQuestion {
                    choices,
                    multi_select: false,
                    cursor_position: 1,
                },
                question,
                "proceed_prompt",
            ));
        }

        // Determine which rule matched
        let rule = if has_yes_no_buttons {
            "yes_no_buttons"
        } else {
            "yes_no_text_pattern"
        };

        // Determine approval type
        let context = safe_tail(content, 1500);

        if self.file_edit_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileEdit, details, rule));
        }

        if self.file_create_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileCreate, details, rule));
        }

        if self.file_delete_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileDelete, details, rule));
        }

        if self.bash_pattern.is_match(context) {
            let details = self.extract_command(context).unwrap_or_default();
            return Some((ApprovalType::ShellCommand, details, rule));
        }

        if self.mcp_pattern.is_match(context) {
            return Some((ApprovalType::McpTool, "MCP tool call".to_string(), rule));
        }

        Some((
            ApprovalType::Other("Pending approval".to_string()),
            String::new(),
            rule,
        ))
    }

    /// Detect error in content using the shared error pattern
    pub(super) fn detect_error(&self, content: &str) -> Option<String> {
        crate::detectors::common::detect_error_common(content, 500)
    }

    /// Extract file path from content
    pub(super) fn extract_file_path(&self, content: &str) -> Option<String> {
        let path_pattern =
            Regex::new(r"(?m)(?:file|path)[:\s]+([^\s\n]+)|([./][\w/.-]+\.\w+)").ok()?;
        path_pattern
            .captures(content)
            .and_then(|c| c.get(1).or(c.get(2)))
            .map(|m| m.as_str().to_string())
    }

    /// Extract command from content
    pub(super) fn extract_command(&self, content: &str) -> Option<String> {
        let cmd_pattern =
            Regex::new(r"(?m)(?:command|run)[:\s]+`([^`]+)`|```(?:bash|sh)?\n([^`]+)```").ok()?;
        cmd_pattern
            .captures(content)
            .and_then(|c| c.get(1).or(c.get(2)))
            .map(|m| m.as_str().trim().to_string())
    }
}
