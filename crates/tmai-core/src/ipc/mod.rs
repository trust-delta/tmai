//! IPC module for communication between PTY wrappers and tmai parent process
//!
//! Uses Unix domain sockets with newline-delimited JSON (ndjson) protocol
//! for bidirectional communication.

pub mod client;
pub mod protocol;
pub mod server;

pub use client::IpcClient;
pub use server::{IpcRegistry, IpcServer};
