//! Git worktree CRUD operations.
//!
//! Worktrees are created under `<repo>/.claude/worktrees/<name>/`
//! to be compatible with Claude Code's `--worktree` convention.

use std::path::Path;
use std::time::Duration;
use tokio::process::Command;

use crate::git::is_valid_worktree_name;

use super::types::{
    BaseStalenessReport, WorktreeCreateRequest, WorktreeCreateResult, WorktreeDeleteRequest,
    WorktreeMoveRequest, WorktreeOpsError,
};

/// Timeout for git worktree commands
const GIT_TIMEOUT: Duration = Duration::from_secs(10);

/// Timeout for the optional `git fetch origin <base>` performed before
/// branching. Network operations are slower than local plumbing, so this
/// gets a longer budget than `GIT_TIMEOUT`.
const FETCH_BASE_TIMEOUT: Duration = Duration::from_secs(20);

/// Create a new git worktree under `.claude/worktrees/<name>/`
///
/// Creates the branch if it does not exist. Uses `git worktree add -b <branch> <path> [base]`.
pub async fn create_worktree(
    req: &WorktreeCreateRequest,
) -> Result<WorktreeCreateResult, WorktreeOpsError> {
    // Validate branch name
    if !is_valid_worktree_name(&req.branch_name) {
        return Err(WorktreeOpsError::InvalidName(req.branch_name.clone()));
    }

    // Validate base_branch if provided (reject leading `-` to prevent flag injection)
    if let Some(ref base) = req.base_branch {
        if !crate::git::is_safe_git_ref(base) {
            return Err(WorktreeOpsError::InvalidName(format!(
                "invalid base branch: {}",
                base
            )));
        }
    }

    let dir_name = req.dir_name.as_deref().unwrap_or(&req.branch_name);
    let worktree_dir = Path::new(&req.repo_path)
        .join(".claude")
        .join("worktrees")
        .join(dir_name);

    // Ensure parent directory exists
    let parent = worktree_dir
        .parent()
        .ok_or_else(|| WorktreeOpsError::GitError("invalid worktree path".to_string()))?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|e| WorktreeOpsError::GitError(format!("failed to create directory: {}", e)))?;

    let worktree_path = worktree_dir.to_string_lossy().to_string();

    // Resolve the effective base ref. When `auto_fetch_base` is on and the
    // requested base is a normal branch (i.e. `origin/<base>` exists), we
    // best-effort fetch and — if local lags — branch off `origin/<base>`
    // so the new worktree starts from the latest upstream commit (#334).
    let (effective_base, staleness) = match req.base_branch.as_deref() {
        Some(base) if req.auto_fetch_base => resolve_fresh_base(&req.repo_path, base).await,
        Some(base) => (Some(base.to_string()), None),
        None => (None, None),
    };

    // Build git worktree add command
    let mut args = vec![
        "-C".to_string(),
        req.repo_path.clone(),
        "worktree".to_string(),
        "add".to_string(),
        "-b".to_string(),
        req.branch_name.clone(),
        worktree_path.clone(),
    ];
    if let Some(ref base) = effective_base {
        args.push(base.clone());
    }

    let output = tokio::time::timeout(GIT_TIMEOUT, Command::new("git").args(&args).output())
        .await
        .map_err(|_| WorktreeOpsError::GitError("git worktree add timed out".to_string()))?
        .map_err(|e| WorktreeOpsError::GitError(format!("failed to run git: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // Detect "already exists" from git error message
        if stderr.contains("already exists") {
            return Err(WorktreeOpsError::AlreadyExists(req.branch_name.clone()));
        }
        return Err(WorktreeOpsError::GitError(stderr));
    }

    Ok(WorktreeCreateResult {
        path: worktree_path,
        branch: req.branch_name.clone(),
        staleness,
    })
}

/// Best-effort: fetch `origin/<base>` and decide whether to branch off it.
///
/// Returns `(effective_base_ref, staleness_report)`:
/// - When `origin/<base>` does not exist (no remote, branch never pushed,
///   shallow clone, etc.) we silently fall back to the requested local ref
///   so callers without a configured `origin` still work.
/// - When `origin/<base>` exists and local `<base>` is behind, we return
///   `origin/<base>` as the ref to branch from plus a populated report so
///   the caller can surface a notification.
/// - When local `<base>` is up-to-date we return the local ref unchanged
///   (avoiding unnecessary detached-HEAD-style refs in the new branch).
async fn resolve_fresh_base(
    repo_path: &str,
    base: &str,
) -> (Option<String>, Option<BaseStalenessReport>) {
    // Defense in depth: only run when the base name is shaped like a
    // branch ref. `is_safe_git_ref` is also enforced upstream, but we may
    // be passed something like a SHA — `origin/<sha>` is meaningless, so
    // skip the fetch and use the literal ref.
    if !crate::git::is_safe_git_ref(base) {
        return (Some(base.to_string()), None);
    }

    let origin_ref = format!("origin/{}", base);

    // Fetch — best-effort. Failures (no network, no `origin`, auth issue)
    // must NOT abort worktree creation; we simply fall back to local.
    let _ = tokio::time::timeout(
        FETCH_BASE_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_path, "fetch", "origin", base])
            .output(),
    )
    .await;

    // Verify origin/<base> resolves (it won't if there's no remote tracking
    // branch, e.g. a freshly init'd repo without push).
    let verify = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_path, "rev-parse", "--verify", &origin_ref])
            .output(),
    )
    .await;
    let origin_ok = matches!(verify, Ok(Ok(o)) if o.status.success());
    if !origin_ok {
        return (Some(base.to_string()), None);
    }

    // Count commits in origin/<base> not yet in local <base>.
    let range = format!("{}..{}", base, origin_ref);
    let count = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_path, "rev-list", "--count", &range])
            .output(),
    )
    .await;
    let behind: usize = match count {
        Ok(Ok(out)) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse()
            .unwrap_or(0),
        _ => 0,
    };

    if behind == 0 {
        (Some(base.to_string()), None)
    } else {
        tracing::warn!(
            base = base,
            behind = behind,
            "Local base branch is behind origin; branching new worktree from {} instead",
            origin_ref
        );
        (
            Some(origin_ref.clone()),
            Some(BaseStalenessReport {
                base_branch: base.to_string(),
                behind,
                used_ref: origin_ref,
            }),
        )
    }
}

