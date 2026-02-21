/// Rule-based auto-approve engine.
///
/// Evaluates screen context against allow rules to make instant
/// (sub-millisecond) approval decisions without AI.
/// If no allow rule matches, the decision is Uncertain — which becomes
/// ManualRequired in Rules mode, or escalates to AI in Hybrid mode.
use std::time::Instant;

use anyhow::Result;
use regex::Regex;

use crate::config::RuleSettings;

use super::judge::JudgmentProvider;
use super::types::{JudgmentDecision, JudgmentRequest, JudgmentResult};

/// Parsed operation from Claude Code's approval prompt
struct ParsedContext {
    /// Operation type: "Read", "Edit", "Bash", "WebFetch", "WebSearch", "MCP tool", etc.
    operation: Option<String>,
    /// Target: file path, command string, URL, etc.
    target: Option<String>,
}

/// Rule engine that evaluates allow rules against screen context
pub struct RuleEngine {
    settings: RuleSettings,
    /// Compiled user-defined allow patterns
    allow_patterns: Vec<Regex>,
}

impl RuleEngine {
    /// Create a new RuleEngine with the given settings
    pub fn new(settings: RuleSettings) -> Self {
        let allow_patterns = settings
            .allow_patterns
            .iter()
            .filter_map(|p| match Regex::new(p) {
                Ok(r) => Some(r),
                Err(e) => {
                    tracing::warn!(pattern = %p, "Invalid allow_pattern regex: {}", e);
                    None
                }
            })
            .collect();

        Self {
            settings,
            allow_patterns,
        }
    }

    /// Parse the screen context to extract operation and target
    fn parse_context(screen_context: &str) -> ParsedContext {
        // Claude Code approval prompts follow patterns like:
        //   "Allow Read access to /path/to/file"
        //   "Allow Edit access to /path/to/file"
        //   "Allow Bash: git status"
        //   "Allow WebFetch: https://..."
        //   "Allow MCP tool: tool_name"
        let last_lines: Vec<&str> = screen_context.lines().rev().take(15).collect();
        let search_text: String = last_lines.into_iter().rev().collect::<Vec<_>>().join("\n");

        // Try "Allow <Operation> access to <target>" pattern
        let access_re = Regex::new(r"(?i)Allow\s+(\w+)\s+access\s+to\s+(.+)").expect("valid regex");
        if let Some(caps) = access_re.captures(&search_text) {
            return ParsedContext {
                operation: Some(caps[1].to_string()),
                target: Some(caps[2].trim().to_string()),
            };
        }

        // Try "Allow <Operation>: <target>" pattern
        let colon_re = Regex::new(r"(?i)Allow\s+([\w\s]+?):\s+(.+)").expect("valid regex");
        if let Some(caps) = colon_re.captures(&search_text) {
            return ParsedContext {
                operation: Some(caps[1].trim().to_string()),
                target: Some(caps[2].trim().to_string()),
            };
        }

        ParsedContext {
            operation: None,
            target: None,
        }
    }

