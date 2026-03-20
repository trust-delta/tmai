//! PTY session management for spawning and streaming terminal processes.
//!
//! This module provides `PtySession` for individual PTY lifecycle management,
//! `PtyRegistry` for managing multiple sessions, and `holder` for the
//! detached PTY daemon that survives tmai restarts.

pub mod holder;
pub mod persistence;
pub mod registry;
pub mod session;

pub use registry::PtyRegistry;
pub use session::PtySession;
