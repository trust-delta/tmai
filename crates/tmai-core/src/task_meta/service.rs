//! Background service that records milestones on CoreEvent changes.
//!
//! Also enforces guardrail limits: when CI failure count, review loop count,
//! or consecutive failure count exceeds the configured threshold, a
//! `GuardrailExceeded` CoreEvent is emitted.

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::api::{CoreEvent, GuardrailKind};
use crate::config::GuardrailsSettings;
use crate::state::SharedState;

use super::store;

/// Shared, hot-reloadable reference to guardrails settings
pub type SharedGuardrailsSettings = Arc<RwLock<GuardrailsSettings>>;

/// Background service that listens to CoreEvents and appends milestones
/// to the corresponding `.task-meta/{branch}.json` files.
pub struct TaskMetaService;

impl TaskMetaService {
    /// Spawn the milestone recording service as a background task.
    ///
    /// Listens for relevant events and appends milestones to task meta files.
    /// Also handles cleanup (deleting meta files) on PrClosed.
    /// When guardrail limits are exceeded, emits `GuardrailExceeded` events.
    pub fn spawn(
        state: SharedState,
        mut event_rx: broadcast::Receiver<CoreEvent>,
        guardrails: SharedGuardrailsSettings,
        event_tx: broadcast::Sender<CoreEvent>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                match event_rx.recv().await {
                    Ok(event) => Self::handle_event(&state, &event, &guardrails, &event_tx),
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        debug!(skipped = n, "TaskMetaService lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Event channel closed, stopping TaskMetaService");
                        break;
                    }
                }
            }
        })
    }

    /// Handle a single event, appending milestones or cleaning up as needed.
    /// Checks guardrail limits after recording CI failure and review feedback milestones.
    fn handle_event(
        state: &SharedState,
        event: &CoreEvent,
        guardrails: &SharedGuardrailsSettings,
        event_tx: &broadcast::Sender<CoreEvent>,
    ) {
        let project_roots = Self::project_roots(state);
        if project_roots.is_empty() {
            return;
        }

        match event {
            CoreEvent::PrCreated {
                pr_number,
                title,
                branch,
            } => {
                let milestone = format!("PR #{pr_number} created: {title}");
                for root in &project_roots {
                    store::update_meta(root, branch, |meta| {
                        meta.pr = Some(*pr_number);
                        meta.add_milestone(&milestone);
                    });
                }
            }

            CoreEvent::PrCiPassed {
                pr_number,
                checks_summary,
                ..
            } => {
                if let Some(branch) = Self::branch_for_pr(state, *pr_number) {
                    let milestone = format!("CI passed (PR #{pr_number}): {checks_summary}");
                    for root in &project_roots {
                        store::append_milestone(root, &branch, &milestone);
                    }
                }
            }

            CoreEvent::PrCiFailed {
                pr_number,
                failed_details,
                ..
            } => {
                if let Some(branch) = Self::branch_for_pr(state, *pr_number) {
                    let milestone = format!("CI failed (PR #{pr_number}): {failed_details}");
                    for root in &project_roots {
                        store::append_milestone(root, &branch, &milestone);
                    }

                    // Check CI retry guardrail
                    let g = guardrails.read().clone();
                    if let Some(meta) = store::read_meta(&project_roots[0], &branch) {
                        let ci_fail_count = count_ci_failures(&meta);
                        if ci_fail_count >= g.max_ci_retries {
                            info!(
                                branch = %branch,
                                count = ci_fail_count,
                                limit = g.max_ci_retries,
                                "CI retries guardrail exceeded"
                            );
                            let _ = event_tx.send(CoreEvent::GuardrailExceeded {
                                guardrail: GuardrailKind::CiRetries,
                                branch: branch.clone(),
                                pr_number: Some(*pr_number),
                                count: ci_fail_count,
                                limit: g.max_ci_retries,
                            });
                        }

                        // Check consecutive failures guardrail
                        let consec = count_consecutive_failures(&meta);
                        if consec >= g.escalate_to_human_after {
                            info!(
                                branch = %branch,
                                count = consec,
                                limit = g.escalate_to_human_after,
                                "Consecutive failures guardrail exceeded"
                            );
                            let _ = event_tx.send(CoreEvent::GuardrailExceeded {
                                guardrail: GuardrailKind::ConsecutiveFailures,
                                branch: branch.clone(),
                                pr_number: Some(*pr_number),
                                count: consec,
                                limit: g.escalate_to_human_after,
                            });
                        }
                    }
                }
            }

            CoreEvent::PrReviewFeedback {
                pr_number,
                comments_summary,
                ..
            } => {
                if let Some(branch) = Self::branch_for_pr(state, *pr_number) {
                    let milestone =
                        format!("Review feedback (PR #{pr_number}): {comments_summary}");
                    for root in &project_roots {
                        store::append_milestone(root, &branch, &milestone);
                    }

                    // Check review loops guardrail
                    let g = guardrails.read().clone();
                    if let Some(meta) = store::read_meta(&project_roots[0], &branch) {
                        let review_count = count_review_loops(&meta);
                        if review_count >= g.max_review_loops {
                            info!(
                                branch = %branch,
                                count = review_count,
                                limit = g.max_review_loops,
                                "Review loops guardrail exceeded"
                            );
                            let _ = event_tx.send(CoreEvent::GuardrailExceeded {
                                guardrail: GuardrailKind::ReviewLoops,
                                branch: branch.clone(),
                                pr_number: Some(*pr_number),
                                count: review_count,
                                limit: g.max_review_loops,
                            });
                        }
                    }
                }
            }

            CoreEvent::AgentStopped { target, .. } => {
                if let Some(branch) = Self::branch_for_agent(state, target) {
                    for root in &project_roots {
                        store::append_milestone(root, &branch, "Agent stopped");
                    }
                }
            }

            CoreEvent::PrClosed { branch, .. } => {
                for root in &project_roots {
                    if let Err(e) = store::delete_meta(root, branch) {
                        warn!(
                            branch = %branch,
                            error = %e,
                            "Failed to delete task meta on PR close"
                        );
                    } else {
                        info!(branch = %branch, "Deleted task meta for closed PR");
                    }
                }
            }

            _ => {}
        }
    }

    /// Get all registered project roots from state.
    fn project_roots(state: &SharedState) -> Vec<PathBuf> {
        let s = state.read();
        s.registered_projects.iter().map(PathBuf::from).collect()
    }

    /// Find the branch associated with a PR number by checking agents in state.
    fn branch_for_pr(state: &SharedState, pr_number: u64) -> Option<String> {
        let s = state.read();
        s.agents
            .values()
            .find(|a| a.pr_number == Some(pr_number))
            .and_then(|a| a.git_branch.clone())
    }

    /// Find the branch associated with an agent target.
    fn branch_for_agent(state: &SharedState, target: &str) -> Option<String> {
        let s = state.read();
        s.agents.get(target).and_then(|a| a.git_branch.clone())
    }
}

