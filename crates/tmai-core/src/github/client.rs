//! [`GhClient`] trait — abstracts the `gh` CLI so call sites can target the
//! trait rather than the concrete shell-out, and tests can inject a mock.
//!
//! The production implementation [`GhCliClient`] shells out to `gh` exactly as
//! the previous free functions did (same JSON fields, same timeouts). Errors
//! are classified into [`GhError`] variants so callers can branch on
//! `AuthExpired` / `RateLimited` / `GhNotInstalled` without re-parsing stderr.
//!
//! The 30s TTL cache is intentionally NOT part of this trait — it wraps the
//! trait at the `github::mod` layer, keeping this module a pure transport.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::LazyLock;
use std::time::Duration;

use tokio::process::Command;

use super::error::GhError;
use super::{
    author_login, build_pr_comments, compute_rollup, parse_issue_detail_json, CheckStatus, CiCheck,
    CiFailureLog, CiSummary, GhMergedPrEntry, GhPrCommentsResponse, GhPrEntry, GhRunEntry,
    IssueDetail, IssueInfo, MergeMethod, MergeResult, PrChangedFile, PrComment, PrInfo,
    PrMergeStatus, ReviewAction, ReviewDecision, ReviewResult,
};

/// Timeout for standard `gh` invocations (list/view/etc.). Mirrors the value
/// used before the trait extraction.
const GH_TIMEOUT: Duration = Duration::from_secs(10);

/// Longer timeout used for slow operations (log fetch, merge) where 10s is
/// routinely insufficient on large repos.
const GH_LONG_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum size for CI failure log output (50KB).
const CI_LOG_MAX_BYTES: usize = 50 * 1024;

/// Pinned, boxed future returning a `GhError`-typed result. Used throughout
/// the trait so it stays dyn-compatible without depending on `async-trait`.
pub type GhFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, GhError>> + Send + 'a>>;

/// Abstraction over the `gh` CLI. Methods mirror the underlying commands
/// 1:1 with typed returns and [`GhError`] variants for failure modes.
///
/// The production impl is [`GhCliClient`]. Tests can use
/// [`crate::github::MockGhClient`] to inject canned responses.
pub trait GhClient: Send + Sync + 'static {
    fn list_open_prs<'a>(&'a self, repo_dir: &'a str) -> GhFuture<'a, HashMap<String, PrInfo>>;

    fn list_merged_prs<'a>(
        &'a self,
        repo_dir: &'a str,
        local_branches: &'a [String],
    ) -> GhFuture<'a, HashMap<String, PrInfo>>;

    fn has_merged_pr<'a>(&'a self, repo_dir: &'a str, branch: &'a str) -> GhFuture<'a, bool>;

    fn list_checks<'a>(
        &'a self,
        repo_dir: &'a str,
        branch: &'a str,
    ) -> GhFuture<'a, Option<CiSummary>>;

    fn list_issues<'a>(&'a self, repo_dir: &'a str) -> GhFuture<'a, Vec<IssueInfo>>;

    fn get_issue_detail<'a>(
        &'a self,
        repo_dir: &'a str,
        issue_number: u64,
    ) -> GhFuture<'a, Option<IssueDetail>>;

    fn get_pr_comments<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
    ) -> GhFuture<'a, Vec<PrComment>>;

    fn get_pr_files<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
    ) -> GhFuture<'a, Vec<PrChangedFile>>;

    fn get_pr_merge_status<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
    ) -> GhFuture<'a, Option<PrMergeStatus>>;

    fn get_ci_failure_log<'a>(
        &'a self,
        repo_dir: &'a str,
        run_id: u64,
    ) -> GhFuture<'a, Option<CiFailureLog>>;

    fn rerun_failed_checks<'a>(&'a self, repo_dir: &'a str, run_id: u64) -> GhFuture<'a, ()>;

    fn merge_pr<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
        method: MergeMethod,
        delete_branch: bool,
    ) -> GhFuture<'a, MergeResult>;

    fn review_pr<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
        action: ReviewAction,
        body: Option<&'a str>,
    ) -> GhFuture<'a, ReviewResult>;
}

