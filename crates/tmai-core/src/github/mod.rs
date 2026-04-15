//! GitHub integration — public types, the process-wide TTL cache, and free
//! functions that delegate to the [`GhClient`] trait.
//!
//! The `gh` CLI transport lives in [`mod@client`]; the cache is intentionally
//! kept at this outer layer so it wraps any [`GhClient`] impl (production or
//! test). Swapping the default implementation therefore changes transport
//! only — caching behavior stays constant.

pub mod client;
pub mod error;
pub mod pr_monitor;

pub use client::{GhCliClient, GhClient, GhFuture, MockGhClient};
pub use error::GhError;

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// TTL for cached GitHub data
const CACHE_TTL: Duration = Duration::from_secs(30);

/// Cached result with TTL
struct CacheEntry<T> {
    data: T,
    fetched_at: Instant,
}

/// Global cache for GitHub API results (gh CLI is slow, ~1-10s per call)
struct GhCache {
    prs: RwLock<HashMap<String, CacheEntry<HashMap<String, PrInfo>>>>,
    issues: RwLock<HashMap<String, CacheEntry<Vec<IssueInfo>>>>,
}

impl GhCache {
    fn new() -> Self {
        Self {
            prs: RwLock::new(HashMap::new()),
            issues: RwLock::new(HashMap::new()),
        }
    }
}

/// Module-level cache instance
static GH_CACHE: LazyLock<GhCache> = LazyLock::new(GhCache::new);

/// PR review decision
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReviewDecision {
    Approved,
    ChangesRequested,
    ReviewRequired,
    #[serde(other)]
    Unknown,
}

/// CI/check status rollup
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CheckStatus {
    Success,
    Failure,
    Pending,
    #[serde(other)]
    Unknown,
}

/// CI run lifecycle status (the phase a check run is in)
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CiRunStatus {
    Queued,
    InProgress,
    Completed,
    Waiting,
    Pending,
    Requested,
    #[serde(other)]
    Unknown,
}

/// CI run outcome (only meaningful when status is Completed)
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CiConclusion {
    Success,
    Failure,
    Neutral,
    Skipped,
    Cancelled,
    TimedOut,
    ActionRequired,
    #[serde(other)]
    Unknown,
}

impl CiRunStatus {
    /// Whether this status indicates the run is still in progress
    fn is_pending(&self) -> bool {
        matches!(
            self,
            CiRunStatus::InProgress
                | CiRunStatus::Queued
                | CiRunStatus::Waiting
                | CiRunStatus::Pending
                | CiRunStatus::Requested
        )
    }
}

impl CiConclusion {
    /// Whether this conclusion indicates a failure
    fn is_failure(&self) -> bool {
        matches!(
            self,
            CiConclusion::Failure | CiConclusion::TimedOut | CiConclusion::Cancelled
        )
    }
}

/// PR info for a branch
#[derive(Debug, Clone, serde::Serialize)]
pub struct PrInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub head_branch: String,
    pub head_sha: String,
    pub base_branch: String,
    pub url: String,
    pub review_decision: Option<ReviewDecision>,
    pub check_status: Option<CheckStatus>,
    pub is_draft: bool,
    pub additions: u64,
    pub deletions: u64,
    /// Conversation comments count
    pub comments: u64,
    /// Review count
    pub reviews: u64,
    /// PR author login (e.g., `dependabot[bot]`). Used by PR Monitor's
    /// `pr_monitor_exclude_authors` filter to skip bot-authored noise.
    #[serde(default)]
    pub author: String,
    /// Merge commit SHA (only for merged PRs)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_commit_sha: Option<String>,
}

/// Raw PR data from gh CLI JSON output
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GhPrEntry {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    pub(super) head_ref_name: String,
    pub(super) head_ref_oid: String,
    pub(super) base_ref_name: String,
    pub(super) url: String,
    pub(super) review_decision: Option<String>,
    pub(super) status_check_rollup: Option<Vec<GhCheckRun>>,
    pub(super) is_draft: bool,
    pub(super) additions: Option<u64>,
    pub(super) deletions: Option<u64>,
    pub(super) comments: Option<Vec<serde_json::Value>>,
    pub(super) reviews: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub(super) author: Option<GhAuthor>,
}

/// Individual check run from statusCheckRollup
#[derive(Debug, serde::Deserialize)]
pub(super) struct GhCheckRun {
    conclusion: Option<String>,
    status: Option<String>,
}

/// Trait for types that carry CI check conclusion/status (used by compute_rollup)
pub(super) trait CheckRunLike {
    fn has_failure_conclusion(&self) -> bool;
    fn has_pending_status(&self) -> bool;
}

