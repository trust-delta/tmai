//! Git worktree CRUD operations.
//!
//! Provides create/delete operations for git worktrees under
//! `<repo>/.claude/worktrees/<name>/` (compatible with Claude Code `--worktree`).

pub mod ops;
pub mod types;

pub use ops::{check_worktree_clean, create_worktree, delete_worktree};
pub use types::{WorktreeCreateRequest, WorktreeDeleteRequest, WorktreeOpsError};
