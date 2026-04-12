//! Persist orchestrator identity across tmai restarts and Claude Code `/resume`.
//!
//! Each orchestrator is identified by `(project_path, claude_session_id)`.
//! The store is persisted to `$XDG_STATE_HOME/tmai/orchestrators.json`
//! (fallback: `~/.local/state/tmai/orchestrators.json`) with `0600` permissions.
//!
//! - Tier 1 (exact match): a newly-detected agent whose
//!   `(project_path, claude_session_id)` tuple matches a persisted record
//!   is silently promoted to orchestrator.
//! - Tier 2 (/resume fallback): when the `claude_session_id` has changed
//!   (common after `/resume`) but the project matches a recent record and
//!   there is exactly one non-worktree candidate, the new agent is promoted
//!   and the record's session_id is rotated.

pub mod persist;
pub mod restore;

pub use persist::{
    default_store_path, new_shared, OrchestratorRecord, OrchestratorStore, SharedOrchestratorStore,
    DEFAULT_TTL_DAYS, TIER2_RECENCY_HOURS,
};
pub use restore::{try_restore_agent, update_last_seen_for_online};