/// Delete a git worktree
///
/// Checks for uncommitted changes unless `force` is set.
pub async fn delete_worktree(req: &WorktreeDeleteRequest) -> Result<(), WorktreeOpsError> {
    // Validate name
    if !is_valid_worktree_name(&req.worktree_name) {
        return Err(WorktreeOpsError::InvalidName(req.worktree_name.clone()));
    }

    // Try both `<repo>/.claude/worktrees/<name>` and `<repo>/.git/.claude/worktrees/<name>`
    // Claude Code may create worktrees under `.git/.claude/worktrees/`
    let worktree_dir = {
        let primary = Path::new(&req.repo_path)
            .join(".claude")
            .join("worktrees")
            .join(&req.worktree_name);
        if primary.exists() {
            Some(primary)
        } else {
            let fallback = Path::new(&req.repo_path)
                .join(".git/.claude/worktrees")
                .join(&req.worktree_name);
            if fallback.exists() {
                Some(fallback)
            } else {
                None
            }
        }
    };

    // Directory already gone — prune git's stale worktree entries and delete branch
    if worktree_dir.is_none() {
        return cleanup_orphaned_worktree(&req.repo_path, &req.worktree_name, req.force).await;
    }
    let worktree_dir = worktree_dir.unwrap();

    // Check for uncommitted changes unless force
    if !req.force {
        let worktree_path = worktree_dir.to_string_lossy().to_string();
        if check_worktree_clean(&worktree_path).await == Some(false) {
            return Err(WorktreeOpsError::UncommittedChanges(
                req.worktree_name.clone(),
            ));
        }
    }

    // Detect the branch name before removing the worktree
    let worktree_path_str = worktree_dir.to_string_lossy().to_string();
    let branch_name = detect_worktree_branch(&req.repo_path, &worktree_path_str).await;

    // Run git worktree remove
    let mut args = vec!["-C", &req.repo_path, "worktree", "remove"];
    args.push(&worktree_path_str);
    if req.force {
        args.push("--force");
    }

    let output = tokio::time::timeout(GIT_TIMEOUT, Command::new("git").args(&args).output())
        .await
        .map_err(|_| WorktreeOpsError::GitError("git worktree remove timed out".to_string()))?
        .map_err(|e| WorktreeOpsError::GitError(format!("failed to run git: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.contains("not found") || stderr.contains("is not a working tree") {
            return Err(WorktreeOpsError::NotFound(req.worktree_name.clone()));
        }
        return Err(WorktreeOpsError::GitError(stderr));
    }

    // Delete the associated branch (best-effort, don't fail if branch is already gone)
    // Use safe delete (-d) by default; only force delete (-D) when req.force is true
    if let Some(ref branch) = branch_name {
        let flag = if req.force { "-D" } else { "-d" };
        let _ = tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args(["-C", &req.repo_path, "branch", flag, branch])
                .output(),
        )
        .await;
    }

    Ok(())
}

