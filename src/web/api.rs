//! REST API handlers for agent control

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use tmai_core::agents::{AgentStatus, ApprovalType};
use tmai_core::api::{ApiError, TmaiCore};

/// Helper to create JSON error responses
fn json_error(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({"error": message})))
}

/// Convert ApiError to HTTP status + JSON error
fn api_error_to_http(err: ApiError) -> (StatusCode, Json<serde_json::Value>) {
    let status = match &err {
        ApiError::AgentNotFound { .. } | ApiError::TeamNotFound { .. } => StatusCode::NOT_FOUND,
        ApiError::NoCommandSender | ApiError::CommandError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        ApiError::VirtualAgent { .. } | ApiError::InvalidInput { .. } | ApiError::NoSelection => {
            StatusCode::BAD_REQUEST
        }
        ApiError::WorktreeError(e) => match e {
            tmai_core::worktree::WorktreeOpsError::NotFound(_) => StatusCode::NOT_FOUND,
            tmai_core::worktree::WorktreeOpsError::AlreadyExists(_)
            | tmai_core::worktree::WorktreeOpsError::InvalidName(_)
            | tmai_core::worktree::WorktreeOpsError::UncommittedChanges(_)
            | tmai_core::worktree::WorktreeOpsError::AgentStillRunning(_) => {
                StatusCode::BAD_REQUEST
            }
            tmai_core::worktree::WorktreeOpsError::GitError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        },
    };
    json_error(status, &err.to_string())
}

/// Text input request body
#[derive(Debug, Deserialize)]
pub struct TextInputRequest {
    pub text: String,
}

/// Special key request body
#[derive(Debug, Deserialize)]
pub struct KeyRequest {
    pub key: String,
}

/// Preview response
#[derive(Debug, Serialize)]
pub struct PreviewResponse {
    pub content: String,
    pub lines: usize,
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
    #[serde(skip_serializing_if = "String::is_empty")]
    pub mode: String,
    /// Git branch name (if in a git repo)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    /// Whether the git working tree has uncommitted changes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_dirty: Option<bool>,
    /// Whether this directory is a git worktree (not the main repo)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_worktree: Option<bool>,
    /// Auto-approve judgment phase: "judging", "approved_rule", "approved_ai", or "manual_required"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve_phase: Option<String>,
    /// Absolute path to the shared git common directory (for repository grouping)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_common_dir: Option<String>,
    /// Worktree name extracted from `.claude/worktrees/{name}` in cwd
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_name: Option<String>,
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
    /// Worktree names used by this team's members
    #[serde(skip_serializing_if = "Vec::is_empty")]
    worktree_names: Vec<String>,
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
    /// Agent definition description (from `.claude/agents/*.md`)
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    /// Agent definition model (from `.claude/agents/*.md`)
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
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
fn convert_team_info(team_info: &tmai_core::agents::AgentTeamInfo) -> AgentTeamInfoResponse {
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

/// Build AgentInfo from an AgentSnapshot
///
/// Shared helper used by both the REST API and SSE events.
pub(super) fn build_agent_info(snapshot: &tmai_core::api::AgentSnapshot) -> AgentInfo {
    use tmai_core::auto_approve::AutoApprovePhase;

    let mode = snapshot.mode.to_string();
    let auto_approve_phase = snapshot.auto_approve_phase.as_ref().map(|p| match p {
        AutoApprovePhase::Judging => "judging".to_string(),
        AutoApprovePhase::ApprovedByRule => "approved_rule".to_string(),
        AutoApprovePhase::ApprovedByAi => "approved_ai".to_string(),
        AutoApprovePhase::ManualRequired(_) => "manual_required".to_string(),
    });
    AgentInfo {
        id: snapshot.id.clone(),
        agent_type: snapshot.agent_type.short_name().to_string(),
        status: StatusInfo::from(&snapshot.status),
        cwd: snapshot.display_cwd.clone(),
        session: snapshot.session.clone(),
        window_name: snapshot.window_name.clone(),
        needs_attention: snapshot.needs_attention(),
        is_virtual: snapshot.is_virtual,
        team: snapshot.team_info.as_ref().map(convert_team_info),
        mode,
        git_branch: snapshot.git_branch.clone(),
        git_dirty: snapshot.git_dirty,
        is_worktree: snapshot.is_worktree,
        auto_approve_phase,
        git_common_dir: snapshot.git_common_dir.clone(),
        worktree_name: snapshot.worktree_name.clone(),
    }
}

/// Build a TeamInfoResponse from a TeamSnapshot
///
/// Shared helper used by both the REST API and SSE events.
pub(super) fn build_team_info(
    snapshot: &tmai_core::state::TeamSnapshot,
    app_state: &tmai_core::state::AppState,
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

            // Look up agent definition for description/model
            let agent_def = app_state
                .agent_definitions
                .iter()
                .find(|d| d.name == member.name);

            TeamMemberResponse {
                name: member.name.clone(),
                agent_type: member.agent_type.clone(),
                is_lead,
                pane_target,
                current_task,
                description: agent_def.and_then(|d| d.description.clone()),
                model: agent_def.and_then(|d| d.model.clone()),
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
        worktree_names: snapshot.worktree_names.clone(),
    }
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

/// Get all agents
pub async fn get_agents(State(core): State<Arc<TmaiCore>>) -> Json<Vec<AgentInfo>> {
    let agents: Vec<AgentInfo> = core.list_agents().iter().map(build_agent_info).collect();
    Json(agents)
}

/// Approve an agent action (send approval keys)
pub async fn approve_agent(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: approve agent_id={}", id);
    core.approve(&id)
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| {
            tracing::warn!("API: approve failed agent_id={}: {}", id, e);
            api_error_to_http(e)
        })
}

/// Select a choice for UserQuestion
pub async fn select_choice(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
    Json(req): Json<SelectRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: select choice={} agent_id={}", req.choice, id);
    core.select_choice(&id, req.choice)
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| {
            tracing::warn!("API: select failed agent_id={}: {}", id, e);
            api_error_to_http(e)
        })
}

/// Submit multi-select choices
pub async fn submit_selection(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
    body: Option<Json<SubmitRequest>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: submit agent_id={}", id);
    let selected = body.map(|b| b.0.selected_choices).unwrap_or_default();
    core.submit_selection(&id, &selected)
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| {
            tracing::warn!("API: submit failed agent_id={}: {}", id, e);
            api_error_to_http(e)
        })
}