/// Production [`GhClient`] implementation that shells out to `gh`.
#[derive(Debug, Default, Clone, Copy)]
pub struct GhCliClient;

impl GhCliClient {
    pub const fn new() -> Self {
        Self
    }
}

/// Process-wide default [`GhCliClient`]. Returned by
/// [`default_client`] for the module-level free-function wrappers.
static DEFAULT_CLIENT: LazyLock<GhCliClient> = LazyLock::new(GhCliClient::new);

/// Return a reference to the process-wide default [`GhCliClient`].
pub(super) fn default_client() -> &'static GhCliClient {
    &DEFAULT_CLIENT
}

/// Run `gh <args>` in `repo_dir` with `timeout`. Returns the raw stdout on
/// success; classifies stderr into [`GhError`] variants on failure.
async fn run_gh(args: &[&str], repo_dir: &str, timeout: Duration) -> Result<Vec<u8>, GhError> {
    let spawn_result = tokio::time::timeout(
        timeout,
        Command::new("gh").args(args).current_dir(repo_dir).output(),
    )
    .await;

    let output = match spawn_result {
        Err(_) => {
            return Err(GhError::Other(format!(
                "gh {} timed out after {}s",
                args.first().copied().unwrap_or(""),
                timeout.as_secs()
            )));
        }
        Ok(Err(e)) => return Err(GhError::from_spawn_error(e)),
        Ok(Ok(out)) => out,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(GhError::classify_stderr(&stderr));
    }

    Ok(output.stdout)
}

fn parse_json<T>(bytes: &[u8]) -> Result<T, GhError>
where
    T: for<'de> serde::Deserialize<'de>,
{
    serde_json::from_slice(bytes).map_err(|e| GhError::ParseError(e.to_string()))
}

impl GhClient for GhCliClient {
    fn list_open_prs<'a>(&'a self, repo_dir: &'a str) -> GhFuture<'a, HashMap<String, PrInfo>> {
        Box::pin(async move {
            let stdout = run_gh(
                &[
                    "pr",
                    "list",
                    "--state",
                    "open",
                    "--json",
                    "number,title,state,headRefName,headRefOid,baseRefName,url,reviewDecision,statusCheckRollup,isDraft,additions,deletions,comments,reviews,author",
                    "--limit",
                    "50",
                ],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            let entries: Vec<GhPrEntry> = parse_json(&stdout)?;
            let mut map = HashMap::new();
            for entry in entries {
                let check_status = entry
                    .status_check_rollup
                    .as_ref()
                    .map(|checks| compute_rollup(checks));

                let review_decision = entry.review_decision.as_deref().and_then(|s| match s {
                    "APPROVED" => Some(ReviewDecision::Approved),
                    "CHANGES_REQUESTED" => Some(ReviewDecision::ChangesRequested),
                    "REVIEW_REQUIRED" => Some(ReviewDecision::ReviewRequired),
                    _ => None,
                });

                let pr = PrInfo {
                    number: entry.number,
                    title: entry.title,
                    state: entry.state,
                    head_branch: entry.head_ref_name.clone(),
                    head_sha: entry.head_ref_oid.clone(),
                    url: entry.url,
                    base_branch: entry.base_ref_name.clone(),
                    review_decision,
                    check_status,
                    is_draft: entry.is_draft,
                    additions: entry.additions.unwrap_or(0),
                    deletions: entry.deletions.unwrap_or(0),
                    comments: entry.comments.map(|c| c.len() as u64).unwrap_or(0),
                    reviews: entry.reviews.map(|r| r.len() as u64).unwrap_or(0),
                    author: author_login(entry.author),
                    merge_commit_sha: None,
                };
                map.insert(entry.head_ref_name, pr);
            }
            Ok(map)
        })
    }

    fn list_merged_prs<'a>(
        &'a self,
        repo_dir: &'a str,
        local_branches: &'a [String],
    ) -> GhFuture<'a, HashMap<String, PrInfo>> {
        Box::pin(async move {
            if local_branches.is_empty() {
                return Ok(HashMap::new());
            }

            let stdout = run_gh(
                &[
                    "pr",
                    "list",
                    "--state",
                    "merged",
                    "--json",
                    "number,title,headRefName,headRefOid,baseRefName,url,mergeCommit",
                    "--limit",
                    "30",
                ],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            let entries: Vec<GhMergedPrEntry> = parse_json(&stdout)?;
            let branch_set: HashSet<&str> = local_branches.iter().map(|s| s.as_str()).collect();

            let mut map = HashMap::new();
            for entry in entries {
                if !branch_set.contains(entry.head_ref_name.as_str()) {
                    continue;
                }
                let merge_commit_sha = entry.merge_commit.map(|mc| mc.oid);
                let pr = PrInfo {
                    number: entry.number,
                    title: entry.title,
                    state: "MERGED".to_string(),
                    head_branch: entry.head_ref_name.clone(),
                    head_sha: entry.head_ref_oid,
                    base_branch: entry.base_ref_name,
                    url: entry.url,
                    review_decision: None,
                    check_status: None,
                    is_draft: false,
                    additions: 0,
                    deletions: 0,
                    comments: 0,
                    reviews: 0,
                    author: String::new(),
                    merge_commit_sha,
                };
                map.insert(entry.head_ref_name, pr);
            }
            Ok(map)
        })
    }

