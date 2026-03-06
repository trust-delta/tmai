//! Fresh Session Review service — launches a context-free Claude Code session
//! to review changes made by an agent after it completes work.

use std::collections::HashSet;
use std::io::Write as _;
use std::sync::Arc;

use anyhow::{Context, Result};
use parking_lot::RwLock;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::api::CoreEvent;
use crate::config::ReviewSettings;
use crate::state::SharedState;
use crate::tmux::TmuxClient;

use super::types::{ReviewNotification, ReviewRequest};

/// Shared set of targets currently under review (prevents duplicate reviews)
type ActiveReviews = Arc<RwLock<HashSet<String>>>;

/// RAII guard that removes a target from the active reviews set on drop.
/// Prevents leaking entries if the review task panics.
struct ActiveReviewGuard {
    active: ActiveReviews,
    target: String,
}

impl Drop for ActiveReviewGuard {
    fn drop(&mut self) {
        self.active.write().remove(&self.target);
    }
}

/// Service that manages fresh-session code reviews
pub struct ReviewService;

impl ReviewService {
    /// Spawn the review service as a background task.
    ///
    /// Listens for `CoreEvent::AgentStopped` events (auto_launch) and
    /// `CoreEvent::ReviewReady` events (manual trigger) to launch review sessions.
    /// If `notification` is provided, review completion is reported to the TUI.
    pub fn spawn(
        settings: Arc<ReviewSettings>,
        state: SharedState,
        mut event_rx: broadcast::Receiver<CoreEvent>,
        event_tx: broadcast::Sender<CoreEvent>,
        notification: Option<Arc<ReviewNotification>>,
    ) -> tokio::task::JoinHandle<()> {
        let active_reviews: ActiveReviews = Arc::new(RwLock::new(HashSet::new()));

        tokio::spawn(async move {
            loop {
                let request = match event_rx.recv().await {
                    Ok(CoreEvent::AgentStopped {
                        target,
                        cwd,
                        last_assistant_message,
                    }) => {
                        if !settings.auto_launch {
                            continue;
                        }
                        // Build review request from stop event + agent state
                        let branch = {
                            let app_state = state.read();
                            app_state
                                .agents
                                .get(&target)
                                .and_then(|a| a.git_branch.clone())
                        };
                        ReviewRequest {
                            target,
                            cwd,
                            branch,
                            base_branch: settings.base_branch.clone(),
                            last_message: last_assistant_message,
                        }
                    }
                    Ok(CoreEvent::ReviewReady { request }) => request,
                    Ok(_) => continue,
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        debug!(skipped = n, "Review service lagged, skipping events");
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Event channel closed, stopping review service");
                        break;
                    }
                };

                // Skip if review already in progress for this target
                {
                    let reviews = active_reviews.read();
                    if reviews.contains(&request.target) {
                        debug!(
                            target = %request.target,
                            "Review already in progress, skipping"
                        );
                        continue;
                    }
                }

                // Mark as active
                {
                    let mut reviews = active_reviews.write();
                    reviews.insert(request.target.clone());
                }

                let review_settings = settings.clone();
                let active = active_reviews.clone();
                let tx = event_tx.clone();
                let notif = notification.clone();

                // Launch review in a separate blocking task
                tokio::task::spawn_blocking(move || {
                    // Guard ensures target is removed from active set even on panic
                    let _guard = ActiveReviewGuard {
                        active: active.clone(),
                        target: request.target.clone(),
                    };

                    // Build per-request notification with source_target
                    let req_notif = notif.as_ref().map(|n| ReviewNotification {
                        port: n.port,
                        token: n.token.clone(),
                        source_target: request.target.clone(),
                    });

                    let result = launch_review(&request, &review_settings, req_notif.as_ref());

                    match result {
                        Ok((review_target, output_file)) => {
                            info!(
                                source_target = %request.target,
                                review_target = %review_target,
                                output = %output_file.display(),
                                "Review session launched"
                            );
                            let _ = tx.send(CoreEvent::ReviewLaunched {
                                source_target: request.target.clone(),
                                review_target,
                            });
                        }
                        Err(e) => {
                            warn!(
                                target = %request.target,
                                error = %e,
                                "Failed to launch review session"
                            );
                        }
                    }
                });
            }
        })
    }
}

