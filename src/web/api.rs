//! REST API handlers for agent control

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use tmai_core::api::{AgentSnapshot, ApiError, TmaiCore};

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

/// Passthrough request body — sends raw input to an agent's terminal
#[derive(Debug, Deserialize)]
pub struct PassthroughRequest {
    /// For character input: the literal text to send
    #[serde(default)]
    pub chars: Option<String>,
    /// For special keys: tmux key name (e.g. "Enter", "Up", "C-c")
    #[serde(default)]
    pub key: Option<String>,
}

/// Per-agent auto-approve override request
#[derive(Debug, Deserialize)]
pub struct AutoApproveOverrideRequest {
    /// None = follow global, Some(true) = force enable, Some(false) = force disable
    pub enabled: Option<bool>,
}

/// Preview response
#[derive(Debug, Serialize)]
pub struct PreviewResponse {
    pub content: String,
    pub lines: usize,
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
pub async fn get_agents(State(core): State<Arc<TmaiCore>>) -> Json<Vec<AgentSnapshot>> {
    Json(core.list_agents())
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

/// PUT /api/agents/{id}/auto-approve — set per-agent auto-approve override
///
/// Body: `{"enabled": true}` to force enable, `{"enabled": false}` to force disable,
/// `{"enabled": null}` to follow global setting.
pub async fn set_auto_approve(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
    Json(req): Json<AutoApproveOverrideRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    core.set_auto_approve_override(&id, req.enabled)
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(api_error_to_http)
}

/// POST /api/agents/{id}/passthrough — send raw input to agent terminal
///
/// Uses tmux send-keys directly for reliable passthrough. Falls back to
/// CommandSender for non-tmux agents.
/// Accepts either `chars` (literal text) or `key` (tmux key name).
#[allow(deprecated)]
pub async fn passthrough_input(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
    Json(req): Json<PassthroughRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Resolve the tmux target — agent id may be "hook:0.x" (not a valid tmux target)
    // so we need to find the actual tmux pane target from the agent's target field
    let tmux_target = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        state
            .agents
            .get(&id)
            .map(|a| a.target.clone())
            .filter(|t| !t.starts_with("hook:") && !t.starts_with("discovered:"))
    };

    if let Some(target) = tmux_target {
        // Direct tmux send-keys for reliable passthrough
        let tmux = tmai_core::tmux::TmuxClient::new();
        if let Some(ref chars) = req.chars {
            tmux.send_keys_literal(&target, chars)
                .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
        if let Some(ref key) = req.key {
            tmux.send_keys(&target, key)
                .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
    } else {
        // Fallback for non-tmux agents (PTY sessions, etc.)
        let cmd = core
            .raw_command_sender()
            .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "No command sender"))?;
        if let Some(ref chars) = req.chars {
            cmd.send_keys_literal(&id, chars)
                .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
        if let Some(ref key) = req.key {
            cmd.send_keys(&id, key)
                .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
    }

    Ok(Json(serde_json::json!({"status": "ok"})))
}

/// Kill an agent (terminate PTY session or tmux pane)
pub async fn kill_agent(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    tracing::info!("API: kill agent_id={}", id);
    core.kill_pane(&id)
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| {
            tracing::warn!("API: kill failed agent_id={}: {}", id, e);
            api_error_to_http(e)
        })
}

/// Get preview content (pane capture) for an agent.
///
/// Returns ANSI-colored output when capture-pane is available (tmux runtime),
/// falling back to plain text from last_content or activity log.
#[allow(deprecated)]
pub async fn get_preview(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
) -> Result<Json<PreviewResponse>, StatusCode> {
    // Look up agent target for capture-pane (id may differ from tmux target)
    let (agent_target, agent_content) = {
        let state = core.raw_state().read();
        match state.agents.get(&id) {
            Some(a) => (Some(a.target.clone()), Some(a.last_content.clone())),
            None => (None, None),
        }
    };

    // Try capture-pane with ANSI colors first (via tmux target)
    if let Some(ref target) = agent_target {
        if let Some(cmd) = core.raw_command_sender() {
            if let Ok(content) = cmd.runtime().capture_pane_full(target) {
                if !content.trim().is_empty() {
                    let lines = content.lines().count();
                    return Ok(Json(PreviewResponse { content, lines }));
                }
            }
        }
    }

    // Fallback: plain text from last_content
    if let Some(content) = agent_content.filter(|c| !c.trim().is_empty()) {
        let lines = content.lines().count();
        return Ok(Json(PreviewResponse { content, lines }));
    }

    // Agent exists check
    if core.get_agent(&id).is_err() {
        return Err(StatusCode::NOT_FOUND);
    }

    // Fallback: try capture_pane directly with the id as target
    let cmd = core
        .raw_command_sender()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    match cmd.runtime().capture_pane(&id) {
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
        dir_name: None,
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

    // Verify the repo_path is a valid directory
    let repo_dir = strip_git_suffix(&req.repo_path);
    if !std::path::Path::new(repo_dir).is_dir() {
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

// =========================================================
// Project management endpoints
// =========================================================

/// List registered project directories
pub async fn get_projects(State(core): State<Arc<TmaiCore>>) -> Json<Vec<String>> {
    Json(core.list_projects())
}

/// Add project request body
#[derive(Debug, Deserialize)]
pub struct AddProjectRequest {
    pub path: String,
}

/// Register a new project directory
pub async fn add_project(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<AddProjectRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match core.add_project(&req.path) {
        Ok(()) => Ok(Json(serde_json::json!({"ok": true}))),
        Err(e) => Err(api_error_to_http(e)),
    }
}

/// Remove project request body
#[derive(Debug, Deserialize)]
pub struct RemoveProjectRequest {
    pub path: String,
}

/// Directory entry for the tree browser
#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_git: bool,
}

/// List subdirectories at a given path for the directory tree browser.
/// Query param: ?path=/some/dir (defaults to home directory)
pub async fn list_directories(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<DirEntry>>, (StatusCode, Json<serde_json::Value>)> {
    let home = dirs::home_dir().unwrap_or_default();
    let base = params
        .get("path")
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or(home);

    if !base.is_dir() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Not a directory: {}", base.display()),
        ));
    }

    let mut entries = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(&base) else {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            &format!("Cannot read directory: {}", base.display()),
        ));
    };

