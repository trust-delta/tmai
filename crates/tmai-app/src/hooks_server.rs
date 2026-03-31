// Minimal axum server for Claude Code HTTP hooks integration
// Receives hook events from Claude Code via POST /hooks/event

use axum::{
    body::Bytes,
    extract::{Json, State},
    http::StatusCode,
    routing::post,
    Router,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tmai_core::api::TmaiCore;
use tokio::task::JoinHandle;

/// Hook event from Claude Code
#[derive(Debug, serde::Deserialize)]
#[allow(dead_code)]
pub struct HookEventPayload {
    #[serde(default)]
    pub hook_event_name: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub timestamp: Option<String>,
}

/// Hook server state
#[derive(Clone)]
#[allow(dead_code)]
pub struct HookServerState {
    pub core: Arc<TmaiCore>,
    pub token: String,
}

/// Handle incoming hook event
///
/// Accepts raw bytes instead of `Json<T>` to avoid 415 errors when
/// Claude Code's HTTP hooks don't send `Content-Type: application/json`.
#[allow(dead_code)]
pub async fn handle_hook_event(
    State(state): State<HookServerState>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, StatusCode> {
    // Validate token
    let token = headers
        .get("x-tmai-token")
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if token != state.token {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Parse JSON payload manually (Content-Type agnostic)
    let payload: Value = serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;

    // Process hook event (delegate to core)
    tracing::debug!("Hook event received: {:?}", payload);

    // Acknowledge receipt
    Ok(Json(json!({ "status": "ok" })))
}

/// Handle incoming statusline data
///
/// Receives statusline JSON from Claude Code's statusline hook script.
#[allow(dead_code)]
pub async fn handle_statusline(
    State(state): State<HookServerState>,
    headers: axum::http::HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, StatusCode> {
    // Validate token
    let token = headers
        .get("x-tmai-token")
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if token != state.token {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Parse statusline JSON
    let _data: Value = serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;

    tracing::debug!("Statusline data received");

    Ok(Json(json!({ "status": "ok" })))
}

/// Start the hook server
#[allow(dead_code)]
pub async fn start_hook_server(
    core: Arc<TmaiCore>,
    token: String,
    port: u16,
) -> JoinHandle<Result<(), String>> {
    tokio::spawn(async move {
        let state = HookServerState { core, token };

        let app = Router::new()
            .route("/hooks/event", post(handle_hook_event))
            .route("/hooks/statusline", post(handle_statusline))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port))
            .await
            .map_err(|e| e.to_string())?;

        tracing::info!("Hook server started on port {}", port);

        axum::serve(listener, app)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    })
}
