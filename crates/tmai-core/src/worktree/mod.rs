//! Git worktree CRUD operations.
//!
//! Provides create/delete operations for git worktrees under
//! `<repo>/.claude/worktrees/<name>/` (compatible with Claude Code `--worktree`).

pub mod ops;
pub mod types;

pub use ops::{
    check_worktree_clean, create_worktree, delete_worktree, move_to_worktree, run_setup_commands,
};
pub use types::{
    BaseStalenessReport, WorktreeCreateRequest, WorktreeCreateResult, WorktreeDeleteRequest,
    WorktreeMoveRequest, WorktreeOpsError,
};