    for entry in read_dir.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden dirs except common ones
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let is_git = path.join(".git").exists();
        entries.push(DirEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_git,
        });
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(Json(entries))
}

/// Remove a registered project directory
pub async fn remove_project(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<RemoveProjectRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match core.remove_project(&req.path) {
        Ok(()) => Ok(Json(serde_json::json!({"ok": true}))),
        Err(e) => Err(api_error_to_http(e)),
    }
}

// =========================================================
// Spawn settings endpoint
// =========================================================

/// Response body for spawn settings
#[derive(Debug, Serialize)]
pub struct SpawnSettingsResponse {
    /// Whether to spawn in tmux windows (vs internal PTY)
    pub use_tmux_window: bool,
    /// Whether tmux is available as a runtime
    pub tmux_available: bool,
    /// Window name for tmux-spawned agents
    pub tmux_window_name: String,
}

/// Request body for updating spawn settings
#[derive(Debug, Deserialize)]
pub struct UpdateSpawnSettingsRequest {
    /// Whether to spawn in tmux windows
    pub use_tmux_window: bool,
    /// Window name for tmux-spawned agents (optional, keeps current if omitted)
    #[serde(default)]
    pub tmux_window_name: Option<String>,
}

/// GET /api/settings/spawn — get spawn settings
pub async fn get_spawn_settings(State(core): State<Arc<TmaiCore>>) -> Json<SpawnSettingsResponse> {
    let (use_tmux_window, tmux_window_name) = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        (state.spawn_in_tmux, state.spawn_tmux_window_name.clone())
    };
    let tmux_available = is_tmux_available();

    Json(SpawnSettingsResponse {
        use_tmux_window,
        tmux_available,
        tmux_window_name,
    })
}

/// PUT /api/settings/spawn — update spawn settings
pub async fn update_spawn_settings(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<UpdateSpawnSettingsRequest>,
) -> Json<serde_json::Value> {
    {
        #[allow(deprecated)]
        let state = core.raw_state();
        let mut s = state.write();
        s.spawn_in_tmux = req.use_tmux_window;
        if let Some(ref name) = req.tmux_window_name {
            if !name.is_empty() {
                s.spawn_tmux_window_name = name.clone();
            }
        }
    }
    // Persist to config.toml
    tmai_core::config::Settings::save_toml_value(
        "spawn",
        "use_tmux_window",
        toml_edit::Value::from(req.use_tmux_window),
    );
    if let Some(ref name) = req.tmux_window_name {
        if !name.is_empty() {
            tmai_core::config::Settings::save_toml_value(
                "spawn",
                "tmux_window_name",
                toml_edit::Value::from(name.as_str()),
            );
        }
    }

    tracing::info!(
        "Spawn settings updated: use_tmux_window={} window_name={:?}",
        req.use_tmux_window,
        req.tmux_window_name
    );
    Json(serde_json::json!({"ok": true}))
}

// =========================================================
// Auto-approve settings endpoint
// =========================================================

/// Response body for auto-approve settings
#[derive(Debug, Serialize)]
pub struct AutoApproveSettingsResponse {
    /// Current effective mode
    pub mode: String,
    /// Whether the service is running
    pub running: bool,
    /// Rule presets
    pub rules: RuleSettingsResponse,
}

/// Rule presets included in the auto-approve response
#[derive(Debug, Serialize)]
pub struct RuleSettingsResponse {
    pub allow_read: bool,
    pub allow_tests: bool,
    pub allow_fetch: bool,
    pub allow_git_readonly: bool,
    pub allow_format_lint: bool,
    pub allow_patterns: Vec<String>,
}