/// Collect git diff and launch a review session in a split pane.
///
/// The review pane auto-closes when the review completes.
/// If `notification` is provided, tmai is notified via HTTP on completion.
/// Returns `(review_target, output_file_path)`.
pub fn launch_review(
    request: &ReviewRequest,
    settings: &ReviewSettings,
    notification: Option<&ReviewNotification>,
) -> Result<(String, std::path::PathBuf)> {
    if request.cwd.is_empty() {
        anyhow::bail!("Cannot launch review: working directory is empty");
    }

    let tmux = TmuxClient::new();

    // Collect git diff
    let diff = collect_git_diff(&request.cwd, &request.base_branch)?;

    if diff.trim().is_empty() {
        anyhow::bail!("No changes to review (empty diff)");
    }

    // Build review prompt
    let prompt = build_review_prompt(request, &diff, settings);

    // Write prompt to a temp file (avoids shell escaping issues with large diffs)
    let prompt_file = write_prompt_file(&prompt)?;

    // Output file for review results (sanitize branch name for filesystem/shell safety)
    let safe_branch = sanitize_name(request.branch.as_deref().unwrap_or("unknown"));
    let output_file = review_output_dir()?.join(format!("{safe_branch}.md"));

    // Split the source agent's pane for the review (auto-closes when done)
    let review_target = tmux
        .split_window(&request.target, &request.cwd)
        .context("Failed to split pane for review")?;

    // Build feedback target if auto_feedback is enabled
    let feedback = if settings.auto_feedback {
        Some(super::types::FeedbackTarget {
            target: request.target.clone(),
            output_file: output_file.clone(),
        })
    } else {
        None
    };

    // Launch review agent with the prompt (output tee'd to file)
    let review_cmd =
        settings
            .agent
            .build_command(&prompt_file, &output_file, feedback.as_ref(), notification);
    tmux.send_text_and_enter(&review_target, &review_cmd)
        .context("Failed to send review command")?;

    Ok((review_target, output_file))
}

/// Directory for review output files
fn review_output_dir() -> Result<std::path::PathBuf> {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join("tmai/reviews");
    std::fs::create_dir_all(&dir).context("Failed to create review output dir")?;
    Ok(dir)
}

/// Collect git diff output for the given working directory
fn collect_git_diff(cwd: &str, base_branch: &str) -> Result<String> {
    // Try diff against base branch first (for feature branches)
    let output = std::process::Command::new("git")
        .args([
            "diff",
            &format!("{}...HEAD", base_branch),
            "--stat",
            "--patch",
        ])
        .current_dir(cwd)
        .output()
        .context("Failed to run git diff")?;

    if output.status.success() {
        let diff = String::from_utf8_lossy(&output.stdout).to_string();
        if !diff.trim().is_empty() {
            return Ok(truncate_diff(diff));
        }
    }

    // Fallback: diff of uncommitted changes
    let output = std::process::Command::new("git")
        .args(["diff", "HEAD", "--stat", "--patch"])
        .current_dir(cwd)
        .output()
        .context("Failed to run git diff HEAD")?;

    let diff = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(truncate_diff(diff))
}

/// Truncate diff to avoid exceeding Claude's input limits
fn truncate_diff(diff: String) -> String {
    const MAX_DIFF_BYTES: usize = 100_000; // ~100KB, well within Claude's context
    if diff.len() > MAX_DIFF_BYTES {
        // Find a UTF-8 safe boundary (walk back from MAX to find a char boundary)
        let safe_end = floor_char_boundary(&diff, MAX_DIFF_BYTES);
        // Then find the last newline to avoid cutting mid-line
        let cut_point = diff[..safe_end].rfind('\n').unwrap_or(safe_end);
        format!(
            "{}\n\n... [diff truncated at {}KB, {} total bytes]",
            &diff[..cut_point],
            MAX_DIFF_BYTES / 1024,
            diff.len()
        )
    } else {
        diff
    }
}

/// Find the largest byte index <= `max` that is on a UTF-8 char boundary.
/// Equivalent to `str::floor_char_boundary` (nightly-only as of stable 1.80).
fn floor_char_boundary(s: &str, max: usize) -> usize {
    if max >= s.len() {
        return s.len();
    }
    let mut i = max;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Build the review prompt from request context and diff
fn build_review_prompt(request: &ReviewRequest, diff: &str, settings: &ReviewSettings) -> String {
    let branch_info = request
        .branch
        .as_deref()
        .map(|b| format!("Branch: {}\n", b))
        .unwrap_or_default();

    let last_msg_info = request
        .last_message
        .as_deref()
        .map(|m| {
            format!(
                "The agent's final message was:\n<agent_summary>\n{}\n</agent_summary>\n\n",
                m
            )
        })
        .unwrap_or_default();

    let custom_instructions = if settings.custom_instructions.is_empty() {
        String::new()
    } else {
        format!(
            "\nAdditional review instructions:\n{}\n",
            settings.custom_instructions
        )
    };

    format!(
        r#"You are a code reviewer performing a fresh-context review. You have NO prior context about this codebase — you are seeing these changes for the first time, which gives you an unbiased perspective.

{branch_info}Working directory: {cwd}
Base branch: {base_branch}

{last_msg_info}Review the following git diff carefully. Focus on:

1. **Bugs & Logic Errors** — Off-by-one, null/None handling, race conditions, missing error handling
2. **Security Issues** — Injection, hardcoded secrets, unsafe operations, OWASP top 10
3. **Design & Architecture** — Naming, separation of concerns, unnecessary complexity
4. **Missing Edge Cases** — Boundary conditions, empty inputs, error paths
5. **Test Coverage** — Are the changes adequately tested? What tests are missing?
{custom_instructions}
Output a structured review:
- Start with a 1-line overall assessment (LGTM / Minor Issues / Needs Changes / Critical Issues)
- List each finding with severity (Critical/Warning/Info), file, and line reference
- End with a summary of recommended changes

<diff>
{diff}
</diff>"#,
        cwd = request.cwd,
        base_branch = request.base_branch,
    )
}

/// Write the review prompt to a temporary file
fn write_prompt_file(prompt: &str) -> Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join("tmai-reviews");
    std::fs::create_dir_all(&dir).context("Failed to create review temp dir")?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let pid = std::process::id();
    let path = dir.join(format!("review-{}-{}.txt", timestamp, pid));

    let mut file = std::fs::File::create(&path).context("Failed to create review prompt file")?;
    file.write_all(prompt.as_bytes())
        .context("Failed to write review prompt")?;

    Ok(path)
}

