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
use crate::tmux::TmuxClient;

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
            AgentStatus::Unknown => StatusInfo::Unknown,
        }
    }
}

/// Get all agents
pub async fn get_agents(State(state): State<Arc<ApiState>>) -> Json<Vec<AgentInfo>> {
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
) -> StatusCode {
    let agent_info = {
        let app_state = state.app_state.read();
        app_state.agents.get(&id).map(|a| {
            (
                matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                a.agent_type.clone(),
            )
        })
    };

    match agent_info {
        Some((true, agent_type)) => {
            let detector = get_detector(&agent_type);
            match state.tmux_client.send_keys(&id, detector.approval_keys()) {
                Ok(_) => StatusCode::OK,
                Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
            }
        }
        Some((false, _)) => StatusCode::BAD_REQUEST,
        None => StatusCode::NOT_FOUND,
    }
}

/// Reject an agent action (send 'n')
pub async fn reject_agent(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> StatusCode {
    let agent_info = {
        let app_state = state.app_state.read();
        app_state.agents.get(&id).map(|a| {
            (
                matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                a.agent_type.clone(),
            )
        })
    };

    match agent_info {
        Some((true, agent_type)) => {
            let detector = get_detector(&agent_type);
            match state.tmux_client.send_keys(&id, detector.rejection_keys()) {
                Ok(_) => StatusCode::OK,
                Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
            }
        }
        Some((false, _)) => StatusCode::BAD_REQUEST,
        None => StatusCode::NOT_FOUND,
    }
}

/// Select a choice for UserQuestion
pub async fn select_choice(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(req): Json<SelectRequest>,
) -> StatusCode {
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
                return StatusCode::INTERNAL_SERVER_ERROR;
            }

            // For single select, confirm with Enter
            if !multi_select && state.tmux_client.send_keys(&id, "Enter").is_err() {
                return StatusCode::INTERNAL_SERVER_ERROR;
            }

            StatusCode::OK
        }
        Some(_) => StatusCode::BAD_REQUEST,
        None => StatusCode::NOT_FOUND,
    }
}

/// Submit multi-select choices
pub async fn submit_selection(
    State(state): State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> StatusCode {
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
                    return StatusCode::INTERNAL_SERVER_ERROR;
                }
            }
            if state.tmux_client.send_keys(&id, "Enter").is_err() {
                return StatusCode::INTERNAL_SERVER_ERROR;
            }
            StatusCode::OK
        }
        None => StatusCode::NOT_FOUND,
    }
}
