//! Web server module for remote control via smartphone
//!
//! Provides REST API and SSE for real-time agent monitoring and control.

mod api;
pub mod auth;
mod events;
mod server;
mod static_files;

pub use server::WebServer;