/// Sanitize a name for use in file paths and shell commands.
/// Keeps only alphanumeric, hyphen, underscore, and dot characters.
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_review_prompt_basic() {
        let request = ReviewRequest {
            target: "main:0.1".to_string(),
            cwd: "/home/user/project".to_string(),
            branch: Some("feat/auth".to_string()),
            base_branch: "main".to_string(),
            last_message: None,
        };
        let settings = ReviewSettings::default();
        let prompt = build_review_prompt(&request, "diff content here", &settings);

        assert!(prompt.contains("feat/auth"));
        assert!(prompt.contains("/home/user/project"));
        assert!(prompt.contains("diff content here"));
        assert!(prompt.contains("Bugs & Logic Errors"));
    }

    #[test]
    fn test_build_review_prompt_with_agent_message() {
        let request = ReviewRequest {
            target: "main:0.1".to_string(),
            cwd: "/tmp".to_string(),
            branch: None,
            base_branch: "main".to_string(),
            last_message: Some("I implemented the login feature.".to_string()),
        };
        let settings = ReviewSettings::default();
        let prompt = build_review_prompt(&request, "some diff", &settings);

        assert!(prompt.contains("agent_summary"));
        assert!(prompt.contains("I implemented the login feature."));
    }

    #[test]
    fn test_build_review_prompt_with_custom_instructions() {
        let request = ReviewRequest {
            target: "main:0.1".to_string(),
            cwd: "/tmp".to_string(),
            branch: None,
            base_branch: "main".to_string(),
            last_message: None,
        };
        let settings = ReviewSettings {
            custom_instructions: "Pay special attention to SQL queries.".to_string(),
            ..Default::default()
        };
        let prompt = build_review_prompt(&request, "some diff", &settings);

        assert!(prompt.contains("Pay special attention to SQL queries."));
    }

    #[test]
    fn test_truncate_diff_short() {
        let diff = "short diff".to_string();
        assert_eq!(truncate_diff(diff.clone()), diff);
    }

    #[test]
    fn test_truncate_diff_long() {
        let diff = "x\n".repeat(100_000); // ~200KB
        let result = truncate_diff(diff);
        assert!(result.len() <= 110_000); // Some overhead from truncation message
        assert!(result.contains("[diff truncated"));
    }

    #[test]
    fn test_write_prompt_file() {
        let path = write_prompt_file("test prompt content").unwrap();
        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content, "test prompt content");
        // Cleanup
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn test_sanitize_name_basic() {
        assert_eq!(sanitize_name("feat/auth"), "feat-auth");
        assert_eq!(sanitize_name("simple"), "simple");
    }

    #[test]
    fn test_sanitize_name_removes_shell_metacharacters() {
        assert_eq!(sanitize_name("feat/$(rm -rf /)"), "feat---rm--rf---");
        assert_eq!(sanitize_name("branch`whoami`"), "branch-whoami-");
        // All shell metacharacters are replaced with hyphens
        assert_eq!(sanitize_name("name;echo hi"), "name-echo-hi");
    }

    #[test]
    fn test_floor_char_boundary_ascii() {
        let s = "hello world";
        assert_eq!(floor_char_boundary(s, 5), 5);
        assert_eq!(floor_char_boundary(s, 100), s.len());
    }

    #[test]
    fn test_floor_char_boundary_multibyte() {
        // "あいう" = 3 chars × 3 bytes = 9 bytes
        let s = "あいう";
        assert_eq!(floor_char_boundary(s, 9), 9); // exact boundary
        assert_eq!(floor_char_boundary(s, 7), 6); // mid-char → back to boundary
        assert_eq!(floor_char_boundary(s, 4), 3); // mid-char → back to boundary
        assert_eq!(floor_char_boundary(s, 1), 0); // mid-char → back to 0
    }

    #[test]
    fn test_truncate_diff_with_multibyte() {
        // Ensure no panic with multibyte content near the truncation boundary
        let line = "日本語コメント含むdiff行\n";
        let repeat_count = 100_000 / line.len() + 1;
        let diff = line.repeat(repeat_count);
        let result = truncate_diff(diff);
        assert!(result.contains("[diff truncated"));
    }
}
