//! Server-Sent Events for real-time agent updates
//!
//! Uses `TmaiCore::subscribe()` for push-based notifications and falls back
//! to polling the latest state when the receiver lags.

use axum::{
    extract::State,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;

use tmai_core::api::{CoreEvent, TmaiCore};

use super::api::{build_team_info, TeamInfoResponse};

/// Build agents JSON from TmaiCore snapshots
fn build_agents_json(core: &TmaiCore) -> String {
    let agents = core.list_agents();
    serde_json::to_string(&agents).unwrap_or_else(|_| "[]".to_string())
}

/// Build agents JSON for change-detection comparison (excludes volatile fields like last_update)
fn build_agents_fingerprint(core: &TmaiCore) -> String {
    let agents = core.list_agents();
    let stripped: Vec<serde_json::Value> = agents
        .iter()
        .filter_map(|a| {
            let mut v = serde_json::to_value(a).ok()?;
            if let Some(obj) = v.as_object_mut() {
                obj.remove("last_update");
            }
            Some(v)
        })
        .collect();
    serde_json::to_string(&stripped).unwrap_or_default()
}

/// Build teams JSON from TmaiCore raw state
#[allow(deprecated)]
fn build_teams_json(core: &TmaiCore) -> String {
    let app_state = core.raw_state().read();
    let teams: Vec<TeamInfoResponse> = app_state
        .teams
        .values()
        .map(|snapshot| build_team_info(snapshot, &app_state))
        .collect();
    serde_json::to_string(&teams).unwrap_or_else(|_| "[]".to_string())
}

/// SSE stream for agent and team updates
///
/// Uses `core.subscribe()` to receive push notifications from the core event
/// system. Falls back to full state re-send on lag. Maintains a keep-alive
/// every 15 seconds.
pub async fn events(State(core): State<Arc<TmaiCore>>) -> impl IntoResponse {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(16);

    tokio::spawn(async move {
        let mut event_rx = core.subscribe();
        let mut last_agents_fingerprint = String::new();
        let mut last_teams_json = String::new();

        // Send initial state immediately
        let agents_json = build_agents_json(&core);
        let agents_fingerprint = build_agents_fingerprint(&core);
        let teams_json = build_teams_json(&core);

        if !agents_json.is_empty() && agents_json != "[]" {
            let event = Event::default().event("agents").data(&agents_json);
            if tx.send(Ok(event)).await.is_err() {
                return;
            }
            last_agents_fingerprint = agents_fingerprint;
        }
        if !teams_json.is_empty() && teams_json != "[]" {
            let event = Event::default().event("teams").data(&teams_json);
            if tx.send(Ok(event)).await.is_err() {
                return;
            }
            last_teams_json = teams_json;
        }

        // Fallback interval for when no events arrive (e.g. teams not yet emitting events)
        let mut fallback_interval = tokio::time::interval(Duration::from_millis(500));
        // Skip the first tick (already sent initial state)
        fallback_interval.tick().await;

        loop {
            tokio::select! {
                result = event_rx.recv() => {
                    match result {
                        Ok(CoreEvent::AgentsUpdated) | Ok(CoreEvent::AgentStatusChanged { .. })
                        | Ok(CoreEvent::AgentAppeared { .. }) | Ok(CoreEvent::AgentDisappeared { .. }) => {
                            let fingerprint = build_agents_fingerprint(&core);
                            if fingerprint != last_agents_fingerprint {
                                let agents_json = build_agents_json(&core);
                                let event = Event::default().event("agents").data(&agents_json);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                                last_agents_fingerprint = fingerprint;
                            }
                        }
                        Ok(CoreEvent::TeamsUpdated) => {
                            let teams_json = build_teams_json(&core);
                            if teams_json != last_teams_json {
                                let event = Event::default().event("teams").data(&teams_json);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                                last_teams_json = teams_json;
                            }
                        }
                        Ok(CoreEvent::TeammateIdle { team_name, member_name, .. }) => {
                            let data = serde_json::json!({
                                "team_name": team_name,
                                "member_name": member_name,
                            });
                            let event = Event::default()
                                .event("teammate_idle")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::TaskCreated { team_name, task_id, task_subject }) => {
                            let data = serde_json::json!({
                                "team_name": team_name,
                                "task_id": task_id,
                                "task_subject": task_subject,
                            });
                            let event = Event::default()
                                .event("task_created")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::TaskCompleted { team_name, task_id, task_subject }) => {
                            let data = serde_json::json!({
                                "team_name": team_name,
                                "task_id": task_id,
                                "task_subject": task_subject,
                            });
                            let event = Event::default()
                                .event("task_completed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ContextCompacting { target, compaction_count }) => {
                            let data = serde_json::json!({
                                "target": target,
                                "compaction_count": compaction_count,
                            });
                            let event = Event::default()
                                .event("context_compacting")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::UsageUpdated) => {
                            let usage = core.get_usage();
                            if let Ok(data) = serde_json::to_string(&usage) {
                                let event = Event::default().event("usage").data(data);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                            }
                        }
                        Ok(CoreEvent::WorktreeCreated { target, worktree }) => {
                            let data = serde_json::json!({
                                "target": target,
                                "worktree": worktree,
                            });
                            let event = Event::default()
                                .event("worktree_created")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::WorktreeRemoved { target, worktree }) => {
                            let data = serde_json::json!({
                                "target": target,
                                "worktree": worktree,
                            });
                            let event = Event::default()
                                .event("worktree_removed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ToolCallDeferred { defer_id, target, tool_name }) => {
                            let data = serde_json::json!({
                                "defer_id": defer_id,
                                "target": target,
                                "tool_name": tool_name,
                            });
                            let event = Event::default()
                                .event("tool_call_deferred")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ToolCallResolved { defer_id, target, decision, resolved_by }) => {
                            let data = serde_json::json!({
                                "defer_id": defer_id,
                                "target": target,
                                "decision": decision,
                                "resolved_by": resolved_by,
                            });
                            let event = Event::default()
                                .event("tool_call_resolved")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ConfigChanged { .. })
                        | Ok(CoreEvent::AgentStopped { .. })
                        | Ok(CoreEvent::InstructionsLoaded { .. })
                        | Ok(CoreEvent::ReviewReady { .. })
                        | Ok(CoreEvent::WorktreeSetupCompleted { .. })
                        | Ok(CoreEvent::WorktreeSetupFailed { .. }) => {
                            // Future: forward to SSE subscribers if needed
                        }
                        Ok(CoreEvent::ReviewLaunched { source_target, review_target }) => {
                            let data = serde_json::json!({
                                "source_target": source_target,
                                "review_target": review_target,
                            });
                            let event = Event::default()
                                .event("review_launched")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ReviewCompleted { source_target, summary }) => {
                            let data = serde_json::json!({
                                "source_target": source_target,
                                "summary": summary,
                            });
                            let event = Event::default()
                                .event("review_completed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Err(RecvError::Lagged(skipped)) => {
                            tracing::debug!(skipped, "SSE subscriber lagged, re-sending full state");
                            // Re-send full state on lag
                            let fingerprint = build_agents_fingerprint(&core);
                            if fingerprint != last_agents_fingerprint {
                                let agents_json = build_agents_json(&core);
                                let event = Event::default().event("agents").data(&agents_json);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                                last_agents_fingerprint = fingerprint;
                            }
                            let teams_json = build_teams_json(&core);
                            if teams_json != last_teams_json {
                                let event = Event::default().event("teams").data(&teams_json);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                                last_teams_json = teams_json;
                            }
                        }
                        Err(RecvError::Closed) => {
                            return;
                        }
                    }
                }
                _ = fallback_interval.tick() => {
                    // Fallback polling for data not yet covered by events (e.g. teams)
                    let teams_json = build_teams_json(&core);
                    if teams_json != last_teams_json {
                        let event = Event::default().event("teams").data(&teams_json);
                        if tx.send(Ok(event)).await.is_err() {
                            return;
                        }
                        last_teams_json = teams_json;
                    }
                }
            }
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