/// Send text input to an agent
pub async fn send_text(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
    Json(req): Json<TextInputRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: input agent_id={}", id);
    core.send_text(&id, &req.text)
        .await
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| {
            tracing::warn!("API: input failed agent_id={}: {}", id, e);
            api_error_to_http(e)
        })
}

/// Send a special key to an agent
pub async fn send_key(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
    Json(req): Json<KeyRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: send_key key={} agent_id={}", req.key, id);
    core.send_key(&id, &req.key)
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| {
            tracing::warn!("API: send_key failed agent_id={}: {}", id, e);
            api_error_to_http(e)
        })
}

/// Get preview content (pane capture) for an agent
#[allow(deprecated)]
pub async fn get_preview(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
) -> Result<Json<PreviewResponse>, StatusCode> {
    // Check if agent exists and try to get content from AppState first
    // (Poller already populates last_content with fallback chain:
    //  capture-pane > transcript > activity log)
    let agent_content = {
        let state = core.raw_state().read();
        state
            .agents
            .get(&id)
            .map(|a| a.last_content.clone())
            .filter(|c| !c.trim().is_empty())
    };

    if let Some(content) = agent_content {
        let lines = content.lines().count();
        return Ok(Json(PreviewResponse { content, lines }));
    }

    // Agent exists check (if not found in state, try the facade)
    if core.get_agent(&id).is_err() {
        return Err(StatusCode::NOT_FOUND);
    }

    // Fallback: try capture_pane_plain directly
    let cmd = core
        .raw_command_sender()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    match cmd.runtime().capture_pane_plain(&id) {
        Ok(content) => {
            let display_content = if content.trim().is_empty() {
                // Fallback: try activity log from hooks via pane_id mapping
                let pane_id = {
                    let state = core.raw_state().read();
                    state.target_to_pane_id.get(&id).cloned()
                };
                let hook_reg = core.hook_registry().read();
                let activity_content = pane_id
                    .as_ref()
                    .and_then(|pid| hook_reg.get(pid))
                    .filter(|hs| !hs.activity_log.is_empty())
                    .map(|hs| tmai_core::hooks::handler::format_activity_log(&hs.activity_log));
                drop(hook_reg);

                activity_content
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "(waiting for agent activity...)".to_string())
            } else {
                content
            };
            let lines = display_content.lines().count();
            Ok(Json(PreviewResponse {
                content: display_content,
                lines,
            }))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// Get all teams with their task summaries and member info
#[allow(deprecated)]
pub async fn get_teams(State(core): State<Arc<TmaiCore>>) -> Json<Vec<TeamInfoResponse>> {
    let state = core.raw_state().read();

    let teams: Vec<TeamInfoResponse> = state
        .teams
        .values()
        .map(|snapshot| build_team_info(snapshot, &state))
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
#[allow(deprecated)]
pub async fn get_team_tasks(
    State(core): State<Arc<TmaiCore>>,
    Path(name): Path<String>,
) -> Result<Json<Vec<TeamTaskResponse>>, (StatusCode, Json<serde_json::Value>)> {
    // Validate team name to prevent path traversal
    if !is_valid_team_name(&name) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid team name"));
    }

    let state = core.raw_state().read();

    let snapshot = state
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

// =========================================================
// Worktree endpoints
// =========================================================

/// Worktree creation request body
#[derive(Debug, Deserialize)]
pub struct WorktreeCreateRequestBody {
    pub repo_path: String,
    pub branch_name: String,
    #[serde(default)]
    pub base_branch: Option<String>,
}

/// Default agent type for launch
fn default_agent_type() -> String {
    "claude".to_string()
}

/// Get all worktrees
pub async fn get_worktrees(
    State(core): State<Arc<TmaiCore>>,
) -> Json<Vec<tmai_core::api::WorktreeSnapshot>> {
    Json(core.list_worktrees())
}

/// Create a new worktree
pub async fn create_worktree(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<WorktreeCreateRequestBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Verify the repo_path exists in our known worktrees (prevent arbitrary path writes)
    let repo_exists = core.list_worktrees().iter().any(|wt| {
        wt.repo_path == req.repo_path || strip_git_suffix(&wt.repo_path) == req.repo_path
    });
    if !repo_exists {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    let create_req = tmai_core::worktree::WorktreeCreateRequest {
        repo_path: strip_git_suffix(&req.repo_path).to_string(),
        branch_name: req.branch_name,
        base_branch: req.base_branch,
    };

    match core.create_worktree(&create_req).await {
        Ok(result) => Ok(Json(serde_json::json!({
            "status": "ok",
            "path": result.path,
            "branch": result.branch,
        }))),
        Err(e) => Err(api_error_to_http(e)),
    }
}

/// Worktree delete request body (uses repo_path for unambiguous identification)
#[derive(Debug, Deserialize)]
pub struct WorktreeDeleteRequestBody {
    pub repo_path: String,
    pub worktree_name: String,
    #[serde(default)]
    pub force: bool,
}

/// Delete a worktree
pub async fn delete_worktree(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<WorktreeDeleteRequestBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Validate worktree name to prevent path traversal
    if !tmai_core::git::is_valid_worktree_name(&req.worktree_name) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid worktree name"));
    }

    // Verify the repo_path exists in our known worktrees
    let repo_exists = core.list_worktrees().iter().any(|wt| {
        wt.repo_path == req.repo_path || strip_git_suffix(&wt.repo_path) == req.repo_path
    });
    if !repo_exists {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    let del_req = tmai_core::worktree::WorktreeDeleteRequest {
        repo_path: strip_git_suffix(&req.repo_path).to_string(),
        worktree_name: req.worktree_name,
        force: req.force,
    };

    core.delete_worktree(&del_req)
        .await
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(api_error_to_http)
}

/// Worktree launch request body (uses repo_path for unambiguous identification)
#[derive(Debug, Deserialize)]
pub struct WorktreeLaunchRequestBody {
    pub repo_path: String,
    pub worktree_name: String,
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
    #[serde(default)]
    pub session: Option<String>,
}

/// Launch an agent in a worktree
pub async fn launch_agent_in_worktree(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<WorktreeLaunchRequestBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Validate worktree name
    if !tmai_core::git::is_valid_worktree_name(&req.worktree_name) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid worktree name"));
    }

    // Find worktree path from state by repo_path + worktree_name
    let wt_path = {
        let worktrees = core.list_worktrees();
        worktrees
            .iter()
            .find(|wt| {
                (wt.repo_path == req.repo_path || strip_git_suffix(&wt.repo_path) == req.repo_path)
                    && wt.name == req.worktree_name
            })
            .map(|wt| wt.path.clone())
    };

    let wt_path = match wt_path {
        Some(p) => p,
        None => return Err(json_error(StatusCode::NOT_FOUND, "Worktree not found")),
    };

    // Parse agent type
    let agent_type = match req.agent_type.as_str() {
        "claude" | "claude_code" => tmai_core::agents::AgentType::ClaudeCode,
        "codex" | "codex_cli" => tmai_core::agents::AgentType::CodexCli,
        "gemini" | "gemini_cli" => tmai_core::agents::AgentType::GeminiCli,
        "opencode" | "open_code" => tmai_core::agents::AgentType::OpenCode,
        other => {
            return Err(json_error(
                StatusCode::BAD_REQUEST,
                &format!("Unknown agent type: {}", other),
            ))
        }
    };

    core.launch_agent_in_worktree(&wt_path, &agent_type, req.session.as_deref())
        .map(|target| {
            Json(serde_json::json!({
                "status": "ok",
                "target": target,
            }))
        })
        .map_err(api_error_to_http)
}

/// Worktree diff request body
#[derive(Debug, Deserialize)]
pub struct WorktreeDiffRequestBody {
    pub worktree_path: String,
    #[serde(default = "default_base_branch")]
    pub base_branch: String,
}

/// Default base branch for diff
fn default_base_branch() -> String {
    "main".to_string()
}

/// Get diff for a worktree
pub async fn get_worktree_diff(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<WorktreeDiffRequestBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Validate base_branch
    if !tmai_core::git::is_safe_git_ref(&req.base_branch) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid base branch"));
    }

    // Verify the worktree_path belongs to a known worktree
    let known = core
        .list_worktrees()
        .iter()
        .any(|wt| wt.path == req.worktree_path);
    if !known {
        return Err(json_error(StatusCode::NOT_FOUND, "Worktree not found"));
    }

    match core
        .get_worktree_diff(&req.worktree_path, &req.base_branch)
        .await
    {
        Ok((diff, summary)) => {
            let summary_json = summary.map(|s| {
                serde_json::json!({
                    "files_changed": s.files_changed,
                    "insertions": s.insertions,
                    "deletions": s.deletions,
                })
            });
            Ok(Json(serde_json::json!({
                "diff": diff,
                "summary": summary_json,
            })))
        }
        Err(e) => Err(api_error_to_http(e)),
    }
}

/// Re-export for convenience
fn strip_git_suffix(path: &str) -> &str {
    tmai_core::git::strip_git_suffix(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::routing::{get, post};
    use axum::Router;
    use http::Request;
    use http_body_util::BodyExt;
    use tmai_core::api::{has_checkbox_format, TmaiCoreBuilder};
    use tmai_core::command_sender::CommandSender;
    use tmai_core::state::SharedState;
    use tower::ServiceExt;

    /// Create a fresh shared AppState for tests
    fn test_app_state() -> SharedState {
        tmai_core::state::AppState::shared()
    }

    /// Build a Router with all API routes but NO auth middleware
    fn test_router_with_state(app_state: SharedState) -> Router {
        let runtime: Arc<dyn tmai_core::runtime::RuntimeAdapter> =
            Arc::new(tmai_core::runtime::StandaloneAdapter::new());
        let cmd = CommandSender::new(None, runtime, app_state.clone());
        let core = Arc::new(
            TmaiCoreBuilder::new(tmai_core::config::Settings::default())
                .with_state(app_state)
                .with_command_sender(Arc::new(cmd))
                .build(),
        );
        Router::new()
            .route("/agents", get(get_agents))
            .route("/agents/{id}/approve", post(approve_agent))
            .route("/agents/{id}/select", post(select_choice))
            .route("/agents/{id}/submit", post(submit_selection))
            .route("/agents/{id}/input", post(send_text))
            .route("/agents/{id}/key", post(send_key))
            .route("/agents/{id}/preview", get(get_preview))
            .route("/teams", get(get_teams))
            .route("/teams/{name}/tasks", get(get_team_tasks))
            .with_state(core)
    }

    /// Build a Router with default empty state
    fn test_router() -> Router {
        test_router_with_state(test_app_state())
    }

    /// Add an idle agent to the shared state
    fn add_idle_agent(state: &SharedState, id: &str) {
        let mut s = state.write();
        let mut agent = tmai_core::agents::MonitoredAgent::new(
            id.to_string(),
            tmai_core::agents::AgentType::ClaudeCode,
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
    async fn test_approve_idle_agent_returns_ok() {
        // With the new Facade, approving an idle agent returns Ok (idempotent)
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
        assert_eq!(response.status(), StatusCode::OK);
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

    #[tokio::test]
    async fn test_send_key_not_found() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/nonexistent/key")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"key":"Enter"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_send_key_invalid_key() {
        let state = test_app_state();
        add_idle_agent(&state, "main:0.0");
        let app = test_router_with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/main:0.0/key")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"key":"Delete"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
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

    #[test]
    fn test_has_checkbox_format() {
        assert!(has_checkbox_format(&[
            "[ ] Option A".to_string(),
            "[ ] Option B".to_string(),
        ]));
        assert!(!has_checkbox_format(&[
            "Option A".to_string(),
            "Option B".to_string(),
        ]));
    }
}
