//! PTY session management for spawning and streaming terminal processes.
//!
//! This module provides `PtySession` for individual PTY lifecycle management
//! and `PtyRegistry` for managing multiple sessions.

pub mod registry;
pub mod session;

pub use registry::PtyRegistry;
pub use session::PtySession;
