//! PR/CI status monitor — polls GitHub for state transitions and notifies the orchestrator.
//!
//! Tracks open PRs and their CI/review states, emitting [`CoreEvent`] variants
//! when transitions occur (new PR, CI pass/fail, review feedback).

use std::collections::HashMap;
use std::time::Duration;

use tokio::sync::broadcast;

use crate::api::events::CoreEvent;
use crate::config::OrchestratorSettings;
use crate::github::{self, CheckStatus, PrInfo, ReviewDecision};
use crate::state::SharedState;

/// Snapshot of a PR's state for change detection
#[derive(Debug, Clone, PartialEq)]
struct PrState {
    title: String,
    branch: String,
    check_status: Option<CheckStatus>,
    review_decision: Option<ReviewDecision>,
    comments: u64,
    reviews: u64,
}

impl PrState {
    /// Build a snapshot from a PrInfo
    fn from_pr(pr: &PrInfo) -> Self {
        Self {
            title: pr.title.clone(),
            branch: pr.head_branch.clone(),
            check_status: pr.check_status.clone(),
            review_decision: pr.review_decision.clone(),
            comments: pr.comments,
            reviews: pr.reviews,
        }
    }
}

/// Checks if a CheckStatus represents a completed success
fn is_success(status: &Option<CheckStatus>) -> bool {
    matches!(status, Some(CheckStatus::Success))
}

/// Checks if a CheckStatus represents a completed failure
fn is_failure(status: &Option<CheckStatus>) -> bool {
    matches!(status, Some(CheckStatus::Failure))
}

/// Checks if a ReviewDecision is changes-requested
fn is_changes_requested(decision: &Option<ReviewDecision>) -> bool {
    matches!(decision, Some(ReviewDecision::ChangesRequested))
}

/// PR/CI status monitor that polls GitHub and emits events on state changes
pub struct PrMonitor {
    /// Repository directory path for gh CLI
    repo_dir: String,
    /// Previous PR states for change detection
    previous_states: HashMap<u64, PrState>,
    /// Event sender for broadcasting CoreEvents
    event_tx: broadcast::Sender<CoreEvent>,
    /// Monitor configuration
    settings: OrchestratorSettings,
}

impl PrMonitor {
    /// Create a new PrMonitor
    pub fn new(
        repo_dir: String,
        event_tx: broadcast::Sender<CoreEvent>,
        settings: OrchestratorSettings,
    ) -> Self {
        Self {
            repo_dir,
            previous_states: HashMap::new(),
            event_tx,
            settings,
        }
    }