impl CheckRunLike for GhCheckRun {
    fn has_failure_conclusion(&self) -> bool {
        self.conclusion
            .as_deref()
            .map(|s| {
                let u = s.to_ascii_uppercase();
                u == "FAILURE" || u == "TIMED_OUT" || u == "CANCELLED"
            })
            .unwrap_or(false)
    }
    fn has_pending_status(&self) -> bool {
        self.status
            .as_deref()
            .map(|s| {
                matches!(
                    s.to_ascii_uppercase().as_str(),
                    "IN_PROGRESS" | "QUEUED" | "WAITING" | "PENDING" | "REQUESTED"
                )
            })
            .unwrap_or(false)
    }
}

impl CheckRunLike for CiCheck {
    fn has_failure_conclusion(&self) -> bool {
        self.conclusion
            .as_ref()
            .map(|c| c.is_failure())
            .unwrap_or(false)
    }
    fn has_pending_status(&self) -> bool {
        self.status.is_pending()
    }
}

/// Fetch open PRs for a repository (cached with 30s TTL). Delegates to
/// [`GhClient::list_open_prs`] on cache miss.
pub async fn list_open_prs(repo_dir: &str) -> Option<HashMap<String, PrInfo>> {
    {
        let cache_read = GH_CACHE.prs.read().await;
        if let Some(entry) = cache_read.get(repo_dir) {
            if entry.fetched_at.elapsed() < CACHE_TTL {
                return Some(entry.data.clone());
            }
        }
    }

    let map = client::default_client()
        .list_open_prs(repo_dir)
        .await
        .ok()?;

    {
        let mut cache_write = GH_CACHE.prs.write().await;
        cache_write.insert(
            repo_dir.to_string(),
            CacheEntry {
                data: map.clone(),
                fetched_at: Instant::now(),
            },
        );
    }

    Some(map)
}

/// Raw merged PR data from gh CLI JSON output
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GhMergedPrEntry {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) head_ref_name: String,
    pub(super) head_ref_oid: String,
    pub(super) base_ref_name: String,
    pub(super) url: String,
    pub(super) merge_commit: Option<GhMergeCommit>,
}

/// Merge commit info from gh CLI
#[derive(Debug, serde::Deserialize)]
pub(super) struct GhMergeCommit {
    pub(super) oid: String,
}

/// Fetch recently merged PRs for branches that still exist locally.
///
/// Returns a map of head_branch -> PrInfo (with merge_commit_sha populated).
/// Only returns PRs whose head_branch is in the provided `local_branches` set,
/// so we avoid fetching irrelevant old merged PRs.
pub async fn list_merged_prs(
    repo_dir: &str,
    local_branches: &[String],
) -> Option<HashMap<String, PrInfo>> {
    client::default_client()
        .list_merged_prs(repo_dir, local_branches)
        .await
        .ok()
}

/// Check if a specific branch has an associated merged PR.
///
/// Uses `gh pr list --state merged --head <branch>` to detect squash-merged
/// branches that `git branch -d` would refuse to delete.
/// Returns `true` if at least one merged PR exists for the given branch.
pub async fn has_merged_pr(repo_dir: &str, branch: &str) -> bool {
    client::default_client()
        .has_merged_pr(repo_dir, branch)
        .await
        .unwrap_or(false)
}

/// A single CI check / workflow run
#[derive(Debug, Clone, serde::Serialize)]
pub struct CiCheck {
    pub name: String,
    pub status: CiRunStatus,
    pub conclusion: Option<CiConclusion>,
    pub url: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub run_id: Option<u64>,
}

/// A comment on a pull request (conversation comment or review comment)
#[derive(Debug, Clone, serde::Serialize)]
pub struct PrComment {
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
    /// "comment" for conversation comments, "review" for review comments
    pub comment_type: String,
    /// File path (review comments only)
    pub path: Option<String>,
    /// Diff context (review comments only)
    pub diff_hunk: Option<String>,
}

/// A file changed in a pull request
#[derive(Debug, Clone, serde::Serialize)]
pub struct PrChangedFile {
    pub path: String,
    pub additions: u64,
    pub deletions: u64,
}

/// Merge readiness status for a pull request
#[derive(Debug, Clone, serde::Serialize)]
pub struct PrMergeStatus {
    pub mergeable: String,
    pub merge_state_status: String,
    pub review_decision: Option<String>,
    pub check_status: Option<CheckStatus>,
}