/// Move an existing branch from the main working tree into a worktree.
///
/// Steps:
/// 1. Validate inputs
/// 2. Auto-commit WIP changes if working tree is dirty
/// 3. `git worktree add <path> <branch>` (existing branch, no -b)
/// 4. `git checkout <default_branch>` in the main working tree
pub async fn move_to_worktree(
    req: &WorktreeMoveRequest,
) -> Result<WorktreeCreateResult, WorktreeOpsError> {
    // Validate branch name
    if !is_valid_worktree_name(&req.branch_name) {
        return Err(WorktreeOpsError::InvalidName(req.branch_name.clone()));
    }
    if !crate::git::is_safe_git_ref(&req.default_branch) {
        return Err(WorktreeOpsError::InvalidName(format!(
            "invalid default branch: {}",
            req.default_branch
        )));
    }

    let dir_name = req.dir_name.as_deref().unwrap_or(&req.branch_name);
    let worktree_dir = Path::new(&req.repo_path)
        .join(".claude")
        .join("worktrees")
        .join(dir_name);

    if worktree_dir.exists() {
        return Err(WorktreeOpsError::AlreadyExists(req.branch_name.clone()));
    }

    // Ensure parent directory exists
    let parent = worktree_dir
        .parent()
        .ok_or_else(|| WorktreeOpsError::GitError("invalid worktree path".to_string()))?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|e| WorktreeOpsError::GitError(format!("failed to create directory: {}", e)))?;

    let worktree_path = worktree_dir.to_string_lossy().to_string();

    // Auto-commit WIP changes if working tree is dirty
    if check_worktree_clean(&req.repo_path).await == Some(false) {
        // Stage all changes
        let add_output = tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args(["-C", &req.repo_path, "add", "-A"])
                .output(),
        )
        .await
        .map_err(|_| WorktreeOpsError::GitError("git add timed out".to_string()))?
        .map_err(|e| WorktreeOpsError::GitError(format!("failed to run git add: {}", e)))?;

        if !add_output.status.success() {
            let stderr = String::from_utf8_lossy(&add_output.stderr)
                .trim()
                .to_string();
            return Err(WorktreeOpsError::GitError(format!(
                "git add failed: {}",
                stderr
            )));
        }

        // Commit with WIP message
        let commit_output = tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args([
                    "-C",
                    &req.repo_path,
                    "commit",
                    "-m",
                    &format!("WIP: move {} to worktree", req.branch_name),
                ])
                .output(),
        )
        .await
        .map_err(|_| WorktreeOpsError::GitError("git commit timed out".to_string()))?
        .map_err(|e| WorktreeOpsError::GitError(format!("failed to run git commit: {}", e)))?;

        if !commit_output.status.success() {
            let stderr = String::from_utf8_lossy(&commit_output.stderr)
                .trim()
                .to_string();
            return Err(WorktreeOpsError::GitError(format!(
                "git commit failed: {}",
                stderr
            )));
        }
    }

    // Checkout the default branch first — git won't allow creating a worktree
    // for a branch that's currently checked out in the main working tree.
    let checkout_output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", &req.repo_path, "checkout", &req.default_branch])
            .output(),
    )
    .await
    .map_err(|_| WorktreeOpsError::GitError("git checkout timed out".to_string()))?
    .map_err(|e| WorktreeOpsError::GitError(format!("failed to run git checkout: {}", e)))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr)
            .trim()
            .to_string();
        return Err(WorktreeOpsError::GitError(format!(
            "checkout to {} failed: {}",
            req.default_branch, stderr
        )));
    }

    // Create worktree from existing branch (no -b flag)
    let args = vec![
        "-C",
        &req.repo_path,
        "worktree",
        "add",
        &worktree_path,
        &req.branch_name,
    ];

    let output = tokio::time::timeout(GIT_TIMEOUT, Command::new("git").args(&args).output())
        .await
        .map_err(|_| WorktreeOpsError::GitError("git worktree add timed out".to_string()))?
        .map_err(|e| WorktreeOpsError::GitError(format!("failed to run git: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.contains("already exists") {
            return Err(WorktreeOpsError::AlreadyExists(req.branch_name.clone()));
        }
        return Err(WorktreeOpsError::GitError(stderr));
    }

    Ok(WorktreeCreateResult {
        path: worktree_path,
        branch: req.branch_name.clone(),
        staleness: None,
    })
}