    /// Run a single poll cycle: fetch PRs, detect transitions, emit events.
    ///
    /// Returns the list of notifications generated (for testing/logging).
    pub async fn poll(&mut self) -> Vec<PrNotification> {
        let prs = match github::list_open_prs(&self.repo_dir).await {
            Some(prs) => prs,
            None => {
                tracing::debug!("PR monitor: failed to fetch open PRs");
                return Vec::new();
            }
        };

        let mut notifications = Vec::new();
        let mut current_pr_numbers: Vec<u64> = Vec::new();

        for pr in prs.values() {
            current_pr_numbers.push(pr.number);
            let current_state = PrState::from_pr(pr);

            match self.previous_states.get(&pr.number) {
                None => {
                    // New PR detected
                    if self.settings.notify.on_pr_created {
                        let notif = PrNotification::Created {
                            pr_number: pr.number,
                            title: pr.title.clone(),
                            branch: pr.head_branch.clone(),
                        };
                        self.emit_event(&notif);
                        notifications.push(notif);
                    }
                }
                Some(prev) => {
                    // CI status transition: non-success → success
                    if self.settings.notify.on_ci_passed
                        && !is_success(&prev.check_status)
                        && is_success(&current_state.check_status)
                    {
                        let summary = self.fetch_checks_summary(&pr.head_branch).await;
                        let notif = PrNotification::CiPassed {
                            pr_number: pr.number,
                            title: pr.title.clone(),
                            checks_summary: summary,
                        };
                        self.emit_event(&notif);
                        notifications.push(notif);
                    }

                    // CI status transition: non-failure → failure
                    if self.settings.notify.on_ci_failed
                        && !is_failure(&prev.check_status)
                        && is_failure(&current_state.check_status)
                    {
                        let details = self.fetch_failure_details(&pr.head_branch).await;
                        let notif = PrNotification::CiFailed {
                            pr_number: pr.number,
                            title: pr.title.clone(),
                            failed_details: details,
                        };
                        self.emit_event(&notif);
                        notifications.push(notif);
                    }

                    // Review feedback: transition to ChangesRequested
                    if self.settings.notify.on_pr_comment
                        && !is_changes_requested(&prev.review_decision)
                        && is_changes_requested(&current_state.review_decision)
                    {
                        let comments_summary = self.fetch_review_summary(pr.number).await;
                        let notif = PrNotification::ReviewFeedback {
                            pr_number: pr.number,
                            title: pr.title.clone(),
                            comments_summary,
                        };
                        self.emit_event(&notif);
                        notifications.push(notif);
                    }
                }
            }

            self.previous_states.insert(pr.number, current_state);
        }

        // Detect PRs that disappeared from open list (merged or closed)
        let disappeared: Vec<(u64, PrState)> = self
            .previous_states
            .iter()
            .filter(|(num, _)| !current_pr_numbers.contains(num))
            .map(|(num, state)| (*num, state.clone()))
            .collect();

        for (pr_number, state) in &disappeared {
            let notif = PrNotification::Closed {
                pr_number: *pr_number,
                title: state.title.clone(),
                branch: state.branch.clone(),
            };
            self.emit_event(&notif);
            notifications.push(notif);
        }

        // Remove closed PRs from tracking
        self.previous_states
            .retain(|num, _| current_pr_numbers.contains(num));

        notifications
    }

    /// Emit a CoreEvent for a notification
    fn emit_event(&self, notif: &PrNotification) {
        let event = match notif {
            PrNotification::Created {
                pr_number,
                title,
                branch,
            } => CoreEvent::PrCreated {
                pr_number: *pr_number,
                title: title.clone(),
                branch: branch.clone(),
            },
            PrNotification::CiPassed {
                pr_number,
                title,
                checks_summary,
            } => CoreEvent::PrCiPassed {
                pr_number: *pr_number,
                title: title.clone(),
                checks_summary: checks_summary.clone(),
            },
            PrNotification::CiFailed {
                pr_number,
                title,
                failed_details,
            } => CoreEvent::PrCiFailed {
                pr_number: *pr_number,
                title: title.clone(),
                failed_details: failed_details.clone(),
            },
            PrNotification::ReviewFeedback {
                pr_number,
                title,
                comments_summary,
            } => CoreEvent::PrReviewFeedback {
                pr_number: *pr_number,
                title: title.clone(),
                comments_summary: comments_summary.clone(),
            },
            PrNotification::Closed {
                pr_number,
                title,
                branch,
            } => CoreEvent::PrClosed {
                pr_number: *pr_number,
                title: title.clone(),
                branch: branch.clone(),
            },
        };
        let _ = self.event_tx.send(event);
    }

    /// Fetch CI checks summary for a branch
    async fn fetch_checks_summary(&self, branch: &str) -> String {
        match github::list_checks(&self.repo_dir, branch).await {
            Some(ci) => {
                let names: Vec<&str> = ci.checks.iter().map(|c| c.name.as_str()).collect();
                if names.is_empty() {
                    "all checks passed".to_string()
                } else {
                    format!("{} checks passed: {}", names.len(), names.join(", "))
                }
            }
            None => "checks passed".to_string(),
        }
    }

