// WebSocket server for terminal I/O integration
// Provides real-time PTY output stream to connected Tauri frontend

use axum::{
    extract::ws::{WebSocket, WebSocketUpgrade},
    routing::get,
    Router,
};
use std::sync::Arc;
use tmai_core::api::TmaiCore;
use tokio::task::JoinHandle;

/// WebSocket upgrade handler for terminal stream
#[allow(dead_code)]
pub async fn ws_handler(ws: WebSocketUpgrade) -> impl axum::response::IntoResponse {
    ws.on_upgrade(handle_socket)
}

/// Handle a single WebSocket connection
#[allow(dead_code)]
async fn handle_socket(_socket: WebSocket) {
    // TODO: Subscribe to agent output stream
    // TODO: Forward PTY data to WebSocket client
    // TODO: Handle client messages (resize, input, etc.)
}

/// Start the WebSocket server
#[allow(dead_code)]
pub async fn start_ws_server(_core: Arc<TmaiCore>, port: u16) -> JoinHandle<Result<(), String>> {
    tokio::spawn(async move {
        let app = Router::new().route("/ws", get(ws_handler));

        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port))
            .await
            .map_err(|e| e.to_string())?;

        tracing::info!("WebSocket server started on port {}", port);

        axum::serve(listener, app)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    })
}