    fn has_merged_pr<'a>(&'a self, repo_dir: &'a str, branch: &'a str) -> GhFuture<'a, bool> {
        Box::pin(async move {
            let stdout = run_gh(
                &[
                    "pr", "list", "--state", "merged", "--head", branch, "--json", "number",
                    "--limit", "1",
                ],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            let parsed: Vec<serde_json::Value> = parse_json(&stdout)?;
            Ok(!parsed.is_empty())
        })
    }

    fn list_checks<'a>(
        &'a self,
        repo_dir: &'a str,
        branch: &'a str,
    ) -> GhFuture<'a, Option<CiSummary>> {
        Box::pin(async move {
            if branch.is_empty() || branch.starts_with('-') {
                return Ok(None);
            }

            let stdout = run_gh(
                &[
                    "run",
                    "list",
                    "--branch",
                    branch,
                    "--json",
                    "name,status,conclusion,url,headBranch,createdAt,updatedAt,databaseId",
                    "--limit",
                    "10",
                ],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            let entries: Vec<GhRunEntry> = parse_json(&stdout)?;
            let mut seen = HashSet::new();
            let checks: Vec<CiCheck> = entries
                .into_iter()
                .filter(|e| seen.insert(e.name.clone()))
                .map(|e| CiCheck {
                    name: e.name,
                    status: e.status,
                    conclusion: e.conclusion,
                    url: e.url,
                    started_at: e.created_at,
                    completed_at: e.updated_at,
                    run_id: e.database_id,
                })
                .collect();

            let rollup = compute_rollup(&checks);
            Ok(Some(CiSummary {
                branch: branch.to_string(),
                checks,
                rollup,
            }))
        })
    }

    fn list_issues<'a>(&'a self, repo_dir: &'a str) -> GhFuture<'a, Vec<IssueInfo>> {
        Box::pin(async move {
            let stdout = run_gh(
                &[
                    "issue",
                    "list",
                    "--state",
                    "open",
                    "--json",
                    "number,title,state,url,labels,assignees",
                    "--limit",
                    "50",
                ],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            let entries: Vec<super::GhIssueEntry> = parse_json(&stdout)?;
            Ok(entries
                .into_iter()
                .map(|e| IssueInfo {
                    number: e.number,
                    title: e.title,
                    state: e.state,
                    url: e.url,
                    labels: e.labels,
                    assignees: e.assignees.into_iter().map(|a| a.login).collect(),
                })
                .collect())
        })
    }

    fn get_issue_detail<'a>(
        &'a self,
        repo_dir: &'a str,
        issue_number: u64,
    ) -> GhFuture<'a, Option<IssueDetail>> {
        Box::pin(async move {
            let stdout = run_gh(
                &[
                    "issue",
                    "view",
                    &issue_number.to_string(),
                    "--json",
                    "number,title,state,url,body,labels,assignees,createdAt,updatedAt,comments",
                ],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            let val: serde_json::Value = parse_json(&stdout)?;
            Ok(parse_issue_detail_json(&val))
        })
    }

    fn get_pr_comments<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
    ) -> GhFuture<'a, Vec<PrComment>> {
        Box::pin(async move {
            let stdout = run_gh(
                &[
                    "pr",
                    "view",
                    &pr_number.to_string(),
                    "--json",
                    "comments,reviews",
                ],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            let resp: GhPrCommentsResponse = parse_json(&stdout)?;
            Ok(build_pr_comments(resp))
        })
    }

    fn get_pr_files<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
    ) -> GhFuture<'a, Vec<PrChangedFile>> {
        Box::pin(async move {
            let stdout = run_gh(
                &["pr", "view", &pr_number.to_string(), "--json", "files"],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            #[derive(serde::Deserialize)]
            struct FilesResponse {
                files: Vec<GhFileEntry>,
            }

            #[derive(serde::Deserialize)]
            struct GhFileEntry {
                path: String,
                additions: u64,
                deletions: u64,
            }

            let resp: FilesResponse = parse_json(&stdout)?;
            Ok(resp
                .files
                .into_iter()
                .map(|f| PrChangedFile {
                    path: f.path,
                    additions: f.additions,
                    deletions: f.deletions,
                })
                .collect())
        })
    }

    fn get_pr_merge_status<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
    ) -> GhFuture<'a, Option<PrMergeStatus>> {
        Box::pin(async move {
            let stdout = run_gh(
                &[
                    "pr",
                    "view",
                    &pr_number.to_string(),
                    "--json",
                    "mergeable,mergeStateStatus,reviewDecision,statusCheckRollup",
                ],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;

            let json: serde_json::Value = parse_json(&stdout)?;

            let mergeable = json
                .get("mergeable")
                .and_then(|v| v.as_str())
                .unwrap_or("UNKNOWN")
                .to_string();
            let merge_state_status = json
                .get("mergeStateStatus")
                .and_then(|v| v.as_str())
                .unwrap_or("UNKNOWN")
                .to_string();
            let review_decision = json
                .get("reviewDecision")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let check_status: Option<CheckStatus> = json
                .get("statusCheckRollup")
                .and_then(|v| serde_json::from_value::<Vec<super::GhCheckRun>>(v.clone()).ok())
                .map(|checks| compute_rollup(&checks));

            Ok(Some(PrMergeStatus {
                mergeable,
                merge_state_status,
                review_decision,
                check_status,
            }))
        })
    }

    fn get_ci_failure_log<'a>(
        &'a self,
        repo_dir: &'a str,
        run_id: u64,
    ) -> GhFuture<'a, Option<CiFailureLog>> {
        Box::pin(async move {
            let stdout = run_gh(
                &["run", "view", &run_id.to_string(), "--log-failed"],
                repo_dir,
                GH_LONG_TIMEOUT,
            )
            .await?;

            if stdout.is_empty() {
                return Ok(None);
            }

            let text = if stdout.len() > CI_LOG_MAX_BYTES {
                let truncated = &stdout[..CI_LOG_MAX_BYTES];
                let s = String::from_utf8_lossy(truncated);
                format!("{}\n\n... (truncated, showing first 50KB)", s)
            } else {
                String::from_utf8_lossy(&stdout).to_string()
            };

            Ok(Some(CiFailureLog {
                run_id,
                log_text: text,
            }))
        })
    }

    fn rerun_failed_checks<'a>(&'a self, repo_dir: &'a str, run_id: u64) -> GhFuture<'a, ()> {
        Box::pin(async move {
            let _ = run_gh(
                &["run", "rerun", &run_id.to_string(), "--failed"],
                repo_dir,
                GH_TIMEOUT,
            )
            .await?;
            Ok(())
        })
    }

    fn merge_pr<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
        method: MergeMethod,
        delete_branch: bool,
    ) -> GhFuture<'a, MergeResult> {
        Box::pin(async move {
            // Pre-flight: check merge readiness (explicit guardrails before we
            // actually invoke `gh pr merge`, so the caller gets a specific
            // reason instead of a generic "not mergeable" stderr).
            if let Ok(Some(status)) = self.get_pr_merge_status(repo_dir, pr_number).await {
                if status.mergeable == "CONFLICTING" {
                    return Err(GhError::Other(format!(
                        "PR #{} has merge conflicts — resolve conflicts before merging",
                        pr_number
                    )));
                }
                if let Some(CheckStatus::Failure) = status.check_status {
                    return Err(GhError::Other(format!(
                        "PR #{} has failing CI checks — fix CI before merging",
                        pr_number
                    )));
                }
                if let Some(CheckStatus::Pending) = status.check_status {
                    return Err(GhError::Other(format!(
                        "PR #{} has pending CI checks — wait for CI to complete before merging",
                        pr_number
                    )));
                }
            }

            let pr_str = pr_number.to_string();
            let mut args: Vec<&str> = vec!["pr", "merge", &pr_str, method.as_flag()];
            if delete_branch {
                args.push("--delete-branch");
            }

            // Custom invocation to capture both stdout and stderr regardless of
            // success (success path surfaces stderr as the human-readable
            // message).
            let spawn_result = tokio::time::timeout(
                GH_LONG_TIMEOUT,
                Command::new("gh")
                    .args(&args)
                    .current_dir(repo_dir)
                    .output(),
            )
            .await;

            let output = match spawn_result {
                Err(_) => return Err(GhError::Other("gh pr merge timed out".into())),
                Ok(Err(e)) => return Err(GhError::from_spawn_error(e)),
                Ok(Ok(o)) => o,
            };

            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

            if !output.status.success() {
                return Err(GhError::classify_stderr(&stderr));
            }

            let message = if stdout.is_empty() { stderr } else { stdout };
            let method_str = match method {
                MergeMethod::Squash => "squash",
                MergeMethod::Merge => "merge",
                MergeMethod::Rebase => "rebase",
            };

            Ok(MergeResult {
                pr_number,
                merged: true,
                method: method_str.to_string(),
                message,
                branch_deleted: delete_branch,
                worktree_cleanup: None,
            })
        })
    }

    fn review_pr<'a>(
        &'a self,
        repo_dir: &'a str,
        pr_number: u64,
        action: ReviewAction,
        body: Option<&'a str>,
    ) -> GhFuture<'a, ReviewResult> {
        Box::pin(async move {
            let pr_str = pr_number.to_string();
            let mut args: Vec<&str> = vec!["pr", "review", &pr_str, action.as_flag()];
            if let Some(body_text) = body {
                args.push("--body");
                args.push(body_text);
            }

            let spawn_result = tokio::time::timeout(
                GH_TIMEOUT,
                Command::new("gh")
                    .args(&args)
                    .current_dir(repo_dir)
                    .output(),
            )
            .await;

            let output = match spawn_result {
                Err(_) => return Err(GhError::Other("gh pr review timed out".into())),
                Ok(Err(e)) => return Err(GhError::from_spawn_error(e)),
                Ok(Ok(o)) => o,
            };

            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

            if !output.status.success() {
                return Err(GhError::classify_stderr(&stderr));
            }

            let message = if stdout.is_empty() { stderr } else { stdout };
            let action_str = match action {
                ReviewAction::Approve => "approve",
                ReviewAction::RequestChanges => "request_changes",
                ReviewAction::Comment => "comment",
            };

            Ok(ReviewResult {
                pr_number,
                action: action_str.to_string(),
                message,
            })
        })
    }
}