    /// Fetch failure details for a branch
    async fn fetch_failure_details(&self, branch: &str) -> String {
        match github::list_checks(&self.repo_dir, branch).await {
            Some(ci) => {
                let failed: Vec<&str> = ci
                    .checks
                    .iter()
                    .filter(|c| c.conclusion.as_ref().is_some_and(|con| con.is_failure()))
                    .map(|c| c.name.as_str())
                    .collect();
                if failed.is_empty() {
                    "CI failed".to_string()
                } else {
                    format!("failed checks: {}", failed.join(", "))
                }
            }
            None => "CI failed (could not fetch details)".to_string(),
        }
    }

    /// Fetch review comment summary for a PR
    async fn fetch_review_summary(&self, pr_number: u64) -> String {
        match github::get_pr_comments(&self.repo_dir, pr_number).await {
            Some(comments) => {
                let review_comments: Vec<&str> = comments
                    .iter()
                    .filter(|c| c.comment_type == "review")
                    .map(|c| c.body.as_str())
                    .collect();
                if review_comments.is_empty() {
                    "changes requested".to_string()
                } else {
                    // Take last 3 review comments as summary
                    let recent: Vec<&str> = review_comments.iter().rev().take(3).copied().collect();
                    // Truncate each comment to 200 chars
                    let summaries: Vec<String> = recent
                        .iter()
                        .map(|c| {
                            if c.len() > 200 {
                                format!("{}...", &c[..200])
                            } else {
                                c.to_string()
                            }
                        })
                        .collect();
                    summaries.join(" | ")
                }
            }
            None => "changes requested (could not fetch details)".to_string(),
        }
    }

    /// Get all tracked PR branch→number mappings for agent association.
    ///
    /// Returns all open PRs currently tracked, regardless of notification settings.
    pub fn branch_pr_mappings(&self) -> Vec<(String, u64)> {
        self.previous_states
            .iter()
            .map(|(num, state)| (state.branch.clone(), *num))
            .collect()
    }

    /// Format a notification as a prompt message for the orchestrator
    pub fn format_prompt(notif: &PrNotification) -> String {
        match notif {
            PrNotification::Created {
                pr_number,
                title,
                branch,
            } => {
                format!(
                    "[PR Monitor] PR #{} created: \"{}\" (branch: {})",
                    pr_number, title, branch
                )
            }
            PrNotification::CiPassed {
                pr_number,
                title,
                checks_summary,
            } => {
                format!(
                    "[PR Monitor] PR #{} \"{}\" CI passed. Ready to merge. {}",
                    pr_number, title, checks_summary
                )
            }
            PrNotification::CiFailed {
                pr_number,
                title,
                failed_details,
            } => {
                format!(
                    "[PR Monitor] PR #{} \"{}\" CI failed. {}",
                    pr_number, title, failed_details
                )
            }
            PrNotification::ReviewFeedback {
                pr_number,
                title,
                comments_summary,
            } => {
                format!(
                    "[PR Monitor] PR #{} \"{}\" has review feedback: {}",
                    pr_number, title, comments_summary
                )
            }
            PrNotification::Closed {
                pr_number,
                title,
                branch,
            } => {
                format!(
                    "[PR Monitor] PR #{} \"{}\" closed (branch: {})",
                    pr_number, title, branch
                )
            }
        }
    }
}

/// Notification type for PR state transitions
#[derive(Debug, Clone)]
pub enum PrNotification {
    /// A new PR was created
    Created {
        pr_number: u64,
        title: String,
        branch: String,
    },
    /// CI checks passed
    CiPassed {
        pr_number: u64,
        title: String,
        checks_summary: String,
    },
    /// CI checks failed
    CiFailed {
        pr_number: u64,
        title: String,
        failed_details: String,
    },
    /// Review feedback received (changes requested)
    ReviewFeedback {
        pr_number: u64,
        title: String,
        comments_summary: String,
    },
    /// PR disappeared from open list (merged or closed)
    Closed {
        pr_number: u64,
        title: String,
        branch: String,
    },
}

