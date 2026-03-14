//! Codex CLI app-server WebSocket integration.
//!
//! Connects to Codex CLI's `app-server --listen ws://IP:PORT` endpoint
//! to receive JSON-RPC 2.0 events for high-fidelity agent state detection.
//! Phase 1: read-only monitoring (no bidirectional control).

pub mod client;
pub mod service;
pub mod translator;
pub mod types;

pub use service::CodexWsService;