/// Clean up an orphaned worktree whose directory has already been removed.
///
/// Runs `git worktree prune` to clear stale git registry entries, then
/// attempts to delete the associated branch (best-effort). Returns `Ok(())`
/// for idempotent delete semantics.
async fn cleanup_orphaned_worktree(
    repo_path: &str,
    worktree_name: &str,
    force: bool,
) -> Result<(), WorktreeOpsError> {
    // Prune stale worktree entries from git's internal list
    let prune_output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_path, "worktree", "prune"])
            .output(),
    )
    .await
    .map_err(|_| WorktreeOpsError::GitError("git worktree prune timed out".to_string()))?
    .map_err(|e| WorktreeOpsError::GitError(format!("failed to run git: {}", e)))?;

    if !prune_output.status.success() {
        let stderr = String::from_utf8_lossy(&prune_output.stderr)
            .trim()
            .to_string();
        return Err(WorktreeOpsError::GitError(format!(
            "git worktree prune failed: {}",
            stderr
        )));
    }

    // Best-effort branch deletion — infer branch name from worktree name
    let flag = if force { "-D" } else { "-d" };
    let _ = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_path, "branch", flag, worktree_name])
            .output(),
    )
    .await;

    Ok(())
}

/// Detect the branch checked out in a worktree via `git worktree list --porcelain`
async fn detect_worktree_branch(repo_path: &str, worktree_path: &str) -> Option<String> {
    let output = tokio::time::timeout(
        GIT_TIMEOUT,
        Command::new("git")
            .args(["-C", repo_path, "worktree", "list", "--porcelain"])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    // Parse porcelain output: blocks separated by blank lines
    // Each block: "worktree <path>\nHEAD <sha>\nbranch refs/heads/<name>\n"
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut in_target = false;
    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            in_target = line.trim_start_matches("worktree ") == worktree_path;
        } else if in_target && line.starts_with("branch refs/heads/") {
            return Some(line.trim_start_matches("branch refs/heads/").to_string());
        } else if line.is_empty() {
            in_target = false;
        }
    }
    None
}

/// Check if a worktree has no uncommitted changes
///
/// Returns `Some(true)` if clean, `Some(false)` if dirty, `None` if check failed.
pub async fn check_worktree_clean(worktree_path: &str) -> Option<bool> {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new("git")
            .args(["-C", worktree_path, "status", "--porcelain"])
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if output.status.success() {
        Some(output.stdout.is_empty())
    } else {
        None
    }
}

