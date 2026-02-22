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

use super::api::{build_agent_info, build_team_info, AgentInfo, TeamInfoResponse};

/// Build agents JSON from TmaiCore snapshots
fn build_agents_json(core: &TmaiCore) -> String {
    let agents: Vec<AgentInfo> = core.list_agents().iter().map(build_agent_info).collect();
    serde_json::to_string(&agents).unwrap_or_else(|_| "[]".to_string())
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
        let mut last_agents_json = String::new();
        let mut last_teams_json = String::new();

        // Send initial state immediately
        let agents_json = build_agents_json(&core);
        let teams_json = build_teams_json(&core);

        if !agents_json.is_empty() && agents_json != "[]" {
            let event = Event::default().event("agents").data(&agents_json);
            if tx.send(Ok(event)).await.is_err() {
                return;
            }
            last_agents_json = agents_json;
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
                            let agents_json = build_agents_json(&core);
                            if agents_json != last_agents_json {
                                let event = Event::default().event("agents").data(&agents_json);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                                last_agents_json = agents_json;
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
                        Err(RecvError::Lagged(_)) => {
                            // Re-send full state on lag
                            let agents_json = build_agents_json(&core);
                            if agents_json != last_agents_json {
                                let event = Event::default().event("agents").data(&agents_json);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                                last_agents_json = agents_json;
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
