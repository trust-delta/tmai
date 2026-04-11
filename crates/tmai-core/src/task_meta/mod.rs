//! File-based task metadata (.task-meta/) for persistence across restarts.
//!
//! Each branch gets a JSON file: `.task-meta/{branch-name}.json`
//! containing issue/PR associations and milestone history.
//! Branch name is the natural key — joins with git worktree info.

mod service;
pub mod store;

pub use service::{
    count_ci_failures, count_consecutive_failures, count_review_loops, restore_from_disk,
    SharedGuardrailsSettings, TaskMetaService,
};
pub use store::{Milestone, TaskMeta};
