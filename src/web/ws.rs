//! WebSocket handler for PTY terminal streaming.
//!
//! Bridges a PTY session's output broadcast to a WebSocket connection,
//! allowing xterm.js to render live terminal output and send input.

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use std::sync::Arc;

use tmai_core::api::TmaiCore;

/// WebSocket upgrade handler for PTY terminal streaming.
///
/// GET /api/agents/{id}/terminal → WebSocket upgrade
///
/// Protocol:
/// - Server → Client: Binary frames (raw PTY output with ANSI escapes)
/// - Client → Server: Binary frames (raw input bytes)
/// - Client → Server: Text frames (JSON control messages, e.g. resize)
pub async fn ws_terminal(
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
    State(core): State<Arc<TmaiCore>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, id, core))
}

/// Handle a single WebSocket connection for a PTY session
async fn handle_ws(socket: WebSocket, session_id: String, core: Arc<TmaiCore>) {
    // Look up PTY session
    let session = match core.pty_registry().get(&session_id) {
        Some(s) => s,
        None => {
            tracing::warn!("WS: PTY session not found: {}", session_id);
            return;
        }
    };

    tracing::debug!("WS: connected to PTY session {}", session_id);

    // Subscribe BEFORE taking the snapshot so we don't miss output
    // that arrives between snapshot and first recv().
    let mut output_rx = session.subscribe();
    let (mut ws_tx, mut ws_rx) = socket.split();

    use futures_util::{SinkExt, StreamExt};

    // Replay scrollback buffer so the client sees past output
    let snapshot = session.scrollback_snapshot();
    if !snapshot.is_empty() {
        tracing::debug!(
            "WS: replaying {} bytes of scrollback for session {}",
            snapshot.len(),
            session_id
        );
        if ws_tx
            .send(Message::Binary(snapshot.to_vec().into()))
            .await
            .is_err()
        {
            return;
        }
    }

    // Bidirectional bridge: PTY output ↔ WebSocket
    loop {
        tokio::select! {
            // PTY output → WebSocket (binary frames)
            result = output_rx.recv() => {
                match result {
                    Ok(data) => {
                        if ws_tx.send(Message::Binary(data.to_vec().into())).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::debug!("WS: lagged {} messages for session {}", n, session_id);
                        // Continue — client will see gaps but that's acceptable
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        // PTY session ended
                        tracing::debug!("WS: PTY output channel closed for session {}", session_id);
                        break;
                    }
                }
            }

            // WebSocket → PTY input
            result = ws_rx.next() => {
                match result {
                    Some(Ok(Message::Binary(data))) => {
                        // Raw input bytes → PTY
                        if let Err(e) = session.write_input(&data) {
                            tracing::warn!("WS: PTY write error: {}", e);
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        // JSON control message
                        if let Err(e) = handle_control_message(&text, &session) {
                            tracing::debug!("WS: control message error: {}", e);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break; // Client disconnected
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = ws_tx.send(Message::Pong(data)).await;
                    }
                    Some(Ok(_)) => {} // Pong, etc.
                    Some(Err(e)) => {
                        tracing::debug!("WS: receive error: {}", e);
                        break;
                    }
                }
            }
        }
    }

    tracing::debug!("WS: disconnected from PTY session {}", session_id);
}

/// Control message envelope
#[derive(serde::Deserialize)]
struct ControlMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    cols: u16,
    #[serde(default)]
    rows: u16,
}

/// Handle a JSON control message from the client
fn handle_control_message(text: &str, session: &tmai_core::pty::PtySession) -> anyhow::Result<()> {
    let msg: ControlMessage = serde_json::from_str(text)?;
    match msg.msg_type.as_str() {
        "resize" => {
            if msg.cols > 0 && msg.rows > 0 {
                session.resize(msg.rows, msg.cols)?;
                tracing::debug!("WS: resized PTY to {}x{}", msg.cols, msg.rows);
            }
        }
        other => {
            tracing::debug!("WS: unknown control message type: {}", other);
        }
    }
    Ok(())
}
