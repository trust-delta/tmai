//! JSONL Transcript Watcher for Claude Code conversation logs.
//!
//! Watches `~/.claude/projects/{hash}/{session}.jsonl` files for changes
//! and provides parsed, rendered preview text for the Web UI.

pub mod ansi_renderer;
pub mod parser;
pub mod renderer;
pub mod types;
pub mod watcher;

pub use ansi_renderer::render_ansi_preview;
pub use types::{TranscriptRecord, TranscriptState};
pub use watcher::{TranscriptRegistry, TranscriptWatcher};
