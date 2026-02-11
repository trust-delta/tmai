//! REST API handlers for agent control

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::agents::{AgentStatus, ApprovalType};
use crate::audit::helper::AuditHelper;
use crate::command_sender::CommandSender;
use crate::detectors::get_detector;
use crate::state::SharedState;

/// Helper to create JSON error responses
fn json_error(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({"error": message})))
}

/// Text input request body
#[derive(Debug, Deserialize)]
pub struct TextInputRequest {
    pub text: String,
}

/// Preview response
#[derive(Debug, Serialize)]
pub struct PreviewResponse {
    pub content: String,
    pub lines: usize,
}

/// Shared application state for API handlers
pub struct ApiState {
    pub app_state: SharedState,
    pub command_sender: CommandSender,
    pub audit_helper: AuditHelper,
}

/// Agent information for API response
#[derive(Debug, Serialize)]
pub struct AgentInfo {
    pub id: String,
    pub agent_type: String,
    pub status: StatusInfo,
    pub cwd: String,
    pub session: String,
    pub window_name: String,
    pub needs_attention: bool,
    pub is_virtual: bool,
    pub team: Option<AgentTeamInfoResponse>,
}

/// Team information associated with an agent for API response
#[derive(Debug, Serialize)]
pub struct AgentTeamInfoResponse {
    pub team_name: String,
    pub member_name: String,
    pub is_lead: bool,
    pub current_task: Option<TaskSummaryResponse>,
}

/// Summary of a task for API response
#[derive(Debug, Serialize)]
pub struct TaskSummaryResponse {
    pub id: String,
    pub subject: String,
    pub status: String,
}

/// Team overview information for API response
#[derive(Debug, Serialize)]
pub(crate) struct TeamInfoResponse {
    name: String,
    description: Option<String>,
    task_summary: TaskSummaryOverview,
    members: Vec<TeamMemberResponse>,
}

/// Task progress summary for API response
#[derive(Debug, Serialize)]
pub(crate) struct TaskSummaryOverview {
    total: usize,
    completed: usize,
    in_progress: usize,
    pending: usize,
}

/// Team member information for API response
#[derive(Debug, Serialize)]
pub(crate) struct TeamMemberResponse {
    name: String,
    agent_type: Option<String>,
    is_lead: bool,
    pane_target: Option<String>,
    current_task: Option<TaskSummaryResponse>,
}

/// Detailed team task information for API response
#[derive(Debug, Serialize)]
pub(crate) struct TeamTaskResponse {
    id: String,
    subject: String,
    description: String,
    active_form: Option<String>,
    status: String,
    owner: Option<String>,
    blocks: Vec<String>,
    blocked_by: Vec<String>,
}

/// Status information for API response
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum StatusInfo {
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "processing")]
    Processing { message: Option<String> },
    #[serde(rename = "awaiting_approval")]
    AwaitingApproval {
        approval_type: String,
        details: String,
        choices: Option<Vec<String>>,
        multi_select: Option<bool>,
    },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "offline")]
    Offline,
    #[serde(rename = "unknown")]
    Unknown,
}

impl From<&AgentStatus> for StatusInfo {
    fn from(status: &AgentStatus) -> Self {
        match status {
            AgentStatus::Idle => StatusInfo::Idle,
            AgentStatus::Processing { activity } => StatusInfo::Processing {
                message: Some(activity.clone()),
            },
            AgentStatus::AwaitingApproval {
                approval_type,
                details,
            } => {
                let (type_name, choices, multi_select) = match approval_type {
                    ApprovalType::FileEdit => ("file_edit".to_string(), None, None),
                    ApprovalType::FileCreate => ("file_create".to_string(), None, None),
                    ApprovalType::FileDelete => ("file_delete".to_string(), None, None),
                    ApprovalType::ShellCommand => ("shell_command".to_string(), None, None),
                    ApprovalType::McpTool => ("mcp_tool".to_string(), None, None),
                    ApprovalType::UserQuestion {
                        choices,
                        multi_select,
                        ..
                    } => (
                        "user_question".to_string(),
                        Some(choices.clone()),
                        Some(*multi_select),
                    ),
                    ApprovalType::Other(_) => ("other".to_string(), None, None),
                };
                StatusInfo::AwaitingApproval {
                    approval_type: type_name,
                    details: details.clone(),
                    choices,
                    multi_select,
                }
            }
            AgentStatus::Error { message } => StatusInfo::Error {
                message: message.clone(),
            },
            AgentStatus::Offline => StatusInfo::Offline,
            AgentStatus::Unknown => StatusInfo::Unknown,
        }
    }
}

