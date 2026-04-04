use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use tokio::process::Command;

/// Timeout for git commands to prevent hanging on unresponsive repos
const GIT_TIMEOUT: Duration = Duration::from_secs(5);

/// Git information for a working directory
#[derive(Debug, Clone)]
pub struct GitInfo {
    /// Current branch name
    pub branch: String,
    /// Whether the working tree has uncommitted changes
    pub dirty: bool,
    /// Whether this directory is a git worktree (not the main repo)
    pub is_worktree: bool,
    /// Absolute path to the shared git common directory (same as .git dir for main repo)
    pub common_dir: Option<String>,
}

/// Cache for git information with TTL
pub struct GitCache {
    cache: HashMap<String, (Option<GitInfo>, Instant)>,
    ttl_secs: u64,
}

impl Default for GitCache {
    fn default() -> Self {
        Self::new()
    }
}

impl GitCache {
    /// Create a new GitCache with default TTL of 10 seconds
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
            ttl_secs: 10,
        }
    }

    /// Get git info for a directory, using cache if available.
    /// Fetches fresh info from git if cache is expired or missing.
    pub async fn get_info(&mut self, dir: &str) -> Option<GitInfo> {
        // Check cache (includes negative cache for non-git directories)
        if let Some((info, ts)) = self.cache.get(dir) {
            if ts.elapsed().as_secs() < self.ttl_secs {
                return info.clone();
            }
        }

        // Fetch fresh info
        let info = fetch_git_info(dir).await;
        self.cache
            .insert(dir.to_string(), (info.clone(), Instant::now()));
        info
    }

    /// Get cached git info without fetching from git.
    /// Returns None if no cached entry exists or cache is expired.
    pub fn get_cached(&self, dir: &str) -> Option<GitInfo> {
        if let Some((info, ts)) = self.cache.get(dir) {
            if ts.elapsed().as_secs() < self.ttl_secs {
                return info.clone();
            }
        }
        None
    }

    /// Remove expired entries from cache
    pub fn cleanup(&mut self) {
        self.cache
            .retain(|_, (_, ts)| ts.elapsed().as_secs() < self.ttl_secs * 3);
    }
}

/// Fetch all git info for a directory (branch, dirty, worktree) with timeout
async fn fetch_git_info(dir: &str) -> Option<GitInfo> {
    let branch = fetch_branch(dir).await?;
    // Run dirty and worktree checks in parallel
    let (dirty, (is_worktree, common_dir)) =
        tokio::join!(fetch_dirty(dir), fetch_worktree_info(dir));
    Some(GitInfo {
        branch,
        dirty,
        is_worktree,
        common_dir,
    })
}

/// Fetch the current branch name for a directory
async fn fetch_branch(dir: &str) -> Option<String> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"])
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Check if the working tree has uncommitted changes
async fn fetch_dirty(dir: &str) -> bool {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", dir, "status", "--porcelain"])
            .output(),
    )
    .await;
    match output {
        Ok(Ok(o)) => !o.stdout.is_empty(),
        _ => false,
    }
}

/// Check if the directory is a git worktree and return the common dir
///
/// Returns `(is_worktree, common_dir)` where `common_dir` is the absolute
/// path to the shared git directory. For worktrees this differs from git-dir;
/// for the main repo they are the same.
async fn fetch_worktree_info(dir: &str) -> (bool, Option<String>) {
    let results = tokio::join!(
        tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args(["-C", dir, "rev-parse", "--git-dir"])
                .output(),
        ),
        tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args(["-C", dir, "rev-parse", "--git-common-dir"])
                .output(),
        ),
    );
    match results {
        (Ok(Ok(gd)), Ok(Ok(cd))) => {
            let gd_str = String::from_utf8_lossy(&gd.stdout).trim().to_string();
            let cd_str = String::from_utf8_lossy(&cd.stdout).trim().to_string();
            let is_worktree = gd_str != cd_str;

            // Resolve common_dir to absolute path (git may return relative like ".")
            // Then strip /.git suffix to get the project root directory.
            let common_dir_path = std::path::Path::new(dir).join(&cd_str);
            let common_dir = common_dir_path
                .canonicalize()
                .ok()
                .map(|p| p.to_string_lossy().to_string())
                .map(|s| {
                    s.strip_suffix("/.git")
                        .or_else(|| s.strip_suffix("/.git/"))
                        .unwrap_or(&s)
                        .to_string()
                });

            (is_worktree, common_dir)
        }
        _ => (false, None),
    }
}

/// Parsed worktree entry from `git worktree list --porcelain`
#[derive(Debug, Clone)]
pub struct WorktreeEntry {
    /// Absolute path to the worktree
    pub path: String,
    /// Branch name (None for detached HEAD)
    pub branch: Option<String>,
    /// Whether this is a bare repository
    pub is_bare: bool,
    /// Whether this is the main working tree (first entry)
    pub is_main: bool,
}

/// List all worktrees for a repository by running `git worktree list --porcelain`
pub async fn list_worktrees(repo_dir: &str) -> Vec<WorktreeEntry> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "worktree", "list", "--porcelain"])
            .output(),
    )
    .await;
    match output {
        Ok(Ok(o)) if o.status.success() => parse_worktree_list(&String::from_utf8_lossy(&o.stdout)),
        _ => Vec::new(),
    }
}

/// Parse `git worktree list --porcelain` output into WorktreeEntry values
fn parse_worktree_list(output: &str) -> Vec<WorktreeEntry> {
    let mut entries = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;
    let mut is_bare = false;
    let mut is_first = true;

    for line in output.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            // Flush previous entry
            if let Some(prev_path) = current_path.take() {
                entries.push(WorktreeEntry {
                    path: prev_path,
                    branch: current_branch.take(),
                    is_bare,
                    is_main: entries.is_empty() && is_first,
                });
                is_first = false;
            }
            current_path = Some(path.to_string());
            current_branch = None;
            is_bare = false;
        } else if let Some(branch_ref) = line.strip_prefix("branch ") {
            // Extract branch name from refs/heads/xxx
            current_branch = Some(
                branch_ref
                    .strip_prefix("refs/heads/")
                    .unwrap_or(branch_ref)
                    .to_string(),
            );
        } else if line == "bare" {
            is_bare = true;
        } else if line == "detached" {
            // detached HEAD: branch stays None
        }
        // Empty lines separate entries but we handle via "worktree" prefix
    }

    // Flush last entry
    if let Some(path) = current_path.take() {
        entries.push(WorktreeEntry {
            path,
            branch: current_branch.take(),
            is_bare,
            is_main: entries.is_empty() && is_first,
        });
    }

    entries
}

