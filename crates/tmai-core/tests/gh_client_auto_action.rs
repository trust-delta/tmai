//! Cross-module integration test for [`tmai_core::github::GhClient`].
//!
//! Demonstrates that the trait seam is publicly usable from outside the crate:
//! a consumer can inject a [`MockGhClient`] into [`AutoActionExecutor::spawn`]
//! without any privileged access, exercising the PR-CI-failed flow end-to-end
//! through the real background task plumbing.
//!
//! Added for #447 (refactor: extract GhClient trait). Before the refactor the
//! only way to drive `handle_ci_failed` against a fake GitHub was via the
//! narrow `GithubApi` adapter defined inside `auto_action`; that lived behind
//! module-private wiring and could not be reused across crates / integration
//! tests.

use std::sync::Arc;
use std::time::Duration;

use tmai_core::agents::{AgentStatus, AgentType, MonitoredAgent};
use tmai_core::api::CoreEvent;
use tmai_core::auto_action::{AutoActionExecutor, AutoActionTemplates, AutoActionTracker};
use tmai_core::config::{EventHandling, GuardrailsSettings, OrchestratorNotifySettings};
use tmai_core::github::{
    CheckStatus, CiCheck, CiConclusion, CiFailureLog, CiRunStatus, CiSummary, MockGhClient,
};
use tmai_core::state::{AppState, SharedState};
use tmai_core::task_meta::store::{write_meta, TaskMeta};
use tokio::sync::broadcast;

fn insert_agent(
    state: &SharedState,
    target: &str,
    branch: &str,
    pr: Option<u64>,
    status: AgentStatus,
) {
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
    agent.status = status;
    agent.git_branch = Some(branch.to_string());
    agent.pr_number = pr;
    s.agents.insert(target.to_string(), agent);
}

fn seed_failing_ci(mock: &MockGhClient, log_text: &str) {
    *mock.list_checks.lock() = Some(CiSummary {
        branch: "feat/x".into(),
        checks: vec![CiCheck {
            name: "test".into(),
            status: CiRunStatus::Completed,
            conclusion: Some(CiConclusion::Failure),
            url: String::new(),
            started_at: None,
            completed_at: None,
            run_id: Some(42),
        }],
        rollup: CheckStatus::Failure,
    });
    *mock.get_ci_failure_log.lock() = Some(CiFailureLog {
        run_id: 42,
        log_text: log_text.to_string(),
    });
}

/// Drive the `AutoActionExecutor` via its public `spawn` entry point and wait
/// for a `PromptReady` to surface, bounded by `timeout`.
async fn collect_prompt_ready(
    rx: &mut broadcast::Receiver<CoreEvent>,
    timeout: Duration,
) -> Option<(String, String)> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(tokio::time::Instant::now())
            .unwrap_or(Duration::from_millis(0));
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Ok(CoreEvent::PromptReady { target, prompt })) => {
                return Some((target, prompt));
            }
            Ok(Ok(_other)) => continue,
            Ok(Err(_recv_err)) => return None,
            Err(_elapsed) => return None,
        }
    }
}

#[tokio::test]
async fn pr_ci_failed_auto_action_uses_mock_gh_log() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::shared();
    insert_agent(&state, "main:0.1", "feat/x", Some(10), AgentStatus::Idle);
    let meta = TaskMeta::for_issue(10, Some("main:0.1".into()));
    write_meta(dir.path(), "feat/x", &meta).unwrap();
    {
        let mut s = state.write();
        s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
    }

    let (tx, mut rx) = broadcast::channel::<CoreEvent>(32);
    let event_rx = tx.subscribe();
    let guardrails = Arc::new(parking_lot::RwLock::new(GuardrailsSettings::default()));
    let templates = Arc::new(parking_lot::RwLock::new(AutoActionTemplates::defaults()));

    let mock = Arc::new(MockGhClient::new());
    seed_failing_ci(&mock, "--- CI LOG EXCERPT ---\nassertion failed at line 42");
    let dispatcher = Arc::new(tmai_core::auto_action::NoopReviewDispatcher);

    let mut notify = OrchestratorNotifySettings::default();
    notify.on_ci_failed = EventHandling::AutoAction;
    let notify_settings = Arc::new(parking_lot::RwLock::new(notify));

    let _handle = AutoActionExecutor::spawn(
        state.clone(),
        event_rx,
        tx.clone(),
        notify_settings,
        guardrails,
        templates,
        mock.clone(),
        dispatcher,
    );

    let event = CoreEvent::PrCiFailed {
        pr_number: 10,
        title: "Add feature".into(),
        failed_details: "1/3 checks failed".into(),
    };
    let _ = tx.send(event);

    let (target, prompt) = collect_prompt_ready(&mut rx, Duration::from_secs(2))
        .await
        .expect("expected PromptReady from AutoActionExecutor");
    assert_eq!(target, "main:0.1");
    // Seeded log must be enriched into the prompt — end-to-end proof the
    // trait seam reaches get_ci_failure_log on a non-concrete client.
    assert!(
        prompt.contains("assertion failed at line 42"),
        "expected seeded CI log in prompt; got: {prompt}"
    );
    assert!(prompt.contains("PR #10"));
    assert!(prompt.contains("feat/x"));
    assert!(prompt.contains("1/3 checks failed"));
}

#[tokio::test]
async fn pr_ci_failed_auto_action_falls_back_without_log() {
    // MockGhClient with no seeded list_checks / get_ci_failure_log: the
    // enrichment path returns None and the prompt falls back to the summary.
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::shared();
    insert_agent(&state, "main:0.2", "feat/y", Some(20), AgentStatus::Idle);
    let meta = TaskMeta::for_issue(20, Some("main:0.2".into()));
    write_meta(dir.path(), "feat/y", &meta).unwrap();
    {
        let mut s = state.write();
        s.registered_projects = vec![dir.path().to_string_lossy().to_string()];
    }

    let (tx, mut rx) = broadcast::channel::<CoreEvent>(32);
    let event_rx = tx.subscribe();
    let guardrails = Arc::new(parking_lot::RwLock::new(GuardrailsSettings::default()));
    let templates = Arc::new(parking_lot::RwLock::new(AutoActionTemplates::defaults()));
    let mock: Arc<MockGhClient> = Arc::new(MockGhClient::new());
    let dispatcher = Arc::new(tmai_core::auto_action::NoopReviewDispatcher);

    let mut notify = OrchestratorNotifySettings::default();
    notify.on_ci_failed = EventHandling::AutoAction;
    let notify_settings = Arc::new(parking_lot::RwLock::new(notify));

    let _handle = AutoActionExecutor::spawn(
        state.clone(),
        event_rx,
        tx.clone(),
        notify_settings,
        guardrails,
        templates,
        mock.clone(),
        dispatcher,
    );

    let _ = tx.send(CoreEvent::PrCiFailed {
        pr_number: 20,
        title: "Fix bug".into(),
        failed_details: "lint failed".into(),
    });

    let (_target, prompt) = collect_prompt_ready(&mut rx, Duration::from_secs(2))
        .await
        .expect("expected PromptReady fallback prompt");
    assert!(
        prompt.contains("lint failed"),
        "fallback summary must appear in prompt when log unavailable; got: {prompt}"
    );
    assert!(!prompt.contains("--- CI log ---"));
}

// `AutoActionTracker` imported for future integration cases; quiet an unused
// warning if only a subset of tests are compiled at once.
#[allow(dead_code)]
fn _tracker_ref() -> Arc<AutoActionTracker> {
    Arc::new(AutoActionTracker::new())
}
