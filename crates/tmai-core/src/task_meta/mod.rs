//! File-based task metadata (.task-meta/) for persistence across restarts.
//!
//! Each branch gets a JSON file: `.task-meta/{branch-name}.json`
//! containing issue/PR associations and milestone history.
//! Branch name is the natural key — joins with git worktree info.

mod service;
pub mod store;

pub use service::{restore_from_disk, TaskMetaService};
pub use store::{Milestone, TaskMeta};