    /// Check allow rules; returns the matching rule name if allowed
    fn check_allow(
        &self,
        screen_context: &str,
        operation: Option<&str>,
        target: Option<&str>,
    ) -> Option<String> {
        // User-defined allow patterns (highest priority)
        for (i, pattern) in self.allow_patterns.iter().enumerate() {
            if pattern.is_match(screen_context) {
                return Some(format!(
                    "allow_pattern[{}]: {}",
                    i, self.settings.allow_patterns[i]
                ));
            }
        }

        let op = operation.unwrap_or("").to_lowercase();
        let tgt = target.unwrap_or("").to_lowercase();

        // Read operations
        if self.settings.allow_read {
            if op == "read" {
                return Some("allow_read: Read access".to_string());
            }
            let read_commands = [
                "cat ", "head ", "tail ", "less ", "ls ", "find ", "grep ", "wc ",
            ];
            if op == "bash" {
                for cmd in &read_commands {
                    if tgt.starts_with(cmd) || tgt.contains(&format!(" | {}", cmd)) {
                        return Some(format!("allow_read: {}", cmd.trim()));
                    }
                }
            }
        }

        // Test execution
        if self.settings.allow_tests && op == "bash" {
            let test_commands = [
                "cargo test",
                "npm test",
                "npm run test",
                "npx jest",
                "npx vitest",
                "pytest",
                "python -m pytest",
                "go test",
                "dotnet test",
                "mvn test",
                "gradle test",
            ];
            for cmd in &test_commands {
                if tgt.starts_with(cmd) || tgt.contains(&format!("&& {}", cmd)) {
                    return Some(format!("allow_tests: {}", cmd));
                }
            }
        }

        // Fetch/search operations
        if self.settings.allow_fetch {
            if op == "webfetch" || op == "websearch" {
                return Some(format!("allow_fetch: {}", op));
            }
            // curl GET (no -X POST, no --data, no -d)
            if op == "bash"
                && tgt.starts_with("curl ")
                && !tgt.contains("-x post")
                && !tgt.contains("--data")
                && !tgt.contains(" -d ")
            {
                return Some("allow_fetch: curl GET".to_string());
            }
        }

        // Git read-only commands
        if self.settings.allow_git_readonly && op == "bash" {
            let git_readonly = [
                "git status",
                "git log",
                "git diff",
                "git branch",
                "git show",
                "git blame",
                "git stash list",
                "git remote -v",
                "git tag",
                "git rev-parse",
                "git ls-files",
                "git ls-tree",
            ];
            for cmd in &git_readonly {
                if tgt.starts_with(cmd) {
                    return Some(format!("allow_git_readonly: {}", cmd));
                }
            }
        }

        // Format/lint commands
        if self.settings.allow_format_lint && op == "bash" {
            let fmt_commands = [
                "cargo fmt",
                "cargo clippy",
                "prettier",
                "eslint",
                "rustfmt",
                "black ",
                "isort ",
                "gofmt",
                "go fmt",
                "biome ",
                "deno fmt",
                "deno lint",
            ];
            for cmd in &fmt_commands {
                if tgt.starts_with(cmd) || tgt.contains(&format!("npx {}", cmd)) {
                    return Some(format!("allow_format_lint: {}", cmd.trim()));
                }
            }
        }

        None
    }
}

impl JudgmentProvider for RuleEngine {
    /// Evaluate allow rules against the request (instant, sub-millisecond).
    ///
    /// Returns Approve if an allow rule matches, Uncertain otherwise.
    /// There are no deny rules — unmatched requests fall through to manual
    /// approval (Rules mode) or AI escalation (Hybrid mode).
    async fn judge(&self, request: &JudgmentRequest) -> Result<JudgmentResult> {
        let start = Instant::now();
        let parsed = Self::parse_context(&request.screen_context);

        // Check allow rules
        if let Some(rule) = self.check_allow(
            &request.screen_context,
            parsed.operation.as_deref(),
            parsed.target.as_deref(),
        ) {
            return Ok(JudgmentResult {
                decision: JudgmentDecision::Approve,
                reasoning: format!("Allowed by rule: {}", rule),
                model: format!("rules:{}", rule.split(':').next().unwrap_or("allow")),
                elapsed_ms: start.elapsed().as_millis() as u64,
                usage: None,
            });
        }

        // No matching rule — abstain (hand off to manual or AI)
        Ok(JudgmentResult {
            decision: JudgmentDecision::Uncertain,
            reasoning: "No matching allow rule".to_string(),
            model: "rules:abstain".to_string(),
            elapsed_ms: start.elapsed().as_millis() as u64,
            usage: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to create a RuleEngine with default settings
    fn default_engine() -> RuleEngine {
        RuleEngine::new(RuleSettings::default())
    }

    /// Helper to create a JudgmentRequest with given screen context
    fn request_with_context(screen_context: &str) -> JudgmentRequest {
        JudgmentRequest {
            target: "test:0.1".to_string(),
            approval_type: "shell_command".to_string(),
            details: String::new(),
            screen_context: screen_context.to_string(),
            cwd: "/tmp/project".to_string(),
            agent_type: "claude_code".to_string(),
        }
    }

    #[tokio::test]
    async fn test_allow_read_access() {
        let engine = default_engine();
        let req = request_with_context("Allow Read access to /home/user/project/src/main.rs");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Approve);
        assert!(result.model.starts_with("rules:"));
    }

    #[tokio::test]
    async fn test_allow_bash_cat() {
        let engine = default_engine();
        let req = request_with_context("Allow Bash: cat /etc/hosts");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Approve);
    }

    #[tokio::test]
    async fn test_allow_cargo_test() {
        let engine = default_engine();
        let req = request_with_context("Allow Bash: cargo test --lib");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Approve);
        assert!(result.reasoning.contains("allow_tests"));
    }

