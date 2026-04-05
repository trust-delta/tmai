//! GitHub integration via `gh` CLI — fetches PR, CI, and issue data.

pub mod pr_monitor;

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::RwLock;

/// Timeout for gh CLI commands
const GH_TIMEOUT: Duration = Duration::from_secs(10);

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
    /// Merge commit SHA (only for merged PRs)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_commit_sha: Option<String>,
}

/// Raw PR data from gh CLI JSON output
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPrEntry {
    number: u64,
    title: String,
    state: String,
    head_ref_name: String,
    head_ref_oid: String,
    base_ref_name: String,
    url: String,
    review_decision: Option<String>,
    status_check_rollup: Option<Vec<GhCheckRun>>,
    is_draft: bool,
    additions: Option<u64>,
    deletions: Option<u64>,
    comments: Option<Vec<serde_json::Value>>,
    reviews: Option<Vec<serde_json::Value>>,
}

/// Individual check run from statusCheckRollup
#[derive(Debug, serde::Deserialize)]
struct GhCheckRun {
    conclusion: Option<String>,
    status: Option<String>,
}

/// Trait for types that carry CI check conclusion/status (used by compute_rollup)
trait CheckRunLike {
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

/// Fetch open PRs for a repository using gh CLI (cached with 30s TTL)
///
/// Returns a map of head_branch -> PrInfo for quick lookup.
pub async fn list_open_prs(repo_dir: &str) -> Option<HashMap<String, PrInfo>> {
    // Check cache first
    {
        let cache_read = GH_CACHE.prs.read().await;
        if let Some(entry) = cache_read.get(repo_dir) {
            if entry.fetched_at.elapsed() < CACHE_TTL {
                return Some(entry.data.clone());
            }
        }
    }

    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "pr",
                "list",
                "--state",
                "open",
                "--json",
                "number,title,state,headRefName,headRefOid,baseRefName,url,reviewDecision,statusCheckRollup,isDraft,additions,deletions,comments,reviews",
                "--limit",
                "50",
            ])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    let entries: Vec<GhPrEntry> = serde_json::from_slice(&output.stdout).ok()?;

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
            merge_commit_sha: None,
        };
        map.insert(entry.head_ref_name, pr);
    }

    // Store in cache
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
struct GhMergedPrEntry {
    number: u64,
    title: String,
    head_ref_name: String,
    head_ref_oid: String,
    base_ref_name: String,
    url: String,
    merge_commit: Option<GhMergeCommit>,
}

/// Merge commit info from gh CLI
#[derive(Debug, serde::Deserialize)]
struct GhMergeCommit {
    oid: String,
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
    if local_branches.is_empty() {
        return Some(HashMap::new());
    }

    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "pr",
                "list",
                "--state",
                "merged",
                "--json",
                "number,title,headRefName,headRefOid,baseRefName,url,mergeCommit",
                "--limit",
                "30",
            ])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    let entries: Vec<GhMergedPrEntry> = serde_json::from_slice(&output.stdout).ok()?;

    // Build a set for O(1) lookup
    let branch_set: std::collections::HashSet<&str> =
        local_branches.iter().map(|s| s.as_str()).collect();

    let mut map = HashMap::new();
    for entry in entries {
        // Only include PRs whose head branch still exists locally
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
            merge_commit_sha,
        };
        map.insert(entry.head_ref_name, pr);
    }

    Some(map)
}

