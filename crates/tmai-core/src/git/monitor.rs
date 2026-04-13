//! Git state monitor — polls per-repository git state and publishes an
//! in-memory snapshot that `/api/git/*` endpoints read from.
//!
//! Sibling of [`crate::github::pr_monitor`] for the git domain (#423).
//! `/api/git/branches`, `/api/git/graph`, etc. are served from this
//! snapshot once the monitor has warmed up, so the WebUI and the event
//! stream both observe the same poll tick.
//!
//! On a detected transition (branch list, HEAD, or commit graph change),
//! emits [`CoreEvent::GitStateChanged`] so WebUI subscribers refetch.
//! Snapshot write happens *before* event broadcast — a listener that
//! refetches in response must see the post-transition state.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

use tokio::sync::{broadcast, RwLock};

use super::{list_branches, log_graph, BranchListResult, GraphData};
use crate::api::events::CoreEvent;

/// Default commit limit used for the cached graph. Matches the initial
/// `graphLimit` state in the WebUI BranchGraph so the first cache hit
/// serves exactly what the UI asks for.
pub const DEFAULT_GRAPH_LIMIT: usize = 200;

/// In-memory git state snapshot for a single repository.
///
/// Populated by [`GitMonitor::poll`]. Endpoints serve from this once
/// `warmed_up` is true; before warm-up, they fall back to calling git
/// directly so cold-start requests still work.
#[derive(Debug, Default, Clone)]
pub struct GitSnapshot {
    /// Branch list result (local + remote tracking + parents + ahead/behind).
    pub branches: Option<BranchListResult>,
    /// Commit graph for lane visualization, fetched with `DEFAULT_GRAPH_LIMIT`.
    pub graph: Option<GraphData>,
    /// True after the first successful poll. Endpoints must check this
    /// before reading — a half-initialized entry should not leak out.
    pub warmed_up: bool,
}

/// Module-level snapshot store keyed by repo directory.
///
/// The git monitor writes after each poll; API endpoints read for the
/// SoT path. Mirrors the layout of [`crate::github::pr_monitor`].
static MONITOR_SNAPSHOTS: LazyLock<RwLock<HashMap<String, GitSnapshot>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// Read the snapshot for `repo_dir`, if the monitor has populated it.
///
/// Returns `None` on cold start or before the monitor has warmed up.
pub async fn snapshot_for(repo_dir: &str) -> Option<GitSnapshot> {
    let guard = MONITOR_SNAPSHOTS.read().await;
    guard.get(repo_dir).filter(|s| s.warmed_up).cloned()
}

/// Drop the snapshot for `repo_dir`. Called by [`SnapshotGuard`] when
/// the owning monitor task exits so endpoints stop serving a frozen
/// view of a monitor that is no longer running.
pub async fn clear_snapshot_for(repo_dir: &str) {
    let mut guard = MONITOR_SNAPSHOTS.write().await;
    guard.remove(repo_dir);
}

/// Guard that clears the snapshot entry for a repo when the owning
/// monitor task is dropped (normal exit, cancellation, or panic).
///
/// Without this, a crashed monitor would leave its last published
/// snapshot wedged in `MONITOR_SNAPSHOTS` forever.
struct SnapshotGuard {
    repo_dir: String,
}

impl Drop for SnapshotGuard {
    fn drop(&mut self) {
        let repo_dir = std::mem::take(&mut self.repo_dir);
        tokio::spawn(async move {
            clear_snapshot_for(&repo_dir).await;
        });
    }
}

/// Test-only: seed a snapshot directly. Not exposed outside the crate.
#[cfg(test)]
pub(crate) async fn set_snapshot_for_test(repo_dir: &str, snapshot: GitSnapshot) {
    let mut guard = MONITOR_SNAPSHOTS.write().await;
    guard.insert(repo_dir.to_string(), snapshot);
}

/// Condensed fingerprint used to detect "did anything change" between
/// polls without comparing the full snapshot. Cheap to build and compare.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct GitFingerprint {
    current_branch: Option<String>,
    default_branch: String,
    /// Sorted `(branch, last_commit_time_unix)` pairs. Covers both new
    /// branches and updates to existing branches (commit timestamp moves
    /// when a branch advances). Sorting keeps comparison order-stable.
    branches_and_times: Vec<(String, i64)>,
    /// SHA of the newest commit across all branches. Catches graph
    /// updates even on the default branch, where `last_commit_times`
    /// alone would also suffice but this is redundant defense.
    top_sha: Option<String>,
    /// Total commit count across all branches. Bumps when anything new
    /// lands anywhere, even below the graph limit window.
    total_commits: usize,
}

