use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;

/// Timeout for gh CLI commands
const GH_TIMEOUT: Duration = Duration::from_secs(10);

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
    pub url: String,
    pub review_decision: Option<ReviewDecision>,
    pub check_status: Option<CheckStatus>,
    pub is_draft: bool,
    pub additions: u64,
    pub deletions: u64,
}

/// Raw PR data from gh CLI JSON output
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPrEntry {
    number: u64,
    title: String,
    state: String,
    head_ref_name: String,
    url: String,
    review_decision: Option<String>,
    status_check_rollup: Option<Vec<GhCheckRun>>,
    is_draft: bool,
    additions: Option<u64>,
    deletions: Option<u64>,
}

/// Individual check run from statusCheckRollup
#[derive(Debug, serde::Deserialize)]
struct GhCheckRun {
    conclusion: Option<String>,
    status: Option<String>,
}

/// Fetch open PRs for a repository using gh CLI
///
/// Returns a map of head_branch -> PrInfo for quick lookup.
pub async fn list_open_prs(repo_dir: &str) -> Option<HashMap<String, PrInfo>> {
    let output = tokio::time::timeout(
        GH_TIMEOUT,
        Command::new("gh")
            .args([
                "pr",
                "list",
                "--state",
                "open",
                "--json",
                "number,title,state,headRefName,url,reviewDecision,statusCheckRollup,isDraft,additions,deletions",
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
                c.status.as_deref() == Some("IN_PROGRESS")
                    || c.status.as_deref() == Some("QUEUED")
                    || c.conclusion.is_none()
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
            url: entry.url,
            review_decision,
            check_status,
            is_draft: entry.is_draft,
            additions: entry.additions.unwrap_or(0),
            deletions: entry.deletions.unwrap_or(0),
        };
        map.insert(entry.head_ref_name, pr);
    }

    Some(map)
}