/// Merge method for `gh pr merge`
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MergeMethod {
    Squash,
    Merge,
    Rebase,
}

impl MergeMethod {
    /// Convert to the `gh pr merge` CLI flag
    pub(super) fn as_flag(self) -> &'static str {
        match self {
            MergeMethod::Squash => "--squash",
            MergeMethod::Merge => "--merge",
            MergeMethod::Rebase => "--rebase",
        }
    }
}

/// Result of a PR merge operation
#[derive(Debug, Clone, serde::Serialize)]
pub struct MergeResult {
    pub pr_number: u64,
    pub merged: bool,
    pub method: String,
    pub message: String,
    /// Whether the remote branch was deleted after merge
    pub branch_deleted: bool,
    /// Worktree cleanup result (if requested)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_cleanup: Option<String>,
}

/// Review action for `gh pr review`
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewAction {
    Approve,
    RequestChanges,
    Comment,
}

impl ReviewAction {
    /// Convert to the `gh pr review` CLI flag
    pub(super) fn as_flag(self) -> &'static str {
        match self {
            ReviewAction::Approve => "--approve",
            ReviewAction::RequestChanges => "--request-changes",
            ReviewAction::Comment => "--comment",
        }
    }
}

/// Result of a PR review operation
#[derive(Debug, Clone, serde::Serialize)]
pub struct ReviewResult {
    pub pr_number: u64,
    pub action: String,
    pub message: String,
}

/// CI failure log output (truncated to 50KB)
#[derive(Debug, Clone, serde::Serialize)]
pub struct CiFailureLog {
    pub run_id: u64,
    pub log_text: String,
}

/// CI checks summary for a branch
#[derive(Debug, Clone, serde::Serialize)]
pub struct CiSummary {
    pub branch: String,
    pub checks: Vec<CiCheck>,
    pub rollup: CheckStatus,
}

/// Raw workflow run from `gh run list`
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(super) struct GhRunEntry {
    pub(super) name: String,
    pub(super) status: CiRunStatus,
    pub(super) conclusion: Option<CiConclusion>,
    pub(super) url: String,
    pub(super) head_branch: String,
    pub(super) created_at: Option<String>,
    pub(super) updated_at: Option<String>,
    pub(super) database_id: Option<u64>,
}

/// Fetch CI checks for a specific branch. Delegates to
/// [`GhClient::list_checks`].
pub async fn list_checks(repo_dir: &str, branch: &str) -> Option<CiSummary> {
    client::default_client()
        .list_checks(repo_dir, branch)
        .await
        .ok()
        .flatten()
}

/// Compute rollup status from a list of checks
pub(super) fn compute_rollup<T: CheckRunLike>(checks: &[T]) -> CheckStatus {
    if checks.is_empty() {
        return CheckStatus::Unknown;
    }
    if checks.iter().any(|c| c.has_failure_conclusion()) {
        return CheckStatus::Failure;
    }
    if checks.iter().any(|c| c.has_pending_status()) {
        return CheckStatus::Pending;
    }
    CheckStatus::Success
}

/// A GitHub issue label
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IssueLabel {
    pub name: String,
    pub color: String,
}

/// A GitHub issue
#[derive(Debug, Clone, serde::Serialize)]
pub struct IssueInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
    pub labels: Vec<IssueLabel>,
    pub assignees: Vec<String>,
}

/// A comment on a GitHub issue
#[derive(Debug, Clone, serde::Serialize)]
pub struct IssueComment {
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
}

/// Detailed view of a single GitHub issue (includes body and comments)
#[derive(Debug, Clone, serde::Serialize)]
pub struct IssueDetail {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
    pub body: String,
    pub labels: Vec<IssueLabel>,
    pub assignees: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub comments: Vec<IssueComment>,
}

/// Raw assignee from `gh issue list`
#[derive(Debug, serde::Deserialize)]
pub(super) struct GhAssignee {
    pub(super) login: String,
}

/// Raw issue from `gh issue list`
#[derive(Debug, serde::Deserialize)]
pub(super) struct GhIssueEntry {
    pub(super) number: u64,
    pub(super) title: String,
    pub(super) state: String,
    pub(super) url: String,
    pub(super) labels: Vec<IssueLabel>,
    #[serde(default)]
    pub(super) assignees: Vec<GhAssignee>,
}

