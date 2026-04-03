//! MCP (Model Context Protocol) server for tmai.
//!
//! Exposes tmai's functionality as MCP tools, allowing AI agents (e.g., Claude Code)
//! to programmatically control tmai — list agents, approve actions, send text,
//! query GitHub state, and manage worktrees.
//!
//! Communication: stdio transport (spawned by Claude Code as an MCP server).
//! The MCP server connects to the running tmai instance via its HTTP API.

pub mod client;
mod server;
mod tools;

pub use server::run;