/// Diff statistics summary (files changed, insertions, deletions)
#[derive(Debug, Clone, Default)]
pub struct DiffSummary {
    /// Number of files changed
    pub files_changed: usize,
    /// Number of lines inserted
    pub insertions: usize,
    /// Number of lines deleted
    pub deletions: usize,
}

/// Fetch lightweight diff statistics between base branch and HEAD
///
/// Runs `git diff --shortstat <base>...HEAD` and parses the output.
/// Returns None if the command fails or no diff exists.
pub async fn fetch_diff_stat(dir: &str, base_branch: &str) -> Option<DiffSummary> {
    if !is_safe_git_ref(base_branch) {
        return None;
    }
    let diff_spec = format!("{}...HEAD", base_branch);
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", dir, "diff", "--shortstat", &diff_spec])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    parse_shortstat(&text)
}

/// Fetch diff statistics between two explicit branches (not using HEAD)
pub async fn fetch_branch_diff_stat(
    dir: &str,
    branch: &str,
    base_branch: &str,
) -> Option<DiffSummary> {
    if !is_safe_git_ref(base_branch) || !is_safe_git_ref(branch) {
        return None;
    }
    let diff_spec = format!("{}...{}", base_branch, branch);
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", dir, "diff", "--shortstat", &diff_spec])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    parse_shortstat(&text)
}

/// Parse `git diff --shortstat` output into DiffSummary
///
/// Example input: " 3 files changed, 45 insertions(+), 12 deletions(-)\n"
fn parse_shortstat(text: &str) -> Option<DiffSummary> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }

    let mut summary = DiffSummary::default();

    for part in text.split(',') {
        let part = part.trim();
        // Extract the leading number
        let num_str: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
        let num: usize = num_str.parse().unwrap_or(0);

        if part.contains("file") {
            summary.files_changed = num;
        } else if part.contains("insertion") {
            summary.insertions = num;
        } else if part.contains("deletion") {
            summary.deletions = num;
        }
    }

    Some(summary)
}

/// Fetch full diff content between base branch and HEAD (on-demand)
///
/// Runs `git diff <base>...HEAD --stat --patch` and truncates at 100KB.
/// Returns None if the command fails or produces no output.
pub async fn fetch_full_diff(dir: &str, base_branch: &str) -> Option<String> {
    if !is_safe_git_ref(base_branch) {
        return None;
    }
    let diff_spec = format!("{}...HEAD", base_branch);
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new("git")
            .args(["-C", dir, "diff", &diff_spec, "--stat", "--patch"])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        return None;
    }

    // Truncate at 100KB to prevent memory issues with large diffs
    const MAX_DIFF_SIZE: usize = 100 * 1024;
    if text.len() > MAX_DIFF_SIZE {
        let mut truncated = text[..MAX_DIFF_SIZE].to_string();
        truncated.push_str("\n\n... (diff truncated at 100KB) ...\n");
        Some(truncated)
    } else {
        Some(text)
    }
}

/// Remote tracking info for a branch
#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteTrackingInfo {
    /// Remote tracking branch name (e.g., "origin/main")
    pub remote_branch: String,
    /// Commits ahead of remote (need to push)
    pub ahead: usize,
    /// Commits behind remote (need to pull)
    pub behind: usize,
}

/// Result of listing branches for a repository
#[derive(Debug, Clone, serde::Serialize)]
pub struct BranchListResult {
    /// Detected default branch (main, master, etc.)
    pub default_branch: String,
    /// Currently checked-out branch (HEAD)
    pub current_branch: Option<String>,
    /// All local branch names
    pub branches: Vec<String>,
    /// Parent branch map: branch_name → closest ancestor branch
    #[serde(default)]
    pub parents: HashMap<String, String>,
    /// Ahead/behind counts vs default branch: branch_name → (ahead, behind)
    #[serde(default)]
    pub ahead_behind: HashMap<String, (usize, usize)>,
    /// Remote tracking info per branch
    #[serde(default)]
    pub remote_tracking: HashMap<String, RemoteTrackingInfo>,
    /// Remote-only branches (no local counterpart), e.g., "origin/fix-hook-script"
    #[serde(default)]
    pub remote_only_branches: Vec<String>,
    /// Last fetch timestamp (Unix seconds), None if never fetched
    pub last_fetch: Option<u64>,
    /// Last commit timestamp per branch (Unix seconds)
    #[serde(default)]
    pub last_commit_times: HashMap<String, i64>,
}

/// List branches for a repository and detect the default branch
pub async fn list_branches(repo_dir: &str) -> Option<BranchListResult> {
    // List local branches
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "branch", "--format=%(refname:short)"])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let branches: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // Detect default branch: try symbolic-ref, then fallback to main/master
    let default_branch = detect_default_branch(repo_dir).await.unwrap_or_else(|| {
        if branches.contains(&"main".to_string()) {
            "main".to_string()
        } else if branches.contains(&"master".to_string()) {
            "master".to_string()
        } else {
            branches
                .first()
                .cloned()
                .unwrap_or_else(|| "main".to_string())
        }
    });

    // Get current HEAD branch
    let current_branch = fetch_branch(repo_dir).await;

    // Compute parent branch map
    let parents = compute_branch_parents(repo_dir, &branches, &default_branch).await;

    // Compute ahead/behind vs default branch for each branch
    let mut ab_map = HashMap::new();
    for branch in &branches {
        if branch == &default_branch {
            continue;
        }
        if let Some((a, b)) = ahead_behind(repo_dir, branch, &default_branch).await {
            ab_map.insert(branch.clone(), (a, b));
        }
    }

    // Compute remote tracking info
    let remote_tracking = fetch_remote_tracking(repo_dir).await;

    // Get remote-only branches (no local counterpart)
    let remote_only_branches = fetch_remote_only_branches(repo_dir, &branches).await;

    // Get last fetch timestamp
    let last_fetch = fetch_head_time(repo_dir);

    // Get last commit timestamps per branch
    let last_commit_times =
        fetch_last_commit_times(repo_dir, &branches, &remote_only_branches).await;

    Some(BranchListResult {
        default_branch,
        current_branch,
        branches,
        parents,
        ahead_behind: ab_map,
        remote_tracking,
        remote_only_branches,
        last_fetch,
        last_commit_times,
    })
}

