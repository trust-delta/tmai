use std::collections::HashMap;
use std::time::Instant;
use tokio::process::Command;

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
    cache: HashMap<String, (GitInfo, Instant)>,
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

    /// Get git info for a directory, using cache if available
    pub async fn get_info(&mut self, dir: &str) -> Option<GitInfo> {
        // Check cache
        if let Some((info, ts)) = self.cache.get(dir) {
            if ts.elapsed().as_secs() < self.ttl_secs {
                return Some(info.clone());
            }
        }

        // Fetch fresh info
        let branch = fetch_branch(dir).await?;
        let dirty = fetch_dirty(dir).await;
        let is_worktree = fetch_is_worktree(dir).await;

        let info = GitInfo {
            branch,
            dirty,
            is_worktree,
        };
        self.cache
            .insert(dir.to_string(), (info.clone(), Instant::now()));
        Some(info)
    }

    /// Remove expired entries from cache
    pub fn cleanup(&mut self) {
        self.cache
            .retain(|_, (_, ts)| ts.elapsed().as_secs() < self.ttl_secs * 3);
    }
}

/// Fetch the current branch name for a directory
async fn fetch_branch(dir: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .await
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Check if the working tree has uncommitted changes
async fn fetch_dirty(dir: &str) -> bool {
    let output = Command::new("git")
        .args(["-C", dir, "status", "--porcelain"])
        .output()
        .await;
    match output {
        Ok(o) => !o.stdout.is_empty(),
        Err(_) => false,
    }
}

/// Check if the directory is a git worktree (not the main repo)
async fn fetch_is_worktree(dir: &str) -> bool {
    let git_dir = Command::new("git")
        .args(["-C", dir, "rev-parse", "--git-dir"])
        .output()
        .await;
    let common_dir = Command::new("git")
        .args(["-C", dir, "rev-parse", "--git-common-dir"])
        .output()
        .await;
    match (git_dir, common_dir) {
        (Ok(gd), Ok(cd)) => {
            let gd_str = String::from_utf8_lossy(&gd.stdout).trim().to_string();
            let cd_str = String::from_utf8_lossy(&cd.stdout).trim().to_string();
            gd_str != cd_str
        }
        _ => false,
    }
}
