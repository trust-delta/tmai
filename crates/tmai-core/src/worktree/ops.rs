//! Git worktree CRUD operations.
//!
//! Worktrees are created under `<repo>/.claude/worktrees/<name>/`
//! to be compatible with Claude Code's `--worktree` convention.

use std::path::Path;
use std::time::Duration;
use tokio::process::Command;

use crate::git::is_valid_worktree_name;

use super::types::{
    WorktreeCreateRequest, WorktreeCreateResult, WorktreeDeleteRequest, WorktreeOpsError,
};

/// Timeout for git worktree commands
const GIT_TIMEOUT: Duration = Duration::from_secs(10);

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
    if let Some(ref base) = req.base_branch {
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
    })
}

/// Delete a git worktree
///
/// Checks for uncommitted changes unless `force` is set.
pub async fn delete_worktree(req: &WorktreeDeleteRequest) -> Result<(), WorktreeOpsError> {
    // Validate name
    if !is_valid_worktree_name(&req.worktree_name) {
        return Err(WorktreeOpsError::InvalidName(req.worktree_name.clone()));
    }

    let worktree_dir = Path::new(&req.repo_path)
        .join(".claude")
        .join("worktrees")
        .join(&req.worktree_name);

    if !worktree_dir.exists() {
        return Err(WorktreeOpsError::NotFound(req.worktree_name.clone()));
    }

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
    if let Some(ref branch) = branch_name {
        let _ = tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args(["-C", &req.repo_path, "branch", "-D", branch])
                .output(),
        )
        .await;

        // Also delete the remote tracking branch (best-effort)
        let _ = tokio::time::timeout(
            GIT_TIMEOUT,
            Command::new("git")
                .args(["-C", &req.repo_path, "push", "origin", "--delete", branch])
                .output(),
        )
        .await;
    }

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

    /// Initialize a bare-minimum git repo in a temp directory
    async fn init_test_repo() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().to_path_buf();

        // git init
        let status = Command::new("git")
            .args(["-C", &repo.to_string_lossy(), "init"])
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
    async fn test_delete_worktree_not_found() {
        let (_tmp, repo) = init_test_repo().await;
        let repo_path = repo.to_string_lossy().to_string();

        let req = WorktreeDeleteRequest {
            repo_path,
            worktree_name: "nonexistent".to_string(),
            force: false,
        };

        let result = delete_worktree(&req).await;
        assert!(matches!(result, Err(WorktreeOpsError::NotFound(_))));
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
}
