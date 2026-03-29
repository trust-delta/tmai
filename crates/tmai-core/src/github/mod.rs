//! GitHub integration via `gh` CLI — fetches PR, CI, and issue data.

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
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReviewDecision {
    Approved,
    ChangesRequested,
    ReviewRequired,
    #[serde(other)]
    Unknown,
}

/// CI/check status rollup
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CheckStatus {
    Success,
    Failure,
    Pending,
    #[serde(other)]
    Unknown,
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
        let check_status = entry.status_check_rollup.as_ref().map(|checks| {
            if checks.is_empty() {
                return CheckStatus::Unknown;
            }
            let has_failure = checks.iter().any(|c| {
                c.conclusion.as_deref() == Some("FAILURE")
                    || c.conclusion.as_deref() == Some("TIMED_OUT")
                    || c.conclusion.as_deref() == Some("CANCELLED")
            });
            if has_failure {
                return CheckStatus::Failure;
            }
            let has_pending = checks.iter().any(|c| {
                matches!(
                    c.status.as_deref(),
                    Some("IN_PROGRESS")
                        | Some("QUEUED")
                        | Some("WAITING")
                        | Some("PENDING")
                        | Some("REQUESTED")
                )
            });
            if has_pending {
                return CheckStatus::Pending;
            }
            CheckStatus::Success
        });

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

/// A single CI check / workflow run
#[derive(Debug, Clone, serde::Serialize)]
pub struct CiCheck {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
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
    pub check_status: Option<String>,
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
    status: String,
    conclusion: Option<String>,
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
fn compute_rollup(checks: &[CiCheck]) -> CheckStatus {
    if checks.is_empty() {
        return CheckStatus::Unknown;
    }
    let has_failure = checks.iter().any(|c| {
        matches!(
            c.conclusion.as_deref(),
            Some("failure") | Some("timed_out") | Some("cancelled")
        )
    });
    if has_failure {
        return CheckStatus::Failure;
    }
    let has_pending = checks.iter().any(|c| {
        matches!(
            c.status.as_str(),
            "in_progress" | "queued" | "waiting" | "pending" | "requested"
        )
    });
    if has_pending {
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
}

/// Raw issue from `gh issue list`
#[derive(Debug, serde::Deserialize)]
struct GhIssueEntry {
    number: u64,
    title: String,
    state: String,
    url: String,
    labels: Vec<IssueLabel>,
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
                "number,title,state,url,labels",
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

    // Compute check status from statusCheckRollup
    let check_status = json
        .get("statusCheckRollup")
        .and_then(|v| v.as_array())
        .map(|checks| {
            if checks.is_empty() {
                return "UNKNOWN".to_string();
            }
            let has_failure = checks.iter().any(|c| {
                matches!(
                    c.get("conclusion").and_then(|v| v.as_str()),
                    Some("FAILURE") | Some("TIMED_OUT") | Some("CANCELLED")
                )
            });
            if has_failure {
                return "FAILURE".to_string();
            }
            let has_pending = checks.iter().any(|c| {
                matches!(
                    c.get("status").and_then(|v| v.as_str()),
                    Some("IN_PROGRESS")
                        | Some("QUEUED")
                        | Some("WAITING")
                        | Some("PENDING")
                        | Some("REQUESTED")
                )
            });
            if has_pending {
                return "PENDING".to_string();
            }
            "SUCCESS".to_string()
        });

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
}