// ─── MockGhClient ────────────────────────────────────────────────────────────
//
// A test double exposed to the whole crate (and to integration tests under
// `tests/` via `pub use`). Each trait method reads a pre-seeded canned
// response; unset fields return `GhError::Other("not seeded")` so tests fail
// loudly if they exercise a path that wasn't explicitly mocked.

use parking_lot::Mutex;

/// Canned responses keyed loosely by operation. Only the subset needed by
/// current tests is expressive; unused fields stay `None` and make the
/// corresponding trait method return [`GhError::Other`].
#[derive(Default)]
pub struct MockGhClient {
    pub list_open_prs: Mutex<Option<HashMap<String, PrInfo>>>,
    pub list_merged_prs: Mutex<Option<HashMap<String, PrInfo>>>,
    pub has_merged_pr: Mutex<Option<bool>>,
    pub list_checks: Mutex<Option<CiSummary>>,
    pub list_issues: Mutex<Option<Vec<IssueInfo>>>,
    pub get_issue_detail: Mutex<Option<IssueDetail>>,
    pub get_pr_comments: Mutex<Option<Vec<PrComment>>>,
    pub get_pr_files: Mutex<Option<Vec<PrChangedFile>>>,
    pub get_pr_merge_status: Mutex<Option<PrMergeStatus>>,
    pub get_ci_failure_log: Mutex<Option<CiFailureLog>>,
    pub rerun_failed_checks_ok: Mutex<bool>,
    pub merge_pr: Mutex<Option<MergeResult>>,
    pub review_pr: Mutex<Option<ReviewResult>>,
}

