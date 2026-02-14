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
    let (dirty, is_worktree) = tokio::join!(fetch_dirty(dir), fetch_is_worktree(dir));
    Some(GitInfo {
        branch,
        dirty,
        is_worktree,
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

/// Check if the directory is a git worktree (not the main repo)
async fn fetch_is_worktree(dir: &str) -> bool {
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
            gd_str != cd_str
        }
        _ => false,
    }
}