/// Check if a specific branch has an associated merged PR.
///
/// Uses `gh pr list --state merged --head <branch>` to detect squash-merged
/// branches that `git branch -d` would refuse to delete.
/// Returns `true` if at least one merged PR exists for the given branch.
pub async fn has_merged_pr(repo_dir: &str, branch: &str) -> bool {
    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "pr", "list", "--state", "merged", "--head", branch, "--json", "number", "--limit",
                "1",
            ])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    match output {
        Some(o) if o.status.success() => {
            // Parse JSON array — non-empty means at least one merged PR
            serde_json::from_slice::<Vec<serde_json::Value>>(&o.stdout)
                .map(|v| !v.is_empty())
                .unwrap_or(false)
        }
        _ => false,
    }
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
    fn as_flag(self) -> &'static str {
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
    fn as_flag(self) -> &'static str {
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
struct GhRunEntry {
    name: String,
    status: CiRunStatus,
    conclusion: Option<CiConclusion>,
    url: String,
    head_branch: String,
    created_at: Option<String>,
    updated_at: Option<String>,
    database_id: Option<u64>,
}

/// Fetch CI checks for a specific branch
///
/// Uses `gh run list --branch <branch>` to get recent workflow runs.
pub async fn list_checks(repo_dir: &str, branch: &str) -> Option<CiSummary> {
    if branch.is_empty() || branch.starts_with('-') {
        return None;
    }

    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "run",
                "list",
                "--branch",
                branch,
                "--json",
                "name,status,conclusion,url,headBranch,createdAt,updatedAt,databaseId",
                "--limit",
                "10",
            ])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    let entries: Vec<GhRunEntry> = serde_json::from_slice(&output.stdout).ok()?;

    // Deduplicate by workflow name (keep most recent = first in list)
    let mut seen = std::collections::HashSet::new();
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

    // Compute rollup from individual checks
    let rollup = compute_rollup(&checks);

    Some(CiSummary {
        branch: branch.to_string(),
        checks,
        rollup,
    })
}

/// Compute rollup status from a list of checks
fn compute_rollup<T: CheckRunLike>(checks: &[T]) -> CheckStatus {
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
struct GhAssignee {
    login: String,
}

/// Raw issue from `gh issue list`
#[derive(Debug, serde::Deserialize)]
struct GhIssueEntry {
    number: u64,
    title: String,
    state: String,
    url: String,
    labels: Vec<IssueLabel>,
    #[serde(default)]
    assignees: Vec<GhAssignee>,
}

/// Fetch open issues for a repository using gh CLI (cached with 30s TTL)
pub async fn list_issues(repo_dir: &str) -> Option<Vec<IssueInfo>> {
    // Check cache first
    {
        let cache_read = GH_CACHE.issues.read().await;
        if let Some(entry) = cache_read.get(repo_dir) {
            if entry.fetched_at.elapsed() < CACHE_TTL {
                return Some(entry.data.clone());
            }
        }
    }

    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "issue",
                "list",
                "--state",
                "open",
                "--json",
                "number,title,state,url,labels,assignees",
                "--limit",
                "50",
            ])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    let entries: Vec<GhIssueEntry> = serde_json::from_slice(&output.stdout).ok()?;

    let issues: Vec<IssueInfo> = entries
        .into_iter()
        .map(|e| IssueInfo {
            number: e.number,
            title: e.title,
            state: e.state,
            url: e.url,
            labels: e.labels,
            assignees: e.assignees.into_iter().map(|a| a.login).collect(),
        })
        .collect();

    // Store in cache
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
    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "issue",
                "view",
                &issue_number.to_string(),
                "--json",
                "number,title,state,url,body,labels,assignees,createdAt,updatedAt,comments",
            ])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    let val: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    parse_issue_detail_json(&val)
}

