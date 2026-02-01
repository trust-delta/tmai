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
use tokio_stream::StreamExt;

use crate::state::SharedState;

use super::api::{AgentInfo, StatusInfo};

/// State for SSE handler
pub struct SseState {
    pub app_state: SharedState,
}

/// SSE stream for agent updates
pub async fn events(State(state): State<Arc<SseState>>) -> impl IntoResponse {
    let stream = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        Duration::from_millis(500),
    ))
    .map(move |_| {
        let app_state = state.app_state.read();
        let agents: Vec<AgentInfo> = app_state
            .agent_order
            .iter()
            .filter_map(|id| app_state.agents.get(id))
            .map(|agent| AgentInfo {
                id: agent.id.clone(),
                agent_type: agent.agent_type.short_name().to_string(),
                status: StatusInfo::from(&agent.status),
                cwd: agent.cwd.clone(),
                session: agent.session.clone(),
                window_name: agent.window_name.clone(),
                needs_attention: agent.status.needs_attention(),
            })
            .collect();

        let data = serde_json::to_string(&agents).unwrap_or_else(|_| "[]".to_string());
        Ok::<_, Infallible>(Event::default().event("agents").data(data))
    });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
