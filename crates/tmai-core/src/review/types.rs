use std::fmt;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Agent to use for code review
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReviewAgent {
    /// Claude Code CLI (`claude -p`)
    #[default]
    ClaudeCode,
    /// Codex CLI (`codex -q`)
    Codex,
    /// Gemini CLI (`gemini`)
    Gemini,
}

/// Options for post-review feedback to the original session
#[derive(Debug, Clone)]
pub struct FeedbackTarget {
    /// tmux target of the original agent pane (e.g., "session-1:1.1")
    pub target: String,
    /// Path to the review output file
    pub output_file: std::path::PathBuf,
}

impl ReviewAgent {
    /// Build the shell command to run the review with this agent.
    ///
    /// Output is tee'd to `output_file` so tmai can read the result.
    /// If `feedback` is provided, the review result file path is sent to the
    /// original session as a prompt after the review completes.
    pub fn build_command(
        &self,
        prompt_file: &std::path::Path,
        output_file: &std::path::Path,
        feedback: Option<&FeedbackTarget>,
    ) -> String {
        let prompt = shell_escape(prompt_file);
        let output = shell_escape(output_file);

        // Core review command per agent (use stdin pipe to avoid ARG_MAX with large prompts)
        let review_cmd = match self {
            ReviewAgent::ClaudeCode => {
                format!("cat {prompt} | claude -p - | tee {output}")
            }
            ReviewAgent::Codex => {
                format!("cat {prompt} | codex -q - | tee {output}")
            }
            ReviewAgent::Gemini => {
                format!("gemini < {prompt} | tee {output}")
            }
        };

        // Post-review feedback: send review file path to original session
        let feedback_cmd = if let Some(fb) = feedback {
            let fb_target = shell_escape_str(&fb.target);
            let fb_output = shell_escape(&fb.output_file);
            format!(
                " && tmux send-keys -t {fb_target} -l 'Read the code review at {fb_output} and fix Critical/Warning issues' && tmux send-keys -t {fb_target} Enter"
            )
        } else {
            String::new()
        };

        let cleanup = format!("rm -f {prompt}");

        format!(
            "{review_cmd}{feedback_cmd} ; \
             echo '\\n[Review complete. Press Enter to close.]' ; read ; {cleanup}"
        )
    }
}

impl fmt::Display for ReviewAgent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReviewAgent::ClaudeCode => write!(f, "claude_code"),
            ReviewAgent::Codex => write!(f, "codex"),
            ReviewAgent::Gemini => write!(f, "gemini"),
        }
    }
}

/// Request to launch a fresh-session code review
#[derive(Debug, Clone)]
pub struct ReviewRequest {
    /// tmux target of the agent that completed work (e.g., "main:0.1")
    pub target: String,
    /// Working directory of the completed agent
    pub cwd: String,
    /// Git branch name (if available)
    pub branch: Option<String>,
    /// Base branch to diff against (default: main)
    pub base_branch: String,
    /// Last assistant message from the Stop event
    pub last_message: Option<String>,
}

/// Current status of a review session
#[derive(Debug, Clone, Serialize)]
pub enum ReviewStatus {
    /// Review is being prepared (collecting diff, creating prompt)
    Preparing,
    /// Review session is running in a tmux pane
    Running {
        /// tmux target of the review pane
        review_target: String,
    },
    /// Review completed
    Completed {
        /// tmux target of the review pane
        review_target: String,
    },
    /// Review failed to start
    Failed {
        /// Error description
        reason: String,
    },
}

/// Shell-escape a path by wrapping in single quotes with proper escaping.
/// e.g., `/tmp/foo's bar` → `'/tmp/foo'\''s bar'`
fn shell_escape(path: &Path) -> String {
    shell_escape_str(&path.display().to_string())
}

/// Shell-escape a string by wrapping in single quotes with proper escaping.
fn shell_escape_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_review_agent_default_is_claude_code() {
        assert_eq!(ReviewAgent::default(), ReviewAgent::ClaudeCode);
    }

    #[test]
    fn test_review_agent_serde_roundtrip() {
        let json = serde_json::to_string(&ReviewAgent::ClaudeCode).unwrap();
        assert_eq!(json, r#""claude_code""#);

        let json = serde_json::to_string(&ReviewAgent::Codex).unwrap();
        assert_eq!(json, r#""codex""#);

        let json = serde_json::to_string(&ReviewAgent::Gemini).unwrap();
        assert_eq!(json, r#""gemini""#);

        // Deserialize
        let agent: ReviewAgent = serde_json::from_str(r#""codex""#).unwrap();
        assert_eq!(agent, ReviewAgent::Codex);
    }

    #[test]
    fn test_review_agent_build_command_without_feedback() {
        let prompt = PathBuf::from("/tmp/review.txt");
        let output = PathBuf::from("/tmp/output.md");

        let cmd = ReviewAgent::ClaudeCode.build_command(&prompt, &output, None);
        assert!(cmd.contains("claude -p"));
        assert!(cmd.contains("/tmp/review.txt"));
        assert!(cmd.contains("/tmp/output.md"));
        assert!(!cmd.contains("send-keys"));

        let cmd = ReviewAgent::Codex.build_command(&prompt, &output, None);
        assert!(cmd.contains("codex -q"));

        let cmd = ReviewAgent::Gemini.build_command(&prompt, &output, None);
        assert!(cmd.contains("gemini <"));
    }

    #[test]
    fn test_review_agent_build_command_with_feedback() {
        let prompt = PathBuf::from("/tmp/review.txt");
        let output = PathBuf::from("/tmp/output.md");
        let feedback = FeedbackTarget {
            target: "main:0.1".to_string(),
            output_file: output.clone(),
        };

        let cmd = ReviewAgent::ClaudeCode.build_command(&prompt, &output, Some(&feedback));
        assert!(cmd.contains("send-keys -t"));
        assert!(cmd.contains("main:0.1"));
        assert!(cmd.contains("/tmp/output.md"));
        assert!(cmd.contains("fix Critical/Warning"));
    }

    #[test]
    fn test_shell_escape_simple_path() {
        let path = PathBuf::from("/tmp/review.txt");
        assert_eq!(shell_escape(&path), "'/tmp/review.txt'");
    }

    #[test]
    fn test_shell_escape_with_single_quote() {
        let path = PathBuf::from("/tmp/it's a file.txt");
        assert_eq!(shell_escape(&path), "'/tmp/it'\\''s a file.txt'");
    }

    #[test]
    fn test_shell_escape_with_special_chars() {
        // Paths with shell metacharacters should be safely quoted
        let escaped = shell_escape_str("feat-$(rm -rf /)");
        assert_eq!(escaped, "'feat-$(rm -rf /)'");
    }

    #[test]
    fn test_review_agent_display() {
        assert_eq!(ReviewAgent::ClaudeCode.to_string(), "claude_code");
        assert_eq!(ReviewAgent::Codex.to_string(), "codex");
        assert_eq!(ReviewAgent::Gemini.to_string(), "gemini");
    }

    #[test]
    fn test_review_agent_toml_config() {
        // Simulate parsing from TOML config
        let toml_str = r#"agent = "codex""#;
        #[derive(Deserialize)]
        struct TestConfig {
            agent: ReviewAgent,
        }
        let config: TestConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.agent, ReviewAgent::Codex);
    }
}
