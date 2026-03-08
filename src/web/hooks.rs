//! Hook event endpoints for receiving Claude Code HTTP hook notifications
//! and review completion notifications.
//!
//! `POST /hooks/event` — receives hook events and updates HookRegistry.
//! `POST /hooks/review-complete` — receives review completion from split pane.
//! Uses a separate auth token from the main web API (hooks_token).

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info, warn};

use tmai_core::api::{CoreEvent, TmaiCore};
use tmai_core::hooks::handler::{handle_hook_event, resolve_pane_id};
use tmai_core::hooks::HookEventPayload;

/// Response body for hook events that support stop control
///
/// Claude Code v2.1.69+ supports `{"continue": false, "stopReason": "..."}` responses
/// for TeammateIdle and TaskCompleted events, allowing tmai to stop teammates.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HookEventResponse {
    /// Whether the teammate should continue (true) or stop (false)
    #[serde(rename = "continue")]
    should_continue: bool,
    /// Reason for stopping (only meaningful when should_continue is false)
    #[serde(skip_serializing_if = "Option::is_none")]
    stop_reason: Option<String>,
}

/// POST /hooks/event — receive a hook event from Claude Code
///
/// Returns 200 OK for most events. For TeammateIdle/TaskCompleted events,
/// returns a JSON body that can control whether the teammate continues.
pub async fn hook_event(
    State(core): State<Arc<TmaiCore>>,
    headers: HeaderMap,
    Json(payload): Json<HookEventPayload>,
) -> impl IntoResponse {
    // Validate hook token from Authorization header
    let token_valid = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|token| core.validate_hook_token(token))
        .unwrap_or(false);

    if !token_valid {
        debug!("Hook event rejected: invalid or missing token");
        return (StatusCode::UNAUTHORIZED, Json(serde_json::Value::Null));
    }

    // Extract pane_id from X-Tmai-Pane-Id header
    let header_pane_id = headers.get("x-tmai-pane-id").and_then(|v| v.to_str().ok());

    // Resolve pane_id using 3-tier fallback
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
            // Still return 200 to not block Claude Code
            return (StatusCode::OK, Json(serde_json::Value::Null));
        }
    };

    // Check if this is a teammate event that supports stop control
    let event_name = payload.hook_event_name.clone();

    // Process the hook event
    let core_event = handle_hook_event(
        &payload,
        &pane_id,
        core.hook_registry(),
        core.session_pane_map(),
    );

    // Emit CoreEvent if handler produced one
    if let Some(event) = core_event {
        let _ = core.event_sender().send(event);
    }

    // Notify subscribers that agent state may have changed
    core.notify_agents_updated();

    // For TeammateIdle/TaskCompleted, return JSON body for stop control.
    // Default: continue=true (don't stop). Future: configurable stop logic.
    if event_name == "TeammateIdle" || event_name == "TaskCompleted" {
        let response = HookEventResponse {
            should_continue: true,
            stop_reason: None,
        };
        (
            StatusCode::OK,
            Json(serde_json::to_value(response).unwrap_or(serde_json::Value::Null)),
        )
    } else {
        (StatusCode::OK, Json(serde_json::Value::Null))
    }
}

/// Payload for review completion notification
#[derive(Debug, Deserialize)]
pub struct ReviewCompletePayload {
    /// Original agent target that was reviewed
    pub source_target: String,
    /// One-line summary (first line of review output)
    pub summary: String,
}

/// POST /hooks/review-complete — receive review completion from split pane
pub async fn review_complete(
    State(core): State<Arc<TmaiCore>>,
    headers: HeaderMap,
    Json(payload): Json<ReviewCompletePayload>,
) -> impl IntoResponse {
    // Validate hook token
    let token_valid = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|token| core.validate_hook_token(token))
        .unwrap_or(false);

    if !token_valid {
        debug!("Review complete rejected: invalid or missing token");
        return StatusCode::UNAUTHORIZED;
    }

    info!(
        source_target = %payload.source_target,
        summary = %payload.summary,
        "Review completed"
    );

    let _ = core.event_sender().send(CoreEvent::ReviewCompleted {
        source_target: payload.source_target,
        summary: payload.summary,
    });

    StatusCode::OK
}
