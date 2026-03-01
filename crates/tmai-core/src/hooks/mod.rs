//! Hook integration for Claude Code HTTP hooks.
//!
//! This module handles events received from Claude Code's hook system,
//! providing the highest-fidelity agent state detection.
//!
//! Detection priority (3-tier):
//! 1. HTTP Hooks — direct event notification from Claude Code (100% accuracy)
//! 2. IPC Socket — PTY wrapper state reporting (high accuracy)
//! 3. capture-pane — screen scraping fallback

pub mod handler;
pub mod registry;
pub mod types;

pub use registry::{new_hook_registry, new_session_pane_map, HookRegistry, SessionPaneMap};
pub use types::{HookEventPayload, HookState, HookStatus};