/// Convert agent team info to API response format
fn convert_team_info(team_info: &crate::agents::AgentTeamInfo) -> AgentTeamInfoResponse {
    AgentTeamInfoResponse {
        team_name: team_info.team_name.clone(),
        member_name: team_info.member_name.clone(),
        is_lead: team_info.is_lead,
        current_task: team_info
            .current_task
            .as_ref()
            .map(|t| TaskSummaryResponse {
                id: t.id.clone(),
                subject: t.subject.clone(),
                status: t.status.to_string(),
            }),
    }
}

/// Build AgentInfo from a MonitoredAgent
///
/// Shared helper used by both the REST API and SSE events.
pub(super) fn build_agent_info(agent: &crate::agents::MonitoredAgent) -> AgentInfo {
    AgentInfo {
        id: agent.id.clone(),
        agent_type: agent.agent_type.short_name().to_string(),
        status: StatusInfo::from(&agent.status),
        cwd: agent.cwd.clone(),
        session: agent.session.clone(),
        window_name: agent.window_name.clone(),
        needs_attention: agent.status.needs_attention(),
        is_virtual: agent.is_virtual,
        team: agent.team_info.as_ref().map(convert_team_info),
    }
}

/// Get all agents
pub async fn get_agents(State(state): State<Arc<ApiState>>) -> Json<Vec<AgentInfo>> {
    let app_state = state.app_state.read();
    let agents: Vec<AgentInfo> = app_state
        .agent_order
        .iter()
        .filter_map(|id| app_state.agents.get(id))
        .map(build_agent_info)
        .collect();

    Json(agents)
}

/// Selection request body
#[derive(Debug, Deserialize)]
pub struct SelectRequest {
    pub choice: usize,
}

/// Submit multi-select request body
#[derive(Debug, Deserialize)]
pub struct SubmitRequest {
    #[serde(default)]
    pub selected_choices: Vec<usize>,
}

/// Check if choices use checkbox format ([ ], [x], [X], [✔])
fn has_checkbox_format(choices: &[String]) -> bool {
    choices.iter().any(|c| {
        let t = c.trim();
        t.starts_with("[ ]") || t.starts_with("[x]") || t.starts_with("[X]") || t.starts_with("[✔]")
    })
}

/// Approve an agent action (send 'y')
pub async fn approve_agent(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: approve agent_id={}", id);
    let agent_info = {
        let app_state = state.app_state.read();
        app_state.agents.get(&id).map(|a| {
            (
                matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                a.agent_type.clone(),
                a.is_virtual,
            )
        })
    };

    match agent_info {
        Some((_, _, true)) => {
            tracing::warn!("API: approve failed - virtual agent agent_id={}", id);
            Err(json_error(
                StatusCode::BAD_REQUEST,
                "Cannot approve virtual agent",
            ))
        }
        Some((true, agent_type, false)) => {
            let detector = get_detector(&agent_type);
            match state
                .command_sender
                .send_keys(&id, detector.approval_keys())
            {
                Ok(_) => Ok(Json(serde_json::json!({"status": "ok"}))),
                Err(_) => {
                    tracing::warn!("API: approve failed - send_keys error agent_id={}", id);
                    Err(json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to send approval",
                    ))
                }
            }
        }
        Some((false, _, false)) => {
            tracing::warn!(
                "API: approve failed - not awaiting approval agent_id={}",
                id
            );
            Err(json_error(
                StatusCode::BAD_REQUEST,
                "Agent is not awaiting approval",
            ))
        }
        None => {
            tracing::warn!("API: approve failed - not found agent_id={}", id);
            Err(json_error(StatusCode::NOT_FOUND, "Agent not found"))
        }
    }
}