/// Fetch remote tracking info for all local branches
///
/// Uses `git for-each-ref` to get upstream tracking and ahead/behind counts.
async fn fetch_remote_tracking(repo_dir: &str) -> HashMap<String, RemoteTrackingInfo> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args([
                "-C",
                repo_dir,
                "for-each-ref",
                "--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)",
                "refs/heads/",
            ])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let mut result = HashMap::new();

    let Some(output) = output else {
        return result;
    };
    if !output.status.success() {
        return result;
    }

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let branch = parts[0].trim();
        let upstream = parts[1].trim();
        let track = parts.get(2).map(|s| s.trim()).unwrap_or("");

        if upstream.is_empty() {
            continue;
        }

        // Parse track: e.g., "[ahead 3]", "[behind 2]", "[ahead 3, behind 2]"
        let (ahead, behind) = parse_track(track);

        result.insert(
            branch.to_string(),
            RemoteTrackingInfo {
                remote_branch: upstream.to_string(),
                ahead,
                behind,
            },
        );
    }

    result
}

/// Fetch remote branches that have no local counterpart
///
/// Returns short names like "origin/fix-hook-script", excluding HEAD and
/// branches that match any local branch name.
async fn fetch_remote_only_branches(repo_dir: &str, local_branches: &[String]) -> Vec<String> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "branch", "-r", "--format=%(refname:short)"])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    let Some(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let local_set: std::collections::HashSet<&str> =
        local_branches.iter().map(|s| s.as_str()).collect();

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| {
            if s.is_empty() || s.contains("->") {
                return false;
            }
            // Extract short name after "origin/" (or any remote prefix)
            let short = s.split('/').skip(1).collect::<Vec<_>>().join("/");
            !local_set.contains(short.as_str())
        })
        .collect()
}

/// Parse git upstream:track format
///
/// Examples: "[ahead 3]", "[behind 2]", "[ahead 3, behind 2]", "[gone]", ""
fn parse_track(track: &str) -> (usize, usize) {
    let mut ahead = 0usize;
    let mut behind = 0usize;

    // Strip brackets
    let inner = track
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or("");

    for part in inner.split(',') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.trim().parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.trim().parse().unwrap_or(0);
        }
    }

    (ahead, behind)
}

/// Get FETCH_HEAD modification time as Unix timestamp
fn fetch_head_time(repo_dir: &str) -> Option<u64> {
    let fetch_head = std::path::Path::new(repo_dir).join(".git/FETCH_HEAD");
    let meta = std::fs::metadata(fetch_head).ok()?;
    let modified = meta.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

/// Fetch last commit timestamp for each local and remote-only branch
async fn fetch_last_commit_times(
    repo_dir: &str,
    branches: &[String],
    remote_only_branches: &[String],
) -> HashMap<String, i64> {
    let mut result = HashMap::new();

    // Fetch timestamps for local branches using for-each-ref
    if !branches.is_empty() {
        if let Ok(Ok(output)) = tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args([
                    "-C",
                    repo_dir,
                    "for-each-ref",
                    "--format=%(refname:short) %(committerdate:unix)",
                    "refs/heads/",
                ])
                .output(),
        )
        .await
        {
            if output.status.success() {
                for line in String::from_utf8_lossy(&output.stdout).lines() {
                    if let Some((name, ts_str)) = line.rsplit_once(' ') {
                        if let Ok(ts) = ts_str.parse::<i64>() {
                            result.insert(name.to_string(), ts);
                        }
                    }
                }
            }
        }
    }

    // Fetch timestamps for remote-only branches
    if !remote_only_branches.is_empty() {
        if let Ok(Ok(output)) = tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args([
                    "-C",
                    repo_dir,
                    "for-each-ref",
                    "--format=%(refname:short) %(committerdate:unix)",
                    "refs/remotes/",
                ])
                .output(),
        )
        .await
        {
            if output.status.success() {
                let remote_set: std::collections::HashSet<&str> =
                    remote_only_branches.iter().map(|s| s.as_str()).collect();
                for line in String::from_utf8_lossy(&output.stdout).lines() {
                    if let Some((name, ts_str)) = line.rsplit_once(' ') {
                        // Strip "origin/" prefix to match remote_only_branches naming
                        let short = name.strip_prefix("origin/").unwrap_or(name);
                        if remote_set.contains(short) {
                            if let Ok(ts) = ts_str.parse::<i64>() {
                                result.insert(short.to_string(), ts);
                            }
                        }
                    }
                }
            }
        }
    }

    result
}

/// Compute parent branch for each non-default branch
///
/// Strategy: first check reflog for "Created from <branch>" (exact match),
/// then fall back to closest ancestor via commit distance.
///
/// Optimization: processes branches concurrently and uses
/// `git for-each-ref --merged` to batch ancestor detection (one git call
/// per branch instead of O(n) `--is-ancestor` calls).
async fn compute_branch_parents(
    repo_dir: &str,
    branches: &[String],
    default_branch: &str,
) -> HashMap<String, String> {
    if branches.len() > 100 {
        return HashMap::new();
    }

    let branch_set: HashSet<&str> = branches.iter().map(|s| s.as_str()).collect();

    // Process all branches concurrently
    let mut join_set = tokio::task::JoinSet::new();

    for branch in branches {
        if branch == default_branch {
            continue;
        }

        let branch = branch.clone();
        let branches_owned: Vec<String> = branches.to_vec();
        let default_branch_owned = default_branch.to_string();
        let repo_dir_owned = repo_dir.to_string();
        let branch_set_owned: HashSet<String> = branch_set.iter().map(|s| s.to_string()).collect();

        join_set.spawn(async move {
            let known: HashSet<&str> = branch_set_owned.iter().map(|s| s.as_str()).collect();

            // 1. Try reflog: "branch: Created from <name>"
            if let Some(parent) =
                reflog_created_from(&repo_dir_owned, &branch, &known, &default_branch_owned).await
            {
                return (branch, parent);
            }

            // 2. Fallback: closest ancestor by commit distance
            let parent = find_closest_parent_branch(
                &repo_dir_owned,
                &branch,
                &branches_owned,
                &default_branch_owned,
            )
            .await;

            (branch, parent)
        });
    }

    let mut parents = HashMap::new();
    while let Some(result) = join_set.join_next().await {
        if let Ok((branch, parent)) = result {
            parents.insert(branch, parent);
        }
    }

    parents
}