/// Request body for updating auto-approve settings
#[derive(Debug, Deserialize)]
pub struct UpdateAutoApproveRequest {
    /// Mode: "off", "rules", "ai", "hybrid"
    #[serde(default)]
    pub mode: Option<String>,
    /// Rule preset updates (partial)
    #[serde(default)]
    pub rules: Option<UpdateRuleSettingsRequest>,
}

/// Partial update for rule presets
#[derive(Debug, Deserialize)]
pub struct UpdateRuleSettingsRequest {
    pub allow_read: Option<bool>,
    pub allow_tests: Option<bool>,
    pub allow_fetch: Option<bool>,
    pub allow_git_readonly: Option<bool>,
    pub allow_format_lint: Option<bool>,
    pub allow_patterns: Option<Vec<String>>,
}

/// GET /api/settings/auto-approve — get current auto-approve settings
pub async fn get_auto_approve_settings(
    State(core): State<Arc<TmaiCore>>,
) -> Json<AutoApproveSettingsResponse> {
    let aa = &core.settings().auto_approve;
    let mode = serde_json::to_value(aa.effective_mode())
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| format!("{:?}", aa.effective_mode()).to_lowercase());
    let running = aa.effective_mode() != tmai_core::auto_approve::types::AutoApproveMode::Off;

    let rules = RuleSettingsResponse {
        allow_read: aa.rules.allow_read,
        allow_tests: aa.rules.allow_tests,
        allow_fetch: aa.rules.allow_fetch,
        allow_git_readonly: aa.rules.allow_git_readonly,
        allow_format_lint: aa.rules.allow_format_lint,
        allow_patterns: aa.rules.allow_patterns.clone(),
    };

    Json(AutoApproveSettingsResponse {
        mode,
        running,
        rules,
    })
}

/// PUT /api/settings/auto-approve — update auto-approve settings (persisted to config.toml)
pub async fn update_auto_approve_settings(
    Json(req): Json<UpdateAutoApproveRequest>,
) -> Json<serde_json::Value> {
    // Persist mode change (normalize to lowercase for serde compat)
    if let Some(ref mode) = req.mode {
        let mode_lower = mode.to_lowercase();
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "mode",
            toml_edit::Value::from(mode_lower.as_str()),
        );
        tracing::info!("Auto-approve mode updated to '{mode_lower}' (restart to apply)");
    }

    // Persist rule preset changes
    if let Some(ref rules) = req.rules {
        if let Some(v) = rules.allow_read {
            tmai_core::config::Settings::save_toml_nested_value(
                "auto_approve",
                "rules",
                "allow_read",
                toml_edit::Value::from(v),
            );
        }
        if let Some(v) = rules.allow_tests {
            tmai_core::config::Settings::save_toml_nested_value(
                "auto_approve",
                "rules",
                "allow_tests",
                toml_edit::Value::from(v),
            );
        }
        if let Some(v) = rules.allow_fetch {
            tmai_core::config::Settings::save_toml_nested_value(
                "auto_approve",
                "rules",
                "allow_fetch",
                toml_edit::Value::from(v),
            );
        }
        if let Some(v) = rules.allow_git_readonly {
            tmai_core::config::Settings::save_toml_nested_value(
                "auto_approve",
                "rules",
                "allow_git_readonly",
                toml_edit::Value::from(v),
            );
        }
        if let Some(v) = rules.allow_format_lint {
            tmai_core::config::Settings::save_toml_nested_value(
                "auto_approve",
                "rules",
                "allow_format_lint",
                toml_edit::Value::from(v),
            );
        }
        if let Some(ref patterns) = rules.allow_patterns {
            let arr = patterns
                .iter()
                .map(|s| toml_edit::Value::from(s.as_str()))
                .collect::<toml_edit::Array>();
            tmai_core::config::Settings::save_toml_nested_value(
                "auto_approve",
                "rules",
                "allow_patterns",
                toml_edit::Value::Array(arr),
            );
        }
        tracing::info!("Auto-approve rules updated (restart to apply)");
    }

    Json(serde_json::json!({"ok": true, "restart_required": true}))
}

// =========================================================
// Agent spawn endpoint
// =========================================================

/// Spawn request body
#[derive(Debug, Deserialize)]
pub struct SpawnRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_cwd")]
    pub cwd: String,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
    /// Force PTY spawn even when tmux mode is enabled (e.g., for worktree)
    #[serde(default)]
    pub force_pty: bool,
}

/// Default working directory for spawn
fn default_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "/tmp".to_string())
}

/// Default terminal rows
fn default_rows() -> u16 {
    24
}

/// Default terminal cols
fn default_cols() -> u16 {
    80
}

/// Spawn response body
#[derive(Debug, Serialize)]
pub struct SpawnResponse {
    pub session_id: String,
    pub pid: u32,
    pub command: String,
}