// Note: reject_agent removed - use select_choice with option number instead

/// Select a choice for UserQuestion
pub async fn select_choice(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(req): Json<SelectRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: select choice={} agent_id={}", req.choice, id);
    let question_info = {
        let app_state = state.app_state.read();
        app_state.agents.get(&id).and_then(|agent| {
            if let AgentStatus::AwaitingApproval {
                approval_type:
                    ApprovalType::UserQuestion {
                        choices,
                        multi_select,
                        cursor_position,
                    },
                ..
            } = &agent.status
            {
                Some((choices.clone(), *multi_select, *cursor_position))
            } else {
                None
            }
        })
    };

    match question_info {
        Some((choices, multi_select, cursor_pos))
            if req.choice >= 1 && req.choice <= choices.len() + 1 =>
        {
            let cursor = if cursor_pos == 0 { 1 } else { cursor_pos };
            let steps = req.choice as i32 - cursor as i32;
            let key = if steps > 0 { "Down" } else { "Up" };
            for _ in 0..steps.unsigned_abs() {
                if state.command_sender.send_keys(&id, key).is_err() {
                    return Err(json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to navigate",
                    ));
                }
            }

            // Confirm: single-select always, multi-select only for checkbox toggle
            if (!multi_select || has_checkbox_format(&choices))
                && state.command_sender.send_keys(&id, "Enter").is_err()
            {
                return Err(json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to confirm selection",
                ));
            }

            Ok(Json(serde_json::json!({"status": "ok"})))
        }
        Some(_) => Err(json_error(StatusCode::BAD_REQUEST, "Invalid choice number")),
        None => Err(json_error(
            StatusCode::NOT_FOUND,
            "Agent not found or not in question state",
        )),
    }
}

/// Submit multi-select choices
pub async fn submit_selection(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
    body: Option<Json<SubmitRequest>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: submit agent_id={}", id);
    let multi_info = {
        let app_state = state.app_state.read();
        app_state.agents.get(&id).and_then(|agent| {
            if let AgentStatus::AwaitingApproval {
                approval_type:
                    ApprovalType::UserQuestion {
                        choices,
                        multi_select: true,
                        cursor_position,
                    },
                ..
            } = &agent.status
            {
                Some((choices.clone(), *cursor_position))
            } else {
                None
            }
        })
    };

    match multi_info {
        Some((choices, cursor_pos)) => {
            let is_checkbox = has_checkbox_format(&choices);
            let selected = body.map(|b| b.0.selected_choices).unwrap_or_default();

            if is_checkbox && !selected.is_empty() {
                // Checkbox format: toggle each selected choice then submit
                let mut sorted = selected.clone();
                sorted.retain(|&c| c >= 1 && c <= choices.len());
                if sorted.is_empty() {
                    return Err(json_error(StatusCode::BAD_REQUEST, "No valid choices"));
                }
                sorted.sort();
                let mut current_pos = if cursor_pos == 0 { 1 } else { cursor_pos };

                for &choice in &sorted {
                    let steps = choice as i32 - current_pos as i32;
                    let key = if steps > 0 { "Down" } else { "Up" };
                    for _ in 0..steps.unsigned_abs() {
                        if state.command_sender.send_keys(&id, key).is_err() {
                            return Err(json_error(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to navigate",
                            ));
                        }
                    }
                    // Enter to toggle checkbox
                    if state.command_sender.send_keys(&id, "Enter").is_err() {
                        return Err(json_error(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to toggle",
                        ));
                    }
                    current_pos = choice;
                }
                // Right + Enter to submit
                if state.command_sender.send_keys(&id, "Right").is_err() {
                    return Err(json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to submit",
                    ));
                }
                if state.command_sender.send_keys(&id, "Enter").is_err() {
                    return Err(json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to submit",
                    ));
                }
            } else {
                // Legacy format: Down × N + Enter
                let downs_needed = choices.len().saturating_sub(cursor_pos.saturating_sub(1));
                for _ in 0..downs_needed {
                    if state.command_sender.send_keys(&id, "Down").is_err() {
                        return Err(json_error(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to navigate",
                        ));
                    }
                }
                if state.command_sender.send_keys(&id, "Enter").is_err() {
                    return Err(json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to submit",
                    ));
                }
            }
            Ok(Json(serde_json::json!({"status": "ok"})))
        }
        None => Err(json_error(
            StatusCode::NOT_FOUND,
            "Agent not found or not in multi-select state",
        )),
    }
}

