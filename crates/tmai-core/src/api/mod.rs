//! Public API layer (Facade) for tmai-core.
//!
//! This module provides [`TmaiCore`] — a high-level entry-point that
//! encapsulates all core services and exposes typed query/action methods.
//! Consumers (TUI, Web, MCP, IDE extensions) should use this API instead
//! of directly operating on `SharedState`.
//!
//! # Quick Start
//!
//! ```ignore
//! use tmai_core::api::{TmaiCore, TmaiCoreBuilder};
//!
//! let core = TmaiCoreBuilder::new(settings).build();
//!
//! // Query agents (lock-free for the caller)
//! let agents = core.list_agents();
//! let count = core.attention_count();
//!
//! // Subscribe to events (Phase 4)
//! let mut rx = core.subscribe();
//! ```

pub mod actions;
mod auto_approve;
mod builder;
mod core;
pub mod events;
#[cfg(feature = "openapi")]
pub mod openapi;
mod queries;
pub mod types;
mod worktree_guard;

pub use builder::TmaiCoreBuilder;
pub use core::TmaiCore;
pub use events::{CoreEvent, GuardrailKind};
pub use types::{
    ActionOrigin, AgentSnapshot, ApiError, SendPromptResult, TeamSummary, TeamTaskInfo,
    WorktreeSnapshot,
};

// Re-export for web/api.rs usage
pub use actions::has_checkbox_format;
