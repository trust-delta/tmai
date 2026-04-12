//! AutoActionExecutor service — consumes `CoreEvent`s and either directly
//! instructs a target worker via a `PromptReady` event, or emits
//! `GuardrailExceeded` when retry limits are reached.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::broadcast;
use tracing::{debug, info, warn};

/// Pinned, boxed future returning `Option<String>` — used as the return type
/// of `GithubApi` methods so the trait stays dyn-compatible without dragging
/// in `async-trait` as a dependency.
pub type GhFuture<'a> = Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>>;

use crate::agents::MonitoredAgent;
use crate::api::{CoreEvent, GuardrailKind};
use crate::config::{EventHandling, OrchestratorNotifySettings};
use crate::orchestrator_notify::SharedNotifySettings;
use crate::state::SharedState;
use crate::task_meta::{store as meta_store, SharedGuardrailsSettings};

use super::resolver::{find_agent_by_id, is_agent_online, resolve_target_agent, AgentRole};
use super::templates::{render, AutoActionTemplates};
use super::tracker::AutoActionTracker;

/// Abstraction over the subset of GitHub APIs AutoActionExecutor uses,
/// injected so integration tests can stub out real `gh` invocations.
pub trait GithubApi: Send + Sync + 'static {
    /// Fetch the failure log text for the most recent failed CI run on `branch`.
    /// Returns `None` if no failed run is found or the log can't be fetched.
    fn fetch_ci_failure_log<'a>(&'a self, repo_dir: &'a str, branch: &'a str) -> GhFuture<'a>;

    /// Fetch review / conversation comments on `pr_number`, joined as human-readable text.
    fn fetch_pr_comments<'a>(&'a self, repo_dir: &'a str, pr_number: u64) -> GhFuture<'a>;
}

/// Abstraction over `dispatch_review` so AutoActionExecutor can trigger a review-agent
/// dispatch without depending on the bin crate's HTTP handler directly.
///
/// The concrete implementation lives in the bin crate (see `src/main.rs`)
/// and calls the same internal path used by the `/api/review/dispatch` endpoint.
pub trait ReviewDispatcher: Send + Sync + 'static {
    /// Dispatch a review agent for `pr_number` rooted at `cwd` (project root).
    /// Returns a human-readable error string on failure.
    fn dispatch_review<'a>(
        &'a self,
        pr_number: u64,
        cwd: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
}

/// No-op `ReviewDispatcher` — used by tests and as a safe default when no
/// concrete dispatcher is wired (in which case PrCiPassed auto-dispatch is a no-op).
pub struct NoopReviewDispatcher;

impl ReviewDispatcher for NoopReviewDispatcher {
    fn dispatch_review<'a>(
        &'a self,
        _pr_number: u64,
        _cwd: String,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move { Ok(()) })
    }
}

/// Default `GithubApi` implementation that shells out to `gh` via `crate::github`.
pub struct RealGithubApi;

impl GithubApi for RealGithubApi {
    fn fetch_ci_failure_log<'a>(&'a self, repo_dir: &'a str, branch: &'a str) -> GhFuture<'a> {
        Box::pin(async move {
            let summary = crate::github::list_checks(repo_dir, branch).await?;
            let run_id = summary.checks.iter().find_map(|c| {
                let failed = matches!(
                    c.conclusion,
                    Some(crate::github::CiConclusion::Failure)
                        | Some(crate::github::CiConclusion::TimedOut)
                        | Some(crate::github::CiConclusion::Cancelled)
                );
                if failed {
                    c.run_id
                } else {
                    None
                }
            })?;
            let log = crate::github::get_ci_failure_log(repo_dir, run_id).await?;
            Some(log.log_text)
        })
    }

    fn fetch_pr_comments<'a>(&'a self, repo_dir: &'a str, pr_number: u64) -> GhFuture<'a> {
        Box::pin(async move {
            let comments = crate::github::get_pr_comments(repo_dir, pr_number).await?;
            if comments.is_empty() {
                return None;
            }
            let joined = comments
                .iter()
                .map(|c| {
                    let path = c
                        .path
                        .as_deref()
                        .map(|p| format!(" [{p}]"))
                        .unwrap_or_default();
                    format!("- @{}{}: {}", c.author, path, c.body.trim())
                })
                .collect::<Vec<_>>()
                .join("\n");
            Some(joined)
        })
    }
}

/// Event-driven service that, when configured, instructs workers directly
/// in response to `CoreEvent`s — replacing the orchestrator's manual
/// routing for routine CI / review cycles.
pub struct AutoActionExecutor;

