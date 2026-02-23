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
}