/// POST /api/spawn — spawn an agent (tmux window or PTY session)
pub async fn spawn_agent(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<SpawnRequest>,
) -> Result<Json<SpawnResponse>, (StatusCode, Json<serde_json::Value>)> {
    // Validate command (whitelist to prevent arbitrary execution)
    let allowed_commands = ["claude", "codex", "gemini", "bash", "sh", "zsh"];
    let base_command = req.command.split('/').next_back().unwrap_or(&req.command);
    if !allowed_commands.contains(&base_command) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!(
                "Command not allowed: {}. Allowed: {:?}",
                req.command, allowed_commands
            ),
        ));
    }

    // Validate cwd exists
    if !std::path::Path::new(&req.cwd).is_dir() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Directory does not exist: {}", req.cwd),
        ));
    }

    // Check if we should spawn in tmux
    let use_tmux = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        state.spawn_in_tmux
    };
    let tmux_avail = is_tmux_available();

    // Shell commands (bash/sh/zsh) always use PTY — tmux wrap is for AI agents
    let is_shell = matches!(req.command.as_str(), "bash" | "sh" | "zsh");

    if use_tmux && tmux_avail && !req.force_pty && !is_shell {
        spawn_in_tmux(&core, &req).await
    } else {
        spawn_in_pty(&core, &req).await
    }
}

/// Check if tmux is available (running inside tmux and tmux command exists)
fn is_tmux_available() -> bool {
    std::env::var("TMUX").is_ok()
        && std::process::Command::new("tmux")
            .arg("list-sessions")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
}

/// Get the current tmux session name from $TMUX environment variable
fn current_tmux_session() -> Option<String> {
    // $TMUX format: /path/to/socket,pid,session_index
    // We need to ask tmux for the session name
    let output = std::process::Command::new("tmux")
        .args(["display-message", "-p", "#{session_name}"])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Find an existing tmux window by name in a session.
/// Returns the window target (e.g., "session-1:2") if found.
fn find_tmux_window(session: &str, window_name: &str) -> Option<String> {
    let output = std::process::Command::new("tmux")
        .args([
            "list-windows",
            "-t",
            session,
            "-F",
            "#{window_index}:#{window_name}",
        ])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some((idx, name)) = line.split_once(':') {
            if name == window_name {
                return Some(format!("{}:{}", session, idx));
            }
        }
    }
    None
}

/// Spawn an agent in a tmux window (detected by poller like a normal pane)
async fn spawn_in_tmux(
    core: &Arc<TmaiCore>,
    req: &SpawnRequest,
) -> Result<Json<SpawnResponse>, (StatusCode, Json<serde_json::Value>)> {
    let tmux = tmai_core::tmux::TmuxClient::new();

    // Determine the tmux session to use.
    // Prefer current_tmux_session() since it always returns the real tmux session.
    // AppState.current_session or agent.session may be "hook"/"pty" (non-tmux).
    let session_name = current_tmux_session()
        .or_else(|| {
            #[allow(deprecated)]
            let state = core.raw_state().read();
            state.current_session.clone().or_else(|| {
                state
                    .agent_order
                    .iter()
                    .filter_map(|key| state.agents.get(key))
                    .find(|a| a.session != "hook" && a.session != "pty")
                    .map(|a| a.session.clone())
            })
        })
        .unwrap_or_else(|| "main".to_string());

    let window_name = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        state.spawn_tmux_window_name.clone()
    };

    // Reuse existing window with the same name, or create a new one
    let pane_target = find_tmux_window(&session_name, &window_name)
        .and_then(|target| {
            // Split existing window to add a pane
            tmux.split_window(&target, &req.cwd).ok()
        })
        .or_else(|| {
            // No existing window — create a new one
            tmux.new_window(&session_name, &req.cwd, Some(&window_name))
                .ok()
        })
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create tmux window or split pane",
            )
        })?;

    // Build command with args
    let full_command = if req.args.is_empty() {
        req.command.clone()
    } else {
        format!("{} {}", req.command, req.args.join(" "))
    };

    // Run the command via tmai wrap for monitoring
    tmux.run_command_wrapped(&pane_target, &full_command)
        .map_err(|e| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to run command: {}", e),
            )
        })?;

    tracing::info!(
        "API: spawned in tmux window '{}' target={} command={}",
        window_name,
        pane_target,
        req.command
    );

    // The agent will be discovered by the poller on the next cycle.
    Ok(Json(SpawnResponse {
        session_id: pane_target,
        pid: 0, // poller will discover the actual PID
        command: req.command.clone(),
    }))
}