impl AutoActionExecutor {
    /// Spawn the executor as a background task.
    ///
    /// Mirrors the lifecycle of `OrchestratorNotifier`: reads settings fresh
    /// on each event, handles `Lagged` gracefully, exits on channel close.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        state: SharedState,
        mut event_rx: broadcast::Receiver<CoreEvent>,
        event_tx: broadcast::Sender<CoreEvent>,
        notify_settings: SharedNotifySettings,
        guardrails: SharedGuardrailsSettings,
        templates: Arc<parking_lot::RwLock<AutoActionTemplates>>,
        github: Arc<dyn GithubApi>,
        review_dispatcher: Arc<dyn ReviewDispatcher>,
    ) -> tokio::task::JoinHandle<()> {
        let tracker = Arc::new(AutoActionTracker::new());

        tokio::spawn(async move {
            loop {
                match event_rx.recv().await {
                    Ok(event) => {
                        let ns = notify_settings.read().clone();
                        Self::handle_event(
                            &state,
                            &event_tx,
                            &ns,
                            &guardrails,
                            &templates,
                            &tracker,
                            github.as_ref(),
                            review_dispatcher.as_ref(),
                            &event,
                        )
                        .await;
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        debug!(skipped = n, "AutoActionExecutor lagged, skipping events");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Event channel closed, stopping AutoActionExecutor");
                        break;
                    }
                }
            }
        })
    }

    /// Handle one event.  Exposed `pub(crate)` so integration tests can drive
    /// the dispatcher without spinning up the background task.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn handle_event(
        state: &SharedState,
        event_tx: &broadcast::Sender<CoreEvent>,
        notify: &OrchestratorNotifySettings,
        guardrails: &SharedGuardrailsSettings,
        templates: &Arc<parking_lot::RwLock<AutoActionTemplates>>,
        tracker: &Arc<AutoActionTracker>,
        github: &dyn GithubApi,
        review_dispatcher: &dyn ReviewDispatcher,
        event: &CoreEvent,
    ) {
        match event {
            CoreEvent::PrCiFailed {
                pr_number,
                title,
                failed_details,
            } => {
                if notify.on_ci_failed != EventHandling::AutoAction {
                    return;
                }
                Self::handle_ci_failed(
                    state,
                    event_tx,
                    guardrails,
                    templates,
                    tracker,
                    github,
                    *pr_number,
                    title,
                    failed_details,
                )
                .await;
            }

            CoreEvent::PrReviewFeedback {
                pr_number,
                title,
                comments_summary,
            } => {
                if notify.on_pr_comment != EventHandling::AutoAction {
                    return;
                }
                Self::handle_review_feedback(
                    state,
                    event_tx,
                    guardrails,
                    templates,
                    tracker,
                    github,
                    *pr_number,
                    title,
                    comments_summary,
                )
                .await;
            }

            CoreEvent::PrCiPassed {
                pr_number,
                title,
                checks_summary: _,
            } => {
                if notify.on_ci_passed != EventHandling::AutoAction {
                    return;
                }
                Self::handle_pr_ci_passed(
                    state,
                    event_tx,
                    guardrails,
                    tracker,
                    github,
                    review_dispatcher,
                    *pr_number,
                    title,
                )
                .await;
            }

            CoreEvent::PrClosed {
                pr_number, branch, ..
            } => {
                tracker.reset_ci(branch);
                tracker.reset_review(*pr_number);
            }

            _ => {}
        }
    }

    /// Handle `PrCiPassed` as AutoAction: if the PR has no existing reviewer
    /// and no review comments yet, dispatch a new reviewer via the injected
    /// `ReviewDispatcher`. Respects `max_review_loops` guardrail.
    #[allow(clippy::too_many_arguments)]
    async fn handle_pr_ci_passed(
        state: &SharedState,
        event_tx: &broadcast::Sender<CoreEvent>,
        guardrails: &SharedGuardrailsSettings,
        tracker: &Arc<AutoActionTracker>,
        github: &dyn GithubApi,
        review_dispatcher: &dyn ReviewDispatcher,
        pr_number: u64,
        title: &str,
    ) {
        // Resolve project root + branch + meta from task-meta files
        let Some((project_root, branch, meta)) = resolve_meta_for_pr(state, pr_number) else {
            warn!(
                pr = pr_number,
                "AutoAction: no task-meta found for PrCiPassed; skipping auto-dispatch"
            );
            return;
        };

        // Skip if an existing reviewer is still active for this PR
        if let Some(rid) = &meta.review_agent_id {
            let agents = snapshot_agents(state);
            if let Some(agent) = find_agent_by_id(&agents, rid) {
                if is_agent_online(agent) {
                    info!(
                        pr = pr_number,
                        reviewer = %rid,
                        "AutoAction: existing reviewer active — skip auto-dispatch"
                    );
                    return;
                }
            }
        }

        // Skip if the PR already has review comments (human or bot)
        if github
            .fetch_pr_comments(project_root_str(&project_root), pr_number)
            .await
            .is_some()
        {
            info!(
                pr = pr_number,
                "AutoAction: PR already has review comments — skip auto-dispatch"
            );
            return;
        }

        // Guardrail: cap review dispatches by review_loops limit
        let count = tracker.increment_review(pr_number);
        let limit = guardrails.read().max_review_loops;
        if count > limit {
            info!(
                pr = pr_number,
                count, limit, "AutoAction: review dispatch limit exceeded — halting and escalating"
            );
            let _ = event_tx.send(CoreEvent::GuardrailExceeded {
                guardrail: GuardrailKind::ReviewLoops,
                branch: branch.clone(),
                pr_number: Some(pr_number),
                count,
                limit,
            });
            return;
        }

        // Dispatch
        info!(
            pr = pr_number,
            title = title,
            cwd = %project_root.display(),
            "AutoAction: dispatching reviewer for PrCiPassed"
        );
        let cwd = project_root.to_string_lossy().to_string();
        if let Err(e) = review_dispatcher.dispatch_review(pr_number, cwd).await {
            warn!(
                pr = pr_number,
                error = %e,
                "AutoAction: dispatch_review failed"
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn handle_ci_failed(
        state: &SharedState,
        event_tx: &broadcast::Sender<CoreEvent>,
        guardrails: &SharedGuardrailsSettings,
        templates: &Arc<parking_lot::RwLock<AutoActionTemplates>>,
        tracker: &Arc<AutoActionTracker>,
        github: &dyn GithubApi,
        pr_number: u64,
        title: &str,
        failed_details: &str,
    ) {
        // Resolve branch + project root from state / task-meta
        let Some((project_root, branch)) = resolve_branch_for_pr(state, pr_number) else {
            warn!(
                pr = pr_number,
                "AutoAction: no branch/project resolved for PrCiFailed; skipping"
            );
            return;
        };

        // Resolve target implementer
        let agents = snapshot_agents(state);
        let Some(target) =
            resolve_target_agent(&project_root, &branch, AgentRole::Implementer, &agents)
        else {
            warn!(
                pr = pr_number,
                branch = %branch,
                "AutoAction: no implementer agent resolved — falling back to orchestrator notify"
            );
            fallback_notify(
                event_tx,
                format!(
                    "[tmai AutoAction fallback] CI failed on PR #{pr_number} ({title}, branch {branch}) \
                     but no implementer agent was found. Please re-dispatch or intervene."
                ),
                format!("pr-{pr_number}"),
            );
            return;
        };

        // Offline-fallback
        if let Some(agent) = find_agent_by_id(&agents, &target) {
            if !is_agent_online(agent) {
                warn!(
                    pr = pr_number,
                    target = %target,
                    "AutoAction: target implementer offline — falling back to orchestrator notify"
                );
                fallback_notify(
                    event_tx,
                    format!(
                        "[tmai AutoAction fallback] CI failed on PR #{pr_number} ({title}, branch {branch}). \
                         Implementer agent \"{target}\" is offline."
                    ),
                    format!("pr-{pr_number}"),
                );
                return;
            }
        }

        // Guardrail check
        let count = tracker.increment_ci(&branch);
        let limit = guardrails.read().max_ci_retries;
        if count > limit {
            info!(
                branch = %branch,
                count,
                limit,
                "AutoAction: CI retries limit exceeded — halting and escalating"
            );
            let _ = event_tx.send(CoreEvent::GuardrailExceeded {
                guardrail: GuardrailKind::CiRetries,
                branch: branch.clone(),
                pr_number: Some(pr_number),
                count,
                limit,
            });
            return;
        }

        // Enrich failure details with the failure log when available
        let detailed = match github
            .fetch_ci_failure_log(project_root_str(&project_root), &branch)
            .await
        {
            Some(log) => {
                if log.trim().is_empty() {
                    failed_details.to_string()
                } else {
                    format!("{failed_details}\n\n--- CI log ---\n{log}")
                }
            }
            None => failed_details.to_string(),
        };

        let tpl = templates.read().effective_ci_failed();
        let pr_str = pr_number.to_string();
        let prompt = render(
            &tpl,
            &[
                ("pr_number", pr_str.as_str()),
                ("title", title),
                ("branch", branch.as_str()),
                ("failed_details", detailed.as_str()),
            ],
        );

        info!(
            pr = pr_number,
            target = %target,
            "AutoAction: dispatching CiFailed guidance to implementer"
        );
        let _ = event_tx.send(CoreEvent::PromptReady { target, prompt });
    }

    #[allow(clippy::too_many_arguments)]
    async fn handle_review_feedback(
        state: &SharedState,
        event_tx: &broadcast::Sender<CoreEvent>,
        guardrails: &SharedGuardrailsSettings,
        templates: &Arc<parking_lot::RwLock<AutoActionTemplates>>,
        tracker: &Arc<AutoActionTracker>,
        github: &dyn GithubApi,
        pr_number: u64,
        title: &str,
        comments_summary: &str,
    ) {
        let Some((project_root, branch)) = resolve_branch_for_pr(state, pr_number) else {
            warn!(
                pr = pr_number,
                "AutoAction: no branch/project resolved for PrReviewFeedback; skipping"
            );
            return;
        };

        let agents = snapshot_agents(state);
        let Some(target) =
            resolve_target_agent(&project_root, &branch, AgentRole::Implementer, &agents)
        else {
            warn!(
                pr = pr_number,
                branch = %branch,
                "AutoAction: no implementer agent resolved for review feedback — fallback"
            );
            fallback_notify(
                event_tx,
                format!(
                    "[tmai AutoAction fallback] Review feedback on PR #{pr_number} ({title}) \
                     but no implementer agent was found. Please re-dispatch or intervene."
                ),
                format!("pr-{pr_number}"),
            );
            return;
        };

        if let Some(agent) = find_agent_by_id(&agents, &target) {
            if !is_agent_online(agent) {
                warn!(
                    pr = pr_number,
                    target = %target,
                    "AutoAction: target implementer offline for review feedback — fallback"
                );
                fallback_notify(
                    event_tx,
                    format!(
                        "[tmai AutoAction fallback] Review feedback on PR #{pr_number} ({title}). \
                         Implementer agent \"{target}\" is offline."
                    ),
                    format!("pr-{pr_number}"),
                );
                return;
            }
        }

        let count = tracker.increment_review(pr_number);
        let limit = guardrails.read().max_review_loops;
        if count > limit {
            info!(
                pr = pr_number,
                count, limit, "AutoAction: review-loop limit exceeded — halting and escalating"
            );
            let _ = event_tx.send(CoreEvent::GuardrailExceeded {
                guardrail: GuardrailKind::ReviewLoops,
                branch: branch.clone(),
                pr_number: Some(pr_number),
                count,
                limit,
            });
            return;
        }

        // Fetch the full comment text (falls back to summary)
        let full = github
            .fetch_pr_comments(project_root_str(&project_root), pr_number)
            .await
            .unwrap_or_else(|| comments_summary.to_string());

        let tpl = templates.read().effective_review_feedback();
        let pr_str = pr_number.to_string();
        let prompt = render(
            &tpl,
            &[
                ("pr_number", pr_str.as_str()),
                ("title", title),
                ("branch", branch.as_str()),
                ("comments_summary", full.as_str()),
            ],
        );

        info!(
            pr = pr_number,
            target = %target,
            "AutoAction: dispatching review-feedback guidance to implementer"
        );
        let _ = event_tx.send(CoreEvent::PromptReady { target, prompt });
    }
}

/// Snapshot currently-tracked agents (clone out of the lock).
fn snapshot_agents(state: &SharedState) -> Vec<MonitoredAgent> {
    state.read().agents.values().cloned().collect()
}

/// Resolve `(project_root, branch)` for a PR by consulting in-memory agents
/// first (fast path), then persisted `.task-meta/` files (fallback).
fn resolve_branch_for_pr(state: &SharedState, pr_number: u64) -> Option<(PathBuf, String)> {
    let (branch_from_agent, project_roots) = {
        let s = state.read();
        let branch = s
            .agents
            .values()
            .find(|a| a.pr_number == Some(pr_number))
            .and_then(|a| a.git_branch.clone());
        let roots: Vec<PathBuf> = s.registered_projects.iter().map(PathBuf::from).collect();
        (branch, roots)
    };

    if project_roots.is_empty() {
        return None;
    }

    if let Some(branch) = branch_from_agent {
        // Prefer the project root whose .task-meta/ has this branch; else first
        for root in &project_roots {
            if meta_store::read_meta(root, &branch).is_some() {
                return Some((root.clone(), branch));
            }
        }
        return Some((project_roots[0].clone(), branch));
    }

    // Fallback: scan task-meta files for a matching pr number
    for root in &project_roots {
        for (branch, meta) in meta_store::scan_all(root) {
            if meta.pr == Some(pr_number) {
                return Some((root.clone(), branch));
            }
        }
    }

    None
}

/// Resolve `(project_root, branch, meta)` for a PR. Prefers a live agent's
/// branch (when known) but ultimately scans task-meta files across registered
/// projects for the first entry with a matching `pr` field.
fn resolve_meta_for_pr(
    state: &SharedState,
    pr_number: u64,
) -> Option<(PathBuf, String, crate::task_meta::store::TaskMeta)> {
    let (branch_from_agent, project_roots) = {
        let s = state.read();
        let branch = s
            .agents
            .values()
            .find(|a| a.pr_number == Some(pr_number))
            .and_then(|a| a.git_branch.clone());
        let roots: Vec<PathBuf> = s.registered_projects.iter().map(PathBuf::from).collect();
        (branch, roots)
    };

    if project_roots.is_empty() {
        return None;
    }

    if let Some(branch) = branch_from_agent {
        for root in &project_roots {
            if let Some(meta) = meta_store::read_meta(root, &branch) {
                if meta.pr == Some(pr_number) {
                    return Some((root.clone(), branch, meta));
                }
            }
        }
    }

    for root in &project_roots {
        if let Some((branch, meta)) = meta_store::find_by_pr(root, pr_number) {
            return Some((root.clone(), branch, meta));
        }
    }

    None
}

fn project_root_str(p: &Path) -> &str {
    p.to_str().unwrap_or("")
}

/// Emit a synthetic notification so the orchestrator learns about a fallback.
///
/// We intentionally do NOT re-route the original event here — that would
/// double-count against guardrails.  Instead we emit a plain `PromptReady`
/// with a short explanation, addressed at a pseudo-target that any attached
/// notifier / WebUI tail can surface.
fn fallback_notify(
    event_tx: &broadcast::Sender<CoreEvent>,
    message: String,
    pseudo_target: String,
) {
    let _ = event_tx.send(CoreEvent::PromptReady {
        target: pseudo_target,
        prompt: message,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType, MonitoredAgent};
    use crate::config::GuardrailsSettings;
    use crate::state::AppState;
    use crate::task_meta::store::TaskMeta;
    use std::sync::Mutex;

    // ── Test doubles ────────────────────────────────────────────────

    #[derive(Default)]
    struct StubGithub {
        ci_log: Mutex<Option<String>>,
        pr_comments: Mutex<Option<String>>,
    }

    #[derive(Default)]
    struct StubDispatcher {
        calls: Mutex<Vec<(u64, String)>>,
        fail: Mutex<bool>,
    }

    impl ReviewDispatcher for StubDispatcher {
        fn dispatch_review<'a>(
            &'a self,
            pr_number: u64,
            cwd: String,
        ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
            let fail = *self.fail.lock().unwrap();
            self.calls.lock().unwrap().push((pr_number, cwd));
            Box::pin(async move {
                if fail {
                    Err("forced failure".into())
                } else {
                    Ok(())
                }
            })
        }
    }

    impl GithubApi for StubGithub {
        fn fetch_ci_failure_log<'a>(
            &'a self,
            _repo_dir: &'a str,
            _branch: &'a str,
        ) -> GhFuture<'a> {
            let v = self.ci_log.lock().unwrap().clone();
            Box::pin(async move { v })
        }
        fn fetch_pr_comments<'a>(&'a self, _repo_dir: &'a str, _pr_number: u64) -> GhFuture<'a> {
            let v = self.pr_comments.lock().unwrap().clone();
            Box::pin(async move { v })
        }
    }

    fn insert_agent(
        state: &SharedState,
        target: &str,
        branch: &str,
        pr: Option<u64>,
        status: AgentStatus,
    ) -> String {
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
        let stable_id = agent.stable_id.clone();
        s.agents.insert(target.to_string(), agent);
        stable_id
    }

    fn make_harness(
        state: &SharedState,
        root: &Path,
    ) -> (
        broadcast::Sender<CoreEvent>,
        broadcast::Receiver<CoreEvent>,
        SharedGuardrailsSettings,
        Arc<parking_lot::RwLock<AutoActionTemplates>>,
        Arc<AutoActionTracker>,
    ) {
        {
            let mut s = state.write();
            s.registered_projects = vec![root.to_string_lossy().to_string()];
        }
        let (tx, rx) = broadcast::channel(32);
        let g = Arc::new(parking_lot::RwLock::new(GuardrailsSettings::default()));
        let t = Arc::new(parking_lot::RwLock::new(AutoActionTemplates::defaults()));
        let tr = Arc::new(AutoActionTracker::new());
        (tx, rx, g, t, tr)
    }

    fn settings_with(
        on_ci_failed: EventHandling,
        on_pr_comment: EventHandling,
    ) -> OrchestratorNotifySettings {
        let mut s = OrchestratorNotifySettings::default();
        s.on_ci_failed = on_ci_failed;
        s.on_pr_comment = on_pr_comment;
        s
    }

    async fn drain(rx: &mut broadcast::Receiver<CoreEvent>) -> Vec<CoreEvent> {
        let mut out = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            out.push(ev);
        }
        out
    }

    // ── CiFailed ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_ci_failed_autoaction_emits_prompt() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        insert_agent(&state, "main:0.1", "feat/x", Some(10), AgentStatus::Idle);
        let meta = TaskMeta::for_issue(10, Some("main:0.1".into()));
        meta_store::write_meta(dir.path(), "feat/x", &meta).unwrap();

        let (tx, mut rx, g, tpl, tr) = make_harness(&state, dir.path());
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        *gh.ci_log.lock().unwrap() = Some("=== pytest failed ===".to_string());
        let ns = settings_with(EventHandling::AutoAction, EventHandling::NotifyOrchestrator);

        let event = CoreEvent::PrCiFailed {
            pr_number: 10,
            title: "Add feature".into(),
            failed_details: "1/3 checks failed".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        let events = drain(&mut rx).await;
        let prompt = events
            .iter()
            .find_map(|e| match e {
                CoreEvent::PromptReady { target, prompt } => Some((target.clone(), prompt.clone())),
                _ => None,
            })
            .expect("PromptReady emitted");
        assert_eq!(prompt.0, "main:0.1");
        assert!(prompt.1.contains("PR #10"));
        assert!(prompt.1.contains("feat/x"));
        assert!(prompt.1.contains("pytest failed"));
    }

    #[tokio::test]
    async fn test_ci_failed_notify_mode_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        insert_agent(&state, "main:0.1", "feat/x", Some(10), AgentStatus::Idle);
        let meta = TaskMeta::for_issue(10, Some("main:0.1".into()));
        meta_store::write_meta(dir.path(), "feat/x", &meta).unwrap();

        let (tx, mut rx, g, tpl, tr) = make_harness(&state, dir.path());
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with(EventHandling::NotifyOrchestrator, EventHandling::AutoAction);

        let event = CoreEvent::PrCiFailed {
            pr_number: 10,
            title: "x".into(),
            failed_details: "d".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        let events = drain(&mut rx).await;
        assert!(
            events
                .iter()
                .all(|e| !matches!(e, CoreEvent::PromptReady { .. })),
            "no PromptReady when event is NotifyOrchestrator mode"
        );
    }

    #[tokio::test]
    async fn test_ci_failed_offline_agent_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        insert_agent(&state, "main:0.1", "feat/x", Some(10), AgentStatus::Offline);
        let meta = TaskMeta::for_issue(10, Some("main:0.1".into()));
        meta_store::write_meta(dir.path(), "feat/x", &meta).unwrap();

        let (tx, mut rx, g, tpl, tr) = make_harness(&state, dir.path());
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with(EventHandling::AutoAction, EventHandling::AutoAction);

        let event = CoreEvent::PrCiFailed {
            pr_number: 10,
            title: "x".into(),
            failed_details: "d".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        let events = drain(&mut rx).await;
        let fallback = events.iter().find_map(|e| match e {
            CoreEvent::PromptReady { prompt, .. } => Some(prompt.clone()),
            _ => None,
        });
        assert!(
            fallback.unwrap_or_default().contains("offline"),
            "offline fallback notification emitted"
        );
    }

    #[tokio::test]
    async fn test_ci_failed_guardrail_exceeded() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        insert_agent(&state, "main:0.1", "feat/x", Some(10), AgentStatus::Idle);
        let meta = TaskMeta::for_issue(10, Some("main:0.1".into()));
        meta_store::write_meta(dir.path(), "feat/x", &meta).unwrap();

        let (tx, mut rx, g, tpl, tr) = make_harness(&state, dir.path());
        g.write().max_ci_retries = 2;
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with(EventHandling::AutoAction, EventHandling::NotifyOrchestrator);

        let event = CoreEvent::PrCiFailed {
            pr_number: 10,
            title: "x".into(),
            failed_details: "d".into(),
        };

        // Under limit: 2 prompts
        for _ in 0..2 {
            AutoActionExecutor::handle_event(
                &state,
                &tx,
                &ns,
                &g,
                &tpl,
                &tr,
                gh.as_ref(),
                dispatcher.as_ref(),
                &event,
            )
            .await;
        }
        // 3rd exceeds
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        let events = drain(&mut rx).await;
        let prompts = events
            .iter()
            .filter(|e| matches!(e, CoreEvent::PromptReady { .. }))
            .count();
        let guardrails = events
            .iter()
            .filter(|e| matches!(e, CoreEvent::GuardrailExceeded { .. }))
            .count();
        assert_eq!(prompts, 2);
        assert_eq!(guardrails, 1);

        // Further triggers remain halted
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;
        let events = drain(&mut rx).await;
        assert!(events
            .iter()
            .all(|e| !matches!(e, CoreEvent::PromptReady { .. })));
    }

    // ── ReviewFeedback ──────────────────────────────────────────────

    #[tokio::test]
    async fn test_review_feedback_autoaction_emits_prompt() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        insert_agent(&state, "main:0.2", "feat/y", Some(11), AgentStatus::Idle);
        let meta = TaskMeta::for_issue(11, Some("main:0.2".into()));
        meta_store::write_meta(dir.path(), "feat/y", &meta).unwrap();

        let (tx, mut rx, g, tpl, tr) = make_harness(&state, dir.path());
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        *gh.pr_comments.lock().unwrap() = Some("- @alice: please rename foo".to_string());
        let ns = settings_with(EventHandling::NotifyOrchestrator, EventHandling::AutoAction);

        let event = CoreEvent::PrReviewFeedback {
            pr_number: 11,
            title: "Y".into(),
            comments_summary: "1 comment".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        let events = drain(&mut rx).await;
        let (target, prompt) = events
            .iter()
            .find_map(|e| match e {
                CoreEvent::PromptReady { target, prompt } => Some((target.clone(), prompt.clone())),
                _ => None,
            })
            .expect("PromptReady emitted");
        assert_eq!(target, "main:0.2");
        assert!(prompt.contains("alice"));
        assert!(prompt.contains("PR #11"));
    }

    #[tokio::test]
    async fn test_review_feedback_guardrail_exceeded() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        insert_agent(&state, "main:0.2", "feat/y", Some(11), AgentStatus::Idle);
        let meta = TaskMeta::for_issue(11, Some("main:0.2".into()));
        meta_store::write_meta(dir.path(), "feat/y", &meta).unwrap();

        let (tx, mut rx, g, tpl, tr) = make_harness(&state, dir.path());
        g.write().max_review_loops = 1;
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with(EventHandling::NotifyOrchestrator, EventHandling::AutoAction);

        let event = CoreEvent::PrReviewFeedback {
            pr_number: 11,
            title: "Y".into(),
            comments_summary: "c".into(),
        };

        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        let events = drain(&mut rx).await;
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, CoreEvent::PromptReady { .. }))
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(
                    e,
                    CoreEvent::GuardrailExceeded {
                        guardrail: GuardrailKind::ReviewLoops,
                        ..
                    }
                ))
                .count(),
            1
        );
    }

    // ── PrClosed reset ──────────────────────────────────────────────

    #[tokio::test]
    async fn test_pr_closed_resets_trackers() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        let (tx, _rx, g, tpl, tr) = make_harness(&state, dir.path());

        tr.increment_ci("feat/z");
        tr.increment_review(42);
        assert_eq!(tr.ci_count("feat/z"), 1);
        assert_eq!(tr.review_count(42), 1);

        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with(EventHandling::AutoAction, EventHandling::AutoAction);
        let event = CoreEvent::PrClosed {
            pr_number: 42,
            title: "Z".into(),
            branch: "feat/z".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        assert_eq!(tr.ci_count("feat/z"), 0);
        assert_eq!(tr.review_count(42), 0);
    }

    // ── PrCiPassed ──────────────────────────────────────────────────

    fn settings_with_ci_passed(on_ci_passed: EventHandling) -> OrchestratorNotifySettings {
        let mut s = OrchestratorNotifySettings::default();
        s.on_ci_passed = on_ci_passed;
        s
    }

    #[tokio::test]
    async fn test_pr_ci_passed_autoaction_dispatches_review() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        // Task-meta with pr=20 and no review_agent_id
        let mut meta = TaskMeta::for_issue(5, Some("main:0.1".into()));
        meta.pr = Some(20);
        meta_store::write_meta(dir.path(), "feat/a", &meta).unwrap();

        let (tx, mut _rx, g, tpl, tr) = make_harness(&state, dir.path());
        let gh = Arc::new(StubGithub::default()); // no pr_comments → None
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with_ci_passed(EventHandling::AutoAction);

        let event = CoreEvent::PrCiPassed {
            pr_number: 20,
            title: "T".into(),
            checks_summary: "ok".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        let calls = dispatcher.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, 20);
    }

    #[tokio::test]
    async fn test_pr_ci_passed_skips_when_reviewer_active() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        // Insert an online reviewer agent matched by review_agent_id
        insert_agent(&state, "rev:0.1", "feat/a", Some(21), AgentStatus::Idle);
        let mut meta = TaskMeta::for_issue(6, Some("main:0.1".into()));
        meta.pr = Some(21);
        meta.review_agent_id = Some("rev:0.1".into());
        meta_store::write_meta(dir.path(), "feat/a", &meta).unwrap();

        let (tx, mut _rx, g, tpl, tr) = make_harness(&state, dir.path());
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with_ci_passed(EventHandling::AutoAction);

        let event = CoreEvent::PrCiPassed {
            pr_number: 21,
            title: "T".into(),
            checks_summary: "ok".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        assert!(
            dispatcher.calls.lock().unwrap().is_empty(),
            "should not dispatch when an active reviewer exists"
        );
    }

    #[tokio::test]
    async fn test_pr_ci_passed_skips_when_pr_has_review_comments() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        let mut meta = TaskMeta::for_issue(7, Some("main:0.1".into()));
        meta.pr = Some(22);
        meta_store::write_meta(dir.path(), "feat/a", &meta).unwrap();

        let (tx, mut _rx, g, tpl, tr) = make_harness(&state, dir.path());
        let gh = Arc::new(StubGithub::default());
        *gh.pr_comments.lock().unwrap() = Some("- @bob: nit".to_string());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with_ci_passed(EventHandling::AutoAction);

        let event = CoreEvent::PrCiPassed {
            pr_number: 22,
            title: "T".into(),
            checks_summary: "ok".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        assert!(
            dispatcher.calls.lock().unwrap().is_empty(),
            "should not dispatch when PR already has review comments"
        );
    }

    #[tokio::test]
    async fn test_pr_ci_passed_guardrail_exceeded() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        let mut meta = TaskMeta::for_issue(8, Some("main:0.1".into()));
        meta.pr = Some(23);
        meta_store::write_meta(dir.path(), "feat/a", &meta).unwrap();

        let (tx, mut rx, g, tpl, tr) = make_harness(&state, dir.path());
        g.write().max_review_loops = 1;
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with_ci_passed(EventHandling::AutoAction);

        let event = CoreEvent::PrCiPassed {
            pr_number: 23,
            title: "T".into(),
            checks_summary: "ok".into(),
        };
        // First call dispatches, second exceeds the limit
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        assert_eq!(dispatcher.calls.lock().unwrap().len(), 1);
        let events = drain(&mut rx).await;
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(
                    e,
                    CoreEvent::GuardrailExceeded {
                        guardrail: GuardrailKind::ReviewLoops,
                        ..
                    }
                ))
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn test_pr_ci_passed_notify_mode_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::shared();
        let mut meta = TaskMeta::for_issue(9, Some("main:0.1".into()));
        meta.pr = Some(24);
        meta_store::write_meta(dir.path(), "feat/a", &meta).unwrap();

        let (tx, mut _rx, g, tpl, tr) = make_harness(&state, dir.path());
        let gh = Arc::new(StubGithub::default());
        let dispatcher = Arc::new(StubDispatcher::default());
        let ns = settings_with_ci_passed(EventHandling::NotifyOrchestrator);

        let event = CoreEvent::PrCiPassed {
            pr_number: 24,
            title: "T".into(),
            checks_summary: "ok".into(),
        };
        AutoActionExecutor::handle_event(
            &state,
            &tx,
            &ns,
            &g,
            &tpl,
            &tr,
            gh.as_ref(),
            dispatcher.as_ref(),
            &event,
        )
        .await;

        assert!(
            dispatcher.calls.lock().unwrap().is_empty(),
            "no dispatch when event is NotifyOrchestrator mode"
        );
    }
}