/// Find the closest parent branch by commit distance
///
/// Uses `git for-each-ref --merged=<branch>` to get ancestor branches in
/// a single git call, then computes distances concurrently.
async fn find_closest_parent_branch(
    repo_dir: &str,
    branch: &str,
    branches: &[String],
    default_branch: &str,
) -> String {
    // Get all branches whose tips are ancestors of this branch (single git call)
    let ancestors = get_ancestor_branches(repo_dir, branch).await;

    // Build list of candidates: branches that are ancestors (excluding self)
    let candidates: Vec<&String> = branches
        .iter()
        .filter(|c| c.as_str() != branch && ancestors.contains(c.as_str()))
        .collect();

    if candidates.is_empty() {
        return default_branch.to_string();
    }

    // Compute commit distances concurrently
    let futures: Vec<_> = candidates
        .into_iter()
        .map(|candidate| {
            let repo = repo_dir.to_string();
            let cand = candidate.clone();
            let br = branch.to_string();
            async move {
                let count = git_output(
                    &repo,
                    &["rev-list", "--count", &format!("{}..{}", cand, br)],
                )
                .await
                .and_then(|s| s.parse::<u32>().ok());
                (cand, count)
            }
        })
        .collect();

    let results = futures_util::future::join_all(futures).await;

    let mut best_parent = default_branch.to_string();
    let mut best_count = u32::MAX;

    for (candidate, count) in results {
        if let Some(c) = count {
            if c > 0 && c < best_count {
                best_count = c;
                best_parent = candidate;
            }
        }
    }

    best_parent
}

/// Get all branch names whose tips are reachable from the given branch
async fn get_ancestor_branches(repo_dir: &str, branch: &str) -> HashSet<String> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args([
                "-C",
                repo_dir,
                "for-each-ref",
                &format!("--merged={}", branch),
                "--format=%(refname:short)",
                "refs/heads/",
            ])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    match output {
        Some(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        _ => HashSet::new(),
    }
}

/// Check reflog for the branch creation source
///
/// Parses the last reflog entry for "Created from <branch_name>".
/// When source is "HEAD", resolves by finding which known branch was
/// at the same commit using `git branch --points-at`.
/// Run a git command and return trimmed stdout, or None on failure/timeout
async fn git_output(repo_dir: &str, args: &[&str]) -> Option<String> {
    let mut cmd_args = vec!["-C", repo_dir];
    cmd_args.extend_from_slice(args);
    tokio::time::timeout(GIT_TIMEOUT, Command::new("git").args(&cmd_args).output())
        .await
        .ok()
        .and_then(|r| r.ok())
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
}

async fn reflog_created_from(
    repo_dir: &str,
    branch: &str,
    known_branches: &HashSet<&str>,
    default_branch: &str,
) -> Option<String> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "reflog", "show", branch, "--format=%H %gs"])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let last_line = text.lines().last()?;

    // Format: "<sha> branch: Created from <source>"
    let (sha, action) = last_line.split_once(' ')?;
    let raw_source = action.strip_prefix("branch: Created from ")?.trim();
    let source = raw_source.strip_prefix("refs/heads/").unwrap_or(raw_source);

    if source == "HEAD" {
        // Resolve HEAD: find which known branch was at the same commit
        resolve_branch_at_commit(repo_dir, sha, branch, known_branches, default_branch).await
    } else if known_branches.contains(source) {
        Some(source.to_string())
    } else {
        None
    }
}

/// Find which known branch was at a given commit
///
/// Uses `git branch --points-at <sha>` and picks the best match:
/// default_branch preferred, otherwise first known branch found.
async fn resolve_branch_at_commit(
    repo_dir: &str,
    sha: &str,
    exclude_branch: &str,
    known_branches: &HashSet<&str>,
    default_branch: &str,
) -> Option<String> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args([
                "-C",
                repo_dir,
                "branch",
                "--points-at",
                sha,
                "--format=%(refname:short)",
            ])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let candidates: Vec<&str> = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && *l != exclude_branch && known_branches.contains(l))
        .collect();

    if candidates.is_empty() {
        return None;
    }

    // Prefer default branch among candidates
    if candidates.contains(&default_branch) {
        Some(default_branch.to_string())
    } else {
        Some(candidates[0].to_string())
    }
}

/// Detect the default remote branch via symbolic-ref
async fn detect_default_branch(repo_dir: &str) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new("git")
            .args([
                "-C",
                repo_dir,
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "--short",
            ])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let refname = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // "origin/main" -> "main"
    refname
        .strip_prefix("origin/")
        .map(|s| s.to_string())
        .or(Some(refname))
        .filter(|s| !s.is_empty())
}

/// Validate a worktree name (alphanumeric, hyphens, and underscores only, max 64 chars)
///
/// Slashes are rejected: use flat names (`feature-auth`) for the directory,
/// and let the branch name use a prefix (`worktree-feature-auth`).
pub fn is_valid_worktree_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Extract worktree name from a `.claude/worktrees/{name}` path segment
///
/// Claude Code creates worktrees under `<repo>/.claude/worktrees/<name>/`.
/// This function extracts `<name>` if the cwd contains that pattern.
pub fn extract_claude_worktree_name(cwd: &str) -> Option<String> {
    let marker = "/.claude/worktrees/";
    let idx = cwd.find(marker)?;
    let after = &cwd[idx + marker.len()..];
    // Take up to the next '/' or end of string
    let name = after.split('/').next().filter(|s| !s.is_empty())?;
    Some(name.to_string())
}

/// A single commit entry from git log
#[derive(Debug, Clone, serde::Serialize)]
pub struct CommitEntry {
    pub sha: String,
    pub subject: String,
    pub body: String,
}