    #[tokio::test]
    async fn test_allow_git_status() {
        let engine = default_engine();
        let req = request_with_context("Allow Bash: git status");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Approve);
        assert!(result.reasoning.contains("allow_git_readonly"));
    }

    #[tokio::test]
    async fn test_allow_cargo_fmt() {
        let engine = default_engine();
        let req = request_with_context("Allow Bash: cargo fmt");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Approve);
        assert!(result.reasoning.contains("allow_format_lint"));
    }

    #[tokio::test]
    async fn test_allow_webfetch() {
        let engine = default_engine();
        let req = request_with_context("Allow WebFetch: https://docs.rs/ratatui/latest");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Approve);
        assert!(result.reasoning.contains("allow_fetch"));
    }

    #[tokio::test]
    async fn test_abstain_unknown_command() {
        let engine = default_engine();
        let req = request_with_context("Allow Bash: some-unknown-command --flag");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Uncertain);
        assert!(result.model.contains("abstain"));
    }

    #[tokio::test]
    async fn test_abstain_edit_operation() {
        // Edit operations should not be auto-approved by default rules
        let engine = default_engine();
        let req = request_with_context("Allow Edit access to /home/user/project/src/main.rs");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Uncertain);
    }

    #[tokio::test]
    async fn test_disabled_allow_read() {
        let settings = RuleSettings {
            allow_read: false,
            ..Default::default()
        };
        let engine = RuleEngine::new(settings);
        let req = request_with_context("Allow Read access to /home/user/file.txt");
        let result = engine.judge(&req).await.unwrap();
        // With allow_read disabled, Read should abstain (not be allowed)
        assert_eq!(result.decision, JudgmentDecision::Uncertain);
    }

    #[tokio::test]
    async fn test_custom_allow_pattern() {
        let settings = RuleSettings {
            allow_patterns: vec![r"my-safe-tool".to_string()],
            ..Default::default()
        };
        let engine = RuleEngine::new(settings);
        let req = request_with_context("Allow Bash: my-safe-tool run --safe");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Approve);
        assert!(result.reasoning.contains("allow_pattern"));
    }

    #[tokio::test]
    async fn test_model_field_format() {
        let engine = default_engine();
        let req = request_with_context("Allow Read access to /tmp/file.txt");
        let result = engine.judge(&req).await.unwrap();
        assert!(result.model.starts_with("rules:"));
    }

    #[tokio::test]
    async fn test_curl_get_allowed() {
        let engine = default_engine();
        let req = request_with_context("Allow Bash: curl https://api.example.com/data");
        let result = engine.judge(&req).await.unwrap();
        assert_eq!(result.decision, JudgmentDecision::Approve);
    }

    #[tokio::test]
    async fn test_curl_post_abstain() {
        let engine = default_engine();
        let req =
            request_with_context("Allow Bash: curl -X POST https://api.example.com/data -d '{}'");
        let result = engine.judge(&req).await.unwrap();
        // POST curl should not be auto-approved by rules → abstain
        assert_eq!(result.decision, JudgmentDecision::Uncertain);
    }
}