/// Send text input to an agent
pub async fn send_text(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(req): Json<TextInputRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: input agent_id={}", id);
    // Text length limit
    if req.text.len() > 1024 {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "Text exceeds maximum length of 1024 characters",
        ));
    }

    // Check if agent exists and is not virtual
    let agent_info = {
        let app_state = state.app_state.read();
        app_state.agents.get(&id).map(|a| a.is_virtual)
    };

    match agent_info {
        None => Err(json_error(StatusCode::NOT_FOUND, "Agent not found")),
        Some(true) => Err(json_error(
            StatusCode::BAD_REQUEST,
            "Cannot send text to virtual agent",
        )),
        Some(false) => {
            // Send text literally, then Enter after a short delay.
            // Without the delay, text + Enter arrive in a single PTY read() and
            // Claude Code (ink) treats the burst as pasted text where Enter = newline.
            if state
                .command_sender
                .send_keys_literal(&id, &req.text)
                .is_err()
            {
                return Err(json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to send text",
                ));
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if state.command_sender.send_keys(&id, "Enter").is_err() {
                return Err(json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to send Enter",
                ));
            }
            state
                .audit_helper
                .maybe_emit_input(&id, "input_text", "web_api_input", None);
            Ok(Json(serde_json::json!({"status": "ok"})))
        }
    }
}

