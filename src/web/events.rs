//! Server-Sent Events for real-time agent updates

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

use tmai_core::state::SharedState;

use super::api::{build_agent_info, build_team_info, AgentInfo, TeamInfoResponse};

/// State for SSE handler
pub struct SseState {
    pub app_state: SharedState,
}

/// Build agents JSON string for SSE
fn build_agents_json_str(app_state: &tmai_core::state::AppState) -> String {
    let agents: Vec<AgentInfo> = app_state
        .agent_order
        .iter()
        .filter_map(|id| app_state.agents.get(id))
        .map(build_agent_info)
        .collect();

    serde_json::to_string(&agents).unwrap_or_else(|_| "[]".to_string())
}

/// Build teams JSON string for SSE
fn build_teams_json_str(app_state: &tmai_core::state::AppState) -> String {
    let teams: Vec<TeamInfoResponse> = app_state
        .teams
        .values()
        .map(|snapshot| build_team_info(snapshot, app_state))
        .collect();

    serde_json::to_string(&teams).unwrap_or_else(|_| "[]".to_string())
}

/// SSE stream for agent and team updates
///
/// Sends two SSE events per tick: an `agents` event with agent data
/// and a `teams` event with team data. Uses an mpsc channel to emit
/// multiple events per interval tick.
pub async fn events(State(state): State<Arc<SseState>>) -> impl IntoResponse {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(16);

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        let mut last_agents_json = String::new();
        let mut last_teams_json = String::new();

        loop {
            interval.tick().await;
            let (agents_json, teams_json) = {
                let app_state = state.app_state.read();
                (
                    build_agents_json_str(&app_state),
                    build_teams_json_str(&app_state),
                )
            };

            if agents_json != last_agents_json {
                let event = Event::default().event("agents").data(&agents_json);
                if tx.send(Ok(event)).await.is_err() {
                    return;
                }
                last_agents_json = agents_json;
            }
            if teams_json != last_teams_json {
                let event = Event::default().event("teams").data(&teams_json);
                if tx.send(Ok(event)).await.is_err() {
                    return;
                }
                last_teams_json = teams_json;
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