impl MockGhClient {
    pub fn new() -> Self {
        Self::default()
    }
}

fn not_seeded(op: &'static str) -> GhError {
    GhError::Other(format!("MockGhClient: {op} not seeded"))
}

impl GhClient for MockGhClient {
    fn list_open_prs<'a>(&'a self, _repo_dir: &'a str) -> GhFuture<'a, HashMap<String, PrInfo>> {
        let v = self.list_open_prs.lock().clone();
        Box::pin(async move { v.ok_or_else(|| not_seeded("list_open_prs")) })
    }

    fn list_merged_prs<'a>(
        &'a self,
        _repo_dir: &'a str,
        _local_branches: &'a [String],
    ) -> GhFuture<'a, HashMap<String, PrInfo>> {
        let v = self.list_merged_prs.lock().clone();
        Box::pin(async move { v.ok_or_else(|| not_seeded("list_merged_prs")) })
    }

    fn has_merged_pr<'a>(&'a self, _repo_dir: &'a str, _branch: &'a str) -> GhFuture<'a, bool> {
        let v = *self.has_merged_pr.lock();
        Box::pin(async move { v.ok_or_else(|| not_seeded("has_merged_pr")) })
    }

    fn list_checks<'a>(
        &'a self,
        _repo_dir: &'a str,
        _branch: &'a str,
    ) -> GhFuture<'a, Option<CiSummary>> {
        let v = self.list_checks.lock().clone();
        Box::pin(async move { Ok(v) })
    }

    fn list_issues<'a>(&'a self, _repo_dir: &'a str) -> GhFuture<'a, Vec<IssueInfo>> {
        let v = self.list_issues.lock().clone();
        Box::pin(async move { v.ok_or_else(|| not_seeded("list_issues")) })
    }

    fn get_issue_detail<'a>(
        &'a self,
        _repo_dir: &'a str,
        _issue_number: u64,
    ) -> GhFuture<'a, Option<IssueDetail>> {
        let v = self.get_issue_detail.lock().clone();
        Box::pin(async move { Ok(v) })
    }

    fn get_pr_comments<'a>(
        &'a self,
        _repo_dir: &'a str,
        _pr_number: u64,
    ) -> GhFuture<'a, Vec<PrComment>> {
        let v = self.get_pr_comments.lock().clone();
        Box::pin(async move { v.ok_or_else(|| not_seeded("get_pr_comments")) })
    }

    fn get_pr_files<'a>(
        &'a self,
        _repo_dir: &'a str,
        _pr_number: u64,
    ) -> GhFuture<'a, Vec<PrChangedFile>> {
        let v = self.get_pr_files.lock().clone();
        Box::pin(async move { v.ok_or_else(|| not_seeded("get_pr_files")) })
    }

    fn get_pr_merge_status<'a>(
        &'a self,
        _repo_dir: &'a str,
        _pr_number: u64,
    ) -> GhFuture<'a, Option<PrMergeStatus>> {
        let v = self.get_pr_merge_status.lock().clone();
        Box::pin(async move { Ok(v) })
    }

    fn get_ci_failure_log<'a>(
        &'a self,
        _repo_dir: &'a str,
        _run_id: u64,
    ) -> GhFuture<'a, Option<CiFailureLog>> {
        let v = self.get_ci_failure_log.lock().clone();
        Box::pin(async move { Ok(v) })
    }

    fn rerun_failed_checks<'a>(&'a self, _repo_dir: &'a str, _run_id: u64) -> GhFuture<'a, ()> {
        let ok = *self.rerun_failed_checks_ok.lock();
        Box::pin(async move {
            if ok {
                Ok(())
            } else {
                Err(not_seeded("rerun_failed_checks"))
            }
        })
    }

    fn merge_pr<'a>(
        &'a self,
        _repo_dir: &'a str,
        _pr_number: u64,
        _method: MergeMethod,
        _delete_branch: bool,
    ) -> GhFuture<'a, MergeResult> {
        let v = self.merge_pr.lock().clone();
        Box::pin(async move { v.ok_or_else(|| not_seeded("merge_pr")) })
    }

    fn review_pr<'a>(
        &'a self,
        _repo_dir: &'a str,
        _pr_number: u64,
        _action: ReviewAction,
        _body: Option<&'a str>,
    ) -> GhFuture<'a, ReviewResult> {
        let v = self.review_pr.lock().clone();
        Box::pin(async move { v.ok_or_else(|| not_seeded("review_pr")) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_returns_seeded_issues() {
        let mock = MockGhClient::new();
        *mock.list_issues.lock() = Some(vec![IssueInfo {
            number: 42,
            title: "test".into(),
            state: "OPEN".into(),
            url: "u".into(),
            labels: Vec::new(),
            assignees: Vec::new(),
        }]);
        let out = mock.list_issues("/tmp").await.unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].number, 42);
    }

    #[tokio::test]
    async fn mock_surfaces_not_seeded_for_required_ops() {
        let mock = MockGhClient::new();
        let err = mock.list_open_prs("/tmp").await.unwrap_err();
        match err {
            GhError::Other(s) => assert!(s.contains("not seeded")),
            _ => panic!("expected Other"),
        }
    }

    #[tokio::test]
    async fn mock_ci_failure_log_optional_defaults_to_none() {
        // Optional returns default to Ok(None) — loudly-failing "not seeded"
        // only fires for required-result ops.
        let mock = MockGhClient::new();
        let out = mock.get_ci_failure_log("/tmp", 1).await.unwrap();
        assert!(out.is_none());
    }
}