/// Get commit log between two branches (base..branch)
///
/// Returns list of CommitEntry with sha, subject, and full body.
pub async fn log_commits(
    repo_dir: &str,
    base: &str,
    branch: &str,
    max_count: usize,
) -> Vec<CommitEntry> {
    if !is_safe_git_ref(base) || !is_safe_git_ref(branch) {
        return Vec::new();
    }

    // Use record separator (ASCII 0x1E) to split commits
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args([
                "-C",
                repo_dir,
                "log",
                "--format=%H\t%s\t%b%x1e",
                &format!("--max-count={}", max_count),
                &format!("{}..{}", base, branch),
            ])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok());

    match output {
        Some(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .split('\x1e')
            .filter_map(|entry| {
                let entry = entry.trim();
                if entry.is_empty() {
                    return None;
                }
                let mut parts = entry.splitn(3, '\t');
                let sha = parts.next()?.trim().to_string();
                let subject = parts.next()?.trim().to_string();
                let body = parts.next().unwrap_or("").trim().to_string();
                Some(CommitEntry { sha, subject, body })
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// A single commit in the full graph (all branches)
#[derive(Debug, Clone, serde::Serialize)]
pub struct GraphCommit {
    pub sha: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub subject: String,
    pub authored_date: i64,
}

/// Full graph data for lane-based visualization
#[derive(Debug, Clone, serde::Serialize)]
pub struct GraphData {
    pub commits: Vec<GraphCommit>,
    /// Total commit count across all branches (independent of max_commits limit)
    pub total_count: usize,
}

/// Get full commit graph across all branches for lane-based visualization
///
/// Uses `git log --all --topo-order` to get commits from all branches
/// with parent SHAs, ref decorations, and timestamps.
pub async fn log_graph(repo_dir: &str, max_commits: usize) -> Option<GraphData> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args([
                "-C",
                repo_dir,
                "log",
                "--all",
                "--topo-order",
                &format!("--max-count={}", max_commits),
                "--format=%H\t%P\t%D\t%s\t%at",
            ])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<GraphCommit> = stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let mut parts = line.splitn(5, '\t');
            let sha = parts.next()?.to_string();
            let parents: Vec<String> = parts
                .next()
                .unwrap_or("")
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            let refs: Vec<String> = parts
                .next()
                .unwrap_or("")
                .split(", ")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            let subject = parts.next().unwrap_or("").to_string();
            let authored_date = parts.next().unwrap_or("0").parse::<i64>().unwrap_or(0);
            Some(GraphCommit {
                sha,
                parents,
                refs,
                subject,
                authored_date,
            })
        })
        .collect();

    // Get total commit count (fast, no log parsing)
    let total_count = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "rev-list", "--all", "--count"])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .and_then(|o| {
        String::from_utf8_lossy(&o.stdout)
            .trim()
            .parse::<usize>()
            .ok()
    })
    .unwrap_or(commits.len());

    Some(GraphData {
        commits,
        total_count,
    })
}

/// Strip `/.git` or `/.git/` suffix from a path to get the repository root
///
/// Returns the original path if no `.git` suffix is found.
pub fn strip_git_suffix(path: &str) -> &str {
    path.strip_suffix("/.git")
        .or_else(|| path.strip_suffix("/.git/"))
        .unwrap_or(path)
}

/// Validate a git ref name (branch/tag) for safe use as a command argument
///
/// Rejects refs starting with `-` (could be misinterpreted as CLI flags)
/// and empty strings.
pub fn is_safe_git_ref(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('-')
}

/// Extract repository name from a git common directory path
///
/// Strips the trailing `/.git` suffix and returns the last path component.
/// Falls back to the full path if parsing fails.
pub fn repo_name_from_common_dir(common_dir: &str) -> String {
    let stripped = common_dir
        .strip_suffix("/.git")
        .or_else(|| common_dir.strip_suffix("/.git/"))
        .unwrap_or(common_dir);
    let trimmed = stripped.trim_end_matches('/');
    trimmed
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

/// Delete a local branch
///
/// Uses `git branch -d` (safe delete, requires branch to be merged).
/// With `force=true`, uses `git branch -D` (force delete).
/// With `delete_remote=true`, also deletes the remote tracking branch (best-effort).
/// Returns Ok(()) on success, Err(message) on failure.
pub async fn delete_branch(
    repo_dir: &str,
    branch: &str,
    force: bool,
    delete_remote: bool,
) -> Result<(), String> {
    if !is_safe_git_ref(branch) {
        return Err("Invalid branch name".to_string());
    }

    let flag = if force { "-D" } else { "-d" };
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "branch", flag, branch])
            .output(),
    )
    .await
    .map_err(|_| "Git command timed out".to_string())?
    .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim().to_string());
    }

    // Best-effort: delete the remote tracking branch only when opted in
    if delete_remote {
        delete_remote_branch(repo_dir, branch).await;
    }

    Ok(())
}

/// Delete a remote tracking branch (best-effort, never fails the caller).
///
/// Runs `git push origin --delete <branch>`. Silently ignores errors
/// (e.g., no remote, branch not pushed, network issues).
async fn delete_remote_branch(repo_dir: &str, branch: &str) {
    let _ = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "push", "origin", "--delete", branch])
            .output(),
    )
    .await;
}

/// Checkout (switch to) a local branch
///
/// Uses `git checkout <branch>`. Fails if there are uncommitted changes
/// that conflict with the target branch.
pub async fn checkout_branch(repo_dir: &str, branch: &str) -> Result<(), String> {
    if !is_safe_git_ref(branch) {
        return Err("Invalid branch name".to_string());
    }

    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "checkout", branch])
            .output(),
    )
    .await
    .map_err(|_| "Git command timed out".to_string())?
    .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.trim().to_string())
    }
}

/// Create a new local branch (without checking it out)
///
/// Uses `git branch <name> [base]`.
pub async fn create_branch(repo_dir: &str, name: &str, base: Option<&str>) -> Result<(), String> {
    if !is_safe_git_ref(name) {
        return Err("Invalid branch name".to_string());
    }
    if let Some(b) = base {
        if !is_safe_git_ref(b) {
            return Err("Invalid base branch name".to_string());
        }
    }

    let mut args = vec!["-C", repo_dir, "branch", name];
    if let Some(b) = base {
        args.push(b);
    }

    let output = tokio::time::timeout(GIT_TIMEOUT, Command::new("git").args(&args).output())
        .await
        .map_err(|_| "Git command timed out".to_string())?
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.trim().to_string())
    }
}

/// Fetch from a remote (default: origin)
pub async fn fetch_remote(repo_dir: &str, remote: Option<&str>) -> Result<String, String> {
    let remote = remote.unwrap_or("origin");
    if !is_safe_git_ref(remote) {
        return Err("Invalid remote name".to_string());
    }

    let output = tokio::time::timeout(
        Duration::from_secs(30), // fetch can be slow
        Command::new("git")
            .args(["-C", repo_dir, "fetch", remote, "--prune"])
            .output(),
    )
    .await
    .map_err(|_| "Git fetch timed out".to_string())?
    .map_err(|e| format!("Failed to run git: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        // git fetch outputs to stderr even on success
        Ok(format!("{}{}", stdout.trim(), stderr.trim()))
    } else {
        Err(stderr.trim().to_string())
    }
}

/// Pull from upstream (fetch + merge)
pub async fn pull(repo_dir: &str) -> Result<String, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new("git")
            .args(["-C", repo_dir, "pull", "--ff-only"])
            .output(),
    )
    .await
    .map_err(|_| "Git pull timed out".to_string())?
    .map_err(|e| format!("Failed to run git: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        Err(format!("{}\n{}", stdout.trim(), stderr.trim())
            .trim()
            .to_string())
    }
}

