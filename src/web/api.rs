//! REST API handlers for agent control

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::agents::{AgentStatus, ApprovalType};
use crate::detectors::get_detector;
use crate::state::SharedState;
use crate::teams::TaskStatus;
use crate::tmux::TmuxClient;

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
    pub tmux_client: TmuxClient,
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

/// Approve an agent action (send 'y')
pub async fn approve_agent(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
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
        Some((_, _, true)) => Err(json_error(
            StatusCode::BAD_REQUEST,
            "Cannot approve virtual agent",
        )),
        Some((true, agent_type, false)) => {
            let detector = get_detector(&agent_type);
            match state.tmux_client.send_keys(&id, detector.approval_keys()) {
                Ok(_) => Ok(Json(serde_json::json!({"status": "ok"}))),
                Err(_) => Err(json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to send approval",
                )),
            }
        }
        Some((false, _, false)) => Err(json_error(
            StatusCode::BAD_REQUEST,
            "Agent is not awaiting approval",
        )),
        None => Err(json_error(StatusCode::NOT_FOUND, "Agent not found")),
    }
}

// Note: reject_agent removed - use select_choice with option number instead

/// Select a choice for UserQuestion
pub async fn select_choice(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(req): Json<SelectRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let question_info = {
        let app_state = state.app_state.read();
        app_state.agents.get(&id).and_then(|agent| {
            if let AgentStatus::AwaitingApproval {
                approval_type:
                    ApprovalType::UserQuestion {
                        choices,
                        multi_select,
                        ..
                    },
                ..
            } = &agent.status
            {
                Some((choices.len(), *multi_select))
            } else {
                None
            }
        })
    };

    match question_info {
        Some((count, multi_select)) if req.choice >= 1 && req.choice <= count + 1 => {
            // Send the number key
            if state
                .tmux_client
                .send_keys_literal(&id, &req.choice.to_string())
                .is_err()
            {
                return Err(json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to send selection",
                ));
            }

            // For single select, confirm with Enter
            if !multi_select && state.tmux_client.send_keys(&id, "Enter").is_err() {
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
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
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
                Some((choices.len(), *cursor_position))
            } else {
                None
            }
        })
    };

    match multi_info {
        Some((choice_count, cursor_pos)) => {
            // Navigate to Submit button
            let downs_needed = choice_count.saturating_sub(cursor_pos.saturating_sub(1));
            for _ in 0..downs_needed {
                if state.tmux_client.send_keys(&id, "Down").is_err() {
                    return Err(json_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to navigate",
                    ));
                }
            }
            if state.tmux_client.send_keys(&id, "Enter").is_err() {
                return Err(json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to submit",
                ));
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
            // Send the text literally followed by Enter
            match state.tmux_client.send_text_and_enter(&id, &req.text) {
                Ok(_) => Ok(Json(serde_json::json!({"status": "ok"}))),
                Err(_) => Err(json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to send text",
                )),
            }
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
    match state.tmux_client.capture_pane_plain(&id) {
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
