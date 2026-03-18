//! Minimal axum server for Claude Code HTTP hook event reception.
//!
//! Only exposes `POST /hooks/event` — the rest of the API is handled
//! via Tauri IPC commands.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tracing::{debug, info, warn};

use tmai_core::api::TmaiCore;
use tmai_core::hooks::handler::{handle_hook_event, resolve_pane_id};
use tmai_core::hooks::HookEventPayload;

/// Start the hooks HTTP server in the background.
///
/// Listens on the configured port for Claude Code hook events.
pub async fn start_hooks_server(core: Arc<TmaiCore>) {
    let port = core.settings().web.port;

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/hooks/event", post(hook_event))
        .with_state(core)
        .layer(cors);

    let addr = format!("0.0.0.0:{port}");
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            warn!("Failed to bind hooks server on {addr}: {e}");
            return;
        }
    };

    info!("Hooks server listening on port {port}");
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            warn!("Hooks server error: {e}");
        }
    });
}

/// POST /hooks/event — receive a hook event from Claude Code
async fn hook_event(
    State(core): State<Arc<TmaiCore>>,
    headers: HeaderMap,
    Json(payload): Json<HookEventPayload>,
) -> impl IntoResponse {
    // Validate hook token
    let token_valid = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|token| core.validate_hook_token(token))
        .unwrap_or(false);

    if !token_valid {
        debug!("Hook event rejected: invalid or missing token");
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({})));
    }

    // PreToolUse auto-approve evaluation
    let pre_tool_use_response = if payload.hook_event_name == "PreToolUse" {
        core.evaluate_pre_tool_use(&payload)
    } else {
        None
    };

    // Resolve pane_id
    let header_pane_id = headers.get("x-tmai-pane-id").and_then(|v| v.to_str().ok());

    #[allow(deprecated)]
    let pane_id = match resolve_pane_id(
        header_pane_id,
        &payload.session_id,
        payload.cwd.as_deref(),
        core.session_pane_map(),
        core.raw_state(),
    ) {
        Some(id) => id,
        None => {
            warn!(
                event = %payload.hook_event_name,
                session_id = %payload.session_id,
                "Could not resolve pane_id for hook event"
            );
            return (StatusCode::OK, Json(serde_json::json!({})));
        }
    };

    let event_name = payload.hook_event_name.clone();

    // Process hook event
    let core_event = handle_hook_event(
        &payload,
        &pane_id,
        core.hook_registry(),
        core.session_pane_map(),
    );

    if let Some(event) = core_event {
        let _ = core.event_sender().send(event);
    }

    core.notify_agents_updated();

    // Build response
    match event_name.as_str() {
        "PreToolUse" => {
            if let Some(decision) = pre_tool_use_response {
                let response = serde_json::json!({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": decision.decision.as_str(),
                        "permissionDecisionReason": decision.reason
                    }
                });
                info!(
                    pane_id = %pane_id,
                    tool = ?payload.tool_name,
                    decision = decision.decision.as_str(),
                    "PreToolUse auto-approve"
                );
                (StatusCode::OK, Json(response))
            } else {
                (StatusCode::OK, Json(serde_json::json!({})))
            }
        }
        "TeammateIdle" | "TaskCompleted" => (
            StatusCode::OK,
            Json(serde_json::json!({"continue": true, "stopReason": null})),
        ),
        _ => (StatusCode::OK, Json(serde_json::json!({}))),
    }
}