/// Merge a branch into the current branch
pub async fn merge_branch(repo_dir: &str, branch: &str) -> Result<String, String> {
    if !is_safe_git_ref(branch) {
        return Err("Invalid branch name".to_string());
    }

    let output = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new("git")
            .args(["-C", repo_dir, "merge", branch, "--no-edit"])
            .output(),
    )
    .await
    .map_err(|_| "Git merge timed out".to_string())?
    .map_err(|e| format!("Failed to run git: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        Err(format!("{}\n{}", stdout.trim(), stderr.trim())
            .trim()
            .to_string())
    }
}

/// Get ahead/behind counts relative to a base branch
///
/// Returns (ahead, behind) commit counts.
pub async fn ahead_behind(repo_dir: &str, branch: &str, base: &str) -> Option<(usize, usize)> {
    if !is_safe_git_ref(branch) || !is_safe_git_ref(base) {
        return None;
    }

    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args([
                "-C",
                repo_dir,
                "rev-list",
                "--left-right",
                "--count",
                &format!("{}...{}", base, branch),
            ])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = text.trim().split('\t').collect();
    if parts.len() == 2 {
        let behind = parts[0].parse().ok()?;
        let ahead = parts[1].parse().ok()?;
        Some((ahead, behind))
    } else {
        None
    }
}

/// Resolve the SHA of origin/<default_branch> HEAD (from local refs, no fetch).
pub async fn resolve_remote_head(repo_dir: &str) -> Option<String> {
    let default_branch = detect_default_branch(repo_dir).await?;
    let remote_ref = format!("origin/{}", default_branch);

    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_dir, "rev-parse", &remote_ref])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

// ── Auto-rebase service ──────────────────────────────────────────────

/// Result of a single branch rebase attempt
#[derive(Debug, Clone)]
pub struct RebaseResult {
    /// Branch name that was rebased
    pub branch: String,
    /// Worktree path
    pub worktree_path: String,
    /// Whether the rebase succeeded (clean rebase + force-push)
    pub success: bool,
    /// Error message if rebase failed (e.g., conflicts)
    pub error: Option<String>,
}

/// Rebase all tmai-managed worktree branches onto the default branch after a merge.
///
/// Only rebases branches that:
/// - Live in a `.claude/worktrees/` directory (tmai-managed)
/// - Have their PR base branch set to the default branch (e.g., main)
/// - Are behind the default branch
///
/// For each eligible branch: fetch, rebase onto default, force-push if clean.
/// Returns a list of results for each attempted rebase.
pub async fn rebase_worktree_branches(
    repo_dir: &str,
    open_prs: &std::collections::HashMap<String, crate::github::PrInfo>,
) -> Vec<RebaseResult> {
    let default_branch = match detect_default_branch(repo_dir).await {
        Some(b) => b,
        None => return Vec::new(),
    };

    // Fetch latest from remote first
    let _ = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new("git")
            .args(["-C", repo_dir, "fetch", "origin", &default_branch])
            .output(),
    )
    .await;

    let worktrees = list_worktrees(repo_dir).await;
    let mut results = Vec::new();

    for wt in &worktrees {
        // Skip main worktree and bare repos
        if wt.is_main || wt.is_bare {
            continue;
        }

        // Only rebase tmai-managed worktrees (under .claude/worktrees/)
        if extract_claude_worktree_name(&wt.path).is_none() {
            continue;
        }

        let branch = match &wt.branch {
            Some(b) => b.clone(),
            None => continue, // detached HEAD
        };

        // Skip if no open PR for this branch
        let pr = match open_prs.get(&branch) {
            Some(pr) => pr,
            None => continue,
        };

        // Only rebase branches whose PR targets the default branch
        if pr.base_branch != default_branch {
            continue;
        }

        // Check if branch is behind default
        let behind =
            match ahead_behind(&wt.path, &branch, &format!("origin/{}", default_branch)).await {
                Some((_, behind)) if behind > 0 => behind,
                _ => continue, // up-to-date or error
            };

        tracing::info!(
            branch = %branch,
            behind = behind,
            worktree = %wt.path,
            "auto-rebasing worktree branch onto {}",
            default_branch
        );

        let result = rebase_single_branch(&wt.path, &branch, &default_branch).await;
        results.push(result);
    }

    results
}