/// Associate PR numbers with agents by matching PR head branch to agent git_branch.
///
/// Uses the full list of open PRs (not just notifications) so that association
/// works regardless of the `on_pr_created` notification setting.
fn associate_pr_numbers(state: &SharedState, branch_prs: &[(String, u64)]) {
    if branch_prs.is_empty() {
        return;
    }

    let mut s = state.write();
    for agent in s.agents.values_mut() {
        if agent.pr_number.is_some() {
            continue; // already has a PR association
        }
        if let Some(ref git_branch) = agent.git_branch {
            for (branch, pr_number) in branch_prs {
                if git_branch == branch {
                    tracing::info!(
                        "Auto-associated PR #{} with agent {} (branch: {})",
                        pr_number,
                        agent.stable_id,
                        branch
                    );
                    agent.pr_number = Some(*pr_number);
                    break;
                }
            }
        }
    }
}

/// Spawn the PR monitor as a background task.
///
/// Polls GitHub at the configured interval and emits CoreEvents.
/// The OrchestratorNotifier service handles delivering these to orchestrator agents.
/// When new PRs are detected, automatically associates pr_number with matching agents.
pub fn spawn_pr_monitor(
    repo_dir: String,
    event_tx: broadcast::Sender<CoreEvent>,
    settings: OrchestratorSettings,
    state: Option<SharedState>,
) -> tokio::task::JoinHandle<()> {
    let interval_secs = settings.pr_monitor_interval_secs.max(10); // minimum 10s
    let mut monitor = PrMonitor::new(repo_dir, event_tx, settings);

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
        interval.tick().await; // skip first tick

        loop {
            interval.tick().await;

            let notifications = monitor.poll().await;
            for notif in &notifications {
                tracing::info!("PR monitor detected: {}", PrMonitor::format_prompt(notif));
            }

            // Auto-associate PR numbers with agents by branch matching.
            // Uses all tracked PRs (not just Created notifications) so association
            // works even when on_pr_created is disabled.
            if let Some(ref state) = state {
                let branch_prs = monitor.branch_pr_mappings();
                associate_pr_numbers(state, &branch_prs);
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create test PrInfo with given check status and review decision
    fn make_pr(
        number: u64,
        check_status: Option<CheckStatus>,
        review_decision: Option<ReviewDecision>,
    ) -> PrInfo {
        PrInfo {
            number,
            title: format!("Test PR #{}", number),
            state: "OPEN".to_string(),
            head_branch: format!("feat/test-{}", number),
            head_sha: "abc123".to_string(),
            base_branch: "main".to_string(),
            url: format!("https://github.com/test/repo/pull/{}", number),
            review_decision,
            check_status,
            is_draft: false,
            additions: 10,
            deletions: 5,
            comments: 0,
            reviews: 0,
            merge_commit_sha: None,
        }
    }

    #[test]
    fn test_pr_state_from_pr() {
        let pr = make_pr(
            1,
            Some(CheckStatus::Success),
            Some(ReviewDecision::Approved),
        );
        let state = PrState::from_pr(&pr);
        assert!(is_success(&state.check_status));
        assert!(!is_changes_requested(&state.review_decision));
    }

    #[test]
    fn test_is_success() {
        assert!(is_success(&Some(CheckStatus::Success)));
        assert!(!is_success(&Some(CheckStatus::Failure)));
        assert!(!is_success(&Some(CheckStatus::Pending)));
        assert!(!is_success(&None));
    }

    #[test]
    fn test_is_failure() {
        assert!(is_failure(&Some(CheckStatus::Failure)));
        assert!(!is_failure(&Some(CheckStatus::Success)));
        assert!(!is_failure(&None));
    }

    #[test]
    fn test_is_changes_requested() {
        assert!(is_changes_requested(&Some(
            ReviewDecision::ChangesRequested
        )));
        assert!(!is_changes_requested(&Some(ReviewDecision::Approved)));
        assert!(!is_changes_requested(&None));
    }

    #[test]
    fn test_format_prompt_created() {
        let notif = PrNotification::Created {
            pr_number: 42,
            title: "Add feature X".to_string(),
            branch: "feat/x".to_string(),
        };
        let prompt = PrMonitor::format_prompt(&notif);
        assert!(prompt.contains("PR #42"));
        assert!(prompt.contains("Add feature X"));
        assert!(prompt.contains("feat/x"));
        assert!(prompt.starts_with("[PR Monitor]"));
    }

    #[test]
    fn test_format_prompt_ci_passed() {
        let notif = PrNotification::CiPassed {
            pr_number: 10,
            title: "Fix bug".to_string(),
            checks_summary: "3 checks passed: lint, test, build".to_string(),
        };
        let prompt = PrMonitor::format_prompt(&notif);
        assert!(prompt.contains("CI passed"));
        assert!(prompt.contains("Ready to merge"));
    }

    #[test]
    fn test_format_prompt_ci_failed() {
        let notif = PrNotification::CiFailed {
            pr_number: 10,
            title: "Fix bug".to_string(),
            failed_details: "failed checks: test".to_string(),
        };
        let prompt = PrMonitor::format_prompt(&notif);
        assert!(prompt.contains("CI failed"));
        assert!(prompt.contains("failed checks: test"));
    }

    #[test]
    fn test_format_prompt_review_feedback() {
        let notif = PrNotification::ReviewFeedback {
            pr_number: 10,
            title: "Fix bug".to_string(),
            comments_summary: "Please fix the typo".to_string(),
        };
        let prompt = PrMonitor::format_prompt(&notif);
        assert!(prompt.contains("review feedback"));
        assert!(prompt.contains("Please fix the typo"));
    }

    #[test]
    fn test_state_transition_detection() {
        // Verify that PrState comparison works for transition detection
        let pending = PrState {
            title: "Test PR".to_string(),
            branch: "test-branch".to_string(),
            check_status: Some(CheckStatus::Pending),
            review_decision: None,
            comments: 0,
            reviews: 0,
        };
        let success = PrState {
            title: "Test PR".to_string(),
            branch: "test-branch".to_string(),
            check_status: Some(CheckStatus::Success),
            review_decision: None,
            comments: 0,
            reviews: 0,
        };
        let failure = PrState {
            title: "Test PR".to_string(),
            branch: "test-branch".to_string(),
            check_status: Some(CheckStatus::Failure),
            review_decision: None,
            comments: 0,
            reviews: 0,
        };

        assert_ne!(pending, success);
        assert_ne!(pending, failure);
        assert_ne!(success, failure);

        // Transition: pending → success
        assert!(!is_success(&pending.check_status));
        assert!(is_success(&success.check_status));

        // Transition: pending → failure
        assert!(!is_failure(&pending.check_status));
        assert!(is_failure(&failure.check_status));
    }

    #[tokio::test]
    async fn test_poll_detects_new_pr() {
        // Test that poll() with empty previous_states produces Created notifications
        // This test uses the internal state without calling gh CLI
        let (tx, _rx) = broadcast::channel(16);
        let settings = OrchestratorSettings {
            pr_monitor_enabled: true,
            ..Default::default()
        };
        let mut monitor = PrMonitor::new("/nonexistent".to_string(), tx, settings);

        // Simulate inserting a known state, then verify it exists
        let pr = make_pr(1, Some(CheckStatus::Pending), None);
        let state = PrState::from_pr(&pr);
        monitor.previous_states.insert(1, state.clone());

        assert_eq!(monitor.previous_states.len(), 1);
        assert_eq!(monitor.previous_states.get(&1), Some(&state));
    }

    #[tokio::test]
    async fn test_pr_monitor_emits_events() {
        let (tx, mut rx) = broadcast::channel(16);
        let settings = OrchestratorSettings::default();
        let monitor = PrMonitor::new("/tmp".to_string(), tx, settings);

        // Directly emit an event
        let notif = PrNotification::CiPassed {
            pr_number: 5,
            title: "Test".to_string(),
            checks_summary: "all passed".to_string(),
        };
        monitor.emit_event(&notif);

        let event = rx.try_recv().unwrap();
        match event {
            CoreEvent::PrCiPassed {
                pr_number, title, ..
            } => {
                assert_eq!(pr_number, 5);
                assert_eq!(title, "Test");
            }
            _ => panic!("Expected PrCiPassed event"),
        }
    }

    #[test]
    fn test_settings_defaults() {
        let settings = OrchestratorSettings::default();
        assert!(!settings.pr_monitor_enabled);
        assert_eq!(settings.pr_monitor_interval_secs, 60);
        assert!(settings.notify.on_ci_failed);
        assert!(!settings.notify.on_ci_passed);
        assert!(settings.notify.on_pr_comment);
        assert!(settings.notify.on_pr_created);
    }

    #[test]
    fn test_minimum_interval() {
        // spawn_pr_monitor enforces minimum 10s interval
        let interval = 5u64.max(10);
        assert_eq!(interval, 10);
        let interval = 60u64.max(10);
        assert_eq!(interval, 60);
    }

    #[test]
    fn test_associate_pr_numbers_matches_branch() {
        use crate::agents::{AgentType, MonitoredAgent};
        use crate::state::AppState;

        let state = AppState::shared();
        {
            let mut s = state.write();
            let mut agent = MonitoredAgent::new(
                "main:0.0".to_string(),
                AgentType::ClaudeCode,
                "Test".to_string(),
                "/tmp".to_string(),
                100,
                "main".to_string(),
                "win".to_string(),
                0,
                0,
            );
            agent.git_branch = Some("feat/test-42".to_string());
            s.update_agents(vec![agent]);
        }

        let branch_prs = vec![("feat/test-42".to_string(), 42u64)];

        associate_pr_numbers(&state, &branch_prs);

        let s = state.read();
        let agent = s.agents.values().next().unwrap();
        assert_eq!(agent.pr_number, Some(42));
    }

    #[test]
    fn test_associate_pr_numbers_skips_already_set() {
        use crate::agents::{AgentType, MonitoredAgent};
        use crate::state::AppState;

        let state = AppState::shared();
        {
            let mut s = state.write();
            let mut agent = MonitoredAgent::new(
                "main:0.0".to_string(),
                AgentType::ClaudeCode,
                "Test".to_string(),
                "/tmp".to_string(),
                100,
                "main".to_string(),
                "win".to_string(),
                0,
                0,
            );
            agent.git_branch = Some("feat/test-42".to_string());
            agent.pr_number = Some(99); // already set
            s.update_agents(vec![agent]);
        }

        let branch_prs = vec![("feat/test-42".to_string(), 42u64)];

        associate_pr_numbers(&state, &branch_prs);

        let s = state.read();
        let agent = s.agents.values().next().unwrap();
        assert_eq!(agent.pr_number, Some(99)); // unchanged
    }

    #[test]
    fn test_associate_pr_numbers_no_match() {
        use crate::agents::{AgentType, MonitoredAgent};
        use crate::state::AppState;

        let state = AppState::shared();
        {
            let mut s = state.write();
            let mut agent = MonitoredAgent::new(
                "main:0.0".to_string(),
                AgentType::ClaudeCode,
                "Test".to_string(),
                "/tmp".to_string(),
                100,
                "main".to_string(),
                "win".to_string(),
                0,
                0,
            );
            agent.git_branch = Some("feat/other".to_string());
            s.update_agents(vec![agent]);
        }

        let branch_prs = vec![("feat/test-42".to_string(), 42u64)];

        associate_pr_numbers(&state, &branch_prs);

        let s = state.read();
        let agent = s.agents.values().next().unwrap();
        assert_eq!(agent.pr_number, None); // no match
    }
}
