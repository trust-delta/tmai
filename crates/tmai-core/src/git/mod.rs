use std::collections::HashMap;
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
            let common_dir_path = std::path::Path::new(dir).join(&cd_str);
            let common_dir = common_dir_path
                .canonicalize()
                .ok()
                .map(|p| p.to_string_lossy().to_string());

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
    /// Last fetch timestamp (Unix seconds), None if never fetched
    pub last_fetch: Option<u64>,
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

    // Get last fetch timestamp
    let last_fetch = fetch_head_time(repo_dir);

    Some(BranchListResult {
        default_branch,
        current_branch,
        branches,
        parents,
        ahead_behind: ab_map,
        remote_tracking,
        last_fetch,
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

/// Compute parent branch for each non-default branch
///
/// Strategy: first check reflog for "Created from <branch>" (exact match),
/// then fall back to closest ancestor via `git merge-base --is-ancestor`.
async fn compute_branch_parents(
    repo_dir: &str,
    branches: &[String],
    default_branch: &str,
) -> HashMap<String, String> {
    let branch_set: std::collections::HashSet<&str> = branches.iter().map(|s| s.as_str()).collect();
    let mut parents = HashMap::new();

    for branch in branches {
        if branch == default_branch {
            continue;
        }

        // 1. Try reflog: "branch: Created from <name>"
        if let Some(parent) =
            reflog_created_from(repo_dir, branch, &branch_set, default_branch).await
        {
            parents.insert(branch.clone(), parent);
            continue;
        }

        // 2. Fallback: closest ancestor by commit count
        let mut best_parent = default_branch.to_string();
        let mut best_count = u32::MAX;

        for candidate in branches {
            if candidate == branch {
                continue;
            }

            let is_ancestor = tokio::time::timeout(
                GIT_TIMEOUT,
                Command::new("git")
                    .args([
                        "-C",
                        repo_dir,
                        "merge-base",
                        "--is-ancestor",
                        candidate,
                        branch,
                    ])
                    .output(),
            )
            .await
            .ok()
            .and_then(|r| r.ok())
            .map(|o| o.status.success())
            .unwrap_or(false);

            if !is_ancestor {
                continue;
            }

            let count = tokio::time::timeout(
                GIT_TIMEOUT,
                Command::new("git")
                    .args([
                        "-C",
                        repo_dir,
                        "rev-list",
                        "--count",
                        &format!("{}..{}", candidate, branch),
                    ])
                    .output(),
            )
            .await
            .ok()
            .and_then(|r| r.ok())
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8_lossy(&o.stdout)
                        .trim()
                        .parse::<u32>()
                        .ok()
                } else {
                    None
                }
            })
            .unwrap_or(u32::MAX);

            if count < best_count {
                best_count = count;
                best_parent = candidate.clone();
            }
        }

        parents.insert(branch.clone(), best_parent);
    }

    parents
}

/// Check reflog for the branch creation source
///
/// Parses the last reflog entry for "Created from <branch_name>".
/// When source is "HEAD", resolves by finding which known branch was
/// at the same commit using `git branch --points-at`.
async fn reflog_created_from(
    repo_dir: &str,
    branch: &str,
    known_branches: &std::collections::HashSet<&str>,
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
    known_branches: &std::collections::HashSet<&str>,
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
                "--format=%h\t%s\t%b%x1e",
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
/// Returns Ok(()) on success, Err(message) on failure.
pub async fn delete_branch(repo_dir: &str, branch: &str, force: bool) -> Result<(), String> {
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

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.trim().to_string())
    }
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
}
