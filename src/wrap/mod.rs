//! PTY wrapping module for AI agent monitoring
//!
//! This module provides PTY proxy functionality to monitor AI agent I/O in real-time,
//! enabling more accurate state detection than traditional tmux capture-pane approach.

pub mod analyzer;
pub mod exfil_detector;
pub mod runner;
pub mod state_file;

pub use exfil_detector::ExfilDetector;
pub use runner::PtyRunner;
pub use state_file::{StateFile, WrapState, WrapStatus};
