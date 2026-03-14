//! WebSocket client for connecting to a Codex CLI app-server instance.
//!
//! Handles connection, initialization handshake, message loop,
//! and exponential backoff reconnection.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::api::CoreEvent;
use crate::hooks::registry::HookRegistry;
use crate::state::SharedState;

use super::translator;
use super::types::{CodexWsMessage, JsonRpcRequest};

/// Configuration for a single WebSocket client connection
#[derive(Debug, Clone)]
pub struct CodexWsClientConfig {
    /// WebSocket URL to connect to
    pub url: String,
    /// Optional fixed pane_id (from config)
    pub pane_id: Option<String>,
}

/// Run a WebSocket client connection with automatic reconnection.
///
/// This function runs indefinitely, reconnecting on failure with
/// exponential backoff (1s → 2s → 4s → ... → 60s, ±25% jitter).
pub async fn run(
    config: CodexWsClientConfig,
    hook_registry: HookRegistry,
    event_tx: broadcast::Sender<CoreEvent>,
    state: SharedState,
) {
    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(60);

    loop {
        info!(url = %config.url, "Connecting to Codex app-server");

        match connect_and_run(&config, &hook_registry, &event_tx, &state).await {
            Ok(()) => {
                info!(url = %config.url, "Codex WS connection closed cleanly");
            }
            Err(e) => {
                warn!(url = %config.url, error = %e, "Codex WS connection error");
            }
        }

        // On disconnect, remove hook state so poller falls back to capture-pane
        if let Some(ref pane_id) = resolve_pane_id(&config, &state) {
            let mut reg = hook_registry.write();
            reg.remove(pane_id);
            debug!(pane_id, "Removed hook state after WS disconnect");
        }

        // Exponential backoff with jitter
        let jitter = jitter_duration(backoff);
        info!(
            url = %config.url,
            backoff_ms = jitter.as_millis(),
            "Reconnecting after backoff"
        );
        tokio::time::sleep(jitter).await;

        backoff = std::cmp::min(backoff * 2, max_backoff);
    }
}

