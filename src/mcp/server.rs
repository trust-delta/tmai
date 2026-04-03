//! MCP server entry point.
//!
//! Starts a stdio-based MCP server that connects to the running tmai instance.

use anyhow::{Context, Result};
use rmcp::model::{Implementation, ServerCapabilities, ServerInfo};
use rmcp::serve_server;
use rmcp::transport::io::stdio;
use rmcp::ServerHandler;

use super::client::TmaiHttpClient;
use super::tools::TmaiMcpServer;

/// MCP server handler implementation
#[rmcp::tool_handler]
impl ServerHandler for TmaiMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("tmai", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "tmai MCP server — monitor and control AI coding agents. \
                 Use list_agents to see all agents, approve to accept pending permissions, \
                 send_text to inject prompts, and spawn_agent/spawn_worktree to start new agents.",
            )
    }
}

/// Run the MCP server on stdio
pub async fn run() -> Result<()> {
    // Connect to the running tmai instance
    let client =
        TmaiHttpClient::from_runtime().context("Cannot connect to tmai. Is tmai running?")?;

    let server = TmaiMcpServer::new(client);

    // Serve over stdio
    let service = serve_server(server, stdio())
        .await
        .context("Failed to start MCP server")?;

    // Wait until the client disconnects
    service.waiting().await?;

    Ok(())
}
