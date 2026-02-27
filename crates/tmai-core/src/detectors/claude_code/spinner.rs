use tracing::trace;

use crate::agents::AgentMode;
use crate::config::SpinnerVerbsMode;

use super::constants::{BUILTIN_SPINNER_VERBS, CONTENT_SPINNER_CHARS, TURN_DURATION_VERBS};
use super::ClaudeCodeDetector;
use super::DetectionContext;
use crate::detectors::common::safe_tail;

/// Spinner, mode, and task detection methods for ClaudeCodeDetector
impl ClaudeCodeDetector {
    /// Check if content contains Tasks list with in-progress tasks
    /// ◼ indicates an in-progress task in Claude Code's task list
    pub(super) fn has_in_progress_tasks(content: &str) -> bool {
        // Look for the Tasks header pattern and in-progress indicator
        let recent = safe_tail(content, 2000);

        // Check for Tasks header with in_progress count > 0
        for line in recent.lines() {
            let trimmed = line.trim();
            // Match task summary formats:
            // - "Tasks (X done, Y in progress, Z open)" (Teams/Plan format)
            // - "N tasks (X done, Y in progress, Z open)" (internal task list)
            // - "N task (X done, Y in progress, Z open)" (singular)
            let is_task_summary = trimmed.contains("in progress")
                && (trimmed.starts_with("Tasks (")
                    || trimmed.contains(" tasks (")
                    || trimmed.contains(" task ("));
            if is_task_summary {
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
            // Check for ◼ indicator (in-progress task)
            // Formats: "◼ #N task name" (Teams) or "◼ task name" (internal)
            if trimmed.starts_with('◼') {
                return true;
            }
        }
        false
    }

    /// Check if title matches custom spinner verbs from settings
    ///
    /// Returns Some(activity) if a custom verb matches, None otherwise.
    pub(super) fn detect_custom_spinner_verb(
        title: &str,
        context: &DetectionContext,
    ) -> Option<String> {
        let settings_cache = context.settings_cache?;
        let settings = settings_cache.get_settings(context.cwd)?;
        let spinner_config = settings.spinner_verbs?;

        if spinner_config.verbs.is_empty() {
            return None;
        }

        // Check if title starts with any custom verb
        for verb in &spinner_config.verbs {
            if title.starts_with(verb) {
                // Extract activity text after the verb
                let activity = title
                    .strip_prefix(verb)
                    .map(|s| s.trim_start())
                    .unwrap_or("")
                    .to_string();
                return Some(activity);
            }
        }

        None
    }

    /// Detect turn duration completion pattern (e.g., "✻ Cooked for 1m 6s")
    ///
    /// When Claude Code finishes a turn, it displays a line like "✻ Cooked for 1m 6s"
    /// using a past-tense verb. This is a definitive Idle indicator.
    ///
    /// Only checks the last 5 non-empty lines to avoid matching residual
    /// turn duration messages from previous turns while a new turn is active.
    pub(super) fn detect_turn_duration(content: &str) -> Option<String> {
        for line in content
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(5)
        {
            let trimmed = line.trim();

            // Check for content spinner char at the start (Unicode only, not plain *)
            let first_char = match trimmed.chars().next() {
                Some(c) => c,
                None => continue,
            };

            if !CONTENT_SPINNER_CHARS.contains(&first_char) {
                continue;
            }

            let rest = trimmed[first_char.len_utf8()..].trim_start();

            // Check for past-tense verb + " for " + duration pattern
            for verb in TURN_DURATION_VERBS {
                if let Some(after_verb) = rest.strip_prefix(verb) {
                    if after_verb.starts_with(" for ") {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
        None
    }

    /// Detect active spinner verbs in content area
    ///
    /// Claude Code shows spinner activity like "✶ Spinning…", "✻ Levitating…", "* Working…"
    /// in the content. Active spinners contain "…" (ellipsis), while completed ones show
    /// "✻ Crunched for 6m 5s" (past tense + time, no ellipsis).
    ///
    /// Returns (matched_text, is_builtin_verb) — builtin verbs get High confidence,
    /// unknown/custom verbs get Medium confidence.
    ///
    /// This is critical for detecting processing when the title still shows ✳ (idle),
    /// e.g. during /compact or title update lag.
    pub(super) fn detect_content_spinner(
        content: &str,
        context: &DetectionContext,
    ) -> Option<(String, bool)> {
        // If idle prompt ❯ is near the end (last 5 non-empty lines), any spinner above is a past residual
        let has_idle_prompt = content
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(5)
            .any(|line| {
                let trimmed = line.trim();
                trimmed == "❯" || trimmed == "›"
            });
        if has_idle_prompt {
            trace!("detect_content_spinner: skipped due to idle prompt (❯/›) in last 5 non-empty lines");
            return None;
        }

        // Check last 15 non-empty lines (skip empty lines entirely).
        // Claude Code TUI has status bar (3 lines) + separators + empty padding,
        // so using raw line count can miss spinners beyond the window.
        for line in content
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(15)
        {
            let trimmed = line.trim();

            let first_char = match trimmed.chars().next() {
                Some(c) => c,
                None => continue,
            };

            // Check for decorative asterisk chars or plain '*'
            let is_spinner_char = CONTENT_SPINNER_CHARS.contains(&first_char) || first_char == '*';
            if !is_spinner_char {
                continue;
            }

            let rest = trimmed[first_char.len_utf8()..].trim_start();

            // Must start with uppercase letter (verb) and contain ellipsis (active)
            let starts_upper = rest
                .chars()
                .next()
                .map(|c| c.is_uppercase())
                .unwrap_or(false);
            let has_ellipsis = rest.contains('…') || rest.contains("...");

            if starts_upper && has_ellipsis {
                // Extract the verb (first word) and check against builtin/custom lists
                let verb = rest.split_whitespace().next().unwrap_or("");
                // Strip trailing ellipsis from verb if present (e.g., "Spinning…")
                let verb_clean = verb.trim_end_matches('…').trim_end_matches("...");
                let is_builtin = BUILTIN_SPINNER_VERBS.contains(&verb_clean);
                // Also check custom spinnerVerbs from Claude Code settings
                let is_custom = if !is_builtin {
                    context
                        .settings_cache
                        .and_then(|cache| cache.get_settings(context.cwd))
                        .and_then(|s| s.spinner_verbs)
                        .map(|config| config.verbs.iter().any(|v| v == verb_clean))
                        .unwrap_or(false)
                } else {
                    false
                };
                return Some((trimmed.to_string(), is_builtin || is_custom));
            }
        }
        None
    }

    /// Detect permission mode from title icon
    ///
    /// Claude Code displays mode icons in the terminal title:
    /// - ⏸ (U+23F8) = Plan mode
    /// - ⇢ (U+21E2) = Delegate mode
    /// - ⏵⏵ (U+23F5 x2) = Auto-approve (acceptEdits/bypassPermissions/dontAsk)
    pub fn detect_mode(title: &str) -> AgentMode {
        if title.contains('\u{23F8}') {
            AgentMode::Plan
        } else if title.contains('\u{21E2}') {
            AgentMode::Delegate
        } else if title.contains("\u{23F5}\u{23F5}") {
            AgentMode::AutoApprove
        } else {
            AgentMode::Default
        }
    }

    /// Check if we should skip default Braille spinner detection
    ///
    /// Returns true if mode is "replace" and custom verbs are configured.
    pub(super) fn should_skip_default_spinners(context: &DetectionContext) -> bool {
        let settings_cache = match context.settings_cache {
            Some(cache) => cache,
            None => return false,
        };

        let settings = match settings_cache.get_settings(context.cwd) {
            Some(s) => s,
            None => return false,
        };

        matches!(
            settings.spinner_verbs,
            Some(ref config) if config.mode == SpinnerVerbsMode::Replace && !config.verbs.is_empty()
        )
    }
}
