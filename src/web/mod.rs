//! Web server module for remote control via smartphone
//!
//! Provides REST API and SSE for real-time agent monitoring and control.

mod api;
pub use api::{perform_dispatch_review, reconnect_codex_ws};
pub mod auth;
mod events;
pub mod hooks;
mod server;
mod static_files;
mod ws;

pub use server::WebServer;
