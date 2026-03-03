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

/// Validate a worktree name (alphanumeric, hyphens, and underscores only, max 64 chars)
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

        // Invalid: path traversal
        assert!(!is_valid_worktree_name("../../../etc"));
        assert!(!is_valid_worktree_name("foo/bar"));

        // Invalid: spaces
        assert!(!is_valid_worktree_name("foo bar"));

        // Invalid: too long (>64 chars)
        assert!(!is_valid_worktree_name(&"a".repeat(65)));

        // Valid: exactly 64 chars
        assert!(is_valid_worktree_name(&"a".repeat(64)));
    }
}
