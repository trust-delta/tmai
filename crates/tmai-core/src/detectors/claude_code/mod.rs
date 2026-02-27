mod approval;
mod constants;
mod spinner;
#[cfg(test)]
mod tests;

use regex::Regex;
use tracing::trace;

use crate::agents::{AgentStatus, AgentType};

use super::{DetectionConfidence, DetectionContext, DetectionResult, StatusDetector};
use crate::detectors::common::safe_tail;

use constants::*;

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
}

impl ClaudeCodeDetector {
    /// Create a new ClaudeCodeDetector with compiled regex patterns
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
            // Choice pattern: handles "> 1. Option" or "  1. Option" or "❯ 1. Option" or "› 1. Option"
            choice_pattern: Regex::new(r"^\s*(?:[>❯›]\s*)?(\d+)\.\s+(.+)$")
                .expect("Invalid choice_pattern regex"),
        }
    }
}

impl Default for ClaudeCodeDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusDetector for ClaudeCodeDetector {
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus {
        self.detect_status_with_reason(title, content, &DetectionContext::default())
            .status
    }

    fn detect_status_with_context(
        &self,
        title: &str,
        content: &str,
        context: &DetectionContext,
    ) -> AgentStatus {
        self.detect_status_with_reason(title, content, context)
            .status
    }

    fn detect_status_with_reason(
        &self,
        title: &str,
        content: &str,
        context: &DetectionContext,
    ) -> DetectionResult {
        // 1. Check for AskUserQuestion or approval (highest priority)
        if let Some((approval_type, details, rule)) = self.detect_approval(content) {
            trace!(rule, "detect_status: approval detected");
            let matched = safe_tail(content, 200);
            return DetectionResult::new(
                AgentStatus::AwaitingApproval {
                    approval_type,
                    details,
                },
                rule,
                DetectionConfidence::High,
            )
            .with_matched_text(matched);
        }
        trace!("detect_status: no approval detected, continuing to title/content checks");

        // 1.5 Fast path: Braille spinner in title → Processing (skip content parsing)
        //     Any character in the Braille Patterns block (U+2800..=U+28FF) indicates
        //     active processing. This avoids expensive content analysis when the title
        //     already provides a definitive signal.
        //     Approval detection (step 1) is always checked first.
        {
            let title_activity = title
                .chars()
                .skip_while(|c| matches!(*c, '\u{2800}'..='\u{28FF}') || c.is_whitespace())
                .collect::<String>();
            if title.chars().any(|c| matches!(c, '\u{2800}'..='\u{28FF}')) {
                return DetectionResult::new(
                    AgentStatus::Processing {
                        activity: title_activity,
                    },
                    "title_braille_spinner_fast_path",
                    DetectionConfidence::High,
                )
                .with_matched_text(title);
            }
        }

        // 2. Check for errors
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

        // 3. Check for Tasks list with in-progress tasks (◼)
        if Self::has_in_progress_tasks(content) {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: "Tasks running".to_string(),
                },
                "tasks_in_progress",
                DetectionConfidence::High,
            );
        }

        // 4. Check for Compacting (✽ Compacting conversation)
        if title.contains('✽') && title.to_lowercase().contains("compacting") {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: "Compacting...".to_string(),
                },
                "title_compacting",
                DetectionConfidence::High,
            )
            .with_matched_text(title);
        }

        // 5. Content-based "Conversation compacted" detection → Idle
        //    e.g., "✻ Conversation compacted (ctrl+o for history)"
        {
            let recent = safe_tail(content, 1000);
            if recent.contains("Conversation compacted") {
                // Verify it's a spinner-prefixed line (not just any text mentioning it)
                for line in recent
                    .lines()
                    .rev()
                    .filter(|l| !l.trim().is_empty())
                    .take(15)
                {
                    let trimmed = line.trim();
                    let first_char = trimmed.chars().next().unwrap_or('\0');
                    if (CONTENT_SPINNER_CHARS.contains(&first_char) || first_char == '*')
                        && trimmed.contains("Conversation compacted")
                    {
                        return DetectionResult::new(
                            AgentStatus::Idle,
                            "content_conversation_compacted",
                            DetectionConfidence::High,
                        )
                        .with_matched_text(trimmed);
                    }
                }
            }
        }

        // 6. Content-based spinner detection (overrides title idle)
        //    Catches cases where title still shows ✳ but content has active spinner
        //    e.g. during /compact, or title update lag
        if let Some((activity, is_builtin)) = Self::detect_content_spinner(content, context) {
            let confidence = if is_builtin {
                DetectionConfidence::High
            } else {
                DetectionConfidence::Medium
            };
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: activity.clone(),
                },
                "content_spinner_verb",
                confidence,
            )
            .with_matched_text(&activity);
        }

        // 7. Check for turn duration completion (e.g., "✻ Cooked for 1m 6s")
        //    Placed after content spinner so active spinners take priority over
        //    residual turn duration messages from previous turns.
        if let Some(matched) = Self::detect_turn_duration(content) {
            return DetectionResult::new(
                AgentStatus::Idle,
                "turn_duration_completed",
                DetectionConfidence::High,
            )
            .with_matched_text(&matched);
        }

        // 8. Title-based detection: ✳ in title = Idle
        if title.contains(IDLE_INDICATOR) {
            trace!(
                title,
                "detect_status: title_idle_indicator (approval was not detected)"
            );
            return DetectionResult::new(
                AgentStatus::Idle,
                "title_idle_indicator",
                DetectionConfidence::High,
            )
            .with_matched_text(title);
        }

        // 9. Check for custom spinner verbs from settings
        if let Some(activity) = Self::detect_custom_spinner_verb(title, context) {
            return DetectionResult::new(
                AgentStatus::Processing { activity },
                "custom_spinner_verb",
                DetectionConfidence::Medium,
            )
            .with_matched_text(title);
        }

        // 10. Default Braille spinner detection (unless mode is "replace")
        if !Self::should_skip_default_spinners(context)
            && title.chars().any(|c| PROCESSING_SPINNERS.contains(&c))
        {
            let activity = title
                .chars()
                .skip_while(|c| PROCESSING_SPINNERS.contains(c) || c.is_whitespace())
                .collect::<String>();
            return DetectionResult::new(
                AgentStatus::Processing { activity },
                "braille_spinner",
                DetectionConfidence::Medium,
            )
            .with_matched_text(title);
        }

        // No indicator - default to Processing
        DetectionResult::new(
            AgentStatus::Processing {
                activity: String::new(),
            },
            "fallback_no_indicator",
            DetectionConfidence::Low,
        )
    }

    /// Detect context warning percentage from content
    fn detect_context_warning(&self, content: &str) -> Option<u8> {
        // Look for "Context left until auto-compact: XX%"
        for line in content.lines().rev().take(30) {
            if line.contains("Context left until auto-compact:") {
                // Extract percentage
                if let Some(pct_str) = line.split(':').next_back() {
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
        // Claude Code uses cursor-based selection UI
        // Cursor is already on "Yes", just press Enter to confirm
        "Enter"
    }
    // Note: Rejection removed - use number keys, input mode, or passthrough mode
}