/// Parse gh issue view JSON into IssueDetail
fn parse_issue_detail_json(val: &serde_json::Value) -> Option<IssueDetail> {
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
    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "pr",
                "view",
                &pr_number.to_string(),
                "--json",
                "comments,reviews",
            ])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;

    let mut result = Vec::new();

    // Conversation comments: {author:{login}, body, createdAt, url}
    if let Some(comments) = json.get("comments").and_then(|v| v.as_array()) {
        for c in comments {
            let author = c
                .pointer("/author/login")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let body = c
                .get("body")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let created_at = c
                .get("createdAt")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let url = c
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            result.push(PrComment {
                author,
                body,
                created_at,
                url,
                comment_type: "comment".to_string(),
                path: None,
                diff_hunk: None,
            });
        }
    }

    // Reviews: {author:{login}, body, state, comments:[{path, body, diffHunk, createdAt, url}]}
    if let Some(reviews) = json.get("reviews").and_then(|v| v.as_array()) {
        for r in reviews {
            let review_author = r
                .pointer("/author/login")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();

            // Top-level review body (if non-empty)
            let review_body = r
                .get("body")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !review_body.is_empty() {
                let review_state = r
                    .get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let created_at = r
                    .get("submittedAt")
                    .or_else(|| r.get("createdAt"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                result.push(PrComment {
                    author: review_author.clone(),
                    body: format!("[{}] {}", review_state, review_body),
                    created_at,
                    url: String::new(),
                    comment_type: "review".to_string(),
                    path: None,
                    diff_hunk: None,
                });
            }

            // Inline review comments
            if let Some(comments) = r.get("comments").and_then(|v| v.as_array()) {
                for c in comments {
                    let body = c
                        .get("body")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let created_at = c
                        .get("createdAt")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let url = c
                        .get("url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let path = c
                        .get("path")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let diff_hunk = c
                        .get("diffHunk")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    result.push(PrComment {
                        author: review_author.clone(),
                        body,
                        created_at,
                        url,
                        comment_type: "review".to_string(),
                        path,
                        diff_hunk,
                    });
                }
            }
        }
    }

    // Sort by created_at
    result.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    Some(result)
}

/// Fetch changed files for a pull request
pub async fn get_pr_files(repo_dir: &str, pr_number: u64) -> Option<Vec<PrChangedFile>> {
    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args(["pr", "view", &pr_number.to_string(), "--json", "files"])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

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

    let resp: FilesResponse = serde_json::from_slice(&output.stdout).ok()?;

    Some(
        resp.files
            .into_iter()
            .map(|f| PrChangedFile {
                path: f.path,
                additions: f.additions,
                deletions: f.deletions,
            })
            .collect(),
    )
}

/// Fetch merge readiness status for a pull request
pub async fn get_pr_merge_status(repo_dir: &str, pr_number: u64) -> Option<PrMergeStatus> {
    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "pr",
                "view",
                &pr_number.to_string(),
                "--json",
                "mergeable,mergeStateStatus,reviewDecision,statusCheckRollup",
            ])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;

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

    // Compute check status from statusCheckRollup using shared compute_rollup()
    let check_status: Option<CheckStatus> = json
        .get("statusCheckRollup")
        .and_then(|v| serde_json::from_value::<Vec<GhCheckRun>>(v.clone()).ok())
        .map(|checks| compute_rollup(&checks));

    Some(PrMergeStatus {
        mergeable,
        merge_state_status,
        review_decision,
        check_status,
    })
}

/// Maximum size for CI failure log output (50KB)
const CI_LOG_MAX_BYTES: usize = 50 * 1024;