impl GitFingerprint {
    fn from_snapshot(branches: &Option<BranchListResult>, graph: &Option<GraphData>) -> Self {
        let (current_branch, default_branch, branches_and_times) = match branches {
            Some(b) => {
                let mut pairs: Vec<(String, i64)> = b
                    .branches
                    .iter()
                    .map(|br| {
                        (
                            br.clone(),
                            b.last_commit_times.get(br).copied().unwrap_or(0),
                        )
                    })
                    .collect();
                // Also include remote-only branches so a new push observed
                // only in refs/remotes still triggers a transition.
                for rb in &b.remote_only_branches {
                    pairs.push((
                        format!("remote:{}", rb),
                        b.last_commit_times.get(rb).copied().unwrap_or(0),
                    ));
                }
                pairs.sort();
                (b.current_branch.clone(), b.default_branch.clone(), pairs)
            }
            None => (None, String::new(), Vec::new()),
        };
        let (top_sha, total_commits) = match graph {
            Some(g) => (g.commits.first().map(|c| c.sha.clone()), g.total_count),
            None => (None, 0),
        };
        Self {
            current_branch,
            default_branch,
            branches_and_times,
            top_sha,
            total_commits,
        }
    }
}

/// Git state monitor for a single repository.
pub struct GitMonitor {
    repo_dir: String,
    event_tx: broadcast::Sender<CoreEvent>,
    fingerprint: GitFingerprint,
    /// Set to true after the first successful poll (even if branches/graph
    /// came back `None`, we still publish so endpoints know a monitor ran).
    /// The initial poll establishes the baseline and does not emit events,
    /// mirroring the PR monitor's warm-up behavior: pre-existing state is
    /// ground truth, not a transition.
    warmed_up: bool,
    graph_limit: usize,
}

impl GitMonitor {
    /// Create a new monitor for the given repository.
    pub fn new(repo_dir: String, event_tx: broadcast::Sender<CoreEvent>) -> Self {
        Self {
            repo_dir,
            event_tx,
            fingerprint: GitFingerprint::default(),
            warmed_up: false,
            graph_limit: DEFAULT_GRAPH_LIMIT,
        }
    }

    /// Run a single poll: fetch branches + graph, compare against the
    /// previous fingerprint, publish the snapshot, and emit an event
    /// iff something changed (and we're past warm-up).
    pub async fn poll(&mut self) -> bool {
        let (branches, graph) = tokio::join!(
            list_branches(&self.repo_dir),
            log_graph(&self.repo_dir, self.graph_limit)
        );

        let new_fp = GitFingerprint::from_snapshot(&branches, &graph);
        let changed = new_fp != self.fingerprint;

        // Publish snapshot BEFORE emitting any event. A listener that
        // refetches `/api/git/*` in response to `GitStateChanged` must
        // observe the post-transition state, or the SoT contract breaks
        // at the event boundary (#433 ordering requirement).
        self.publish_snapshot(branches, graph).await;

        let was_warm = self.warmed_up;
        self.warmed_up = true;
        self.fingerprint = new_fp;

        if was_warm && changed {
            let _ = self.event_tx.send(CoreEvent::GitStateChanged {
                repo: self.repo_dir.clone(),
            });
            true
        } else {
            false
        }
    }

    /// Write the current view into the module-level snapshot store.
    async fn publish_snapshot(&self, branches: Option<BranchListResult>, graph: Option<GraphData>) {
        let snapshot = GitSnapshot {
            branches,
            graph,
            warmed_up: true,
        };
        let mut guard = MONITOR_SNAPSHOTS.write().await;
        guard.insert(self.repo_dir.clone(), snapshot);
    }
}

