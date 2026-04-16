//! Usage monitoring — fetch and parse Claude Code `/usage` output.
//!
//! This module spawns a temporary Claude Code instance in a hidden tmux pane,
//! sends `/usage`, captures the output, and parses it into structured data.

pub mod fetcher;
pub mod parser;
pub mod service;
pub mod types;

pub use fetcher::{
    fetch_usage, fetch_usage_auto, fetch_usage_pty, usage_channel, UsageSnapshotReceiver,
    UsageSnapshotSender,
};
pub use service::UsageAutoFetchService;
pub use types::{UsageMeter, UsageSnapshot};
