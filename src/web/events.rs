//! Server-Sent Events for real-time agent updates

use axum::{
    extract::State,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
};
use serde::Serialize;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use crate::state::SharedState;
use crate::teams::TaskStatus;

use super::api::{AgentInfo, AgentTeamInfoResponse, StatusInfo, TaskSummaryResponse};

/// State for SSE handler
pub struct SseState {
    pub app_state: SharedState,
}

/// Team summary for SSE event
#[derive(Debug, Serialize)]
struct TeamSseEntry {
    name: String,
    description: Option<String>,
    task_summary: TaskSseSummary,
    members: Vec<TeamSseMember>,
}

/// Task summary counts for SSE event
#[derive(Debug, Serialize)]
struct TaskSseSummary {
    total: usize,
    completed: usize,
    in_progress: usize,
    pending: usize,
}

/// Team member info for SSE event
#[derive(Debug, Serialize)]
struct TeamSseMember {
    name: String,
    is_lead: bool,
    pane_target: Option<String>,
    current_task: Option<TaskSummaryResponse>,
}

/// Build agents SSE event from current application state
fn build_agents_event(app_state: &crate::state::AppState) -> Event {
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
            team: agent.team_info.as_ref().map(|ti| AgentTeamInfoResponse {
                team_name: ti.team_name.clone(),
                member_name: ti.member_name.clone(),
                is_lead: ti.is_lead,
                current_task: ti.current_task.as_ref().map(|t| TaskSummaryResponse {
                    id: t.id.clone(),
                    subject: t.subject.clone(),
                    status: t.status.to_string(),
                }),
            }),
        })
        .collect();

    let data = serde_json::to_string(&agents).unwrap_or_else(|_| "[]".to_string());
    Event::default().event("agents").data(data)
}

/// Build teams SSE event from current application state
fn build_teams_event(app_state: &crate::state::AppState) -> Event {
    let teams: Vec<TeamSseEntry> = app_state
        .teams
        .values()
        .map(|snapshot| {
            let total = snapshot.tasks.len();
            let completed = snapshot
                .tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Completed)
                .count();
            let in_progress = snapshot
                .tasks
                .iter()
                .filter(|t| t.status == TaskStatus::InProgress)
                .count();
            let pending = snapshot
                .tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Pending)
                .count();

            let members: Vec<TeamSseMember> = snapshot
                .config
                .members
                .iter()
                .map(|member| {
                    let pane_target = snapshot.member_panes.get(&member.name).cloned();

                    let current_task = pane_target
                        .as_ref()
                        .and_then(|target| app_state.agents.get(target))
                        .and_then(|agent| agent.team_info.as_ref())
                        .and_then(|ti| ti.current_task.as_ref())
                        .map(|t| TaskSummaryResponse {
                            id: t.id.clone(),
                            subject: t.subject.clone(),
                            status: t.status.to_string(),
                        });

                    let is_lead = snapshot
                        .config
                        .members
                        .first()
                        .map(|first| first.name == member.name)
                        .unwrap_or(false);

                    TeamSseMember {
                        name: member.name.clone(),
                        is_lead,
                        pane_target,
                        current_task,
                    }
                })
                .collect();

            TeamSseEntry {
                name: snapshot.config.team_name.clone(),
                description: snapshot.config.description.clone(),
                task_summary: TaskSseSummary {
                    total,
                    completed,
                    in_progress,
                    pending,
                },
                members,
            }
        })
        .collect();

    let data = serde_json::to_string(&teams).unwrap_or_else(|_| "[]".to_string());
    Event::default().event("teams").data(data)
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
        loop {
            interval.tick().await;
            let (agents_event, teams_event) = {
                let app_state = state.app_state.read();
                (
                    build_agents_event(&app_state),
                    build_teams_event(&app_state),
                )
            };
            if tx.send(Ok(agents_event)).await.is_err() {
                return;
            }
            if tx.send(Ok(teams_event)).await.is_err() {
                return;
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