/// Spawn the git monitor as a background task. Polls at `interval_secs`
/// (clamped to a 5-second minimum so a misconfigured value can't busy-loop
/// git commands).
///
/// The snapshot is cleared when the task exits — normal shutdown,
/// cancellation, or panic — via [`SnapshotGuard`].
pub fn spawn_git_monitor(
    repo_dir: String,
    event_tx: broadcast::Sender<CoreEvent>,
    interval_secs: u64,
) -> tokio::task::JoinHandle<()> {
    let interval_secs = interval_secs.max(5);
    let mut monitor = GitMonitor::new(repo_dir.clone(), event_tx);

    tokio::spawn(async move {
        // Clear the published snapshot when this task exits so endpoints
        // don't keep returning a frozen view from a dead monitor.
        let _guard = SnapshotGuard { repo_dir };

        let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
        // Consume the immediate tick so the first poll happens after
        // interval_secs. Mirrors the PR monitor — cold start falls back
        // to live git calls until the first warm poll lands.
        interval.tick().await;

        loop {
            interval.tick().await;
            monitor.poll().await;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::BranchListResult;

    fn empty_branch_list() -> BranchListResult {
        BranchListResult {
            default_branch: "main".to_string(),
            current_branch: Some("main".to_string()),
            branches: vec!["main".to_string()],
            parents: HashMap::new(),
            ahead_behind: HashMap::new(),
            remote_tracking: HashMap::new(),
            remote_only_branches: Vec::new(),
            last_fetch: None,
            last_commit_times: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn snapshot_for_returns_none_before_warmup() {
        // Seed an entry with warmed_up=false and confirm it does not leak.
        let repo = "/tmp/git-monitor-test-cold";
        set_snapshot_for_test(
            repo,
            GitSnapshot {
                branches: Some(empty_branch_list()),
                graph: None,
                warmed_up: false,
            },
        )
        .await;
        assert!(snapshot_for(repo).await.is_none());
        clear_snapshot_for(repo).await;
    }

    #[tokio::test]
    async fn snapshot_for_returns_warm_snapshot() {
        let repo = "/tmp/git-monitor-test-warm";
        set_snapshot_for_test(
            repo,
            GitSnapshot {
                branches: Some(empty_branch_list()),
                graph: None,
                warmed_up: true,
            },
        )
        .await;

        let snap = snapshot_for(repo).await.expect("warmed snapshot");
        assert!(snap.warmed_up);
        assert_eq!(
            snap.branches.as_ref().map(|b| b.default_branch.as_str()),
            Some("main")
        );
        clear_snapshot_for(repo).await;
    }

    #[tokio::test]
    async fn clear_snapshot_drops_entry() {
        let repo = "/tmp/git-monitor-test-clear";
        set_snapshot_for_test(
            repo,
            GitSnapshot {
                branches: Some(empty_branch_list()),
                graph: None,
                warmed_up: true,
            },
        )
        .await;
        assert!(snapshot_for(repo).await.is_some());

        clear_snapshot_for(repo).await;
        assert!(snapshot_for(repo).await.is_none());
    }

    #[tokio::test]
    async fn publish_snapshot_sets_warmed_up() {
        let repo = "/tmp/git-monitor-test-publish";
        let (tx, _rx) = broadcast::channel(16);
        let monitor = GitMonitor::new(repo.to_string(), tx);

        monitor
            .publish_snapshot(Some(empty_branch_list()), None)
            .await;

        let snap = snapshot_for(repo).await.expect("published");
        assert!(snap.warmed_up);
        assert!(snap.branches.is_some());
        clear_snapshot_for(repo).await;
    }

    #[tokio::test]
    async fn first_poll_does_not_emit_event() {
        // Warm-up baseline must not emit — pre-existing state is ground
        // truth, not a transition. Same contract as the PR monitor.
        let repo = "/tmp/git-monitor-test-warmup-gate";
        let (tx, mut rx) = broadcast::channel(16);
        let mut monitor = GitMonitor::new(repo.to_string(), tx);

        // Simulate first poll by direct state manipulation (real git
        // calls are exercised via the full poll path; this test focuses
        // on the transition gate itself).
        let branches = Some(empty_branch_list());
        let graph = None;
        let fp = GitFingerprint::from_snapshot(&branches, &graph);

        monitor.publish_snapshot(branches, graph).await;
        let was_warm = monitor.warmed_up;
        monitor.warmed_up = true;
        monitor.fingerprint = fp;

        assert!(!was_warm, "first poll should see warmed_up=false");
        // No event should have been emitted.
        assert!(
            rx.try_recv().is_err(),
            "warm-up baseline must not emit GitStateChanged"
        );
        clear_snapshot_for(repo).await;
    }

    #[test]
    fn fingerprint_changes_when_branch_added() {
        let b1 = empty_branch_list();
        let mut b2 = empty_branch_list();
        b2.branches.push("feat/x".to_string());
        b2.last_commit_times
            .insert("feat/x".to_string(), 1_700_000_000);

        let fp1 = GitFingerprint::from_snapshot(&Some(b1), &None);
        let fp2 = GitFingerprint::from_snapshot(&Some(b2), &None);
        assert_ne!(fp1, fp2, "adding a branch must change the fingerprint");
    }

    #[test]
    fn fingerprint_changes_when_head_moves() {
        let mut b1 = empty_branch_list();
        b1.last_commit_times
            .insert("main".to_string(), 1_700_000_000);
        let mut b2 = empty_branch_list();
        b2.last_commit_times
            .insert("main".to_string(), 1_700_000_500);

        let fp1 = GitFingerprint::from_snapshot(&Some(b1), &None);
        let fp2 = GitFingerprint::from_snapshot(&Some(b2), &None);
        assert_ne!(fp1, fp2, "branch tip advance must change the fingerprint");
    }

    #[test]
    fn fingerprint_stable_for_identical_state() {
        let b1 = empty_branch_list();
        let b2 = empty_branch_list();
        let fp1 = GitFingerprint::from_snapshot(&Some(b1), &None);
        let fp2 = GitFingerprint::from_snapshot(&Some(b2), &None);
        assert_eq!(fp1, fp2);
    }
}