/// Spawn an agent in an internal PTY session (with WebSocket streaming)
async fn spawn_in_pty(
    core: &Arc<TmaiCore>,
    req: &SpawnRequest,
) -> Result<Json<SpawnResponse>, (StatusCode, Json<serde_json::Value>)> {
    let args: Vec<&str> = req.args.iter().map(|s| s.as_str()).collect();
    let rows = if req.rows > 0 { req.rows } else { 24 };
    let cols = if req.cols > 0 { req.cols } else { 80 };

    // Build environment variables so spawned agents can call tmai CLI
    let (api_token, api_port) = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        (state.web.token.clone().unwrap_or_default(), state.web.port)
    };
    let api_url = format!("http://127.0.0.1:{}", api_port);
    let env: Vec<(&str, &str)> = vec![
        ("TMAI_API_URL", api_url.as_str()),
        ("TMAI_TOKEN", api_token.as_str()),
    ];

    match core
        .pty_registry()
        .spawn_session(&req.command, &args, &req.cwd, rows, cols, &env)
    {
        Ok(session) => {
            let session_id = session.id.clone();
            let response = SpawnResponse {
                session_id: session_id.clone(),
                pid: session.pid,
                command: session.command.clone(),
            };

            // Fetch git info for the cwd so spawned agent groups with same-repo agents
            let git_info = tmai_core::git::GitCache::new().get_info(&req.cwd).await;

            // Register as a MonitoredAgent in AppState so the Poller won't discard it
            {
                #[allow(deprecated)]
                let state = core.raw_state();
                let mut s = state.write();
                let agent_type = match req.command.as_str() {
                    "claude" => tmai_core::agents::AgentType::ClaudeCode,
                    "codex" => tmai_core::agents::AgentType::CodexCli,
                    "gemini" => tmai_core::agents::AgentType::GeminiCli,
                    other => tmai_core::agents::AgentType::Custom(other.to_string()),
                };
                let mut agent = tmai_core::agents::MonitoredAgent::new(
                    session_id.clone(),
                    agent_type,
                    req.command.clone(),
                    req.cwd.clone(),
                    session.pid,
                    "pty".to_string(),
                    req.command.clone(),
                    0,
                    0,
                );
                agent.status = tmai_core::agents::AgentStatus::Processing {
                    activity: "Starting...".to_string(),
                };
                agent.pty_session_id = Some(session_id.clone());
                if let Some(ref info) = git_info {
                    agent.git_branch = Some(info.branch.clone());
                    agent.git_dirty = Some(info.dirty);
                    agent.is_worktree = Some(info.is_worktree);
                    agent.git_common_dir = info.common_dir.clone();
                    agent.worktree_name = tmai_core::git::extract_claude_worktree_name(&req.cwd);
                }
                s.agents.insert(session_id.clone(), agent);
                s.agent_order.push(session_id);
            }
            core.notify_agents_updated();

            tracing::info!(
                "API: spawned PTY session_id={} pid={}",
                response.session_id,
                response.pid
            );
            Ok(Json(response))
        }
        Err(e) => {
            tracing::error!("API: spawn failed: {}", e);
            Err(json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to spawn: {}", e),
            ))
        }
    }
}

// =========================================================
// Git branch listing endpoint
// =========================================================

/// Query params for branch listing
#[derive(Debug, Deserialize)]
pub struct BranchQueryParams {
    pub repo: String,
}

/// GET /api/git/branches — list branches for a repository
pub async fn list_branches(
    axum::extract::Query(params): axum::extract::Query<BranchQueryParams>,
) -> Result<Json<tmai_core::git::BranchListResult>, (StatusCode, Json<serde_json::Value>)> {
    if !std::path::Path::new(&params.repo).is_dir() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Directory does not exist: {}", params.repo),
        ));
    }

    tmai_core::git::list_branches(&params.repo)
        .await
        .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list branches"))
        .map(Json)
}

/// Commit log query params
#[derive(Debug, Deserialize)]
pub struct CommitLogParams {
    pub repo: String,
    pub base: String,
    pub branch: String,
}

/// Get commit log between two branches
pub async fn git_log(
    axum::extract::Query(params): axum::extract::Query<CommitLogParams>,
) -> Result<Json<Vec<tmai_core::git::CommitEntry>>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&params.repo);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    let commits = tmai_core::git::log_commits(repo_dir, &params.base, &params.branch, 20).await;
    Ok(Json(commits))
}

/// Graph query params
#[derive(Debug, Deserialize)]
pub struct GraphQueryParams {
    pub repo: String,
    #[serde(default = "default_graph_limit")]
    pub limit: usize,
}

/// Default limit for graph commits
fn default_graph_limit() -> usize {
    100
}

/// GET /api/git/graph — get full commit graph for lane visualization
pub async fn git_graph(
    axum::extract::Query(params): axum::extract::Query<GraphQueryParams>,
) -> Result<Json<tmai_core::git::GraphData>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&params.repo);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::git::log_graph(repo_dir, params.limit)
        .await
        .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to get graph"))
        .map(Json)
}

/// Delete branch request body
#[derive(Debug, Deserialize)]
pub struct DeleteBranchRequest {
    pub repo_path: String,
    pub branch: String,
    #[serde(default)]
    pub force: bool,
}

/// Delete a local git branch
pub async fn delete_branch(
    Json(req): Json<DeleteBranchRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !tmai_core::git::is_safe_git_ref(&req.branch) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid branch name"));
    }

    let repo_dir = tmai_core::git::strip_git_suffix(&req.repo_path);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::git::delete_branch(repo_dir, &req.branch, req.force)
        .await
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))
}

/// Checkout branch request body
#[derive(Debug, Deserialize)]
pub struct CheckoutRequest {
    pub repo_path: String,
    pub branch: String,
}