/// Connect to the WebSocket server, perform initialization, and process messages
async fn connect_and_run(
    config: &CodexWsClientConfig,
    hook_registry: &HookRegistry,
    event_tx: &broadcast::Sender<CoreEvent>,
    state: &SharedState,
) -> anyhow::Result<()> {
    let (ws_stream, _response) = tokio_tungstenite::connect_async(&config.url).await?;
    let (mut write, mut read) = ws_stream.split();

    info!(url = %config.url, "Connected to Codex app-server");

    // Send initialize request
    let init_req = JsonRpcRequest::initialize(1);
    let init_json = serde_json::to_string(&init_req)?;
    write.send(Message::Text(init_json.into())).await?;
    debug!("Sent initialize request");

    // Wait for initialize response
    let init_response = tokio::time::timeout(Duration::from_secs(10), read.next())
        .await
        .map_err(|_| anyhow::anyhow!("Initialize response timeout"))?
        .ok_or_else(|| anyhow::anyhow!("Connection closed during initialization"))??;

    if let Message::Text(text) = init_response {
        let msg = CodexWsMessage::parse(&text)?;
        match msg {
            CodexWsMessage::Response(resp) => {
                if let Some(err) = resp.error {
                    return Err(anyhow::anyhow!(
                        "Initialize error: {} ({})",
                        err.message,
                        err.code
                    ));
                }
                info!("Codex app-server initialized successfully");
            }
            CodexWsMessage::Notification(_) => {
                debug!("Received notification before init response, continuing");
            }
        }
    }

    // Reset backoff on successful connection
    // (handled by the caller resetting backoff isn't needed since we loop)

    // Message processing loop
    while let Some(msg_result) = read.next().await {
        let msg = match msg_result {
            Ok(msg) => msg,
            Err(e) => {
                error!(error = %e, "WebSocket read error");
                return Err(e.into());
            }
        };

        match msg {
            Message::Text(text) => {
                handle_text_message(&text, config, hook_registry, event_tx, state);
            }
            Message::Ping(data) => {
                let _ = write.send(Message::Pong(data)).await;
            }
            Message::Close(_) => {
                info!(url = %config.url, "Received close frame");
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Handle an incoming text message from the WebSocket
fn handle_text_message(
    text: &str,
    config: &CodexWsClientConfig,
    hook_registry: &HookRegistry,
    event_tx: &broadcast::Sender<CoreEvent>,
    state: &SharedState,
) {
    let msg = match CodexWsMessage::parse(text) {
        Ok(msg) => msg,
        Err(e) => {
            warn!(error = %e, "Failed to parse WS message");
            return;
        }
    };

    let notification = match msg {
        CodexWsMessage::Notification(notif) => notif,
        CodexWsMessage::Response(_) => {
            // Unexpected response (we only sent initialize), ignore
            return;
        }
    };

    let codex_event = super::types::parse_codex_event(&notification);

    // Resolve pane_id — try config first, then cwd matching
    let pane_id = if let Some(ref id) = config.pane_id {
        id.clone()
    } else {
        // Try to resolve via cwd from thread/started event
        match &codex_event {
            super::types::CodexEvent::ThreadStarted { cwd: Some(cwd) } => {
                resolve_pane_id_by_cwd(cwd, state).unwrap_or_else(|| {
                    // Use URL-based synthetic pane_id as fallback
                    synthetic_pane_id(&config.url)
                })
            }
            _ => {
                // Check if we already have a hook state for a synthetic pane_id
                let synthetic = synthetic_pane_id(&config.url);
                let reg = hook_registry.read();
                if reg.contains_key(&synthetic) {
                    synthetic
                } else {
                    // Try resolving from existing hook states' cwd
                    resolve_pane_id(config, state).unwrap_or(synthetic)
                }
            }
        }
    };

    // Translate event and update hook registry
    if let Some(core_event) = translator::translate_event(&codex_event, &pane_id, hook_registry) {
        let _ = event_tx.send(core_event);
    }
}

/// Resolve pane_id by matching cwd against known agents in AppState
fn resolve_pane_id_by_cwd(cwd: &str, state: &SharedState) -> Option<String> {
    let app_state = state.read();
    for agent in app_state.agents.values() {
        if agent.cwd == cwd {
            if let Some(pane_id) = app_state.target_to_pane_id.get(&agent.target) {
                return Some(pane_id.clone());
            }
        }
    }
    None
}

/// Resolve pane_id from config or state
fn resolve_pane_id(config: &CodexWsClientConfig, state: &SharedState) -> Option<String> {
    if let Some(ref id) = config.pane_id {
        return Some(id.clone());
    }

    // Try to find a Codex agent by iterating state
    let app_state = state.read();
    for agent in app_state.agents.values() {
        if agent.agent_type == crate::agents::AgentType::CodexCli {
            if let Some(pane_id) = app_state.target_to_pane_id.get(&agent.target) {
                return Some(pane_id.clone());
            }
        }
    }
    None
}

/// Generate a synthetic pane_id from a WebSocket URL
fn synthetic_pane_id(url: &str) -> String {
    format!("codex-ws-{}", url.replace([':', '/', '.'], "-"))
}

/// Add ±25% jitter to a duration
fn jitter_duration(base: Duration) -> Duration {
    use rand::RngExt;
    let millis = base.as_millis() as f64;
    let jitter_range = millis * 0.25;
    let jitter = rand::rng().random_range(-jitter_range..jitter_range);
    Duration::from_millis((millis + jitter).max(100.0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_synthetic_pane_id() {
        let id = synthetic_pane_id("ws://127.0.0.1:15710");
        assert!(id.starts_with("codex-ws-"));
        assert!(!id.contains(':'));
        assert!(!id.contains('/'));
    }

    #[test]
    fn test_jitter_duration_within_range() {
        let base = Duration::from_secs(4);
        for _ in 0..100 {
            let jittered = jitter_duration(base);
            // Should be within 75%–125% of base
            assert!(jittered >= Duration::from_millis(3000));
            assert!(jittered <= Duration::from_millis(5000));
        }
    }

    #[test]
    fn test_initialize_request_format() {
        let req = JsonRpcRequest::initialize(42);
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], 42);
        assert_eq!(json["method"], "initialize");
        assert!(json["params"]["clientInfo"]["name"].as_str() == Some("tmai"));
    }
}
