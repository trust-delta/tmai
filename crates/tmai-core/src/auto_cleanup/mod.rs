//! Auto-cleanup service — rule-based cleanup of agents and worktrees
//! when PRs are merged or closed.
//!
//! Subscribes to `CoreEvent::PrClosed` and automatically:
//! 1. Kills agents working on the closed PR's branch
//! 2. Deletes the associated git worktree
//!
//! This is deterministic (no LLM judgment) — cleanup rules are applied
//! by the tool, not the orchestrator.

mod service;

pub use service::AutoCleanupService;