/// Checkout (switch to) a branch
pub async fn checkout_branch(
    Json(req): Json<CheckoutRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&req.repo_path);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::git::checkout_branch(repo_dir, &req.branch)
        .await
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))
}

/// Create branch request body
#[derive(Debug, Deserialize)]
pub struct CreateBranchRequest {
    pub repo_path: String,
    pub name: String,
    pub base: Option<String>,
}

/// Create a new local branch (without checking it out)
pub async fn create_branch(
    Json(req): Json<CreateBranchRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&req.repo_path);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::git::create_branch(repo_dir, &req.name, req.base.as_deref())
        .await
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))
}

/// Fetch request body
#[derive(Debug, Deserialize)]
pub struct FetchRequest {
    pub repo_path: String,
    pub remote: Option<String>,
}

/// Fetch from a remote
pub async fn git_fetch(
    Json(req): Json<FetchRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&req.repo_path);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::git::fetch_remote(repo_dir, req.remote.as_deref())
        .await
        .map(|output| Json(serde_json::json!({"status": "ok", "output": output})))
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))
}

/// Pull request body
#[derive(Debug, Deserialize)]
pub struct PullRequest {
    pub repo_path: String,
}

/// Pull from upstream (fast-forward only)
pub async fn git_pull(
    Json(req): Json<PullRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&req.repo_path);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::git::pull(repo_dir)
        .await
        .map(|output| Json(serde_json::json!({"status": "ok", "output": output})))
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))
}

/// Merge request body
#[derive(Debug, Deserialize)]
pub struct MergeRequest {
    pub repo_path: String,
    pub branch: String,
}

/// Merge a branch into the current branch
pub async fn git_merge(
    Json(req): Json<MergeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&req.repo_path);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::git::merge_branch(repo_dir, &req.branch)
        .await
        .map(|output| Json(serde_json::json!({"status": "ok", "output": output})))
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))
}

// =========================================================
// Worktree spawn endpoint
// =========================================================

/// Request body for worktree spawn
#[derive(Debug, Deserialize)]
pub struct WorktreeSpawnRequest {
    /// Worktree name (also used as branch name)
    pub name: String,
    /// Repository path
    pub cwd: String,
    /// Base branch to create worktree from (defaults to current HEAD)
    #[serde(default)]
    pub base_branch: Option<String>,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
}

/// POST /api/spawn/worktree — create git worktree then spawn claude in it
pub async fn spawn_worktree(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<WorktreeSpawnRequest>,
) -> Result<Json<SpawnResponse>, (StatusCode, Json<serde_json::Value>)> {
    // Validate cwd
    if !std::path::Path::new(&req.cwd).is_dir() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Directory does not exist: {}", req.cwd),
        ));
    }

    // Validate worktree name
    if !tmai_core::git::is_valid_worktree_name(&req.name) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Invalid worktree name: {}", req.name),
        ));
    }

    // Create git worktree using tmai-core
    // Directory: .claude/worktrees/<name>/, branch: worktree-<name> (Claude Code convention)
    let wt_req = tmai_core::worktree::WorktreeCreateRequest {
        repo_path: req.cwd.clone(),
        branch_name: format!("worktree-{}", req.name),
        dir_name: Some(req.name.clone()),
        base_branch: req.base_branch.clone(),
    };

    let wt_result = tmai_core::worktree::create_worktree(&wt_req)
        .await
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e.to_string()))?;

    tracing::info!(
        "API: created worktree '{}' at {} (branch: {})",
        req.name,
        wt_result.path,
        wt_result.branch
    );

    // Spawn claude in the worktree directory
    let spawn_req = SpawnRequest {
        command: "claude".to_string(),
        args: vec![],
        cwd: wt_result.path,
        rows: req.rows,
        cols: req.cols,
        force_pty: false,
    };

    // Resolve the effective base branch for metadata
    let effective_base = req.base_branch.clone();

    // Use tmux if available, otherwise PTY
    let use_tmux = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        state.spawn_in_tmux
    };
    let result = if use_tmux && is_tmux_available() {
        spawn_in_tmux(&core, &spawn_req).await
    } else {
        spawn_in_pty(&core, &spawn_req).await
    };

    // Set worktree_base_branch on the spawned agent
    if let Ok(ref resp) = result {
        #[allow(deprecated)]
        let state = core.raw_state();
        let mut s = state.write();
        if let Some(agent) = s.agents.get_mut(&resp.session_id) {
            agent.worktree_base_branch = effective_base;
        }
    }

    result
}

// =========================================================
// Inter-agent communication endpoints
// =========================================================

/// GET /api/agents/{id}/output — get PTY scrollback output as text
pub async fn get_agent_output(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let session = core
        .pty_registry()
        .get(&id)
        .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "PTY session not found"))?;

    let snapshot = session.scrollback_snapshot();
    let text = String::from_utf8_lossy(&snapshot).to_string();

    Ok(Json(serde_json::json!({
        "session_id": id,
        "output": text,
        "bytes": snapshot.len(),
    })))
}

/// Request body for sending text between agents
#[derive(Debug, Deserialize)]
pub struct SendToRequest {
    /// Text to send as input to the target agent
    pub text: String,
}