/// Count CI failure milestones in a task meta.
pub fn count_ci_failures(meta: &store::TaskMeta) -> u64 {
    meta.milestones
        .iter()
        .filter(|m| m.event.starts_with("CI failed"))
        .count() as u64
}

/// Count review feedback milestones in a task meta.
pub fn count_review_loops(meta: &store::TaskMeta) -> u64 {
    meta.milestones
        .iter()
        .filter(|m| m.event.starts_with("Review feedback"))
        .count() as u64
}

/// Count consecutive failures (CI failure or review feedback) from the end
/// of the milestone history, stopping at the first non-failure event.
pub fn count_consecutive_failures(meta: &store::TaskMeta) -> u64 {
    meta.milestones
        .iter()
        .rev()
        .take_while(|m| m.event.starts_with("CI failed") || m.event.starts_with("Review feedback"))
        .count() as u64
}

/// Restore in-memory issue/PR associations from persisted `.task-meta/` files.
///
/// Called at startup to recover metadata that survived a tmai restart.
/// For each meta file, if the branch matches a running agent, the agent's
/// issue_number and pr_number are restored.
pub fn restore_from_disk(state: &SharedState, project_roots: &[String]) {
    for root in project_roots {
        let metas = store::scan_all(std::path::Path::new(root));
        if metas.is_empty() {
            continue;
        }
        info!(
            project = %root,
            count = metas.len(),
            "Restoring task meta from disk"
        );
        let mut s = state.write();
        for (branch, meta) in &metas {
            // Try to find an agent on this branch and restore its metadata
            let agent_key = s
                .agents
                .iter()
                .find(|(_, a)| a.git_branch.as_deref() == Some(branch.as_str()))
                .map(|(key, _)| key.clone());

            if let Some(key) = agent_key {
                if let Some(agent) = s.agents.get_mut(&key) {
                    if meta.issue.is_some() && agent.issue_number.is_none() {
                        agent.issue_number = meta.issue;
                        debug!(
                            agent = %key,
                            issue = ?meta.issue,
                            "Restored issue_number from task meta"
                        );
                    }
                    if meta.pr.is_some() && agent.pr_number.is_none() {
                        agent.pr_number = meta.pr;
                        debug!(
                            agent = %key,
                            pr = ?meta.pr,
                            "Restored pr_number from task meta"
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType, MonitoredAgent};
    use crate::state::AppState;

    /// Create default guardrails and event channel for tests
    fn test_guardrails_and_tx() -> (SharedGuardrailsSettings, broadcast::Sender<CoreEvent>) {
        let g = Arc::new(RwLock::new(crate::config::GuardrailsSettings::default()));
        let (tx, _) = broadcast::channel(16);
        (g, tx)
    }

    fn insert_agent(state: &SharedState, target: &str, branch: &str, pr: Option<u64>) {
        let mut s = state.write();
        let mut agent = MonitoredAgent::new(
            target.to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/tmp".to_string(),
            0,
            target.to_string(),
            String::new(),
            0,
            0,
        );
        agent.status = AgentStatus::Idle;
        agent.git_branch = Some(branch.to_string());
        agent.pr_number = pr;
        s.agents.insert(target.to_string(), agent);
    }

    #[test]
    fn test_handle_pr_created() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
        }

        // Pre-create a task meta file for the branch
        let meta = store::TaskMeta::for_issue(42, Some("agent-1".into()));
        store::write_meta(dir.path(), "feat/42-auth", &meta).unwrap();

        let event = CoreEvent::PrCreated {
            pr_number: 10,
            title: "Add auth".to_string(),
            branch: "feat/42-auth".to_string(),
        };
        let (g, tx) = test_guardrails_and_tx();
        TaskMetaService::handle_event(&state, &event, &g, &tx);

        let loaded = store::read_meta(dir.path(), "feat/42-auth").unwrap();
        assert_eq!(loaded.pr, Some(10));
        assert!(loaded.milestones.iter().any(|m| m.event.contains("PR #10")));
    }

    #[test]
    fn test_handle_pr_closed_deletes_meta() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
        }

        let meta = store::TaskMeta::for_issue(42, None);
        store::write_meta(dir.path(), "feat/42-auth", &meta).unwrap();
        assert!(store::read_meta(dir.path(), "feat/42-auth").is_some());

        let event = CoreEvent::PrClosed {
            pr_number: 10,
            title: "Add auth".to_string(),
            branch: "feat/42-auth".to_string(),
        };
        let (g, tx) = test_guardrails_and_tx();
        TaskMetaService::handle_event(&state, &event, &g, &tx);

        assert!(store::read_meta(dir.path(), "feat/42-auth").is_none());
    }

    #[test]
    fn test_handle_ci_passed() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
        }
        insert_agent(&state, "worker:0.0", "feat/42-auth", Some(10));

        let meta = store::TaskMeta::for_issue(42, None);
        store::write_meta(dir.path(), "feat/42-auth", &meta).unwrap();

        let event = CoreEvent::PrCiPassed {
            pr_number: 10,
            title: "Add auth".to_string(),
            checks_summary: "3/3 checks passed".to_string(),
        };
        let (g, tx) = test_guardrails_and_tx();
        TaskMetaService::handle_event(&state, &event, &g, &tx);

        let loaded = store::read_meta(dir.path(), "feat/42-auth").unwrap();
        assert!(loaded
            .milestones
            .iter()
            .any(|m| m.event.contains("CI passed")));
    }

    #[test]
    fn test_handle_agent_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
        }
        insert_agent(&state, "worker:0.0", "feat/99-test", None);

        let meta = store::TaskMeta::for_issue(99, None);
        store::write_meta(dir.path(), "feat/99-test", &meta).unwrap();

        let event = CoreEvent::AgentStopped {
            target: "worker:0.0".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: None,
        };
        let (g, tx) = test_guardrails_and_tx();
        TaskMetaService::handle_event(&state, &event, &g, &tx);

        let loaded = store::read_meta(dir.path(), "feat/99-test").unwrap();
        assert!(loaded
            .milestones
            .iter()
            .any(|m| m.event.contains("Agent stopped")));
    }

    #[test]
    fn test_restore_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();

        // Create agent with no metadata
        insert_agent(&state, "worker:0.0", "feat/42-auth", None);

        // Write persisted meta
        let mut meta = store::TaskMeta::for_issue(42, Some("agent-1".into()));
        meta.pr = Some(10);
        store::write_meta(dir.path(), "feat/42-auth", &meta).unwrap();

        // Restore
        restore_from_disk(&state, &[dir.path().to_string_lossy().to_string()]);

        let s = state.read();
        let agent = s.agents.get("worker:0.0").unwrap();
        assert_eq!(agent.issue_number, Some(42));
        assert_eq!(agent.pr_number, Some(10));
    }

    #[test]
    fn test_restore_does_not_overwrite_existing() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();

        // Agent already has metadata
        insert_agent(&state, "worker:0.0", "feat/42-auth", Some(99));
        {
            let mut s = state.write();
            s.agents.get_mut("worker:0.0").unwrap().issue_number = Some(100);
        }

        // Persisted meta has different values
        let mut meta = store::TaskMeta::for_issue(42, None);
        meta.pr = Some(10);
        store::write_meta(dir.path(), "feat/42-auth", &meta).unwrap();

        restore_from_disk(&state, &[dir.path().to_string_lossy().to_string()]);

        let s = state.read();
        let agent = s.agents.get("worker:0.0").unwrap();
        // Should keep existing values
        assert_eq!(agent.issue_number, Some(100));
        assert_eq!(agent.pr_number, Some(99));
    }

    // ── Guardrail counting tests ────────────────────────────

    #[test]
    fn test_count_ci_failures() {
        let mut meta = store::TaskMeta::for_issue(1, None);
        assert_eq!(count_ci_failures(&meta), 0);

        meta.add_milestone("CI failed (PR #10): lint");
        meta.add_milestone("CI passed (PR #10): ok");
        meta.add_milestone("CI failed (PR #10): test");
        assert_eq!(count_ci_failures(&meta), 2);
    }

    #[test]
    fn test_count_review_loops() {
        let mut meta = store::TaskMeta::for_issue(1, None);
        meta.add_milestone("Review feedback (PR #10): fix types");
        meta.add_milestone("CI passed (PR #10): ok");
        meta.add_milestone("Review feedback (PR #10): fix naming");
        assert_eq!(count_review_loops(&meta), 2);
    }

    #[test]
    fn test_count_consecutive_failures() {
        let mut meta = store::TaskMeta::for_issue(1, None);
        meta.add_milestone("CI passed (PR #10): ok");
        meta.add_milestone("CI failed (PR #10): lint");
        meta.add_milestone("Review feedback (PR #10): nit");
        meta.add_milestone("CI failed (PR #10): test");
        // Last 3 milestones are failures
        assert_eq!(count_consecutive_failures(&meta), 3);
    }

    #[test]
    fn test_consecutive_failures_broken_by_pass() {
        let mut meta = store::TaskMeta::for_issue(1, None);
        meta.add_milestone("CI failed (PR #10): a");
        meta.add_milestone("CI passed (PR #10): ok"); // breaks the streak
        meta.add_milestone("CI failed (PR #10): b");
        assert_eq!(count_consecutive_failures(&meta), 1);
    }

    #[test]
    fn test_guardrail_ci_retries_exceeded_emits_event() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
        }
        insert_agent(&state, "worker:0.0", "feat/42-auth", Some(10));

        // Set up meta with 2 CI failures already
        let mut meta = store::TaskMeta::for_issue(42, None);
        meta.add_milestone("CI failed (PR #10): lint");
        meta.add_milestone("CI failed (PR #10): test");
        store::write_meta(dir.path(), "feat/42-auth", &meta).unwrap();

        // Set max_ci_retries = 3
        let g = Arc::new(RwLock::new(crate::config::GuardrailsSettings {
            max_ci_retries: 3,
            ..Default::default()
        }));
        let (tx, mut rx) = broadcast::channel(16);

        // Third CI failure should trigger guardrail
        let event = CoreEvent::PrCiFailed {
            pr_number: 10,
            title: "Add auth".to_string(),
            failed_details: "cargo test failed".to_string(),
        };
        TaskMetaService::handle_event(&state, &event, &g, &tx);

        // Should have emitted a GuardrailExceeded event
        let emitted = rx.try_recv().unwrap();
        match emitted {
            CoreEvent::GuardrailExceeded {
                guardrail,
                branch,
                pr_number,
                count,
                limit,
            } => {
                assert_eq!(guardrail, crate::api::GuardrailKind::CiRetries);
                assert_eq!(branch, "feat/42-auth");
                assert_eq!(pr_number, Some(10));
                assert_eq!(count, 3);
                assert_eq!(limit, 3);
            }
            other => panic!("Expected GuardrailExceeded, got {other:?}"),
        }
    }

    #[test]
    fn test_guardrail_review_loops_exceeded_emits_event() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
        }
        insert_agent(&state, "worker:0.0", "feat/50-api", Some(20));

        // Set up meta with 4 review feedbacks already
        let mut meta = store::TaskMeta::for_issue(50, None);
        for i in 0..4 {
            meta.add_milestone(&format!("Review feedback (PR #20): round {i}"));
        }
        store::write_meta(dir.path(), "feat/50-api", &meta).unwrap();

        let g = Arc::new(RwLock::new(crate::config::GuardrailsSettings {
            max_review_loops: 5,
            ..Default::default()
        }));
        let (tx, mut rx) = broadcast::channel(16);

        // 5th review feedback should trigger guardrail
        let event = CoreEvent::PrReviewFeedback {
            pr_number: 20,
            title: "API endpoints".to_string(),
            comments_summary: "needs more tests".to_string(),
            review_count: 5,
        };
        TaskMetaService::handle_event(&state, &event, &g, &tx);

        let emitted = rx.try_recv().unwrap();
        match emitted {
            CoreEvent::GuardrailExceeded {
                guardrail,
                count,
                limit,
                ..
            } => {
                assert_eq!(guardrail, crate::api::GuardrailKind::ReviewLoops);
                assert_eq!(count, 5);
                assert_eq!(limit, 5);
            }
            other => panic!("Expected GuardrailExceeded, got {other:?}"),
        }
    }

    #[test]
    fn test_guardrail_not_triggered_below_limit() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
        }
        insert_agent(&state, "worker:0.0", "feat/42-auth", Some(10));

        let meta = store::TaskMeta::for_issue(42, None);
        store::write_meta(dir.path(), "feat/42-auth", &meta).unwrap();

        let g = Arc::new(RwLock::new(crate::config::GuardrailsSettings::default()));
        let (tx, mut rx) = broadcast::channel(16);

        // First CI failure — should NOT trigger guardrail (limit=3)
        let event = CoreEvent::PrCiFailed {
            pr_number: 10,
            title: "Add auth".to_string(),
            failed_details: "lint failed".to_string(),
        };
        TaskMetaService::handle_event(&state, &event, &g, &tx);

        assert!(
            rx.try_recv().is_err(),
            "Should not emit GuardrailExceeded below limit"
        );
    }
}