/// Fetch open issues for a repository (cached with 30s TTL).
pub async fn list_issues(repo_dir: &str) -> Option<Vec<IssueInfo>> {
    {
        let cache_read = GH_CACHE.issues.read().await;
        if let Some(entry) = cache_read.get(repo_dir) {
            if entry.fetched_at.elapsed() < CACHE_TTL {
                return Some(entry.data.clone());
            }
        }
    }

    let issues = client::default_client().list_issues(repo_dir).await.ok()?;

    {
        let mut cache_write = GH_CACHE.issues.write().await;
        cache_write.insert(
            repo_dir.to_string(),
            CacheEntry {
                data: issues.clone(),
                fetched_at: Instant::now(),
            },
        );
    }

    Some(issues)
}

/// Fetch detailed information for a single GitHub issue (body, comments, metadata)
pub async fn get_issue_detail(repo_dir: &str, issue_number: u64) -> Option<IssueDetail> {
    client::default_client()
        .get_issue_detail(repo_dir, issue_number)
        .await
        .ok()
        .flatten()
}

/// Parse gh issue view JSON into IssueDetail
pub(super) fn parse_issue_detail_json(val: &serde_json::Value) -> Option<IssueDetail> {
    let number = val["number"].as_u64()?;
    let title = val["title"].as_str()?.to_string();
    let state = val["state"].as_str()?.to_string();
    let url = val["url"].as_str()?.to_string();
    let body = val["body"].as_str().unwrap_or("").to_string();
    let created_at = val["createdAt"].as_str().unwrap_or("").to_string();
    let updated_at = val["updatedAt"].as_str().unwrap_or("").to_string();

    let labels: Vec<IssueLabel> = val["labels"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|l| {
                    Some(IssueLabel {
                        name: l["name"].as_str()?.to_string(),
                        color: l["color"].as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let assignees: Vec<String> = val["assignees"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a["login"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let comments: Vec<IssueComment> = val["comments"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    Some(IssueComment {
                        author: c["author"]["login"].as_str()?.to_string(),
                        body: c["body"].as_str().unwrap_or("").to_string(),
                        created_at: c["createdAt"].as_str().unwrap_or("").to_string(),
                        url: c["url"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Some(IssueDetail {
        number,
        title,
        state,
        url,
        body,
        labels,
        assignees,
        created_at,
        updated_at,
        comments,
    })
}

/// Fetch comments and reviews for a pull request
///
/// Combines conversation comments and review comments into a single timeline,
/// sorted by created_at.
pub async fn get_pr_comments(repo_dir: &str, pr_number: u64) -> Option<Vec<PrComment>> {
    client::default_client()
        .get_pr_comments(repo_dir, pr_number)
        .await
        .ok()
}

#[derive(Debug, serde::Deserialize, Default)]
pub(super) struct GhPrCommentsResponse {
    #[serde(default)]
    pub(super) comments: Vec<GhConversationComment>,
    #[serde(default)]
    pub(super) reviews: Vec<GhReview>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct GhAuthor {
    #[serde(default)]
    pub(super) login: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct GhConversationComment {
    #[serde(default)]
    pub(super) author: Option<GhAuthor>,
    #[serde(default)]
    pub(super) body: String,
    #[serde(default, rename = "createdAt")]
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) url: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct GhReview {
    #[serde(default)]
    pub(super) author: Option<GhAuthor>,
    #[serde(default)]
    pub(super) body: String,
    #[serde(default)]
    pub(super) state: String,
    #[serde(default, rename = "submittedAt")]
    pub(super) submitted_at: Option<String>,
    #[serde(default, rename = "createdAt")]
    pub(super) created_at: Option<String>,
    #[serde(default)]
    pub(super) comments: Vec<GhReviewInlineComment>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct GhReviewInlineComment {
    #[serde(default)]
    pub(super) body: String,
    #[serde(default, rename = "createdAt")]
    pub(super) created_at: String,
    #[serde(default)]
    pub(super) url: String,
    #[serde(default)]
    pub(super) path: Option<String>,
    #[serde(default, rename = "diffHunk")]
    pub(super) diff_hunk: Option<String>,
}

/// Convert a resolved Option<GhAuthor> into the canonical login, preserving
/// the prior "unknown" fallback for missing or empty authors.
pub(super) fn author_login(author: Option<GhAuthor>) -> String {
    author
        .map(|a| a.login)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Flatten the deserialized PR comments/reviews into the public `PrComment`
/// timeline, sorted by created_at.
pub(super) fn build_pr_comments(resp: GhPrCommentsResponse) -> Vec<PrComment> {
    let mut result = Vec::new();

    for c in resp.comments {
        result.push(PrComment {
            author: author_login(c.author),
            body: c.body,
            created_at: c.created_at,
            url: c.url,
            comment_type: "comment".to_string(),
            path: None,
            diff_hunk: None,
        });
    }

    for r in resp.reviews {
        let review_author = author_login(r.author);

        if !r.body.is_empty() {
            let created_at = r
                .submitted_at
                .clone()
                .or(r.created_at.clone())
                .unwrap_or_default();
            result.push(PrComment {
                author: review_author.clone(),
                body: format!("[{}] {}", r.state, r.body),
                created_at,
                url: String::new(),
                comment_type: "review".to_string(),
                path: None,
                diff_hunk: None,
            });
        }

        for c in r.comments {
            result.push(PrComment {
                author: review_author.clone(),
                body: c.body,
                created_at: c.created_at,
                url: c.url,
                comment_type: "review".to_string(),
                path: c.path,
                diff_hunk: c.diff_hunk,
            });
        }
    }

    result.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    result
}

/// Fetch changed files for a pull request
pub async fn get_pr_files(repo_dir: &str, pr_number: u64) -> Option<Vec<PrChangedFile>> {
    client::default_client()
        .get_pr_files(repo_dir, pr_number)
        .await
        .ok()
}

/// Fetch merge readiness status for a pull request
pub async fn get_pr_merge_status(repo_dir: &str, pr_number: u64) -> Option<PrMergeStatus> {
    client::default_client()
        .get_pr_merge_status(repo_dir, pr_number)
        .await
        .ok()
        .flatten()
}

/// Fetch failure log for a CI run. Truncated to 50KB.
pub async fn get_ci_failure_log(repo_dir: &str, run_id: u64) -> Option<CiFailureLog> {
    client::default_client()
        .get_ci_failure_log(repo_dir, run_id)
        .await
        .ok()
        .flatten()
}

/// Re-run failed jobs for a CI workflow run.
pub async fn rerun_failed_checks(repo_dir: &str, run_id: u64) -> Option<()> {
    client::default_client()
        .rerun_failed_checks(repo_dir, run_id)
        .await
        .ok()
}

/// Merge a pull request. Checks merge readiness first, invalidates the PR
/// cache on success so the next read reflects the merged state immediately.
pub async fn merge_pr(
    repo_dir: &str,
    pr_number: u64,
    method: MergeMethod,
    delete_branch: bool,
) -> Result<MergeResult, String> {
    let result = client::default_client()
        .merge_pr(repo_dir, pr_number, method, delete_branch)
        .await
        .map_err(|e| e.to_string())?;

    // Invalidate PR cache after successful merge — kept here (not on the
    // trait) so the cache stays a concern of the outer layer and any
    // GhClient impl can be dropped in without re-implementing invalidation.
    {
        let mut cache = GH_CACHE.prs.write().await;
        cache.remove(repo_dir);
    }

    Ok(result)
}

/// Submit a review on a pull request via [`GhClient::review_pr`].
pub async fn review_pr(
    repo_dir: &str,
    pr_number: u64,
    action: ReviewAction,
    body: Option<&str>,
) -> Result<ReviewResult, String> {
    client::default_client()
        .review_pr(repo_dir, pr_number, action, body)
        .await
        .map_err(|e| e.to_string())
}

/// Extract issue numbers from a branch name
///
/// Matches patterns like: `fix/123-desc`, `feat/42`, `issue-7`, `gh-99`
pub fn extract_issue_numbers(branch: &str) -> Vec<u64> {
    let mut numbers = Vec::new();
    for part in branch.split(&['/', '-', '_'][..]) {
        if let Ok(n) = part.parse::<u64>() {
            if n > 0 && n < 100_000 {
                numbers.push(n);
            }
        }
    }
    numbers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_method_serde_roundtrip() {
        let squash: MergeMethod = serde_json::from_str("\"squash\"").unwrap();
        assert_eq!(squash, MergeMethod::Squash);
        assert_eq!(squash.as_flag(), "--squash");

        let merge: MergeMethod = serde_json::from_str("\"merge\"").unwrap();
        assert_eq!(merge, MergeMethod::Merge);
        assert_eq!(merge.as_flag(), "--merge");

        let rebase: MergeMethod = serde_json::from_str("\"rebase\"").unwrap();
        assert_eq!(rebase, MergeMethod::Rebase);
        assert_eq!(rebase.as_flag(), "--rebase");
    }

    #[test]
    fn merge_result_serializes_correctly() {
        let result = MergeResult {
            pr_number: 42,
            merged: true,
            method: "squash".to_string(),
            message: "Merged".to_string(),
            branch_deleted: true,
            worktree_cleanup: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["pr_number"], 42);
        assert_eq!(json["merged"], true);
        assert_eq!(json["method"], "squash");
        assert_eq!(json["branch_deleted"], true);
        assert!(json.get("worktree_cleanup").is_none());
    }

    #[test]
    fn merge_result_includes_worktree_cleanup() {
        let result = MergeResult {
            pr_number: 10,
            merged: true,
            method: "rebase".to_string(),
            message: "Done".to_string(),
            branch_deleted: false,
            worktree_cleanup: Some("Deleted worktree: feat-branch".to_string()),
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["worktree_cleanup"], "Deleted worktree: feat-branch");
    }

    #[test]
    fn review_action_serde_roundtrip() {
        let approve: ReviewAction = serde_json::from_str("\"approve\"").unwrap();
        assert_eq!(approve, ReviewAction::Approve);
        assert_eq!(approve.as_flag(), "--approve");

        let request_changes: ReviewAction = serde_json::from_str("\"request_changes\"").unwrap();
        assert_eq!(request_changes, ReviewAction::RequestChanges);
        assert_eq!(request_changes.as_flag(), "--request-changes");

        let comment: ReviewAction = serde_json::from_str("\"comment\"").unwrap();
        assert_eq!(comment, ReviewAction::Comment);
        assert_eq!(comment.as_flag(), "--comment");
    }

    #[test]
    fn review_result_serializes_correctly() {
        let result = ReviewResult {
            pr_number: 42,
            action: "approve".to_string(),
            message: "Approved".to_string(),
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["pr_number"], 42);
        assert_eq!(json["action"], "approve");
        assert_eq!(json["message"], "Approved");
    }

    #[test]
    fn test_parse_issue_detail_json() {
        let json = serde_json::json!({
            "number": 159,
            "title": "feat: add issue detail view",
            "state": "OPEN",
            "url": "https://github.com/test/repo/issues/159",
            "body": "## Problem\n\nSome description here.",
            "labels": [
                {"name": "enhancement", "color": "a2eeef"}
            ],
            "assignees": [
                {"login": "alice"},
                {"login": "bob"}
            ],
            "createdAt": "2026-03-31T16:53:44Z",
            "updatedAt": "2026-03-31T16:58:12Z",
            "comments": [
                {
                    "author": {"login": "coderabbitai"},
                    "body": "Review comment here",
                    "createdAt": "2026-03-31T16:58:12Z",
                    "url": "https://github.com/test/repo/issues/159#comment-1"
                }
            ]
        });

        let detail = parse_issue_detail_json(&json).expect("should parse valid JSON");
        assert_eq!(detail.number, 159);
        assert_eq!(detail.title, "feat: add issue detail view");
        assert_eq!(detail.state, "OPEN");
        assert_eq!(detail.body, "## Problem\n\nSome description here.");
        assert_eq!(detail.labels.len(), 1);
        assert_eq!(detail.labels[0].name, "enhancement");
        assert_eq!(detail.assignees, vec!["alice", "bob"]);
        assert_eq!(detail.comments.len(), 1);
        assert_eq!(detail.comments[0].author, "coderabbitai");
        assert_eq!(detail.created_at, "2026-03-31T16:53:44Z");
        assert_eq!(detail.updated_at, "2026-03-31T16:58:12Z");
    }

    #[test]
    fn test_parse_issue_detail_json_minimal() {
        let json = serde_json::json!({
            "number": 1,
            "title": "minimal",
            "state": "CLOSED",
            "url": "https://example.com/issues/1"
        });

        let detail = parse_issue_detail_json(&json).expect("should parse minimal JSON");
        assert_eq!(detail.number, 1);
        assert_eq!(detail.state, "CLOSED");
        assert!(detail.body.is_empty());
        assert!(detail.labels.is_empty());
        assert!(detail.assignees.is_empty());
        assert!(detail.comments.is_empty());
    }

    #[test]
    fn test_parse_issue_detail_json_missing_required() {
        let json = serde_json::json!({"title": "no number"});
        assert!(parse_issue_detail_json(&json).is_none());
    }

    #[test]
    fn test_has_merged_pr_json_parsing() {
        // Non-empty array → branch has a merged PR
        let non_empty = b"[{\"number\":42}]";
        let parsed: Vec<serde_json::Value> = serde_json::from_slice(non_empty).unwrap();
        assert!(!parsed.is_empty());

        // Empty array → no merged PR
        let empty = b"[]";
        let parsed: Vec<serde_json::Value> = serde_json::from_slice(empty).unwrap();
        assert!(parsed.is_empty());

        // Invalid JSON → should not panic
        let invalid = b"not json";
        let result = serde_json::from_slice::<Vec<serde_json::Value>>(invalid);
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_issue_numbers() {
        assert_eq!(extract_issue_numbers("fix/123-login-bug"), vec![123]);
        assert_eq!(extract_issue_numbers("feat/42"), vec![42]);
        assert_eq!(extract_issue_numbers("issue-7-auth"), vec![7]);
        assert_eq!(extract_issue_numbers("gh-99"), vec![99]);
        assert_eq!(extract_issue_numbers("main"), Vec::<u64>::new());
        assert_eq!(extract_issue_numbers("feat/no-number"), Vec::<u64>::new());
        // Ignore zero and very large numbers
        assert_eq!(extract_issue_numbers("fix/0-test"), Vec::<u64>::new());
    }

    /// Helper to build GhCheckRun for tests
    fn check_run(conclusion: Option<&str>, status: Option<&str>) -> GhCheckRun {
        GhCheckRun {
            conclusion: conclusion.map(|s| s.to_string()),
            status: status.map(|s| s.to_string()),
        }
    }

    #[test]
    fn test_compute_rollup_empty() {
        let checks: Vec<GhCheckRun> = vec![];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Unknown));
    }

    #[test]
    fn test_compute_rollup_all_success_uppercase() {
        let checks = vec![
            check_run(Some("SUCCESS"), Some("COMPLETED")),
            check_run(Some("SUCCESS"), Some("COMPLETED")),
        ];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Success));
    }

    #[test]
    fn test_compute_rollup_ci_check_success() {
        let checks = vec![CiCheck {
            name: "build".into(),
            status: CiRunStatus::Completed,
            conclusion: Some(CiConclusion::Success),
            url: String::new(),
            started_at: None,
            completed_at: None,
            run_id: None,
        }];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Success));
    }

    #[test]
    fn test_compute_rollup_ci_check_pending() {
        let checks = vec![CiCheck {
            name: "build".into(),
            status: CiRunStatus::InProgress,
            conclusion: None,
            url: String::new(),
            started_at: None,
            completed_at: None,
            run_id: None,
        }];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Pending));
    }

    #[test]
    fn test_compute_rollup_ci_check_failure() {
        let checks = vec![CiCheck {
            name: "build".into(),
            status: CiRunStatus::Completed,
            conclusion: Some(CiConclusion::Failure),
            url: String::new(),
            started_at: None,
            completed_at: None,
            run_id: None,
        }];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Failure));
    }

    #[test]
    fn test_ci_conclusion_is_failure() {
        assert!(CiConclusion::Failure.is_failure());
        assert!(CiConclusion::TimedOut.is_failure());
        assert!(CiConclusion::Cancelled.is_failure());
        assert!(!CiConclusion::Success.is_failure());
        assert!(!CiConclusion::Neutral.is_failure());
        assert!(!CiConclusion::Skipped.is_failure());
        assert!(!CiConclusion::ActionRequired.is_failure());
        assert!(!CiConclusion::Unknown.is_failure());
    }

    #[test]
    fn test_ci_run_status_is_pending() {
        assert!(CiRunStatus::Queued.is_pending());
        assert!(CiRunStatus::InProgress.is_pending());
        assert!(CiRunStatus::Waiting.is_pending());
        assert!(CiRunStatus::Pending.is_pending());
        assert!(CiRunStatus::Requested.is_pending());
        assert!(!CiRunStatus::Completed.is_pending());
        assert!(!CiRunStatus::Unknown.is_pending());
    }

    #[test]
    fn test_ci_run_status_serde_roundtrip() {
        let status = CiRunStatus::InProgress;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"in_progress\"");
        let parsed: CiRunStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, CiRunStatus::InProgress);
    }

    #[test]
    fn test_ci_conclusion_serde_roundtrip() {
        let conclusion = CiConclusion::TimedOut;
        let json = serde_json::to_string(&conclusion).unwrap();
        assert_eq!(json, "\"timed_out\"");
        let parsed: CiConclusion = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, CiConclusion::TimedOut);
    }

    #[test]
    fn test_ci_run_status_unknown_fallback() {
        let parsed: CiRunStatus = serde_json::from_str("\"some_future_status\"").unwrap();
        assert_eq!(parsed, CiRunStatus::Unknown);
    }

    #[test]
    fn test_ci_conclusion_unknown_fallback() {
        let parsed: CiConclusion = serde_json::from_str("\"stale\"").unwrap();
        assert_eq!(parsed, CiConclusion::Unknown);
    }

    #[test]
    fn test_compute_rollup_failure_takes_precedence() {
        let checks = vec![
            check_run(Some("SUCCESS"), Some("COMPLETED")),
            check_run(Some("FAILURE"), Some("COMPLETED")),
        ];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Failure));
    }

    #[test]
    fn test_compute_rollup_timed_out_is_failure() {
        let checks = vec![check_run(Some("timed_out"), Some("completed"))];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Failure));
    }

    #[test]
    fn test_compute_rollup_cancelled_is_failure() {
        let checks = vec![check_run(Some("CANCELLED"), Some("COMPLETED"))];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Failure));
    }

    #[test]
    fn test_compute_rollup_pending_statuses() {
        for status in &["IN_PROGRESS", "QUEUED", "WAITING", "PENDING", "REQUESTED"] {
            let checks = vec![check_run(None, Some(status))];
            assert!(
                matches!(compute_rollup(&checks), CheckStatus::Pending),
                "expected Pending for status={status}"
            );
        }
    }

    #[test]
    fn test_compute_rollup_pending_lowercase() {
        let checks = vec![check_run(None, Some("in_progress"))];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Pending));
    }

    #[test]
    fn test_build_pr_comments_full() {
        let json = serde_json::json!({
            "comments": [
                {
                    "author": {"login": "alice"},
                    "body": "Looks good",
                    "createdAt": "2026-04-10T10:00:00Z",
                    "url": "https://example.com/c/1"
                },
                {
                    "author": null,
                    "body": "",
                    "createdAt": "2026-04-10T09:00:00Z"
                }
            ],
            "reviews": [
                {
                    "author": {"login": "bob"},
                    "body": "Please revise",
                    "state": "CHANGES_REQUESTED",
                    "submittedAt": "2026-04-10T11:00:00Z",
                    "comments": [
                        {
                            "body": "nit",
                            "createdAt": "2026-04-10T11:05:00Z",
                            "url": "https://example.com/r/1",
                            "path": "src/lib.rs",
                            "diffHunk": "@@ -1,1 +1,1 @@"
                        }
                    ]
                },
                {
                    "author": {"login": "carol"},
                    "body": "",
                    "state": "APPROVED",
                    "createdAt": "2026-04-10T12:00:00Z"
                }
            ]
        });

        let resp: GhPrCommentsResponse = serde_json::from_value(json).unwrap();
        let out = build_pr_comments(resp);

        // 2 conversation + 1 review body + 1 inline = 4 (empty review body skipped)
        assert_eq!(out.len(), 4);

        // Sorted by created_at ascending
        assert_eq!(out[0].created_at, "2026-04-10T09:00:00Z");
        assert_eq!(out[0].author, "unknown");
        assert_eq!(out[0].comment_type, "comment");

        assert_eq!(out[1].created_at, "2026-04-10T10:00:00Z");
        assert_eq!(out[1].author, "alice");
        assert_eq!(out[1].body, "Looks good");

        assert_eq!(out[2].created_at, "2026-04-10T11:00:00Z");
        assert_eq!(out[2].author, "bob");
        assert_eq!(out[2].body, "[CHANGES_REQUESTED] Please revise");
        assert_eq!(out[2].comment_type, "review");

        assert_eq!(out[3].created_at, "2026-04-10T11:05:00Z");
        assert_eq!(out[3].author, "bob");
        assert_eq!(out[3].path.as_deref(), Some("src/lib.rs"));
        assert_eq!(out[3].diff_hunk.as_deref(), Some("@@ -1,1 +1,1 @@"));
    }

    #[test]
    fn test_build_pr_comments_empty() {
        let resp: GhPrCommentsResponse = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(build_pr_comments(resp).is_empty());
    }

    #[test]
    fn test_build_pr_comments_review_created_at_fallback() {
        // Review has body but only createdAt (no submittedAt) — should use createdAt
        let json = serde_json::json!({
            "reviews": [
                {
                    "author": {"login": "dave"},
                    "body": "nit",
                    "state": "COMMENTED",
                    "createdAt": "2026-04-11T00:00:00Z"
                }
            ]
        });
        let resp: GhPrCommentsResponse = serde_json::from_value(json).unwrap();
        let out = build_pr_comments(resp);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].created_at, "2026-04-11T00:00:00Z");
    }

    #[test]
    fn test_compute_rollup_failure_beats_pending() {
        let checks = vec![
            check_run(Some("FAILURE"), Some("COMPLETED")),
            check_run(None, Some("IN_PROGRESS")),
        ];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Failure));
    }
}
