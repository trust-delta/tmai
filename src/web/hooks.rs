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
use serde::Deserialize;
use std::sync::Arc;
use tracing::{debug, info, warn};

use tmai_core::api::{CoreEvent, TmaiCore};
use tmai_core::hooks::handler::{handle_hook_event, resolve_pane_id};
use tmai_core::hooks::HookEventPayload;

/// POST /hooks/event — receive a hook event from Claude Code
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
        return StatusCode::UNAUTHORIZED;
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
            return StatusCode::OK;
        }
    };

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

    StatusCode::OK
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
