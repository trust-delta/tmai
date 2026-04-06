//! Codex CLI app-server WebSocket integration.
//!
//! Connects to Codex CLI's `app-server --listen ws://IP:PORT` endpoint
//! for bidirectional JSON-RPC 2.0 communication:
//! - **Receive**: agent state events (turn/started, item/started, approval requests, etc.)
//! - **Send**: prompts (turn/start), approvals (JSON-RPC response), interrupts (turn/interrupt)

pub mod client;
pub mod sender;
pub mod service;
pub mod translator;
pub mod types;

pub use sender::CodexWsSender;
pub use service::CodexWsService;
