//! Request and error types for worktree operations.

use std::fmt;

/// Worktree creation request
#[derive(Debug, Clone)]
pub struct WorktreeCreateRequest {
    /// Absolute path to the main repository
    pub repo_path: String,
    /// Branch name (= worktree directory name)
    pub branch_name: String,
    /// Branch to fork from (default: HEAD)
    pub base_branch: Option<String>,
}

/// Worktree deletion request
#[derive(Debug, Clone)]
pub struct WorktreeDeleteRequest {
    /// Absolute path to the main repository
    pub repo_path: String,
    /// Worktree name (directory name under .claude/worktrees/)
    pub worktree_name: String,
    /// Force removal even with uncommitted changes
    pub force: bool,
}

/// Worktree operation errors
#[derive(Debug)]
pub enum WorktreeOpsError {
    /// Name failed validation (special chars, too long, etc.)
    InvalidName(String),
    /// A worktree with this name already exists
    AlreadyExists(String),
    /// The requested worktree was not found
    NotFound(String),
    /// Worktree has uncommitted changes (and force=false)
    UncommittedChanges(String),
    /// Underlying git command failed
    GitError(String),
    /// An agent is still running in the worktree
    AgentStillRunning(String),
}

impl fmt::Display for WorktreeOpsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidName(msg) => write!(f, "invalid worktree name: {}", msg),
            Self::AlreadyExists(name) => write!(f, "worktree already exists: {}", name),
            Self::NotFound(name) => write!(f, "worktree not found: {}", name),
            Self::UncommittedChanges(name) => {
                write!(f, "worktree has uncommitted changes: {}", name)
            }
            Self::GitError(msg) => write!(f, "git error: {}", msg),
            Self::AgentStillRunning(name) => {
                write!(f, "agent still running in worktree: {}", name)
            }
        }
    }
}

impl std::error::Error for WorktreeOpsError {}

/// Result of a successful worktree creation
#[derive(Debug, Clone)]
pub struct WorktreeCreateResult {
    /// Absolute path to the created worktree
    pub path: String,
    /// Branch name
    pub branch: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_request_construction() {
        let req = WorktreeCreateRequest {
            repo_path: "/home/user/project".to_string(),
            branch_name: "feat-auth".to_string(),
            base_branch: Some("main".to_string()),
        };
        assert_eq!(req.repo_path, "/home/user/project");
        assert_eq!(req.branch_name, "feat-auth");
        assert_eq!(req.base_branch.as_deref(), Some("main"));
    }

    #[test]
    fn test_delete_request_construction() {
        let req = WorktreeDeleteRequest {
            repo_path: "/home/user/project".to_string(),
            worktree_name: "feat-auth".to_string(),
            force: false,
        };
        assert!(!req.force);
    }

    #[test]
    fn test_error_display() {
        assert_eq!(
            WorktreeOpsError::InvalidName("bad!".to_string()).to_string(),
            "invalid worktree name: bad!"
        );
        assert_eq!(
            WorktreeOpsError::AlreadyExists("feat-x".to_string()).to_string(),
            "worktree already exists: feat-x"
        );
        assert_eq!(
            WorktreeOpsError::NotFound("gone".to_string()).to_string(),
            "worktree not found: gone"
        );
        assert_eq!(
            WorktreeOpsError::UncommittedChanges("dirty".to_string()).to_string(),
            "worktree has uncommitted changes: dirty"
        );
        assert_eq!(
            WorktreeOpsError::GitError("fail".to_string()).to_string(),
            "git error: fail"
        );
        assert_eq!(
            WorktreeOpsError::AgentStillRunning("busy".to_string()).to_string(),
            "agent still running in worktree: busy"
        );
    }
}