/// POST /api/agents/{from}/send-to/{to} — send text from one agent to another
pub async fn send_to_agent(
    State(core): State<Arc<TmaiCore>>,
    Path((from, to)): Path<(String, String)>,
    Json(req): Json<SendToRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Validate source exists (either PTY or regular agent)
    let source_exists = core.pty_registry().get(&from).is_some() || core.get_agent(&from).is_ok();
    if !source_exists {
        return Err(json_error(StatusCode::NOT_FOUND, "Source agent not found"));
    }

    // Validate text length
    if req.text.len() > 10240 {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "Text too long (max 10KB)",
        ));
    }

    // Try PTY write first (for PTY-spawned targets)
    if let Some(target_session) = core.pty_registry().get(&to) {
        target_session
            .write_input(req.text.as_bytes())
            .map_err(|e| {
                json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("Failed to write to target PTY: {}", e),
                )
            })?;
        // Send Enter after the text
        target_session.write_input(b"\r").map_err(|e| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to send Enter: {}", e),
            )
        })?;

        tracing::info!(
            "API: sent {} bytes from {} to {} (PTY)",
            req.text.len(),
            from,
            to
        );
        return Ok(Json(serde_json::json!({
            "status": "ok",
            "method": "pty",
        })));
    }

    // Fall back to regular send_text for non-PTY agents
    core.send_text(&to, &req.text).await.map_err(|e| {
        let status = match &e {
            tmai_core::api::ApiError::AgentNotFound { .. } => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        json_error(status, &e.to_string())
    })?;

    tracing::info!(
        "API: sent {} bytes from {} to {} (command_sender)",
        req.text.len(),
        from,
        to
    );
    Ok(Json(serde_json::json!({
        "status": "ok",
        "method": "command_sender",
    })))
}

// =========================================================
// Security scan endpoints
// =========================================================

/// POST /api/security/scan — run a security scan and return results
pub async fn security_scan(
    State(core): State<Arc<TmaiCore>>,
) -> Json<tmai_core::security::ScanResult> {
    Json(core.security_scan())
}

/// GET /api/security/last — return cached scan result (no new scan)
pub async fn last_security_scan(
    State(core): State<Arc<TmaiCore>>,
) -> Json<Option<tmai_core::security::ScanResult>> {
    Json(core.last_security_scan())
}

// ── Usage ──

/// GET /api/usage — return cached usage snapshot
pub async fn get_usage(State(core): State<Arc<TmaiCore>>) -> Json<tmai_core::usage::UsageSnapshot> {
    Json(core.get_usage())
}

/// POST /api/usage/fetch — trigger a background usage fetch
pub async fn trigger_usage_fetch(State(core): State<Arc<TmaiCore>>) -> StatusCode {
    core.fetch_usage();
    StatusCode::ACCEPTED
}

/// Usage settings response
#[derive(Debug, Serialize)]
pub struct UsageSettingsResponse {
    pub enabled: bool,
    pub auto_refresh_min: u32,
}

/// Usage settings update request
#[derive(Debug, Deserialize)]
pub struct UsageSettingsRequest {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub auto_refresh_min: Option<u32>,
}

/// GET /api/settings/usage — get usage settings
pub async fn get_usage_settings(State(core): State<Arc<TmaiCore>>) -> Json<UsageSettingsResponse> {
    let s = core.settings();
    Json(UsageSettingsResponse {
        enabled: s.usage.enabled,
        auto_refresh_min: s.usage.auto_refresh_min,
    })
}

/// PUT /api/settings/usage — update usage settings and persist
pub async fn update_usage_settings(
    Json(req): Json<UsageSettingsRequest>,
) -> Json<serde_json::Value> {
    if let Some(enabled) = req.enabled {
        tmai_core::config::Settings::save_toml_value(
            "usage",
            "enabled",
            toml_edit::Value::from(enabled),
        );
    }
    if let Some(interval) = req.auto_refresh_min {
        tmai_core::config::Settings::save_toml_value(
            "usage",
            "auto_refresh_min",
            toml_edit::Value::from(interval as i64),
        );
    }
    Json(serde_json::json!({"ok": true}))
}

/// Query params for PR listing
#[derive(Debug, Deserialize)]
pub struct PrQueryParams {
    pub repo: String,
}

/// GET /api/github/prs — list open PRs for a repository
pub async fn list_prs(
    axum::extract::Query(params): axum::extract::Query<PrQueryParams>,
) -> Result<
    Json<std::collections::HashMap<String, tmai_core::github::PrInfo>>,
    (StatusCode, Json<serde_json::Value>),
> {
    let repo_dir = tmai_core::git::strip_git_suffix(&params.repo);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::github::list_open_prs(repo_dir)
        .await
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list PRs (is gh CLI authenticated?)",
            )
        })
        .map(Json)
}

/// Query params for CI checks
#[derive(Debug, Deserialize)]
pub struct ChecksQueryParams {
    pub repo: String,
    pub branch: String,
}