/// Rebase a single branch in its worktree onto origin/<default_branch>.
/// If clean, force-push. If conflicts, abort rebase and report.
async fn rebase_single_branch(
    worktree_path: &str,
    branch: &str,
    default_branch: &str,
) -> RebaseResult {
    let target = format!("origin/{}", default_branch);

    // Run git rebase
    let rebase_output = tokio::time::timeout(
        Duration::from_secs(60),
        Command::new("git")
            .args(["-C", worktree_path, "rebase", &target])
            .output(),
    )
    .await;

    let rebase_ok = match &rebase_output {
        Ok(Ok(o)) => o.status.success(),
        _ => false,
    };

    if !rebase_ok {
        // Abort the failed rebase
        let _ = tokio::time::timeout(
            Duration::from_secs(10),
            Command::new("git")
                .args(["-C", worktree_path, "rebase", "--abort"])
                .output(),
        )
        .await;

        let error_msg = match rebase_output {
            Ok(Ok(o)) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                let stdout = String::from_utf8_lossy(&o.stdout);
                format!("{}\n{}", stdout.trim(), stderr.trim())
                    .trim()
                    .to_string()
            }
            Ok(Err(e)) => format!("Failed to run git: {}", e),
            Err(_) => "Git rebase timed out".to_string(),
        };

        tracing::warn!(
            branch = %branch,
            worktree = %worktree_path,
            error = %error_msg,
            "rebase conflict, aborted"
        );

        return RebaseResult {
            branch: branch.to_string(),
            worktree_path: worktree_path.to_string(),
            success: false,
            error: Some(error_msg),
        };
    }

    // Force-push the rebased branch
    let push_output = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new("git")
            .args([
                "-C",
                worktree_path,
                "push",
                "--force-with-lease",
                "origin",
                branch,
            ])
            .output(),
    )
    .await;

    let push_ok = match &push_output {
        Ok(Ok(o)) => o.status.success(),
        _ => false,
    };

    if !push_ok {
        let error_msg = match push_output {
            Ok(Ok(o)) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                format!("force-push failed: {}", stderr.trim())
            }
            Ok(Err(e)) => format!("Failed to run git push: {}", e),
            Err(_) => "Git push timed out".to_string(),
        };

        tracing::warn!(
            branch = %branch,
            worktree = %worktree_path,
            error = %error_msg,
            "rebase succeeded but push failed"
        );

        return RebaseResult {
            branch: branch.to_string(),
            worktree_path: worktree_path.to_string(),
            success: false,
            error: Some(error_msg),
        };
    }

    tracing::info!(
        branch = %branch,
        worktree = %worktree_path,
        "rebase + force-push succeeded"
    );

    RebaseResult {
        branch: branch.to_string(),
        worktree_path: worktree_path.to_string(),
        success: true,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_claude_worktree_name_valid() {
        assert_eq!(
            extract_claude_worktree_name("/home/user/my-app/.claude/worktrees/feature-a"),
            Some("feature-a".to_string())
        );
        assert_eq!(
            extract_claude_worktree_name("/home/user/my-app/.claude/worktrees/feature-a/src"),
            Some("feature-a".to_string())
        );
    }

    #[test]
    fn test_extract_claude_worktree_name_invalid() {
        assert_eq!(extract_claude_worktree_name("/home/user/my-app"), None);
        assert_eq!(
            extract_claude_worktree_name("/home/user/my-app/.claude/"),
            None
        );
        // Trailing slash with nothing after name marker
        assert_eq!(
            extract_claude_worktree_name("/home/user/my-app/.claude/worktrees/"),
            None
        );
    }

    #[test]
    fn test_repo_name_from_common_dir() {
        assert_eq!(
            repo_name_from_common_dir("/home/user/my-app/.git"),
            "my-app"
        );
        assert_eq!(
            repo_name_from_common_dir("/home/user/my-app/.git/"),
            "my-app"
        );
    }

    #[test]
    fn test_repo_name_from_common_dir_no_git_suffix() {
        // Fallback: just take last component
        assert_eq!(repo_name_from_common_dir("/home/user/my-app"), "my-app");
    }

    #[test]
    fn test_repo_name_from_common_dir_bare() {
        assert_eq!(repo_name_from_common_dir("my-repo/.git"), "my-repo");
    }

    #[test]
    fn test_parse_worktree_list_normal() {
        let output = "\
worktree /home/user/my-app
HEAD abc123def456
branch refs/heads/main

worktree /home/user/my-app/.claude/worktrees/feature-a
HEAD def456abc789
branch refs/heads/feature-a

";
        let entries = parse_worktree_list(output);
        assert_eq!(entries.len(), 2);

        assert_eq!(entries[0].path, "/home/user/my-app");
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert!(!entries[0].is_bare);
        assert!(entries[0].is_main);

        assert_eq!(
            entries[1].path,
            "/home/user/my-app/.claude/worktrees/feature-a"
        );
        assert_eq!(entries[1].branch.as_deref(), Some("feature-a"));
        assert!(!entries[1].is_bare);
        assert!(!entries[1].is_main);
    }

    #[test]
    fn test_parse_worktree_list_detached_head() {
        let output = "\
worktree /home/user/my-app
HEAD abc123
branch refs/heads/main

worktree /home/user/my-app/.claude/worktrees/temp
HEAD def456
detached

";
        let entries = parse_worktree_list(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].branch, None);
        assert!(!entries[1].is_main);
    }

    #[test]
    fn test_parse_worktree_list_bare_repo() {
        let output = "\
worktree /home/user/bare-repo
HEAD abc123
bare

";
        let entries = parse_worktree_list(output);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].is_bare);
        assert!(entries[0].is_main);
    }

    #[test]
    fn test_parse_worktree_list_empty() {
        let entries = parse_worktree_list("");
        assert!(entries.is_empty());
    }

    #[test]
    fn test_parse_worktree_list_single() {
        let output = "\
worktree /home/user/project
HEAD abc123
branch refs/heads/main
";
        let entries = parse_worktree_list(output);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].is_main);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
    }

    #[test]
    fn test_parse_shortstat_normal() {
        let input = " 3 files changed, 45 insertions(+), 12 deletions(-)\n";
        let summary = parse_shortstat(input).unwrap();
        assert_eq!(summary.files_changed, 3);
        assert_eq!(summary.insertions, 45);
        assert_eq!(summary.deletions, 12);
    }

    #[test]
    fn test_parse_shortstat_insertions_only() {
        let input = " 1 file changed, 10 insertions(+)\n";
        let summary = parse_shortstat(input).unwrap();
        assert_eq!(summary.files_changed, 1);
        assert_eq!(summary.insertions, 10);
        assert_eq!(summary.deletions, 0);
    }

    #[test]
    fn test_parse_shortstat_deletions_only() {
        let input = " 2 files changed, 5 deletions(-)\n";
        let summary = parse_shortstat(input).unwrap();
        assert_eq!(summary.files_changed, 2);
        assert_eq!(summary.insertions, 0);
        assert_eq!(summary.deletions, 5);
    }

    #[test]
    fn test_parse_shortstat_empty() {
        assert!(parse_shortstat("").is_none());
        assert!(parse_shortstat("  \n").is_none());
    }

    #[test]
    fn test_is_valid_worktree_name() {
        // Valid names
        assert!(is_valid_worktree_name("feature-auth"));
        assert!(is_valid_worktree_name("fix_bug_123"));
        assert!(is_valid_worktree_name("a"));
        assert!(is_valid_worktree_name("my-worktree"));

        // Invalid: empty
        assert!(!is_valid_worktree_name(""));

        // Invalid: special characters (command injection vectors)
        assert!(!is_valid_worktree_name("foo; rm -rf /"));
        assert!(!is_valid_worktree_name("$(evil)"));
        assert!(!is_valid_worktree_name("foo`whoami`"));
        assert!(!is_valid_worktree_name("a|b"));
        assert!(!is_valid_worktree_name("a&b"));

        // Invalid: path traversal and slashes
        assert!(!is_valid_worktree_name("../../../etc"));
        assert!(!is_valid_worktree_name("foo/bar"));

        // Invalid: spaces
        assert!(!is_valid_worktree_name("foo bar"));

        // Invalid: too long (>64 chars)
        assert!(!is_valid_worktree_name(&"a".repeat(65)));

        // Valid: exactly 64 chars
        assert!(is_valid_worktree_name(&"a".repeat(64)));
    }

    #[test]
    fn test_strip_git_suffix() {
        assert_eq!(
            strip_git_suffix("/home/user/my-app/.git"),
            "/home/user/my-app"
        );
        assert_eq!(
            strip_git_suffix("/home/user/my-app/.git/"),
            "/home/user/my-app"
        );
        assert_eq!(strip_git_suffix("/home/user/my-app"), "/home/user/my-app");
        assert_eq!(strip_git_suffix(""), "");
    }

    #[test]
    fn test_is_safe_git_ref() {
        assert!(is_safe_git_ref("main"));
        assert!(is_safe_git_ref("feature/auth"));
        assert!(is_safe_git_ref("v1.0"));
        assert!(!is_safe_git_ref(""));
        assert!(!is_safe_git_ref("-flag"));
        assert!(!is_safe_git_ref("--exec=evil"));
    }

    #[tokio::test]
    async fn test_log_graph_returns_data_for_this_repo() {
        // Use this repo itself as test subject
        let repo = env!("CARGO_MANIFEST_DIR");
        let result = log_graph(repo, 10).await;
        // Should succeed (we're in a git repo)
        assert!(result.is_some());
        let data = result.unwrap();
        assert!(!data.commits.is_empty());
        // First commit should have a SHA
        assert!(!data.commits[0].sha.is_empty());
        // authored_date should be non-zero (valid timestamp)
        assert!(data.commits[0].authored_date > 0);
    }

    #[tokio::test]
    async fn test_log_graph_invalid_dir_returns_none() {
        let result = log_graph("/nonexistent/path", 10).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_fetch_last_commit_times_returns_timestamps() {
        let repo = env!("CARGO_MANIFEST_DIR");
        let branches_output = Command::new("git")
            .args(["-C", repo, "branch", "--format=%(refname:short)"])
            .output()
            .await
            .unwrap();
        let branches: Vec<String> = String::from_utf8_lossy(&branches_output.stdout)
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let times = fetch_last_commit_times(repo, &branches, &[]).await;
        // At least the current branch should have a timestamp
        assert!(
            !times.is_empty(),
            "should have at least one branch timestamp"
        );
        for ts in times.values() {
            assert!(*ts > 0, "timestamps should be positive Unix seconds");
        }
    }

    #[tokio::test]
    async fn test_fetch_last_commit_times_invalid_dir() {
        let times = fetch_last_commit_times("/nonexistent/path", &["main".to_string()], &[]).await;
        assert!(times.is_empty());
    }

    #[tokio::test]
    async fn test_list_branches_includes_commit_times() {
        let repo = env!("CARGO_MANIFEST_DIR");
        let result = list_branches(repo).await;
        assert!(result.is_some());
        let data = result.unwrap();
        // last_commit_times should be populated for local branches
        assert!(
            !data.last_commit_times.is_empty(),
            "last_commit_times should not be empty"
        );
        // The default branch should have a timestamp
        assert!(
            data.last_commit_times.contains_key(&data.default_branch),
            "default branch should have a commit time"
        );
    }

    #[tokio::test]
    async fn test_compute_branch_parents_returns_map() {
        let repo = env!("CARGO_MANIFEST_DIR");
        let branches_output = Command::new("git")
            .args(["-C", repo, "branch", "--format=%(refname:short)"])
            .output()
            .await
            .unwrap();
        let branches: Vec<String> = String::from_utf8_lossy(&branches_output.stdout)
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if branches.len() < 2 {
            // Need at least 2 branches to test parent detection
            return;
        }
        let default_branch = detect_default_branch(repo)
            .await
            .unwrap_or_else(|| "main".to_string());
        let parents = compute_branch_parents(repo, &branches, &default_branch).await;
        // Default branch should not have a parent entry
        assert!(
            !parents.contains_key(&default_branch),
            "default branch should not appear as key"
        );
        // Every non-default branch should have a parent
        for branch in &branches {
            if branch != &default_branch {
                assert!(
                    parents.contains_key(branch),
                    "branch {} should have a parent",
                    branch
                );
            }
        }
    }

    #[tokio::test]
    async fn test_compute_branch_parents_empty_branches() {
        let repo = env!("CARGO_MANIFEST_DIR");
        let parents = compute_branch_parents(repo, &[], "main").await;
        assert!(parents.is_empty());
    }

    #[tokio::test]
    async fn test_compute_branch_parents_skips_over_limit() {
        let repo = env!("CARGO_MANIFEST_DIR");
        // Create a fake list of >100 branches to verify early-exit
        let branches: Vec<String> = (0..101).map(|i| format!("branch-{}", i)).collect();
        let parents = compute_branch_parents(repo, &branches, "main").await;
        assert!(
            parents.is_empty(),
            "should return empty map for >100 branches"
        );
    }

    #[tokio::test]
    async fn test_get_ancestor_branches_returns_self() {
        let repo = env!("CARGO_MANIFEST_DIR");
        let current = fetch_branch(repo).await.expect("should be on a branch");
        let ancestors = get_ancestor_branches(repo, &current).await;
        // A branch's ancestors (--merged) always include itself
        assert!(
            ancestors.contains(&current),
            "ancestors should include the branch itself"
        );
    }

    #[tokio::test]
    async fn test_get_ancestor_branches_invalid_dir() {
        let ancestors = get_ancestor_branches("/nonexistent/path", "main").await;
        assert!(ancestors.is_empty());
    }

    #[tokio::test]
    async fn test_find_closest_parent_branch_defaults() {
        // With an invalid dir, should fall back to default_branch
        let parent = find_closest_parent_branch(
            "/nonexistent/path",
            "feature",
            &["main".to_string(), "feature".to_string()],
            "main",
        )
        .await;
        assert_eq!(parent, "main");
    }

    #[tokio::test]
    async fn test_resolve_remote_head_invalid_dir() {
        let result = resolve_remote_head("/nonexistent/path").await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_rebase_worktree_branches_no_worktrees() {
        // With an invalid repo dir, rebase should return empty
        let prs = std::collections::HashMap::new();
        let results = rebase_worktree_branches("/nonexistent/path", &prs).await;
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_rebase_worktree_branches_empty_prs() {
        // Even with a valid repo, no open PRs means nothing to rebase
        let repo = env!("CARGO_MANIFEST_DIR");
        let prs = std::collections::HashMap::new();
        let results = rebase_worktree_branches(repo, &prs).await;
        assert!(results.is_empty());
    }

    #[test]
    fn test_rebase_result_fields() {
        let result = RebaseResult {
            branch: "feat-x".to_string(),
            worktree_path: "/tmp/wt".to_string(),
            success: true,
            error: None,
        };
        assert!(result.success);
        assert!(result.error.is_none());
        assert_eq!(result.branch, "feat-x");

        let fail_result = RebaseResult {
            branch: "feat-y".to_string(),
            worktree_path: "/tmp/wt2".to_string(),
            success: false,
            error: Some("CONFLICT in file.rs".to_string()),
        };
        assert!(!fail_result.success);
        assert!(fail_result.error.unwrap().contains("CONFLICT"));
    }
}