/// Run setup commands sequentially in a worktree directory
///
/// Each command is executed via `sh -c` with a per-command timeout.
/// Stops at the first failure (worktree is not rolled back).
pub async fn run_setup_commands(
    worktree_path: &str,
    commands: &[String],
    timeout_secs: u64,
) -> Result<(), String> {
    if commands.is_empty() {
        return Ok(());
    }

    let timeout = Duration::from_secs(timeout_secs);

    for cmd in commands {
        tracing::info!(
            worktree = worktree_path,
            command = cmd,
            "Running setup command"
        );

        let result = tokio::time::timeout(
            timeout,
            Command::new("sh")
                .args(["-c", cmd])
                .current_dir(worktree_path)
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) => {
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return Err(format!(
                        "command '{}' failed (exit {}): {}",
                        cmd,
                        output.status.code().unwrap_or(-1),
                        stderr
                    ));
                }
            }
            Ok(Err(e)) => {
                return Err(format!("failed to run '{}': {}", cmd, e));
            }
            Err(_) => {
                return Err(format!(
                    "command '{}' timed out after {}s",
                    cmd, timeout_secs
                ));
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// Initialize a bare-minimum git repo in a temp directory with "main" as default branch
    async fn init_test_repo() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().to_path_buf();

        // git init with explicit main branch
        let status = Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "init", "-b", "main"])
            .output()
            .await
            .unwrap();
        assert!(status.status.success(), "git init failed");

        // Configure user for commits
        Command::new("git")
            .args([
                "-C",
                &repo.to_string_lossy(),
                "config",
                "user.email",
                "test@test.com",
            ])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "config", "user.name", "Test"])
            .output()
            .await
            .unwrap();

        // Create initial commit (needed for worktree)
        let file = repo.join("README.md");
        tokio::fs::write(&file, "# Test repo\n").await.unwrap();
        Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "add", "."])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args([
                "-C",
                &repo.to_string_lossy(),
                "commit",
                "-m",
                "Initial commit",
            ])
            .output()
            .await
            .unwrap();

        (tmp, repo)
    }

    #[tokio::test]
    async fn test_create_worktree_success() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        let req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-test".to_string(),
            dir_name: None,
            base_branch: None,
            auto_fetch_base: false,
        };

        let result = create_worktree(&req).await;
        assert!(result.is_ok(), "create failed: {:?}", result.err());

        let res = result.unwrap();
        assert_eq!(res.branch, "feat-test");
        assert!(Path::new(&res.path).exists());
        assert!(res.path.contains(".claude/worktrees/feat-test"));
    }

    #[tokio::test]
    async fn test_create_worktree_with_base_branch() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        let req = WorktreeCreateRequest {
            repo_path,
            branch_name: "feat-from-main".to_string(),
            dir_name: None,
            base_branch: Some("HEAD".to_string()),
            auto_fetch_base: false,
        };

        let result = create_worktree(&req).await;
        assert!(result.is_ok(), "create failed: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_create_worktree_invalid_name() {
        let req = WorktreeCreateRequest {
            repo_path: "/tmp/fake".to_string(),
            branch_name: "bad; rm -rf /".to_string(),
            dir_name: None,
            base_branch: None,
            auto_fetch_base: false,
        };

        let result = create_worktree(&req).await;
        assert!(matches!(result, Err(WorktreeOpsError::InvalidName(_))));
    }

    #[tokio::test]
    async fn test_create_worktree_invalid_base_branch() {
        let req = WorktreeCreateRequest {
            repo_path: "/tmp/fake".to_string(),
            branch_name: "valid-name".to_string(),
            dir_name: None,
            base_branch: Some("--exec=evil".to_string()),
            auto_fetch_base: false,
        };

        let result = create_worktree(&req).await;
        assert!(matches!(result, Err(WorktreeOpsError::InvalidName(_))));
    }

    #[tokio::test]
    async fn test_create_worktree_already_exists() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        let req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-dup".to_string(),
            dir_name: None,
            base_branch: None,
            auto_fetch_base: false,
        };

        // First create succeeds
        create_worktree(&req).await.unwrap();
        // Second create fails
        let result = create_worktree(&req).await;
        assert!(matches!(result, Err(WorktreeOpsError::AlreadyExists(_))));
    }

    #[tokio::test]
    async fn test_delete_worktree_success() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Create first
        let create_req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-delete-me".to_string(),
            dir_name: None,
            base_branch: None,
            auto_fetch_base: false,
        };
        create_worktree(&create_req).await.unwrap();

        // Delete
        let del_req = WorktreeDeleteRequest {
            repo_path: repo_path.clone(),
            worktree_name: "feat-delete-me".to_string(),
            force: false,
        };
        let result = delete_worktree(&del_req).await;
        assert!(result.is_ok(), "delete failed: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_delete_worktree_not_found_succeeds_with_prune() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Deleting a nonexistent worktree should succeed (idempotent)
        let req = WorktreeDeleteRequest {
            repo_path,
            worktree_name: "nonexistent".to_string(),
            force: false,
        };

        let result = delete_worktree(&req).await;
        assert!(
            result.is_ok(),
            "expected Ok for missing directory, got: {:?}",
            result.err()
        );
    }

    #[tokio::test]
    async fn test_delete_worktree_directory_already_removed() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Create a worktree normally
        let create_req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-orphan".to_string(),
            dir_name: None,
            base_branch: None,
            auto_fetch_base: false,
        };
        let wt = create_worktree(&create_req).await.unwrap();

        // Manually remove the worktree directory (simulating auto-cleanup)
        tokio::fs::remove_dir_all(&wt.path).await.unwrap();
        assert!(!Path::new(&wt.path).exists());

        // Delete should still succeed via prune path
        let del_req = WorktreeDeleteRequest {
            repo_path: repo_path.clone(),
            worktree_name: "feat-orphan".to_string(),
            force: true,
        };
        let result = delete_worktree(&del_req).await;
        assert!(
            result.is_ok(),
            "expected Ok for orphaned worktree, got: {:?}",
            result.err()
        );

        // Branch should also be cleaned up
        let branch_output = Command::new("git")
            .args(["-C", &repo_path, "branch", "--list", "feat-orphan"])
            .output()
            .await
            .unwrap();
        let branches = String::from_utf8_lossy(&branch_output.stdout);
        assert!(
            !branches.contains("feat-orphan"),
            "branch should have been deleted, but found: {}",
            branches
        );
    }

    #[tokio::test]
    async fn test_delete_worktree_dirty_without_force() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Create worktree
        let create_req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-dirty".to_string(),
            dir_name: None,
            base_branch: None,
            auto_fetch_base: false,
        };
        let wt = create_worktree(&create_req).await.unwrap();

        // Make it dirty
        let dirty_file = Path::new(&wt.path).join("dirty.txt");
        tokio::fs::write(&dirty_file, "dirty content\n")
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &wt.path, "add", "dirty.txt"])
            .output()
            .await
            .unwrap();

        // Delete without force should fail
        let del_req = WorktreeDeleteRequest {
            repo_path: repo_path.clone(),
            worktree_name: "feat-dirty".to_string(),
            force: false,
        };
        let result = delete_worktree(&del_req).await;
        assert!(
            matches!(result, Err(WorktreeOpsError::UncommittedChanges(_))),
            "expected UncommittedChanges, got: {:?}",
            result
        );
    }

    #[tokio::test]
    async fn test_delete_worktree_dirty_with_force() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Create worktree
        let create_req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-force".to_string(),
            dir_name: None,
            base_branch: None,
            auto_fetch_base: false,
        };
        let wt = create_worktree(&create_req).await.unwrap();

        // Make it dirty
        let dirty_file = Path::new(&wt.path).join("dirty.txt");
        tokio::fs::write(&dirty_file, "dirty\n").await.unwrap();

        // Delete with force should succeed
        let del_req = WorktreeDeleteRequest {
            repo_path,
            worktree_name: "feat-force".to_string(),
            force: true,
        };
        let result = delete_worktree(&del_req).await;
        assert!(result.is_ok(), "force delete failed: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_delete_worktree_invalid_name() {
        let req = WorktreeDeleteRequest {
            repo_path: "/tmp/fake".to_string(),
            worktree_name: "../etc".to_string(),
            force: false,
        };
        let result = delete_worktree(&req).await;
        assert!(matches!(result, Err(WorktreeOpsError::InvalidName(_))));
    }

    #[tokio::test]
    async fn test_check_worktree_clean() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Clean repo should be clean
        let clean = check_worktree_clean(&repo_path).await;
        assert_eq!(clean, Some(true));

        // Make it dirty
        let file = repo.join("new_file.txt");
        tokio::fs::write(&file, "content\n").await.unwrap();
        let dirty = check_worktree_clean(&repo_path).await;
        assert_eq!(dirty, Some(false));
    }

    #[tokio::test]
    async fn test_check_worktree_clean_nonexistent() {
        let result = check_worktree_clean("/nonexistent/path").await;
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn test_run_setup_commands_success() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let commands = vec!["echo hello".to_string(), "echo world".to_string()];
        let result = run_setup_commands(&path, &commands, 30).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_run_setup_commands_failure() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let commands = vec!["echo ok".to_string(), "false".to_string()];
        let result = run_setup_commands(&path, &commands, 30).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("false"),
            "error should mention command: {}",
            err
        );
    }

    #[tokio::test]
    async fn test_run_setup_commands_timeout() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let commands = vec!["sleep 60".to_string()];
        let result = run_setup_commands(&path, &commands, 1).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("timed out"),
            "error should mention timeout: {}",
            err
        );
    }

    #[tokio::test]
    async fn test_run_setup_commands_empty() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let result = run_setup_commands(&path, &[], 30).await;
        assert!(result.is_ok());
    }

    /// Helper: create a non-main branch with a commit in a test repo
    async fn create_branch_with_commit(repo: &PathBuf, branch: &str) {
        let repo_str = repo.to_string_lossy().to_string();
        Command::new("git")
            .args(["-C", &repo_str, "checkout", "-b", branch])
            .output()
            .await
            .unwrap();
        let file = repo.join(format!("{}.txt", branch));
        tokio::fs::write(&file, format!("{} content\n", branch))
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &repo_str, "add", "."])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &repo_str, "commit", "-m", &format!("add {}", branch)])
            .output()
            .await
            .unwrap();
    }

    /// Helper: get the current branch name
    async fn current_branch(repo: &PathBuf) -> String {
        let output = Command::new("git")
            .args([
                "-C",
                &repo.to_string_lossy(),
                "rev-parse",
                "--abbrev-ref",
                "HEAD",
            ])
            .output()
            .await
            .unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[tokio::test]
    async fn test_move_to_worktree_success() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Create a feature branch (checked out)
        create_branch_with_commit(&repo, "feat-move").await;
        assert_eq!(current_branch(&repo).await, "feat-move");

        let req = WorktreeMoveRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-move".to_string(),
            dir_name: None,
            default_branch: "main".to_string(),
        };

        let result = move_to_worktree(&req).await;
        assert!(result.is_ok(), "move failed: {:?}", result.err());

        let res = result.unwrap();
        assert_eq!(res.branch, "feat-move");
        assert!(Path::new(&res.path).exists());
        assert!(res.path.contains(".claude/worktrees/feat-move"));

        // Main working tree should now be on main/master
        let branch = current_branch(&repo).await;
        assert_eq!(branch, "main");
    }

    #[tokio::test]
    async fn test_move_to_worktree_auto_commits_dirty() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Create a feature branch
        create_branch_with_commit(&repo, "feat-dirty-move").await;

        // Make it dirty
        let dirty_file = repo.join("uncommitted.txt");
        tokio::fs::write(&dirty_file, "dirty content\n")
            .await
            .unwrap();

        assert_eq!(check_worktree_clean(&repo_path).await, Some(false));

        let req = WorktreeMoveRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-dirty-move".to_string(),
            dir_name: None,
            default_branch: "main".to_string(),
        };

        let result = move_to_worktree(&req).await;
        assert!(result.is_ok(), "move failed: {:?}", result.err());

        // After move, main working tree should be clean and on main
        assert_eq!(current_branch(&repo).await, "main");
    }

    #[tokio::test]
    async fn test_move_to_worktree_invalid_branch() {
        let req = WorktreeMoveRequest {
            repo_path: "/tmp/fake".to_string(),
            branch_name: "bad; rm -rf /".to_string(),
            dir_name: None,
            default_branch: "main".to_string(),
        };

        let result = move_to_worktree(&req).await;
        assert!(matches!(result, Err(WorktreeOpsError::InvalidName(_))));
    }

    #[tokio::test]
    async fn test_move_to_worktree_invalid_default_branch() {
        let req = WorktreeMoveRequest {
            repo_path: "/tmp/fake".to_string(),
            branch_name: "valid-name".to_string(),
            dir_name: None,
            default_branch: "--exec=evil".to_string(),
        };

        let result = move_to_worktree(&req).await;
        assert!(matches!(result, Err(WorktreeOpsError::InvalidName(_))));
    }

    #[tokio::test]
    async fn test_move_to_worktree_already_exists() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        // Create a feature branch
        create_branch_with_commit(&repo, "feat-dup-move").await;

        // Pre-create the worktree directory
        let wt_dir = repo.join(".claude").join("worktrees").join("feat-dup-move");
        tokio::fs::create_dir_all(&wt_dir).await.unwrap();

        let req = WorktreeMoveRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-dup-move".to_string(),
            dir_name: None,
            default_branch: "main".to_string(),
        };

        let result = move_to_worktree(&req).await;
        assert!(matches!(result, Err(WorktreeOpsError::AlreadyExists(_))));
    }

    // -----------------------------------------------------------------
    // Staleness handling (issue #334)
    // -----------------------------------------------------------------

    /// Build a clone-of-clone topology that simulates a real `origin`.
    ///
    /// Returns `(clone_tmp, bare_tmp, upstream_tmp, clone_path, upstream_path)`.
    /// All three TempDirs MUST be kept alive by the caller for the duration
    /// of the test — drop them and the underlying directories vanish, which
    /// breaks any subsequent `git` calls that hold paths into them.
    async fn init_repo_with_origin() -> (TempDir, TempDir, TempDir, PathBuf, PathBuf) {
        // Upstream: a normal repo that we will then clone --bare from.
        // Doing it this way (vs. `init --bare` + commits via a working tree)
        // sidesteps the need for a separate seeding worktree for the bare repo.
        let upstream_tmp = TempDir::new().unwrap();
        let upstream = upstream_tmp.path().to_path_buf();
        let upstream_str = upstream.to_string_lossy().to_string();
        Command::new("git")
            .args(["-C", &upstream_str, "init", "-b", "main"])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &upstream_str, "config", "user.email", "u@u.com"])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &upstream_str, "config", "user.name", "U"])
            .output()
            .await
            .unwrap();
        tokio::fs::write(upstream.join("README.md"), "init\n")
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &upstream_str, "add", "."])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &upstream_str, "commit", "-m", "init"])
            .output()
            .await
            .unwrap();

        // Bare mirror that the working clone will use as `origin`.
        let bare_tmp = TempDir::new().unwrap();
        let bare = bare_tmp.path().join("origin.git");
        Command::new("git")
            .args(["clone", "--bare", &upstream_str, &bare.to_string_lossy()])
            .output()
            .await
            .unwrap();

        // Working clone — this is what `create_worktree` will operate on.
        let clone_tmp = TempDir::new().unwrap();
        let clone = clone_tmp.path().join("repo");
        Command::new("git")
            .args(["clone", &bare.to_string_lossy(), &clone.to_string_lossy()])
            .output()
            .await
            .unwrap();
        let clone_str = clone.to_string_lossy().to_string();
        Command::new("git")
            .args(["-C", &clone_str, "config", "user.email", "c@c.com"])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &clone_str, "config", "user.name", "C"])
            .output()
            .await
            .unwrap();

        (clone_tmp, bare_tmp, upstream_tmp, clone, upstream)
    }

    /// Push a new commit to the bare origin via the `upstream` working tree
    /// so the working `clone` falls behind `origin/main`.
    async fn advance_origin(upstream: &Path, bare: &Path, marker: &str) {
        let upstream_str = upstream.to_string_lossy().to_string();
        tokio::fs::write(upstream.join(format!("{marker}.txt")), marker)
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &upstream_str, "add", "."])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &upstream_str, "commit", "-m", marker])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args(["-C", &upstream_str, "push", &bare.to_string_lossy(), "main"])
            .output()
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_create_worktree_stale_base_uses_origin() {
        let (_clone_tmp, _bare_tmp_keep, _upstream_tmp, clone, _upstream) =
            init_repo_with_origin().await;
        let bare_keep = _bare_tmp_keep.path().join("origin.git");
        advance_origin(&_upstream, &bare_keep, "ahead1").await;
        advance_origin(&_upstream, &bare_keep, "ahead2").await;

        let repo_path = clone.to_string_lossy().to_string();

        let req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-stale".to_string(),
            dir_name: None,
            base_branch: Some("main".to_string()),
            auto_fetch_base: true,
        };

        let res = create_worktree(&req).await.unwrap();
        let report = res.staleness.expect("staleness should have been reported");
        assert_eq!(report.base_branch, "main");
        assert_eq!(report.behind, 2, "should detect 2 commits behind");
        assert_eq!(report.used_ref, "origin/main");

        // The created worktree's HEAD must contain the upstream commits — it
        // was branched off origin/main, not the stale local main.
        let log = Command::new("git")
            .args(["-C", &res.path, "log", "--format=%s"])
            .output()
            .await
            .unwrap();
        let log_str = String::from_utf8_lossy(&log.stdout);
        assert!(
            log_str.contains("ahead1") && log_str.contains("ahead2"),
            "worktree HEAD missing upstream commits; log:\n{}",
            log_str
        );
    }

    #[tokio::test]
    async fn test_create_worktree_up_to_date_no_staleness() {
        let (_clone_tmp, _bare_tmp_keep, _upstream_tmp, clone, _upstream) =
            init_repo_with_origin().await;
        let repo_path = clone.to_string_lossy().to_string();

        let req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-fresh".to_string(),
            dir_name: None,
            base_branch: Some("main".to_string()),
            auto_fetch_base: true,
        };

        let res = create_worktree(&req).await.unwrap();
        assert!(
            res.staleness.is_none(),
            "no staleness expected when local is up-to-date, got: {:?}",
            res.staleness
        );
    }

    #[tokio::test]
    async fn test_create_worktree_no_origin_falls_back_silently() {
        // No remote configured at all — must not fail.
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        let req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-no-origin".to_string(),
            dir_name: None,
            base_branch: Some("main".to_string()),
            auto_fetch_base: true,
        };

        let res = create_worktree(&req).await.unwrap();
        assert!(res.staleness.is_none());
        assert_eq!(res.branch, "feat-no-origin");
    }

    #[tokio::test]
    async fn test_create_worktree_auto_fetch_disabled_skips_check() {
        // When auto_fetch_base = false, we must not even attempt the fetch
        // — preserves legacy behavior for callers (e.g. the TUI) that branch
        // off the local HEAD intentionally.
        let (_clone_tmp, _bare_tmp_keep, _upstream_tmp, clone, _upstream) =
            init_repo_with_origin().await;
        let bare_keep = _bare_tmp_keep.path().join("origin.git");
        advance_origin(&_upstream, &bare_keep, "ahead").await;

        let repo_path = clone.to_string_lossy().to_string();
        let req = WorktreeCreateRequest {
            repo_path: repo_path.clone(),
            branch_name: "feat-skip".to_string(),
            dir_name: None,
            base_branch: Some("main".to_string()),
            auto_fetch_base: false,
        };

        let res = create_worktree(&req).await.unwrap();
        assert!(res.staleness.is_none(), "no check should run");

        // HEAD must NOT include the upstream commit because we never fetched.
        let log = Command::new("git")
            .args(["-C", &res.path, "log", "--format=%s"])
            .output()
            .await
            .unwrap();
        let log_str = String::from_utf8_lossy(&log.stdout);
        assert!(
            !log_str.contains("ahead"),
            "worktree should be on stale main; log:\n{}",
            log_str
        );
    }
}
