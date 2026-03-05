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

use super::types::ReviewRequest;

/// Shared set of targets currently under review (prevents duplicate reviews)
type ActiveReviews = Arc<RwLock<HashSet<String>>>;

/// Service that manages fresh-session code reviews
pub struct ReviewService;

impl ReviewService {
    /// Spawn the review service as a background task.
    ///
    /// Listens for `CoreEvent::AgentStopped` events (auto_launch) and
    /// `CoreEvent::ReviewReady` events (manual trigger) to launch review sessions.
    pub fn spawn(
        settings: Arc<ReviewSettings>,
        state: SharedState,
        mut event_rx: broadcast::Receiver<CoreEvent>,
        event_tx: broadcast::Sender<CoreEvent>,
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

                // Launch review in a separate blocking task
                tokio::task::spawn_blocking(move || {
                    let result = launch_review(&request, &review_settings);

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

                    // Remove from active set
                    let mut reviews = active.write();
                    reviews.remove(&request.target);
                });
            }
        })
    }
}

/// Collect git diff and launch a review session in a new tmux window.
///
/// Returns `(review_target, output_file_path)`.
pub fn launch_review(
    request: &ReviewRequest,
    settings: &ReviewSettings,
) -> Result<(String, std::path::PathBuf)> {
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

    // Output file for review results (sanitize branch name for filesystem)
    let safe_branch = request
        .branch
        .as_deref()
        .unwrap_or("unknown")
        .replace('/', "-");
    let output_file = review_output_dir()?.join(format!("{safe_branch}.md"));

    // Extract session name from the source target (e.g., "main:0.1" → "main")
    let session_name = request.target.split(':').next().unwrap_or("main");

    // Create new tmux window for the review
    let window_name = format!("review-{}", request.branch.as_deref().unwrap_or("unknown"));
    let review_target = tmux
        .new_window(session_name, &request.cwd, Some(&window_name))
        .context("Failed to create review window")?;

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
    let review_cmd = settings
        .agent
        .build_command(&prompt_file, &output_file, feedback.as_ref());
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
        let truncated = &diff[..MAX_DIFF_BYTES];
        // Find the last newline to avoid cutting mid-line
        let cut_point = truncated.rfind('\n').unwrap_or(MAX_DIFF_BYTES);
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
    let path = dir.join(format!("review-{}.txt", timestamp));

    let mut file = std::fs::File::create(&path).context("Failed to create review prompt file")?;
    file.write_all(prompt.as_bytes())
        .context("Failed to write review prompt")?;

    Ok(path)
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
}
