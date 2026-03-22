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

/// Result of listing branches for a repository
#[derive(Debug, Clone, serde::Serialize)]
pub struct BranchListResult {
    /// Detected default branch (main, master, etc.)
    pub default_branch: String,
    /// All local branch names
    pub branches: Vec<String>,
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

    Some(BranchListResult {
        default_branch,
        branches,
    })
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