/// Get preview content (pane capture) for an agent
pub async fn get_preview(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<PreviewResponse>, StatusCode> {
    // Check if agent exists
    let agent_exists = {
        let app_state = state.app_state.read();
        app_state.agents.contains_key(&id)
    };

    if !agent_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    // Capture pane content
    match state.command_sender.tmux_client().capture_pane_plain(&id) {
        Ok(content) => {
            let lines = content.lines().count();
            Ok(Json(PreviewResponse { content, lines }))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Build a TeamInfoResponse from a TeamSnapshot
///
/// Shared helper used by both the REST API and SSE events.
pub(super) fn build_team_info(
    snapshot: &crate::state::TeamSnapshot,
    app_state: &crate::state::AppState,
) -> TeamInfoResponse {
    let total = snapshot.task_total;
    let completed = snapshot.task_done;
    let in_progress = snapshot.task_in_progress;
    let pending = snapshot.task_pending;

    let members: Vec<TeamMemberResponse> = snapshot
        .config
        .members
        .iter()
        .map(|member| {
            let pane_target = snapshot.member_panes.get(&member.name).cloned();

            // Find this member's current task from agent info
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

            // Check if this member is the lead (first member is typically lead)
            let is_lead = snapshot
                .config
                .members
                .first()
                .map(|first| first.name == member.name)
                .unwrap_or(false);

            TeamMemberResponse {
                name: member.name.clone(),
                agent_type: member.agent_type.clone(),
                is_lead,
                pane_target,
                current_task,
            }
        })
        .collect();

    TeamInfoResponse {
        name: snapshot.config.team_name.clone(),
        description: snapshot.config.description.clone(),
        task_summary: TaskSummaryOverview {
            total,
            completed,
            in_progress,
            pending,
        },
        members,
    }
}

/// Get all teams with their task summaries and member info
pub async fn get_teams(State(state): State<Arc<ApiState>>) -> Json<Vec<TeamInfoResponse>> {
    let app_state = state.app_state.read();

    let teams: Vec<TeamInfoResponse> = app_state
        .teams
        .values()
        .map(|snapshot| build_team_info(snapshot, &app_state))
        .collect();

    Json(teams)
}

/// Validate team name to prevent path traversal
///
/// Only allows alphanumeric characters, `-`, and `_`.
fn is_valid_team_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Get tasks for a specific team
pub async fn get_team_tasks(
    State(state): State<Arc<ApiState>>,
    Path(name): Path<String>,
) -> Result<Json<Vec<TeamTaskResponse>>, (StatusCode, Json<serde_json::Value>)> {
    // Validate team name to prevent path traversal
    if !is_valid_team_name(&name) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid team name"));
    }

    let app_state = state.app_state.read();

    let snapshot = app_state
        .teams
        .get(&name)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "Team not found"))?;

    let tasks: Vec<TeamTaskResponse> = snapshot
        .tasks
        .iter()
        .map(|task| TeamTaskResponse {
            id: task.id.clone(),
            subject: task.subject.clone(),
            description: task.description.clone(),
            active_form: task.active_form.clone(),
            status: task.status.to_string(),
            owner: task.owner.clone(),
            blocks: task.blocks.clone(),
            blocked_by: task.blocked_by.clone(),
        })
        .collect();

    Ok(Json(tasks))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::routing::{get, post};
    use axum::Router;
    use http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    /// Create a fresh shared AppState for tests
    fn test_app_state() -> SharedState {
        crate::state::AppState::shared()
    }

    /// Build a Router with all API routes but NO auth middleware
    fn test_router_with_state(app_state: SharedState) -> Router {
        let api_state = Arc::new(ApiState {
            command_sender: CommandSender::new(
                None,
                crate::tmux::TmuxClient::new(),
                app_state.clone(),
            ),
            audit_helper: AuditHelper::new(None, app_state.clone()),
            app_state,
        });
        Router::new()
            .route("/agents", get(get_agents))
            .route("/agents/{id}/approve", post(approve_agent))
            .route("/agents/{id}/select", post(select_choice))
            .route("/agents/{id}/submit", post(submit_selection))
            .route("/agents/{id}/input", post(send_text))
            .route("/agents/{id}/preview", get(get_preview))
            .route("/teams", get(get_teams))
            .route("/teams/{name}/tasks", get(get_team_tasks))
            .with_state(api_state)
    }

    /// Build a Router with default empty state
    fn test_router() -> Router {
        test_router_with_state(test_app_state())
    }

    /// Add an idle agent to the shared state
    fn add_idle_agent(state: &SharedState, id: &str) {
        let mut s = state.write();
        let mut agent = crate::agents::MonitoredAgent::new(
            id.to_string(),
            crate::agents::AgentType::ClaudeCode,
            "Test".to_string(),
            "/tmp".to_string(),
            1234,
            "main".to_string(),
            "window".to_string(),
            0,
            0,
        );
        agent.status = AgentStatus::Idle;
        s.agents.insert(id.to_string(), agent);
        s.agent_order.push(id.to_string());
    }

    #[tokio::test]
    async fn test_get_agents_empty() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let agents: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert!(agents.is_empty());
    }

    #[tokio::test]
    async fn test_approve_not_found() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/nonexistent/approve")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_select_choice_not_found() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/nonexistent/select")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"choice":1}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_submit_selection_not_found() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/nonexistent/submit")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_send_text_not_found() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/nonexistent/input")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"text":"hello"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_get_preview_not_found() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/agents/nonexistent/preview")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_get_teams_empty() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/teams")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let teams: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert!(teams.is_empty());
    }

    #[tokio::test]
    async fn test_get_team_tasks_not_found() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/teams/nonexistent/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_get_team_tasks_path_traversal() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/teams/..%2Fevil/tasks")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_approve_idle_agent_returns_bad_request() {
        let state = test_app_state();
        add_idle_agent(&state, "main:0.0");
        let app = test_router_with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/main:0.0/approve")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_get_agents_with_agent() {
        let state = test_app_state();
        add_idle_agent(&state, "main:0.0");
        let app = test_router_with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let agents: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0]["id"], "main:0.0");
        assert_eq!(agents[0]["status"]["type"], "idle");
    }

    #[test]
    fn test_is_valid_team_name() {
        assert!(is_valid_team_name("my-team"));
        assert!(is_valid_team_name("team_1"));
        assert!(is_valid_team_name("TeamAlpha"));
        assert!(!is_valid_team_name(""));
        assert!(!is_valid_team_name("../evil"));
        assert!(!is_valid_team_name("team/name"));
        assert!(!is_valid_team_name("team name"));
    }
}