/// GET /api/github/checks — list CI checks for a branch
pub async fn list_checks(
    axum::extract::Query(params): axum::extract::Query<ChecksQueryParams>,
) -> Result<Json<tmai_core::github::CiSummary>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&params.repo);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::github::list_checks(repo_dir, &params.branch)
        .await
        .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list checks"))
        .map(Json)
}

/// GET /api/github/issues — list open issues for a repository
pub async fn list_issues(
    axum::extract::Query(params): axum::extract::Query<PrQueryParams>,
) -> Result<Json<Vec<tmai_core::github::IssueInfo>>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&params.repo);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    tmai_core::github::list_issues(repo_dir)
        .await
        .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list issues"))
        .map(Json)
}

// =========================================================
// File read/write/tree endpoints
// =========================================================

/// Query params for file read
#[derive(Debug, Deserialize)]
pub struct FileReadParams {
    pub path: String,
}

/// GET /api/files/read — read any text file's content
pub async fn read_file(
    axum::extract::Query(params): axum::extract::Query<FileReadParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let path = std::path::Path::new(&params.path);
    if !path.is_file() {
        return Err(json_error(StatusCode::NOT_FOUND, "File not found"));
    }
    // Limit file size to 1MB
    let metadata = std::fs::metadata(path)
        .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    if metadata.len() > 1_048_576 {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "File too large (max 1MB)",
        ));
    }
    let content = std::fs::read_to_string(path)
        .map_err(|_| json_error(StatusCode::BAD_REQUEST, "Not a text file (binary content)"))?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let editable = OPENABLE_EXTENSIONS.contains(&ext);
    Ok(Json(
        serde_json::json!({ "path": params.path, "content": content, "editable": editable }),
    ))
}

/// Request body for file write
#[derive(Debug, Deserialize)]
pub struct FileWriteRequest {
    pub path: String,
    pub content: String,
}

/// POST /api/files/write — write content to a file
pub async fn write_file(
    Json(req): Json<FileWriteRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let path = std::path::Path::new(&req.path);
    // Security: only allow writing .md, .json, .toml, .txt, .yaml, .yml files
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !matches!(ext, "md" | "json" | "toml" | "txt" | "yaml" | "yml") {
        return Err(json_error(StatusCode::FORBIDDEN, "File type not allowed"));
    }
    // Must be an existing file (no creating new files via this endpoint)
    if !path.is_file() {
        return Err(json_error(StatusCode::NOT_FOUND, "File not found"));
    }
    std::fs::write(path, &req.content)
        .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

/// Query params for markdown file tree
#[derive(Debug, Deserialize)]
pub struct MdTreeParams {
    pub root: String,
}

/// Entry in the file tree
#[derive(Debug, Serialize)]
pub struct MdTreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub openable: bool,
    pub children: Option<Vec<MdTreeEntry>>,
}

/// File extensions that can be opened (read/write) in the markdown panel
const OPENABLE_EXTENSIONS: &[&str] = &["md", "json", "toml", "txt", "yaml", "yml"];

/// GET /api/files/md-tree — list markdown files in a directory tree
pub async fn md_tree(
    axum::extract::Query(params): axum::extract::Query<MdTreeParams>,
) -> Result<Json<Vec<MdTreeEntry>>, (StatusCode, Json<serde_json::Value>)> {
    let root = std::path::Path::new(&params.root);
    if !root.is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Directory not found"));
    }
    let entries =
        scan_md_tree(root, 0).map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e))?;
    Ok(Json(entries))
}

/// Recursively scan a directory for all files (max depth 5)
fn scan_md_tree(dir: &std::path::Path, depth: usize) -> Result<Vec<MdTreeEntry>, String> {
    if depth > 5 {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    let mut items: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    items.sort_by_key(|e| e.file_name());

    for entry in items {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden directories (except .claude)
        if name.starts_with('.') && name != ".claude" {
            continue;
        }
        // Skip bulky directories
        if matches!(name.as_str(), "node_modules" | "target" | "dist" | ".git") {
            continue;
        }

        if path.is_dir() {
            let children = scan_md_tree(&path, depth + 1)?;
            if !children.is_empty() {
                entries.push(MdTreeEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    is_dir: true,
                    openable: false,
                    children: Some(children),
                });
            }
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let openable = OPENABLE_EXTENSIONS.contains(&ext);
            entries.push(MdTreeEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                openable,
                children: None,
            });
        }
    }
    Ok(entries)
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
    use tmai_core::agents::AgentStatus;
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
            .route("/security/scan", post(security_scan))
            .route("/security/last", get(last_security_scan))
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
        // AgentStatus uses serde externally tagged: unit variants serialize as strings
        assert_eq!(agents[0]["status"], "Idle");
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

    #[tokio::test]
    async fn test_security_last_initially_null() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/security/last")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(result.is_null());
    }

    #[tokio::test]
    async fn test_security_scan_returns_ok() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/security/scan")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(result["risks"].is_array());
        assert!(result["scanned_at"].is_string());
        assert!(result["files_scanned"].is_number());
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