/// Fetch failure log for a CI run
///
/// Uses `gh run view --log-failed` which returns plain text (not JSON).
/// Output is truncated to 50KB.
pub async fn get_ci_failure_log(repo_dir: &str, run_id: u64) -> Option<CiFailureLog> {
    let output = tokio::time::timeout(
        Duration::from_secs(30), // longer timeout for log fetching
        Command::new("gh")
            .args(["run", "view", &run_id.to_string(), "--log-failed"])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    if output.stdout.is_empty() {
        return None;
    }

    // Truncate to 50KB
    let text = if output.stdout.len() > CI_LOG_MAX_BYTES {
        let truncated = &output.stdout[..CI_LOG_MAX_BYTES];
        // Find last valid UTF-8 boundary
        let s = String::from_utf8_lossy(truncated);
        format!("{}\n\n... (truncated, showing first 50KB)", s)
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    Some(CiFailureLog {
        run_id,
        log_text: text,
    })
}

/// Re-run failed jobs for a CI workflow run
///
/// Uses `gh run rerun <run_id> --failed` to re-trigger only failed jobs.
pub async fn rerun_failed_checks(repo_dir: &str, run_id: u64) -> Option<()> {
    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args(["run", "rerun", &run_id.to_string(), "--failed"])
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if output.status.success() {
        Some(())
    } else {
        None
    }
}

/// Merge a pull request using `gh pr merge`
///
/// Checks merge readiness (CI status, mergeable state) before attempting merge.
/// Optionally deletes the remote branch after successful merge (gh does this by default
/// with `--delete-branch`).
pub async fn merge_pr(
    repo_dir: &str,
    pr_number: u64,
    method: MergeMethod,
    delete_branch: bool,
) -> Result<MergeResult, String> {
    // Pre-flight: check merge readiness
    if let Some(status) = get_pr_merge_status(repo_dir, pr_number).await {
        if status.mergeable == "CONFLICTING" {
            return Err(format!(
                "PR #{} has merge conflicts — resolve conflicts before merging",
                pr_number
            ));
        }
        if let Some(CheckStatus::Failure) = status.check_status {
            return Err(format!(
                "PR #{} has failing CI checks — fix CI before merging",
                pr_number
            ));
        }
        if let Some(CheckStatus::Pending) = status.check_status {
            return Err(format!(
                "PR #{} has pending CI checks — wait for CI to complete before merging",
                pr_number
            ));
        }
    }

    let mut args = vec![
        "pr".to_string(),
        "merge".to_string(),
        pr_number.to_string(),
        method.as_flag().to_string(),
    ];
    if delete_branch {
        args.push("--delete-branch".to_string());
    }

    let output = tokio::time::timeout(
        Duration::from_secs(30), // longer timeout for merge operations
        Command::new("gh")
            .args(&args)
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .map_err(|_| "gh pr merge timed out".to_string())?
    .map_err(|e| format!("Failed to run gh: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(format!("gh pr merge failed: {}", stderr));
    }

    // Invalidate PR cache after successful merge
    {
        let mut cache = GH_CACHE.prs.write().await;
        cache.remove(repo_dir);
    }

    let message = if stdout.is_empty() {
        stderr.clone()
    } else {
        stdout
    };

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
}

/// Submit a review on a pull request via `gh pr review`
pub async fn review_pr(
    repo_dir: &str,
    pr_number: u64,
    action: ReviewAction,
    body: Option<&str>,
) -> Result<ReviewResult, String> {
    let mut args = vec![
        "pr".to_string(),
        "review".to_string(),
        pr_number.to_string(),
        action.as_flag().to_string(),
    ];
    if let Some(body_text) = body {
        args.push("--body".to_string());
        args.push(body_text.to_string());
    }

    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args(&args)
            .current_dir(repo_dir)
            .output(),
    )
    .await
    .map_err(|_| "gh pr review timed out".to_string())?
    .map_err(|e| format!("Failed to run gh: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(format!("gh pr review failed: {}", stderr));
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
    }

    #[test]
    fn test_ci_run_status_is_pending() {
        assert!(CiRunStatus::Queued.is_pending());
        assert!(CiRunStatus::InProgress.is_pending());
        assert!(CiRunStatus::Waiting.is_pending());
        assert!(CiRunStatus::Pending.is_pending());
        assert!(CiRunStatus::Requested.is_pending());
        assert!(!CiRunStatus::Completed.is_pending());
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
    fn test_compute_rollup_failure_beats_pending() {
        let checks = vec![
            check_run(Some("FAILURE"), Some("COMPLETED")),
            check_run(None, Some("IN_PROGRESS")),
        ];
        assert!(matches!(compute_rollup(&checks), CheckStatus::Failure));
    }
}
