//! Hook event endpoints for receiving Claude Code HTTP hook notifications
//! and review completion notifications.
//!
//! `POST /hooks/event` — receives hook events and updates HookRegistry.
//! `POST /hooks/review-complete` — receives review completion from split pane.
//! Uses a separate auth token from the main web API (hooks_token).

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, info, warn};

use tmai_core::api::{CoreEvent, TmaiCore};
use tmai_core::auto_approve::types::PermissionDecision;
use tmai_core::hooks::handler::{handle_hook_event, handle_statusline, resolve_pane_id};
use tmai_core::hooks::{HookEventPayload, StatuslineData};

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
/// Returns structured JSON responses for events that support it:
/// - **PreToolUse**: `hookSpecificOutput.permissionDecision` for auto-approval
/// - **TeammateIdle/TaskCompleted**: `continue` + `stopReason` for stop control
/// - Other events: empty 200 OK
///
/// Parse hook payload from raw bytes, bypassing Content-Type requirement.
///
/// Claude Code's HTTP hooks may not send `Content-Type: application/json`,
/// causing axum's `Json` extractor to return 415 Unsupported Media Type.
/// By accepting raw bytes and deserializing manually, we handle any Content-Type.
pub async fn hook_event(
    State(core): State<Arc<TmaiCore>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let payload: HookEventPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(e) => {
            debug!("Hook event rejected: invalid JSON payload: {}", e);
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "invalid JSON"})),
            );
        }
    };
    // Validate hook token from Authorization header
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

    // For PreToolUse: evaluate auto-approve BEFORE processing the event.
    // This allows returning a permissionDecision in the response body,
    // preventing the permission prompt from appearing at all.
    let pre_tool_use_response = if payload.hook_event_name == "PreToolUse" {
        core.evaluate_pre_tool_use(&payload)
    } else {
        None
    };

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
            return (StatusCode::OK, Json(serde_json::json!({})));
        }
    };

    let event_name = payload.hook_event_name.clone();

    // Process the hook event (update HookRegistry, emit CoreEvent)
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

    // Build event-specific response body
    match event_name.as_str() {
        // PreToolUse: return permissionDecision for instant auto-approval
        "PreToolUse" => {
            if let Some(decision) = pre_tool_use_response {
                match decision.decision {
                    // Defer: hold HTTP connection while awaiting AI/human resolution
                    PermissionDecision::Defer => {
                        let tool_name = payload
                            .tool_name
                            .clone()
                            .unwrap_or_else(|| "unknown".into());
                        let (defer_id, rx) = core.defer_registry().defer(
                            payload.session_id.clone(),
                            pane_id.clone(),
                            tool_name.clone(),
                            payload.tool_input.clone(),
                            payload.cwd.clone(),
                        );

                        info!(
                            defer_id,
                            pane_id = %pane_id,
                            tool = %tool_name,
                            "Tool call deferred, awaiting resolution"
                        );

                        // Emit event so UI can show the pending deferred call
                        let _ = core.event_sender().send(CoreEvent::ToolCallDeferred {
                            defer_id,
                            target: pane_id.clone(),
                            tool_name: tool_name.clone(),
                        });

                        // Wait for resolution with timeout (default: 30s)
                        let defer_timeout =
                            Duration::from_secs(core.settings().auto_approve.timeout_secs);
                        let resolution = tokio::time::timeout(defer_timeout, rx).await;

                        match resolution {
                            Ok(Ok(res)) => {
                                let final_decision = res.decision.as_str();
                                info!(
                                    defer_id,
                                    decision = final_decision,
                                    resolved_by = %res.resolved_by,
                                    "Deferred tool call resolved"
                                );
                                let _ = core.event_sender().send(CoreEvent::ToolCallResolved {
                                    defer_id,
                                    target: pane_id,
                                    decision: final_decision.to_string(),
                                    resolved_by: res.resolved_by.clone(),
                                });
                                let response = serde_json::json!({
                                    "hookSpecificOutput": {
                                        "hookEventName": "PreToolUse",
                                        "permissionDecision": final_decision,
                                        "permissionDecisionReason": res.reason
                                    }
                                });
                                (StatusCode::OK, Json(response))
                            }
                            _ => {
                                // Timeout or channel error: fall back to ask
                                warn!(
                                    defer_id,
                                    "Deferred tool call timed out, falling back to ask"
                                );
                                core.defer_registry().remove(defer_id);
                                let _ = core.event_sender().send(CoreEvent::ToolCallResolved {
                                    defer_id,
                                    target: pane_id,
                                    decision: "ask".into(),
                                    resolved_by: "timeout".into(),
                                });
                                let response = serde_json::json!({
                                    "hookSpecificOutput": {
                                        "hookEventName": "PreToolUse",
                                        "permissionDecision": "ask",
                                        "permissionDecisionReason": "Defer timed out"
                                    }
                                });
                                (StatusCode::OK, Json(response))
                            }
                        }
                    }

                    // Allow/Deny/Ask: return immediately
                    _ => {
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
                            model = %decision.model,
                            elapsed_ms = decision.elapsed_ms,
                            "PreToolUse auto-approve"
                        );
                        (StatusCode::OK, Json(response))
                    }
                }
            } else {
                (StatusCode::OK, Json(serde_json::json!({})))
            }
        }

        // TeammateIdle/TaskCompleted: return stop control response
        "TeammateIdle" | "TaskCompleted" => {
            let response = HookEventResponse {
                should_continue: true,
                stop_reason: None,
            };
            (
                StatusCode::OK,
                Json(serde_json::to_value(response).unwrap_or(serde_json::Value::Null)),
            )
        }

        // All other events: empty response
        _ => (StatusCode::OK, Json(serde_json::json!({}))),
    }
}

/// POST /hooks/statusline — receive statusline data from Claude Code
///
/// Statusline data provides reliable model info, cost metrics, context window
/// usage, and session metadata. Sent periodically by the statusline hook script.
pub async fn statusline(
    State(core): State<Arc<TmaiCore>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let data: StatuslineData = match serde_json::from_slice(&body) {
        Ok(d) => d,
        Err(e) => {
            debug!("Statusline rejected: invalid JSON payload: {}", e);
            return StatusCode::BAD_REQUEST;
        }
    };

    // Validate hook token from Authorization header
    let token_valid = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|token| core.validate_hook_token(token))
        .unwrap_or(false);

    if !token_valid {
        debug!("Statusline rejected: invalid or missing token");
        return StatusCode::UNAUTHORIZED;
    }

    // Extract pane_id from X-Tmai-Pane-Id header
    let header_pane_id = headers.get("x-tmai-pane-id").and_then(|v| v.to_str().ok());

    // Resolve pane_id using session_id from statusline data
    let session_id = data.session_id.as_deref().unwrap_or("");
    let cwd = data.cwd.as_deref();

    #[allow(deprecated)]
    let pane_id = match resolve_pane_id(
        header_pane_id,
        session_id,
        cwd,
        core.session_pane_map(),
        core.raw_state(),
    ) {
        Some(id) => id,
        None => {
            warn!(
                session_id = %session_id,
                "Could not resolve pane_id for statusline data"
            );
            return StatusCode::OK;
        }
    };

    // Process the statusline data (update HookRegistry)
    handle_statusline(
        data,
        &pane_id,
        core.hook_registry(),
        core.session_pane_map(),
    );

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
