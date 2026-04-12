//! REST API handlers for agent control

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use tmai_core::api::{ActionOrigin, AgentSnapshot, ApiError, CoreEvent, TmaiCore};
use tmai_core::config::NotifyTemplates;

/// Parse `ActionOrigin` from request headers.
///
/// Reads `X-Tmai-Origin` header (JSON-encoded ActionOrigin).
/// Falls back to `Human(webui)` when the header is absent.
#[allow(dead_code)] // Will be used by side-effect API handlers in next step
pub fn parse_origin(headers: &axum::http::HeaderMap) -> ActionOrigin {
    headers
        .get("x-tmai-origin")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(ActionOrigin::webui)
}

/// Helper to create JSON error responses
fn json_error(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({"error": message})))
}

/// Shell-quote a string for safe embedding in tmux send-keys commands.
/// Wraps in single quotes and escapes any embedded single quotes.
/// Control characters (bytes < 0x20 except \n) are stripped before quoting.
fn shell_quote(s: &str) -> String {
    // Strip control characters (bytes < 0x20) except newline (\n = 0x0A)
    let sanitized: String = s
        .chars()
        .filter(|&c| c as u32 >= 0x20 || c == '\n')
        .collect();
    // If it contains no shell-special characters, return as-is
    if sanitized
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'/')
    {
        return sanitized;
    }
    // Wrap in single quotes, escaping embedded single quotes: ' → '\''
    format!("'{}'", sanitized.replace('\'', "'\\''"))
}

/// Check whether a canonical path falls within the user's HOME directory
/// or any registered project directory. Returns true if allowed.
fn is_path_within_allowed_scope(path: &std::path::Path, core: Option<&TmaiCore>) -> bool {
    let canonical = match path.canonicalize() {
        Ok(p) => p,
        // If the path doesn't exist yet, try canonicalizing the parent
        Err(_) => {
            if let Some(parent) = path.parent() {
                match parent.canonicalize() {
                    Ok(p) => p.join(path.file_name().unwrap_or_default()),
                    Err(_) => return false,
                }
            } else {
                return false;
            }
        }
    };

    // Allow anything under HOME
    if let Some(home) = dirs::home_dir() {
        if let Ok(home_canonical) = home.canonicalize() {
            if canonical.starts_with(&home_canonical) {
                return true;
            }
        }
    }

    // Allow anything under registered project directories
    if let Some(core) = core {
        for project in core.list_projects() {
            let project_path = std::path::Path::new(&project);
            if let Ok(proj_canonical) = project_path.canonicalize() {
                if canonical.starts_with(&proj_canonical) {
                    return true;
                }
            }
        }
    }

    false
}

/// Convert ApiError to HTTP status + JSON error
fn api_error_to_http(err: ApiError) -> (StatusCode, Json<serde_json::Value>) {
    let status = match &err {
        ApiError::AgentNotFound { .. } | ApiError::TeamNotFound { .. } => StatusCode::NOT_FOUND,
        ApiError::NoCommandSender | ApiError::CommandError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        ApiError::VirtualAgent { .. } | ApiError::InvalidInput { .. } | ApiError::NoSelection => {
            StatusCode::BAD_REQUEST
        }
        ApiError::AmbiguousAgent { .. } => StatusCode::CONFLICT,
        ApiError::ProjectScopeMismatch { .. } => StatusCode::FORBIDDEN,
        ApiError::WorktreeError(e) => match e {
            tmai_core::worktree::WorktreeOpsError::NotFound(_) => StatusCode::NOT_FOUND,
            tmai_core::worktree::WorktreeOpsError::AlreadyExists(_)
            | tmai_core::worktree::WorktreeOpsError::InvalidName(_)
            | tmai_core::worktree::WorktreeOpsError::UncommittedChanges(_)
            | tmai_core::worktree::WorktreeOpsError::AgentStillRunning(_)
            | tmai_core::worktree::WorktreeOpsError::AgentPendingDetection(_) => {
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

/// Prompt request body
#[derive(Debug, Deserialize)]
pub struct PromptRequest {
    pub prompt: String,
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
    /// Terminal cursor column (0-indexed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_x: Option<u32>,
    /// Terminal cursor row (0-indexed, absolute within full capture output)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_y: Option<u32>,
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

/// Query parameters for agent listing
#[derive(Debug, Deserialize)]
pub struct AgentListQuery {
    /// Filter agents by project path (git_common_dir). When provided, only agents
    /// belonging to this project (matching git_common_dir or cwd prefix) are returned.
    #[serde(default)]
    pub project: Option<String>,
}

/// Request body for project scope validation
#[derive(Debug, Deserialize)]
pub struct ValidateProjectRequest {
    /// The project path (git_common_dir) to validate against
    pub project: String,
}

/// Validate that an agent belongs to the given project scope.
///
/// Returns 200 if the agent matches, 403 if it belongs to a different project.
pub async fn validate_agent_project(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
    Json(req): Json<ValidateProjectRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    core.validate_agent_project(&id, &req.project)
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(api_error_to_http)
}

/// Get all agents, optionally filtered by project
pub async fn get_agents(
    State(core): State<Arc<TmaiCore>>,
    axum::extract::Query(query): axum::extract::Query<AgentListQuery>,
) -> Json<Vec<AgentSnapshot>> {
    let agents = match query.project {
        Some(ref project) => core.list_agents_by_project(project),
        None => core.list_agents(),
    };
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

/// Send a prompt to an agent with status-aware behavior (queue if Processing)
pub async fn send_prompt(
    State(core): State<Arc<TmaiCore>>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<PromptRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let origin = parse_origin(&headers);
    tracing::info!("API: send_prompt agent_id={} origin={}", id, origin);
    core.send_prompt(&id, &req.prompt)
        .await
        .map(|result| {
            let _ = core.event_sender().send(CoreEvent::ActionPerformed {
                origin,
                action: "send_prompt".to_string(),
                summary: format!("Sent prompt to agent {id}"),
            });
            Json(serde_json::json!({"status": "ok", "action": result.action, "queue_size": result.queue_size}))
        })
        .map_err(|e| {
            tracing::warn!("API: send_prompt failed agent_id={}: {}", id, e);
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
    // Resolve the user-supplied ID to internal key, then find tmux target
    let tmux_target = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        tmai_core::api::TmaiCore::resolve_agent_key_in_state(&state, &id)
            .ok()
            .and_then(|key| state.agents.get(&key).map(|a| a.target.clone()))
            .filter(|t| !t.starts_with("hook:") && !t.starts_with("discovered:"))
    };

    // Use CommandSender (which goes through RuntimeAdapter) for all agents.
    // This handles IPC -> tmux send-keys -> PTY inject fallback chain automatically.
    let send_target = tmux_target.as_deref().unwrap_or(&id);
    let cmd = core
        .raw_command_sender()
        .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "No command sender"))?;
    if let Some(ref chars) = req.chars {
        cmd.send_keys_literal(send_target, chars)
            .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    }
    if let Some(ref key) = req.key {
        cmd.send_keys(send_target, key)
            .map_err(|e| json_error(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    }

    Ok(Json(serde_json::json!({"status": "ok"})))
}

/// Kill an agent (terminate PTY session or tmux pane)
pub async fn kill_agent(
    State(core): State<Arc<TmaiCore>>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let origin = parse_origin(&headers);
    tracing::info!("API: kill agent_id={} origin={}", id, origin);
    core.kill_pane(&id)
        .map(|()| {
            let _ = core.event_sender().send(CoreEvent::ActionPerformed {
                origin,
                action: "kill_agent".to_string(),
                summary: format!("Killed agent {id}"),
            });
            Json(serde_json::json!({"status": "ok"}))
        })
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
    let show_cursor = core.settings().web.show_cursor;

    // Resolve the user-supplied ID to internal key
    let resolved_key = {
        let state = core.raw_state().read();
        tmai_core::api::TmaiCore::resolve_agent_key_in_state(&state, &id).ok()
    };

    // Look up agent target for capture-pane (id may differ from tmux target)
    let (agent_target, agent_content, agent_cursor) = {
        let state = core.raw_state().read();
        match resolved_key.as_deref().and_then(|k| state.agents.get(k)) {
            Some(a) => (
                Some(a.target.clone()),
                Some(a.last_content.clone()),
                (a.cursor_x, a.cursor_y),
            ),
            None => (None, None, (None, None)),
        }
    };

    // Try capture-pane with ANSI colors first (via tmux target).
    // Query cursor BEFORE capture to reduce race conditions: if new content
    // appears between the two calls, the cursor position still references a
    // valid line in the (larger) captured output.
    if let Some(ref target) = agent_target {
        if let Some(cmd) = core.raw_command_sender() {
            // Pre-query cursor position
            let pre_cursor = if show_cursor {
                let cursor_result = cmd.runtime().get_cursor_position(target);
                tracing::debug!("cursor query for {}: {:?}", target, cursor_result);
                cursor_result.ok().flatten()
            } else {
                None
            };

            if let Ok(content) = cmd.runtime().capture_pane_full(target) {
                if !content.trim().is_empty() {
                    let lines = content.lines().count();
                    // Clamp cursor_y to captured content bounds
                    let (cursor_x, cursor_y) = match pre_cursor {
                        Some((x, y)) if lines > 0 => {
                            let clamped_y = y.min((lines - 1) as u32);
                            (Some(x), Some(clamped_y))
                        }
                        _ => (None, None),
                    };
                    return Ok(Json(PreviewResponse {
                        content,
                        lines,
                        cursor_x,
                        cursor_y,
                    }));
                }
            }
        }
    }

    // Fallback: plain text from last_content (use cached cursor from IPC)
    if let Some(content) = agent_content.filter(|c| !c.trim().is_empty()) {
        let lines = content.lines().count();
        return Ok(Json(PreviewResponse {
            content,
            lines,
            cursor_x: if show_cursor { agent_cursor.0 } else { None },
            cursor_y: if show_cursor { agent_cursor.1 } else { None },
        }));
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
                cursor_x: None,
                cursor_y: None,
            }))
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

// =========================================================
// Transcript
// =========================================================

/// Response for GET /api/agents/{id}/transcript
#[derive(Debug, Serialize)]
pub struct TranscriptResponse {
    pub records: Vec<tmai_core::transcript::TranscriptRecord>,
}

/// Get transcript records for an agent (hybrid scrollback preview).
///
/// Returns parsed JSONL conversation records for rendering above
/// the live capture-pane output.
pub async fn get_transcript(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
) -> Result<Json<TranscriptResponse>, StatusCode> {
    match core.get_transcript(&id) {
        Ok(records) => Ok(Json(TranscriptResponse { records })),
        Err(tmai_core::api::ApiError::AgentNotFound { .. }) => Err(StatusCode::NOT_FOUND),
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
// Task metadata endpoints
// =========================================================

/// GET /api/task-meta — list all task metadata merged with worktree info
pub async fn get_task_meta(
    State(core): State<Arc<TmaiCore>>,
) -> Json<Vec<tmai_core::api::types::TaskMetaEntry>> {
    Json(core.list_task_meta())
}

// =========================================================
// Worktree endpoints
// =========================================================

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

    // Verify repo_path is among known projects or worktrees
    {
        let repo_canonical = std::path::Path::new(repo_dir)
            .canonicalize()
            .map_err(|_| json_error(StatusCode::BAD_REQUEST, "Invalid repository path"))?;
        let projects = core.list_projects();
        #[allow(deprecated)]
        let worktree_paths: Vec<String> = {
            let state = core.raw_state().read();
            state.agents.values().map(|a| a.cwd.clone()).collect()
        };
        let is_known = projects.iter().chain(worktree_paths.iter()).any(|p| {
            std::path::Path::new(tmai_core::git::strip_git_suffix(p))
                .canonicalize()
                .map(|c| c == repo_canonical)
                .unwrap_or(false)
        });
        if !is_known {
            return Err(json_error(
                StatusCode::FORBIDDEN,
                "Repository path is not a known project or worktree",
            ));
        }
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

/// Worktree move request body — move an existing branch into a worktree
#[derive(Debug, Deserialize)]
pub struct WorktreeMoveRequestBody {
    pub repo_path: String,
    pub branch_name: String,
    #[serde(default)]
    pub dir_name: Option<String>,
    pub default_branch: String,
}

/// Move a branch into a worktree
pub async fn move_to_worktree(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<WorktreeMoveRequestBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Validate branch name
    if !tmai_core::git::is_valid_worktree_name(&req.branch_name) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid branch name"));
    }
    if !tmai_core::git::is_safe_git_ref(&req.default_branch) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "Invalid default branch name",
        ));
    }

    // Verify the repo_path is a valid directory
    let repo_dir = strip_git_suffix(&req.repo_path);
    if !std::path::Path::new(repo_dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }

    // Verify repo_path is among known projects
    {
        let repo_canonical = std::path::Path::new(repo_dir)
            .canonicalize()
            .map_err(|_| json_error(StatusCode::BAD_REQUEST, "Invalid repository path"))?;
        let projects = core.list_projects();
        #[allow(deprecated)]
        let worktree_paths: Vec<String> = {
            let state = core.raw_state().read();
            state.agents.values().map(|a| a.cwd.clone()).collect()
        };
        let is_known = projects.iter().chain(worktree_paths.iter()).any(|p| {
            std::path::Path::new(tmai_core::git::strip_git_suffix(p))
                .canonicalize()
                .map(|c| c == repo_canonical)
                .unwrap_or(false)
        });
        if !is_known {
            return Err(json_error(
                StatusCode::FORBIDDEN,
                "Repository path is not a known project or worktree",
            ));
        }
    }

    let move_req = tmai_core::worktree::WorktreeMoveRequest {
        repo_path: strip_git_suffix(&req.repo_path).to_string(),
        branch_name: req.branch_name,
        dir_name: req.dir_name,
        default_branch: req.default_branch,
    };

    core.move_to_worktree(&move_req)
        .await
        .map(|result| {
            Json(serde_json::json!({
                "status": "ok",
                "path": result.path,
                "branch": result.branch,
            }))
        })
        .map_err(api_error_to_http)
}

/// Worktree launch request body (uses repo_path for unambiguous identification)
#[derive(Debug, Deserialize)]
pub struct WorktreeLaunchRequestBody {
    pub repo_path: String,
    pub worktree_name: String,
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
    /// Optional initial prompt to pass as the first argument to the agent CLI.
    #[serde(default)]
    pub initial_prompt: Option<String>,
    /// Unused — kept for backward compatibility with older frontends.
    #[serde(default)]
    #[allow(dead_code)]
    pub session: Option<String>,
}

/// Launch an agent in a worktree.
///
/// Resolves the worktree path, then delegates to the same spawn pipeline
/// used by `/api/spawn` so it works in both tmux and standalone modes.
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

    // Map agent_type string to command name
    let command = match req.agent_type.as_str() {
        "claude" | "claude_code" => "claude",
        "codex" | "codex_cli" => "codex",
        "gemini" | "gemini_cli" => "gemini",
        "opencode" | "open_code" => "opencode",
        other => {
            return Err(json_error(
                StatusCode::BAD_REQUEST,
                &format!("Unknown agent type: {}", other),
            ))
        }
    };

    // Build args — pass initial prompt as first positional argument if provided
    let args = match req.initial_prompt {
        Some(ref prompt) if !prompt.is_empty() => vec![prompt.clone()],
        _ => vec![],
    };

    // Worktree already exists — just cd into it and launch the agent
    let spawn_req = SpawnRequest {
        command: command.to_string(),
        args,
        cwd: wt_path,
        rows: default_rows(),
        cols: default_cols(),
        force_pty: false,
    };

    let use_tmux = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        state.spawn_in_tmux
    };
    let tmux_avail = is_tmux_available();

    let result = if use_tmux && tmux_avail {
        spawn_in_tmux(&core, &spawn_req).await
    } else {
        spawn_in_pty(&core, &spawn_req).await
    };

    result.map(|Json(resp)| {
        Json(serde_json::json!({
            "status": "ok",
            "target": resp.session_id,
        }))
    })
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
    State(core): State<Arc<TmaiCore>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<DirEntry>>, (StatusCode, Json<serde_json::Value>)> {
    let home = dirs::home_dir().unwrap_or_default();
    let base = params
        .get("path")
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or(home);

    // Path traversal protection: must be within HOME or a registered project
    if !is_path_within_allowed_scope(&base, Some(&core)) {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Path is outside allowed scope",
        ));
    }

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

    // Reload live settings from config.toml
    core.reload_settings();

    tracing::info!(
        "Spawn settings updated: use_tmux_window={} window_name={:?}",
        req.use_tmux_window,
        req.tmux_window_name
    );
    Json(serde_json::json!({"ok": true}))
}

// =========================================================
// Orchestrator settings endpoints
// =========================================================

/// Query param for per-project orchestrator endpoints
#[derive(Debug, Deserialize)]
pub struct OrchestratorProjectQuery {
    /// Project path. If omitted, returns/updates global settings.
    #[serde(default)]
    pub project: Option<String>,
}

/// Response body for orchestrator settings
#[derive(Debug, Serialize)]
pub struct OrchestratorSettingsResponse {
    pub enabled: bool,
    pub role: String,
    pub rules: OrchestratorRulesResponse,
    pub notify: NotifySettingsResponse,
    pub guardrails: GuardrailsSettingsResponse,
    pub pr_monitor_enabled: bool,
    pub pr_monitor_interval_secs: u64,
    /// Whether this is a per-project override (true) or global fallback (false)
    pub is_project_override: bool,
}

/// Guardrails settings response
#[derive(Debug, Serialize)]
pub struct GuardrailsSettingsResponse {
    pub max_ci_retries: u64,
    pub max_review_loops: u64,
    pub escalate_to_human_after: u64,
}

/// Rules sub-object in orchestrator settings response
#[derive(Debug, Serialize)]
pub struct OrchestratorRulesResponse {
    pub branch: String,
    pub merge: String,
    pub review: String,
    pub custom: String,
}

/// Map tri-state handling → bool for the current 2-state WebUI contract.
/// Only `NotifyOrchestrator` is treated as "on"; `AutoAction` is opaque to
/// the current UI and is reported as "off" (it will gain a dedicated control
/// once PR-C lands).
fn handling_to_bool(h: tmai_core::config::EventHandling) -> bool {
    matches!(h, tmai_core::config::EventHandling::NotifyOrchestrator)
}

/// Merge an optional bool override from the WebUI into an existing handling
/// value.  `None` keeps the current (possibly `AutoAction`) setting; `Some`
/// replaces it with the 2-state mapping (`true` → NotifyOrchestrator, `false`
/// → Off) so that legacy clients cannot silently destroy an AutoAction
/// configuration they don't know about — unless they explicitly toggle.
fn merge_handling(
    override_val: Option<bool>,
    current: tmai_core::config::EventHandling,
) -> tmai_core::config::EventHandling {
    match override_val {
        None => current,
        Some(true) => tmai_core::config::EventHandling::NotifyOrchestrator,
        Some(false) => tmai_core::config::EventHandling::Off,
    }
}

/// Notification settings response (per-event toggles + templates)
#[derive(Debug, Serialize)]
pub struct NotifySettingsResponse {
    pub on_agent_stopped: bool,
    pub on_agent_error: bool,
    pub on_rebase_conflict: bool,
    pub on_ci_passed: bool,
    pub on_ci_failed: bool,
    pub on_pr_created: bool,
    pub on_pr_comment: bool,
    pub on_pr_closed: bool,
    pub on_guardrail_exceeded: bool,
    pub templates: NotifyTemplatesResponse,
    /// Built-in default templates (for UI placeholder display)
    pub default_templates: NotifyTemplatesResponse,
}

/// Template overrides response
#[derive(Debug, Serialize)]
pub struct NotifyTemplatesResponse {
    pub agent_stopped: String,
    pub agent_error: String,
    pub ci_passed: String,
    pub ci_failed: String,
    pub pr_created: String,
    pub pr_comment: String,
    pub rebase_conflict: String,
    pub pr_closed: String,
    pub guardrail_exceeded: String,
}

/// Request body for updating orchestrator settings
#[derive(Debug, Deserialize)]
pub struct UpdateOrchestratorSettingsRequest {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub rules: Option<UpdateOrchestratorRulesRequest>,
    #[serde(default)]
    pub notify: Option<UpdateNotifySettingsRequest>,
    #[serde(default)]
    pub guardrails: Option<UpdateGuardrailsRequest>,
    #[serde(default)]
    pub pr_monitor_enabled: Option<bool>,
    #[serde(default)]
    pub pr_monitor_interval_secs: Option<u64>,
}

/// Guardrails settings update request (all fields optional for partial updates)
#[derive(Debug, Deserialize)]
pub struct UpdateGuardrailsRequest {
    #[serde(default)]
    pub max_ci_retries: Option<u64>,
    #[serde(default)]
    pub max_review_loops: Option<u64>,
    #[serde(default)]
    pub escalate_to_human_after: Option<u64>,
}

/// Rules sub-object in orchestrator settings update request
#[derive(Debug, Deserialize)]
pub struct UpdateOrchestratorRulesRequest {
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub merge: Option<String>,
    #[serde(default)]
    pub review: Option<String>,
    #[serde(default)]
    pub custom: Option<String>,
}

/// Notification settings update request (all fields optional for partial updates)
#[derive(Debug, Deserialize)]
pub struct UpdateNotifySettingsRequest {
    #[serde(default)]
    pub on_agent_stopped: Option<bool>,
    #[serde(default)]
    pub on_agent_error: Option<bool>,
    #[serde(default)]
    pub on_rebase_conflict: Option<bool>,
    #[serde(default)]
    pub on_ci_passed: Option<bool>,
    #[serde(default)]
    pub on_ci_failed: Option<bool>,
    #[serde(default)]
    pub on_pr_created: Option<bool>,
    #[serde(default)]
    pub on_pr_comment: Option<bool>,
    #[serde(default)]
    pub on_pr_closed: Option<bool>,
    #[serde(default)]
    pub on_guardrail_exceeded: Option<bool>,
    #[serde(default)]
    pub templates: Option<UpdateNotifyTemplatesRequest>,
}

/// Template overrides update request
#[derive(Debug, Deserialize)]
pub struct UpdateNotifyTemplatesRequest {
    #[serde(default)]
    pub agent_stopped: Option<String>,
    #[serde(default)]
    pub agent_error: Option<String>,
    #[serde(default)]
    pub ci_passed: Option<String>,
    #[serde(default)]
    pub ci_failed: Option<String>,
    #[serde(default)]
    pub pr_created: Option<String>,
    #[serde(default)]
    pub pr_comment: Option<String>,
    #[serde(default)]
    pub rebase_conflict: Option<String>,
    #[serde(default)]
    pub pr_closed: Option<String>,
    #[serde(default)]
    pub guardrail_exceeded: Option<String>,
}

/// GET /api/settings/orchestrator — get orchestrator settings
/// Accepts `?project=/path` for per-project override; omit for global.
pub async fn get_orchestrator_settings(
    State(core): State<Arc<TmaiCore>>,
    axum::extract::Query(q): axum::extract::Query<OrchestratorProjectQuery>,
) -> Json<OrchestratorSettingsResponse> {
    let settings = core.settings();
    let is_override = q
        .project
        .as_deref()
        .and_then(|p| settings.find_project(p))
        .is_some_and(|proj| proj.orchestrator.is_some());
    let orch = settings.resolve_orchestrator(q.project.as_deref());
    Json(OrchestratorSettingsResponse {
        enabled: orch.enabled,
        role: orch.role.clone(),
        rules: OrchestratorRulesResponse {
            branch: orch.rules.branch.clone(),
            merge: orch.rules.merge.clone(),
            review: orch.rules.review.clone(),
            custom: orch.rules.custom.clone(),
        },
        notify: NotifySettingsResponse {
            on_agent_stopped: handling_to_bool(orch.notify.on_agent_stopped),
            on_agent_error: handling_to_bool(orch.notify.on_agent_error),
            on_rebase_conflict: handling_to_bool(orch.notify.on_rebase_conflict),
            on_ci_passed: handling_to_bool(orch.notify.on_ci_passed),
            on_ci_failed: handling_to_bool(orch.notify.on_ci_failed),
            on_pr_created: handling_to_bool(orch.notify.on_pr_created),
            on_pr_comment: handling_to_bool(orch.notify.on_pr_comment),
            on_pr_closed: handling_to_bool(orch.notify.on_pr_closed),
            on_guardrail_exceeded: handling_to_bool(orch.notify.on_guardrail_exceeded),
            templates: NotifyTemplatesResponse {
                agent_stopped: orch.notify.templates.agent_stopped.clone(),
                agent_error: orch.notify.templates.agent_error.clone(),
                ci_passed: orch.notify.templates.ci_passed.clone(),
                ci_failed: orch.notify.templates.ci_failed.clone(),
                pr_created: orch.notify.templates.pr_created.clone(),
                pr_comment: orch.notify.templates.pr_comment.clone(),
                rebase_conflict: orch.notify.templates.rebase_conflict.clone(),
                pr_closed: orch.notify.templates.pr_closed.clone(),
                guardrail_exceeded: orch.notify.templates.guardrail_exceeded.clone(),
            },
            default_templates: {
                let d = NotifyTemplates::defaults();
                NotifyTemplatesResponse {
                    agent_stopped: d.agent_stopped,
                    agent_error: d.agent_error,
                    ci_passed: d.ci_passed,
                    ci_failed: d.ci_failed,
                    pr_created: d.pr_created,
                    pr_comment: d.pr_comment,
                    rebase_conflict: d.rebase_conflict,
                    pr_closed: d.pr_closed,
                    guardrail_exceeded: d.guardrail_exceeded,
                }
            },
        },
        guardrails: GuardrailsSettingsResponse {
            max_ci_retries: orch.guardrails.max_ci_retries,
            max_review_loops: orch.guardrails.max_review_loops,
            escalate_to_human_after: orch.guardrails.escalate_to_human_after,
        },
        pr_monitor_enabled: orch.pr_monitor_enabled,
        pr_monitor_interval_secs: orch.pr_monitor_interval_secs,
        is_project_override: is_override,
    })
}

/// PUT /api/settings/orchestrator — update orchestrator settings (persisted to config.toml)
/// Accepts `?project=/path` for per-project override; omit for global.
pub async fn update_orchestrator_settings(
    State(core): State<Arc<TmaiCore>>,
    axum::extract::Query(q): axum::extract::Query<OrchestratorProjectQuery>,
    Json(req): Json<UpdateOrchestratorSettingsRequest>,
) -> Json<serde_json::Value> {
    let settings = core.settings();

    // Build the updated OrchestratorSettings from current + request
    let current = settings.resolve_orchestrator(q.project.as_deref());
    let updated = tmai_core::config::OrchestratorSettings {
        enabled: req.enabled.unwrap_or(current.enabled),
        role: req.role.unwrap_or_else(|| current.role.clone()),
        rules: tmai_core::config::OrchestratorRules {
            branch: req
                .rules
                .as_ref()
                .and_then(|r| r.branch.clone())
                .unwrap_or_else(|| current.rules.branch.clone()),
            merge: req
                .rules
                .as_ref()
                .and_then(|r| r.merge.clone())
                .unwrap_or_else(|| current.rules.merge.clone()),
            review: req
                .rules
                .as_ref()
                .and_then(|r| r.review.clone())
                .unwrap_or_else(|| current.rules.review.clone()),
            custom: req
                .rules
                .as_ref()
                .and_then(|r| r.custom.clone())
                .unwrap_or_else(|| current.rules.custom.clone()),
        },
        notify: {
            let n = &current.notify;
            let nr = &req.notify;
            let t = nr.as_ref().and_then(|r| r.templates.as_ref());
            tmai_core::config::OrchestratorNotifySettings {
                on_agent_stopped: merge_handling(
                    nr.as_ref().and_then(|r| r.on_agent_stopped),
                    n.on_agent_stopped,
                ),
                on_agent_error: merge_handling(
                    nr.as_ref().and_then(|r| r.on_agent_error),
                    n.on_agent_error,
                ),
                on_rebase_conflict: merge_handling(
                    nr.as_ref().and_then(|r| r.on_rebase_conflict),
                    n.on_rebase_conflict,
                ),
                on_ci_passed: merge_handling(
                    nr.as_ref().and_then(|r| r.on_ci_passed),
                    n.on_ci_passed,
                ),
                on_ci_failed: merge_handling(
                    nr.as_ref().and_then(|r| r.on_ci_failed),
                    n.on_ci_failed,
                ),
                on_pr_created: merge_handling(
                    nr.as_ref().and_then(|r| r.on_pr_created),
                    n.on_pr_created,
                ),
                on_pr_comment: merge_handling(
                    nr.as_ref().and_then(|r| r.on_pr_comment),
                    n.on_pr_comment,
                ),
                on_pr_closed: merge_handling(
                    nr.as_ref().and_then(|r| r.on_pr_closed),
                    n.on_pr_closed,
                ),
                on_guardrail_exceeded: merge_handling(
                    nr.as_ref().and_then(|r| r.on_guardrail_exceeded),
                    n.on_guardrail_exceeded,
                ),
                templates: tmai_core::config::NotifyTemplates {
                    agent_stopped: t
                        .and_then(|t| t.agent_stopped.clone())
                        .unwrap_or_else(|| n.templates.agent_stopped.clone()),
                    agent_error: t
                        .and_then(|t| t.agent_error.clone())
                        .unwrap_or_else(|| n.templates.agent_error.clone()),
                    ci_passed: t
                        .and_then(|t| t.ci_passed.clone())
                        .unwrap_or_else(|| n.templates.ci_passed.clone()),
                    ci_failed: t
                        .and_then(|t| t.ci_failed.clone())
                        .unwrap_or_else(|| n.templates.ci_failed.clone()),
                    pr_created: t
                        .and_then(|t| t.pr_created.clone())
                        .unwrap_or_else(|| n.templates.pr_created.clone()),
                    pr_comment: t
                        .and_then(|t| t.pr_comment.clone())
                        .unwrap_or_else(|| n.templates.pr_comment.clone()),
                    rebase_conflict: t
                        .and_then(|t| t.rebase_conflict.clone())
                        .unwrap_or_else(|| n.templates.rebase_conflict.clone()),
                    pr_closed: t
                        .and_then(|t| t.pr_closed.clone())
                        .unwrap_or_else(|| n.templates.pr_closed.clone()),
                    guardrail_exceeded: t
                        .and_then(|t| t.guardrail_exceeded.clone())
                        .unwrap_or_else(|| n.templates.guardrail_exceeded.clone()),
                },
            }
        },
        guardrails: {
            let g = &current.guardrails;
            let gr = &req.guardrails;
            tmai_core::config::GuardrailsSettings {
                max_ci_retries: gr
                    .as_ref()
                    .and_then(|r| r.max_ci_retries)
                    .unwrap_or(g.max_ci_retries),
                max_review_loops: gr
                    .as_ref()
                    .and_then(|r| r.max_review_loops)
                    .unwrap_or(g.max_review_loops),
                escalate_to_human_after: gr
                    .as_ref()
                    .and_then(|r| r.escalate_to_human_after)
                    .unwrap_or(g.escalate_to_human_after),
            }
        },
        auto_action_templates: current.auto_action_templates.clone(),
        pr_monitor_enabled: req.pr_monitor_enabled.unwrap_or(current.pr_monitor_enabled),
        pr_monitor_interval_secs: req
            .pr_monitor_interval_secs
            .unwrap_or(current.pr_monitor_interval_secs),
    };
    drop(settings);

    tmai_core::config::Settings::save_project_orchestrator(q.project.as_deref(), &updated);
    core.reload_settings();

    // Hot-reload the live notifier and guardrails services if running
    #[allow(deprecated)]
    let state = core.raw_state();
    let s = state.read();
    if let Some(ref ns) = s.notify_settings {
        *ns.write() = updated.notify;
    }
    if let Some(ref gs) = s.guardrails_settings {
        *gs.write() = updated.guardrails;
    }
    drop(s);

    tracing::info!(
        project = ?q.project,
        "Orchestrator settings updated (including notify and guardrails)"
    );
    Json(serde_json::json!({"ok": true}))
}

// =========================================================
// Auto-approve settings endpoint
// =========================================================

/// Response body for auto-approve settings
#[derive(Debug, Serialize)]
pub struct AutoApproveSettingsResponse {
    /// Master enable/disable
    pub enabled: bool,
    /// Current effective mode
    pub mode: String,
    /// Whether the service is running
    pub running: bool,
    /// Rule presets
    pub rules: RuleSettingsResponse,
    /// AI provider for auto-approve decisions
    pub provider: String,
    /// Model name
    pub model: String,
    /// Timeout for each judgment in seconds
    pub timeout_secs: u64,
    /// Cooldown after judgment (seconds)
    pub cooldown_secs: u64,
    /// Interval between checking for candidates (milliseconds)
    pub check_interval_ms: u64,
    /// Allowed approval types (empty = all except UserQuestion)
    pub allowed_types: Vec<String>,
    /// Maximum concurrent judgments
    pub max_concurrent: usize,
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
    /// Master enable/disable
    #[serde(default)]
    pub enabled: Option<bool>,
    /// AI provider
    #[serde(default)]
    pub provider: Option<String>,
    /// Model name
    #[serde(default)]
    pub model: Option<String>,
    /// Timeout for each judgment (seconds)
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// Cooldown after judgment (seconds)
    #[serde(default)]
    pub cooldown_secs: Option<u64>,
    /// Interval between checking for candidates (milliseconds)
    #[serde(default)]
    pub check_interval_ms: Option<u64>,
    /// Allowed approval types
    #[serde(default)]
    pub allowed_types: Option<Vec<String>>,
    /// Maximum concurrent judgments
    #[serde(default)]
    pub max_concurrent: Option<usize>,
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
        enabled: aa.enabled,
        mode,
        running,
        rules,
        provider: aa.provider.clone(),
        model: aa.model.clone(),
        timeout_secs: aa.timeout_secs,
        cooldown_secs: aa.cooldown_secs,
        check_interval_ms: aa.check_interval_ms,
        allowed_types: aa.allowed_types.clone(),
        max_concurrent: aa.max_concurrent,
    })
}

/// PUT /api/settings/auto-approve — update auto-approve settings (persisted to config.toml)
pub async fn update_auto_approve_settings(
    State(core): State<Arc<TmaiCore>>,
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

    // Persist scalar field changes
    if let Some(v) = req.enabled {
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "enabled",
            toml_edit::Value::from(v),
        );
    }
    if let Some(ref v) = req.provider {
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "provider",
            toml_edit::Value::from(v.as_str()),
        );
    }
    if let Some(ref v) = req.model {
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "model",
            toml_edit::Value::from(v.as_str()),
        );
    }
    if let Some(v) = req.timeout_secs {
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "timeout_secs",
            toml_edit::Value::from(v as i64),
        );
    }
    if let Some(v) = req.cooldown_secs {
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "cooldown_secs",
            toml_edit::Value::from(v as i64),
        );
    }
    if let Some(v) = req.check_interval_ms {
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "check_interval_ms",
            toml_edit::Value::from(v as i64),
        );
    }
    if let Some(ref types) = req.allowed_types {
        let arr = types
            .iter()
            .map(|s| toml_edit::Value::from(s.as_str()))
            .collect::<toml_edit::Array>();
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "allowed_types",
            toml_edit::Value::Array(arr),
        );
    }
    if let Some(v) = req.max_concurrent {
        tmai_core::config::Settings::save_toml_value(
            "auto_approve",
            "max_concurrent",
            toml_edit::Value::from(v as i64),
        );
    }

    // Reload live settings from config.toml
    core.reload_settings();

    Json(serde_json::json!({"ok": true}))
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

    if use_tmux && tmux_avail && !req.force_pty {
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
    // Serialize tmux spawn operations to prevent concurrent calls from receiving
    // the same pane target (TOCTOU race on pane index assignment).
    static TMUX_SPAWN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = TMUX_SPAWN_LOCK.lock().await;

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
            // Split existing window with tiled layout for balanced pane sizes
            tmux.split_window_tiled(&target, &req.cwd).ok()
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

    // For Codex: start app-server first, add --remote to command
    let codex_ws_url = if req.command == "codex" {
        start_codex_app_server_sync(&req.cwd).await
    } else {
        None
    };

    // Build command with args (shell-quote each arg to prevent splitting)
    let mut all_args: Vec<String> = req.args.iter().map(|a| shell_quote(a)).collect();
    if let Some(ref url) = codex_ws_url {
        all_args.push("--remote".to_string());
        all_args.push(shell_quote(url));
    }
    let quoted_command = shell_quote(&req.command);
    let full_command = if all_args.is_empty() {
        quoted_command
    } else {
        format!("{} {}", quoted_command, all_args.join(" "))
    };

    // Shell commands don't need tmai wrap — the tmux pane already starts a shell
    let is_shell = matches!(req.command.as_str(), "bash" | "sh" | "zsh");
    if !is_shell {
        // Run AI agent commands via tmai wrap for monitoring
        tmux.run_command_wrapped(&pane_target, &full_command)
            .map_err(|e| {
                json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("Failed to run command: {}", e),
                )
            })?;
    }

    tracing::info!(
        "API: spawned in tmux window '{}' target={} command={}",
        window_name,
        pane_target,
        req.command
    );

    // Connect WS client to the running app-server
    if let Some(ref ws_url) = codex_ws_url {
        connect_codex_ws(core, &pane_target, ws_url);
    }

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
    let mut extra_args: Vec<String> = Vec::new();
    let rows = if req.rows > 0 { req.rows } else { 24 };
    let cols = if req.cols > 0 { req.cols } else { 80 };

    // For Codex: start app-server first, then launch codex with --remote
    let codex_ws_url = if req.command == "codex" {
        start_codex_app_server_sync(&req.cwd).await
    } else {
        None
    };
    if let Some(ref url) = codex_ws_url {
        extra_args.push("--remote".to_string());
        extra_args.push(url.clone());
    }

    let mut all_args: Vec<&str> = req.args.iter().map(|s| s.as_str()).collect();
    for a in &extra_args {
        all_args.push(a.as_str());
    }

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
        .spawn_session(&req.command, &all_args, &req.cwd, rows, cols, &env)
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
                    activity: tmai_core::agents::Activity::Other("Starting...".to_string()),
                };
                agent.stable_id = session_id.clone();
                agent.pty_session_id = Some(session_id.clone());
                if let Some(ref info) = git_info {
                    agent.git_branch = Some(info.branch.clone());
                    agent.git_dirty = Some(info.dirty);
                    agent.is_worktree = Some(info.is_worktree);
                    agent.git_common_dir = info.common_dir.clone();
                    agent.worktree_name = tmai_core::git::extract_claude_worktree_name(&req.cwd);
                }
                s.agents.insert(session_id.clone(), agent);
                s.agent_order.push(session_id.clone());
            }
            core.notify_agents_updated();

            // For Codex: connect WS client to the already-running app-server
            if let Some(ref ws_url) = codex_ws_url {
                connect_codex_ws(core, &session_id, ws_url);
            }

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

/// POST /api/agents/{id}/set-orchestrator — mark an existing agent as orchestrator
pub async fn set_orchestrator(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    core.set_orchestrator(&id).map_err(api_error_to_http)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

/// Request body for spawning an orchestrator agent
#[derive(Debug, Deserialize)]
pub struct SpawnOrchestratorRequest {
    /// Project path (required). Orchestrator is spawned in this directory.
    pub project: String,
    /// Additional instructions appended to the composed prompt
    #[serde(default)]
    pub additional_instructions: Option<String>,
}

/// POST /api/orchestrator/spawn — spawn an orchestrator agent with composed prompt
pub async fn spawn_orchestrator(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<SpawnOrchestratorRequest>,
) -> Result<Json<SpawnResponse>, (StatusCode, Json<serde_json::Value>)> {
    let cwd = req.project.clone();

    if !std::path::Path::new(&cwd).is_dir() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Directory does not exist: {}", cwd),
        ));
    }

    // Compose orchestrator prompt from settings (with per-project override)
    let mut prompt = core.compose_orchestrator_prompt(Some(&cwd));
    if let Some(ref extra) = req.additional_instructions {
        if !extra.is_empty() {
            prompt.push_str("\n\n");
            prompt.push_str(extra);
        }
    }

    // Spawn as a regular claude agent with the composed prompt as the initial argument
    let spawn_req = SpawnRequest {
        command: "claude".to_string(),
        args: vec![prompt],
        cwd: cwd.clone(),
        rows: default_rows(),
        cols: default_cols(),
        force_pty: false,
    };

    // Respect tmux mode: use tmux window when available, fall back to PTY
    let use_tmux = {
        #[allow(deprecated)]
        let state = core.raw_state().read();
        state.spawn_in_tmux
    };
    let result = if use_tmux && is_tmux_available() {
        spawn_in_tmux(&core, &spawn_req).await?
    } else {
        spawn_in_pty(&core, &spawn_req).await?
    };

    // Mark the newly spawned agent as an orchestrator
    let session_id = &result.session_id;
    {
        #[allow(deprecated)]
        let state = core.raw_state();
        let mut s = state.write();
        if let Some(agent) = s.agents.get_mut(session_id) {
            // Agent already registered (e.g. PTY spawn registers immediately)
            agent.is_orchestrator = true;
        } else {
            // Agent not yet detected by the poller (tmux spawn);
            // queue it so update_agents will apply the flag on first detection.
            s.pending_orchestrator_ids.insert(session_id.clone());
        }
    }
    core.notify_agents_updated();

    tracing::info!("API: spawned orchestrator agent session_id={}", session_id);
    Ok(result)
}

/// Start a Codex app-server and return its WebSocket URL.
///
/// Launches `codex app-server --listen ws://127.0.0.1:0`, reads the actual
/// port from stderr, and returns the URL. The process keeps running in the
/// background for the lifetime of the codex session.
async fn start_codex_app_server_sync(cwd: &str) -> Option<String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    // Use process_group(0) to detach app-server from tmai's process group,
    // so it survives tmai restarts. Codex --remote depends on app-server staying alive.
    let mut child = match tokio::process::Command::new("codex")
        .args(["app-server", "--listen", "ws://127.0.0.1:0"])
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .process_group(0)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to start Codex app-server: {}", e);
            return None;
        }
    };

    let stderr = child.stderr.take()?;
    let mut reader = BufReader::new(stderr).lines();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);

    for _ in 0..10 {
        let line = tokio::select! {
            result = reader.next_line() => match result {
                Ok(Some(l)) => l,
                _ => break,
            },
            _ = tokio::time::sleep_until(deadline) => break,
        };
        if let Some(url) = line.strip_prefix("  listening on: ") {
            let url = url.trim().to_string();
            tracing::info!(url = %url, "Codex app-server started");
            // Record URL for reconnection after tmai restart
            save_codex_ws_url(&url);
            return Some(url);
        }
    }

    tracing::warn!("Codex app-server did not report listening URL");
    let _ = child.kill().await;
    None
}

/// Save codex app-server URL to state dir for reconnection after restart.
fn save_codex_ws_url(url: &str) {
    let state_dir = tmai_core::ipc::protocol::state_dir();
    let ws_dir = state_dir.join("codex-ws");
    let _ = std::fs::create_dir_all(&ws_dir);
    // Use port as filename for dedup
    if let Some(port) = url.rsplit(':').next() {
        let _ = std::fs::write(ws_dir.join(format!("{}.url", port)), url);
    }
}

/// Load previously recorded codex app-server URLs and connect to any that are still alive.
pub async fn reconnect_codex_ws(core: &Arc<TmaiCore>) {
    let state_dir = tmai_core::ipc::protocol::state_dir();
    let ws_dir = state_dir.join("codex-ws");
    let entries = match std::fs::read_dir(&ws_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("url") {
            continue;
        }
        let url = match std::fs::read_to_string(&path) {
            Ok(u) => u.trim().to_string(),
            Err(_) => continue,
        };

        // Check if the app-server is still reachable (quick TCP connect)
        let reachable = if let Some(addr) = url.strip_prefix("ws://") {
            tokio::time::timeout(
                std::time::Duration::from_secs(1),
                tokio::net::TcpStream::connect(addr),
            )
            .await
            .map(|r| r.is_ok())
            .unwrap_or(false)
        } else {
            false
        };

        if reachable {
            tracing::info!(url = %url, "Reconnecting to existing Codex app-server");
            // Use a synthetic pane_id — will be matched via target fallback
            let pane_id = format!(
                "codex-ws-reconnect-{}",
                path.file_stem().unwrap_or_default().to_string_lossy()
            );
            connect_codex_ws(core, &pane_id, &url);
        } else {
            // App-server is dead, clean up the URL file
            tracing::debug!(url = %url, "Codex app-server no longer reachable, removing");
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Connect a WebSocket client to an already-running Codex app-server.
fn connect_codex_ws(core: &Arc<TmaiCore>, pane_id: &str, ws_url: &str) {
    let config = tmai_core::codex_ws::client::CodexWsClientConfig {
        url: ws_url.to_string(),
        pane_id: Some(pane_id.to_string()),
    };
    let registry = core.hook_registry().clone();
    let event_tx = core.event_sender();
    #[allow(deprecated)]
    let state = core.raw_state().clone();

    // Create a sender for bidirectional control and register it
    let sender = tmai_core::codex_ws::CodexWsSender::new(ws_url.to_string());
    if let Some(ws_senders) = core.codex_ws_senders() {
        ws_senders
            .write()
            .insert(ws_url.to_string(), sender.clone());
    }

    tracing::info!(
        pane_id,
        url = ws_url,
        "Connecting WS client to Codex app-server"
    );
    tokio::spawn(async move {
        tmai_core::codex_ws::client::run(config, registry, event_tx, state, sender).await;
    });
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

/// Query params for diff stat endpoint
#[derive(Debug, Deserialize)]
pub struct DiffStatParams {
    pub repo: String,
    pub branch: String,
    pub base: String,
}

/// GET /api/git/diff-stat — get diff statistics between two branches
pub async fn git_diff_stat(
    axum::extract::Query(params): axum::extract::Query<DiffStatParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&params.repo);
    let result =
        tmai_core::git::fetch_branch_diff_stat(repo_dir, &params.branch, &params.base).await;
    match result {
        Some(s) => Ok(Json(serde_json::json!({
            "files_changed": s.files_changed,
            "insertions": s.insertions,
            "deletions": s.deletions,
        }))),
        None => Ok(Json(serde_json::json!(null))),
    }
}

/// GET /api/git/diff — get full diff between two branches
pub async fn git_branch_diff(
    axum::extract::Query(params): axum::extract::Query<DiffStatParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = tmai_core::git::strip_git_suffix(&params.repo);
    if !tmai_core::git::is_safe_git_ref(&params.branch)
        || !tmai_core::git::is_safe_git_ref(&params.base)
    {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid branch name"));
    }
    let diff_spec = format!("{}...{}", params.base, params.branch);
    let output = tokio::process::Command::new("git")
        .args(["-C", repo_dir, "diff", &diff_spec])
        .output()
        .await
        .map_err(|e| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("git diff failed: {}", e),
            )
        })?;
    let raw = &output.stdout;
    const MAX_DIFF_BYTES: usize = 1_048_576; // 1MB
    let truncated = raw.len() > MAX_DIFF_BYTES;
    let diff_bytes = if truncated {
        &raw[..MAX_DIFF_BYTES]
    } else {
        raw.as_slice()
    };
    let diff = String::from_utf8_lossy(diff_bytes).to_string();
    let summary =
        tmai_core::git::fetch_branch_diff_stat(repo_dir, &params.branch, &params.base).await;
    Ok(Json(serde_json::json!({
        "diff": if diff.is_empty() { None } else { Some(diff) },
        "truncated": truncated,
        "summary": summary.map(|s| serde_json::json!({
            "files_changed": s.files_changed,
            "insertions": s.insertions,
            "deletions": s.deletions,
        })),
    })))
}

/// Get commit log between two branches
pub async fn git_log(
    axum::extract::Query(params): axum::extract::Query<CommitLogParams>,
) -> Result<Json<Vec<tmai_core::git::CommitEntry>>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = validate_repo(&params.repo)?;

    let commits = tmai_core::git::log_commits(&repo_dir, &params.base, &params.branch, 20).await;
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
    let repo_dir = validate_repo(&params.repo)?;

    tmai_core::git::log_graph(&repo_dir, params.limit)
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
    #[serde(default)]
    pub delete_remote: bool,
}

/// Delete a local git branch
///
/// When force is not requested, automatically uses force-delete (`-D`) for
/// branches whose PR has been squash-merged — `git branch -d` would reject
/// them because the original commits don't exist on the target branch.
pub async fn delete_branch(
    Json(req): Json<DeleteBranchRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !tmai_core::git::is_safe_git_ref(&req.branch) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid branch name"));
    }

    let repo_dir = validate_repo(&req.repo_path)?;

    // Auto-force for squash-merged branches: git branch -d fails because the
    // original commits don't appear in the target branch after squash merge.
    let force = if req.force {
        true
    } else {
        tmai_core::github::has_merged_pr(&repo_dir, &req.branch).await
    };

    tmai_core::git::delete_branch(&repo_dir, &req.branch, force, req.delete_remote)
        .await
        .map(|()| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))
}

/// Bulk delete branches request body
#[derive(Debug, Deserialize)]
pub struct BulkDeleteBranchesRequest {
    pub repo_path: String,
    pub branches: Vec<String>,
    #[serde(default)]
    pub delete_remote: bool,
}

/// Result of a single branch deletion attempt
#[derive(Debug, Serialize)]
struct BranchDeleteResult {
    branch: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Bulk-delete local branches that have been merged
///
/// For each branch, auto-detects squash-merged PRs and uses force-delete
/// accordingly. Returns per-branch success/failure results so the caller
/// can report partial failures.
pub async fn bulk_delete_branches(
    Json(req): Json<BulkDeleteBranchesRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if req.branches.is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "No branches specified"));
    }

    let repo_dir = validate_repo(&req.repo_path)?;

    let mut results: Vec<BranchDeleteResult> = Vec::new();

    for branch in &req.branches {
        if !tmai_core::git::is_safe_git_ref(branch) {
            results.push(BranchDeleteResult {
                branch: branch.clone(),
                status: "error".to_string(),
                error: Some("Invalid branch name".to_string()),
            });
            continue;
        }

        // Auto-force for squash-merged branches
        let force = tmai_core::github::has_merged_pr(&repo_dir, branch).await;

        match tmai_core::git::delete_branch(&repo_dir, branch, force, req.delete_remote).await {
            Ok(()) => {
                results.push(BranchDeleteResult {
                    branch: branch.clone(),
                    status: "ok".to_string(),
                    error: None,
                });
            }
            Err(e) => {
                results.push(BranchDeleteResult {
                    branch: branch.clone(),
                    status: "error".to_string(),
                    error: Some(e),
                });
            }
        }
    }

    let succeeded = results.iter().filter(|r| r.status == "ok").count();
    let failed = results.iter().filter(|r| r.status == "error").count();

    Ok(Json(serde_json::json!({
        "results": results,
        "succeeded": succeeded,
        "failed": failed,
    })))
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
    // Validate branch name to prevent command injection
    if !tmai_core::git::is_safe_git_ref(&req.branch) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid branch name"));
    }
    let repo_dir = validate_repo(&req.repo_path)?;

    tmai_core::git::checkout_branch(&repo_dir, &req.branch)
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
    // Validate branch name to prevent command injection
    if !tmai_core::git::is_safe_git_ref(&req.name) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Invalid branch name"));
    }
    if let Some(ref base) = req.base {
        if !tmai_core::git::is_safe_git_ref(base) {
            return Err(json_error(
                StatusCode::BAD_REQUEST,
                "Invalid base branch name",
            ));
        }
    }
    let repo_dir = validate_repo(&req.repo_path)?;

    tmai_core::git::create_branch(&repo_dir, &req.name, req.base.as_deref())
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
    let repo_dir = validate_repo(&req.repo_path)?;

    tmai_core::git::fetch_remote(&repo_dir, req.remote.as_deref())
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
    let repo_dir = validate_repo(&req.repo_path)?;

    tmai_core::git::pull(&repo_dir)
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
    let repo_dir = validate_repo(&req.repo_path)?;

    tmai_core::git::merge_branch(&repo_dir, &req.branch)
        .await
        .map(|output| Json(serde_json::json!({"status": "ok", "output": output})))
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))
}

// =========================================================
// Review dispatch endpoint
// =========================================================

/// Request body for dispatch_review
#[derive(Debug, Deserialize)]
pub struct DispatchReviewRequest {
    /// Pull request number to review
    pub pr_number: u64,
    /// Repository path
    pub cwd: String,
    /// Extra review instructions
    #[serde(default)]
    pub additional_instructions: Option<String>,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
}

/// POST /api/review/dispatch — spawn a review agent for a pull request
pub async fn dispatch_review(
    State(core): State<Arc<TmaiCore>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<DispatchReviewRequest>,
) -> Result<Json<SpawnResponse>, (StatusCode, Json<serde_json::Value>)> {
    let origin = parse_origin(&headers);

    // Validate cwd
    if !std::path::Path::new(&req.cwd).is_dir() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Directory does not exist: {}", req.cwd),
        ));
    }

    // Fetch PR info via gh CLI
    let pr_view = tokio::process::Command::new("gh")
        .args([
            "pr",
            "view",
            &req.pr_number.to_string(),
            "--json",
            "title,headRefName,baseRefName,body,url,additions,deletions",
        ])
        .current_dir(&req.cwd)
        .output()
        .await
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &format!("Failed to run gh: {e}")))?;

    if !pr_view.status.success() {
        let stderr = String::from_utf8_lossy(&pr_view.stderr);
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Failed to fetch PR #{}: {}", req.pr_number, stderr.trim()),
        ));
    }

    let pr_json: serde_json::Value = serde_json::from_slice(&pr_view.stdout).map_err(|e| {
        json_error(
            StatusCode::BAD_REQUEST,
            &format!("Failed to parse PR JSON: {e}"),
        )
    })?;

    let pr_title = pr_json["title"].as_str().unwrap_or("(untitled)");
    let pr_url = pr_json["url"].as_str().unwrap_or("");
    let head_branch = pr_json["headRefName"].as_str().unwrap_or("");
    let base_branch = pr_json["baseRefName"].as_str().unwrap_or("main");

    // Fetch latest remote main so worktree starts from up-to-date state
    let fetch_output = tokio::process::Command::new("git")
        .args(["-C", &req.cwd, "fetch", "origin", base_branch])
        .output()
        .await
        .map_err(|e| {
            json_error(
                StatusCode::BAD_REQUEST,
                &format!("Failed to fetch origin/{base_branch}: {e}"),
            )
        })?;

    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Failed to fetch origin/{}: {}", base_branch, stderr.trim()),
        ));
    }

    // Create a dedicated worktree for the review agent
    let worktree_name = format!("review-pr-{}", req.pr_number);
    let wt_req = tmai_core::worktree::WorktreeCreateRequest {
        repo_path: req.cwd.clone(),
        branch_name: worktree_name.clone(),
        dir_name: None,
        base_branch: Some(format!("origin/{base_branch}")),
    };

    let wt_result = tmai_core::worktree::create_worktree(&wt_req)
        .await
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e.to_string()))?;

    tracing::info!(
        "dispatch_review: created worktree '{}' at {} for PR #{}",
        worktree_name,
        wt_result.path,
        req.pr_number,
    );

    // Compose review prompt
    let extra = req
        .additional_instructions
        .as_deref()
        .map(|s| format!("\n\nAdditional instructions:\n{s}"))
        .unwrap_or_default();

    let prompt = format!(
        "IMPORTANT: You are working in a git worktree at: {worktree_path}\n\
         All file reads and edits MUST use paths starting with this directory.\n\
         NEVER edit files outside your worktree directory.\n\n\
         You are a code reviewer. Review PR #{pr_number} and post your review via `gh pr review`.\n\n\
         ## PR Context\n\
         - Title: {title}\n\
         - URL: {url}\n\
         - Branch: {head} → {base}\n\n\
         ## Steps\n\
         1. Run `gh pr diff {pr_number}` to read the full diff\n\
         2. Read relevant source files for context as needed\n\
         3. Analyze the changes for correctness, edge cases, and style\n\
         4. Post your review with `gh pr review {pr_number}` using --comment, --approve, or --request-changes\n\
         5. If you find issues, include specific file/line references in your review body\n\
         {extra}",
        worktree_path = wt_result.path,
        pr_number = req.pr_number,
        title = pr_title,
        url = pr_url,
        head = head_branch,
        base = base_branch,
        extra = extra,
    );

    // Spawn agent in the review worktree directory
    let project_cwd = req.cwd.clone();
    let worktree_path = wt_result.path.clone();
    let spawn_req = SpawnRequest {
        command: "claude".to_string(),
        args: vec![prompt],
        cwd: wt_result.path,
        rows: req.rows,
        cols: req.cols,
        force_pty: false,
    };

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

    // Set pr_number metadata and register pending worktree
    if let Ok(ref resp) = result {
        #[allow(deprecated)]
        let state = core.raw_state();
        let mut s = state.write();
        if let Some(agent) = s.agents.get_mut(&resp.session_id) {
            agent.pr_number = Some(req.pr_number);
        } else {
            // Agent not yet in state (tmux spawn) — store for deferred application
            s.pending_agent_metadata.insert(
                resp.session_id.clone(),
                tmai_core::state::PendingAgentMetadata {
                    pr_number: Some(req.pr_number),
                    ..Default::default()
                },
            );
        }
        // Protect worktree from premature deletion during agent detection
        s.pending_agent_worktrees
            .insert(worktree_path, std::time::Instant::now());
    }

    if let Ok(ref resp) = result {
        // Update .task-meta/{branch}.json with review agent and PR info
        let project_root = std::path::Path::new(&project_cwd);
        tmai_core::task_meta::store::update_meta(project_root, head_branch, |meta| {
            meta.pr = Some(req.pr_number);
            meta.review_agent_id = Some(resp.session_id.clone());
            meta.add_milestone(&format!(
                "Review dispatched for PR #{} \"{}\"",
                req.pr_number, pr_title
            ));
        });

        let _ = core.event_sender().send(CoreEvent::ActionPerformed {
            origin,
            action: "dispatch_review".to_string(),
            summary: format!(
                "Spawned review agent for PR #{} \"{}\" ({} → {}) in worktree {}",
                req.pr_number, pr_title, head_branch, base_branch, worktree_name
            ),
        });
    }

    result
}

// =========================================================
// Worktree spawn endpoint
// =========================================================

/// Request body for worktree spawn
#[derive(Debug, Deserialize)]
pub struct WorktreeSpawnRequest {
    /// Worktree name (optional if issue_number is provided — auto-generated from issue title)
    #[serde(default)]
    pub name: Option<String>,
    /// GitHub issue number. When set, fetches issue title/body to auto-generate the
    /// worktree name (if not given) and compose a resolve prompt with issue context.
    #[serde(default)]
    pub issue_number: Option<u64>,
    /// Repository path
    pub cwd: String,
    /// Base branch to create worktree from (defaults to current HEAD)
    #[serde(default)]
    pub base_branch: Option<String>,
    /// Optional initial prompt to send to the agent on launch
    #[serde(default)]
    pub initial_prompt: Option<String>,
    /// Extra instructions appended after the auto-generated issue prompt.
    /// Only used when issue_number is set and initial_prompt is absent.
    #[serde(default)]
    pub additional_instructions: Option<String>,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_cols")]
    pub cols: u16,
}

/// POST /api/spawn/worktree — create git worktree then spawn claude in it
pub async fn spawn_worktree(
    State(core): State<Arc<TmaiCore>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<WorktreeSpawnRequest>,
) -> Result<Json<SpawnResponse>, (StatusCode, Json<serde_json::Value>)> {
    let origin = parse_origin(&headers);
    // Validate cwd
    if !std::path::Path::new(&req.cwd).is_dir() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Directory does not exist: {}", req.cwd),
        ));
    }

    // Resolve worktree name and initial prompt from issue context if provided
    let (resolved_name, resolved_prompt) = resolve_issue_context(&req).await?;

    // Validate worktree name
    if !tmai_core::git::is_valid_worktree_name(&resolved_name) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Invalid worktree name: {}", resolved_name),
        ));
    }

    // Create git worktree using tmai-core
    let wt_req = tmai_core::worktree::WorktreeCreateRequest {
        repo_path: req.cwd.clone(),
        branch_name: resolved_name.clone(),
        dir_name: None,
        base_branch: req.base_branch.clone(),
    };

    let wt_result = tmai_core::worktree::create_worktree(&wt_req)
        .await
        .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e.to_string()))?;

    tracing::info!(
        "API: created worktree '{}' at {} (branch: {})",
        resolved_name,
        wt_result.path,
        wt_result.branch
    );

    // Inject worktree path constraint into the prompt (defense in depth)
    let worktree_prompt = if !resolved_prompt.is_empty() {
        format!(
            "IMPORTANT: You are working in a git worktree at: {path}\n\
             All file reads and edits MUST use paths starting with this directory.\n\
             NEVER edit files outside your worktree directory.\n\n\
             {prompt}",
            path = wt_result.path,
            prompt = resolved_prompt,
        )
    } else {
        resolved_prompt
    };

    // Build args — pass resolved prompt as first positional argument if provided
    let args = if !worktree_prompt.is_empty() {
        vec![worktree_prompt]
    } else {
        vec![]
    };

    // Spawn claude in the worktree directory
    let worktree_path = wt_result.path.clone();
    let spawn_req = SpawnRequest {
        command: "claude".to_string(),
        args,
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

    // Record pending agent state to prevent premature worktree deletion
    if let Ok(ref resp) = result {
        #[allow(deprecated)]
        let state = core.raw_state();
        let mut s = state.write();
        // Set worktree metadata on the spawned agent (or defer for tmux)
        if let Some(agent) = s.agents.get_mut(&resp.session_id) {
            agent.worktree_base_branch = effective_base;
            agent.issue_number = req.issue_number;
        } else {
            // Agent not yet in state (tmux spawn) — store for deferred application
            s.pending_agent_metadata.insert(
                resp.session_id.clone(),
                tmai_core::state::PendingAgentMetadata {
                    issue_number: req.issue_number,
                    worktree_base_branch: effective_base,
                    ..Default::default()
                },
            );
        }
        s.pending_agent_worktrees
            .insert(worktree_path, std::time::Instant::now());
    }

    if let Ok(ref resp) = result {
        // Write .task-meta/{branch}.json for persistence across restarts
        if let Some(issue_number) = req.issue_number {
            let project_root = std::path::Path::new(&req.cwd);
            let meta = tmai_core::task_meta::TaskMeta::for_issue(
                issue_number,
                Some(resp.session_id.clone()),
            );
            if let Err(e) =
                tmai_core::task_meta::store::write_meta(project_root, &resolved_name, &meta)
            {
                tracing::warn!(error = %e, "Failed to write task meta for dispatch_issue");
            }
        }

        let issue_label = req
            .issue_number
            .map(|n| format!(" (issue #{n})"))
            .unwrap_or_default();
        let _ = core.event_sender().send(CoreEvent::ActionPerformed {
            origin,
            action: "dispatch_issue".to_string(),
            summary: format!("Spawned worktree agent \"{resolved_name}\"{issue_label}"),
        });
    }

    result
}

/// Resolve worktree name and initial prompt from issue context.
///
/// When `issue_number` is provided, fetches the issue via `gh` and:
/// - auto-generates a worktree name from `{issue_number}-{slugified-title}` if `name` is absent
/// - composes an initial prompt with the issue context (title + body) if `initial_prompt` is absent
async fn resolve_issue_context(
    req: &WorktreeSpawnRequest,
) -> Result<(String, String), (StatusCode, Json<serde_json::Value>)> {
    match req.issue_number {
        Some(issue_number) => {
            let issue = tmai_core::github::get_issue_detail(&req.cwd, issue_number)
                .await
                .ok_or_else(|| {
                    json_error(
                        StatusCode::BAD_REQUEST,
                        &format!("Failed to fetch GitHub issue #{issue_number}. Is `gh` authenticated and is this a GitHub repository?"),
                    )
                })?;

            // Auto-generate name: {issue_number}-{slugified-title}
            let name = match &req.name {
                Some(n) if !n.is_empty() => n.clone(),
                _ => {
                    // Max slug portion: 64 (worktree name limit) - issue_number digits - 1 (hyphen)
                    let prefix = format!("{}-", issue_number);
                    let max_slug = 64_usize.saturating_sub(prefix.len());
                    let slug =
                        tmai_core::utils::namegen::slugify_for_branch(&issue.title, max_slug);
                    if slug.is_empty() {
                        return Err(json_error(
                            StatusCode::BAD_REQUEST,
                            &format!("Could not generate valid worktree name from issue #{issue_number} title"),
                        ));
                    }
                    format!("{prefix}{slug}")
                }
            };

            // Compose initial prompt with issue context if not explicitly provided
            let prompt = match &req.initial_prompt {
                Some(p) if !p.is_empty() => p.clone(),
                _ => {
                    let body_section = if issue.body.is_empty() {
                        String::new()
                    } else {
                        format!("\n\n## Issue Body\n{}", issue.body)
                    };
                    let base = format!(
                        "Resolve GitHub issue #{number}: {title}{body}\n\nCreate PR: \"{title} (#{number})\"",
                        number = issue_number,
                        title = issue.title,
                        body = body_section,
                    );
                    match &req.additional_instructions {
                        Some(extra) if !extra.is_empty() => {
                            format!("{base}\n\n## Additional Instructions\n{extra}")
                        }
                        _ => base,
                    }
                }
            };

            Ok((name, prompt))
        }
        None => {
            let name = req.name.clone().ok_or_else(|| {
                json_error(
                    StatusCode::BAD_REQUEST,
                    "Either 'name' or 'issue_number' must be provided",
                )
            })?;
            let prompt = req.initial_prompt.clone().unwrap_or_default();
            Ok((name, prompt))
        }
    }
}

// =========================================================
// Inter-agent communication endpoints
// =========================================================

/// GET /api/agents/{id}/output — get PTY scrollback output as text
pub async fn get_agent_output(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // Resolve stable_id/pane_id to internal key, then try PTY lookup by key
    let resolved = core.resolve_agent_key(&id).unwrap_or_else(|_| id.clone());
    let session = core
        .pty_registry()
        .get(&resolved)
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
    // Resolve both agent IDs
    let from_key = core
        .resolve_agent_key(&from)
        .map_err(|_| json_error(StatusCode::NOT_FOUND, "Source agent not found"))?;
    let to_key = core
        .resolve_agent_key(&to)
        .map_err(|_| json_error(StatusCode::NOT_FOUND, "Target agent not found"))?;

    // Validate text length (32KB, matching MAX_TEXT_LENGTH in tmai-core)
    if req.text.len() > 32_768 {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "Text too long (max 32KB)",
        ));
    }
    let _ = &from_key; // ensure source is valid

    // Try PTY write first (for PTY-spawned targets)
    if let Some(target_session) = core.pty_registry().get(&to_key) {
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
// Config audit endpoints
// =========================================================

/// POST /api/config-audit/run — run a config audit and return results
pub async fn config_audit(
    State(core): State<Arc<TmaiCore>>,
) -> Json<tmai_core::security::ScanResult> {
    Json(core.config_audit())
}

/// GET /api/config-audit/last — return cached audit result (no new audit)
pub async fn last_config_audit(
    State(core): State<Arc<TmaiCore>>,
) -> Json<Option<tmai_core::security::ScanResult>> {
    Json(core.last_config_audit())
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
    State(core): State<Arc<TmaiCore>>,
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

    // Reload live settings from config.toml
    core.reload_settings();

    Json(serde_json::json!({"ok": true}))
}

/// Query params for PR listing
#[derive(Debug, Deserialize)]
pub struct PrQueryParams {
    pub repo: String,
}

/// GET /api/github/prs — list open and merged PRs for a repository
///
/// Returns both open PRs and recently merged PRs whose head branch still
/// exists locally. Merged PRs include `merge_commit_sha` for drawing
/// merge lines in the git graph.
pub async fn list_prs(
    axum::extract::Query(params): axum::extract::Query<PrQueryParams>,
) -> Result<
    Json<std::collections::HashMap<String, tmai_core::github::PrInfo>>,
    (StatusCode, Json<serde_json::Value>),
> {
    let repo_dir = validate_repo(&params.repo)?;

    let mut map = tmai_core::github::list_open_prs(&repo_dir)
        .await
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list PRs (is gh CLI authenticated?)",
            )
        })?;

    // Fetch merged PRs for local branches (best-effort, don't fail if unavailable)
    if let Some(branch_list) = tmai_core::git::list_branches(&repo_dir).await {
        let local_branches: Vec<String> = branch_list
            .branches
            .iter()
            .filter(|b| !map.contains_key(b.as_str()))
            .cloned()
            .collect();
        if let Some(merged) = tmai_core::github::list_merged_prs(&repo_dir, &local_branches).await {
            map.extend(merged);
        }
    }

    Ok(Json(map))
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
    let repo_dir = validate_repo(&params.repo)?;

    tmai_core::github::list_checks(&repo_dir, &params.branch)
        .await
        .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list checks"))
        .map(Json)
}

/// GET /api/github/issues — list open issues for a repository
pub async fn list_issues(
    axum::extract::Query(params): axum::extract::Query<PrQueryParams>,
) -> Result<Json<Vec<tmai_core::github::IssueInfo>>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = validate_repo(&params.repo)?;

    tmai_core::github::list_issues(&repo_dir)
        .await
        .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list issues"))
        .map(Json)
}

/// Query params for issue detail endpoint
#[derive(Debug, Deserialize)]
pub struct IssueDetailParams {
    pub repo: String,
    pub issue_number: u64,
}

/// GET /api/github/issue/detail — fetch detailed info for a single issue
pub async fn get_issue_detail(
    axum::extract::Query(params): axum::extract::Query<IssueDetailParams>,
) -> Result<Json<tmai_core::github::IssueDetail>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = validate_repo(&params.repo)?;

    tmai_core::github::get_issue_detail(&repo_dir, params.issue_number)
        .await
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch issue detail",
            )
        })
        .map(Json)
}

/// Query params for PR detail endpoints
#[derive(Debug, Deserialize)]
pub struct PrDetailParams {
    pub repo: String,
    pub pr_number: u64,
}

/// Request body for PR merge endpoint
#[derive(Debug, Deserialize)]
pub struct PrMergeRequest {
    pub repo: String,
    pub pr_number: u64,
    /// Merge method: "squash" (default), "merge", or "rebase"
    #[serde(default = "default_merge_method")]
    pub method: tmai_core::github::MergeMethod,
    /// Delete remote branch after merge (default: true)
    #[serde(default = "default_true")]
    pub delete_branch: bool,
    /// Clean up associated worktree after merge (default: false)
    #[serde(default)]
    pub delete_worktree: bool,
    /// Worktree name to clean up (required if delete_worktree is true)
    #[serde(default)]
    pub worktree_name: Option<String>,
}

fn default_merge_method() -> tmai_core::github::MergeMethod {
    tmai_core::github::MergeMethod::Squash
}

fn default_true() -> bool {
    true
}

/// Query params for CI log endpoint
#[derive(Debug, Deserialize)]
pub struct CiLogParams {
    pub repo: String,
    pub run_id: u64,
}

/// GET /api/github/pr/comments — fetch comments and reviews for a PR
pub async fn get_pr_comments(
    axum::extract::Query(params): axum::extract::Query<PrDetailParams>,
) -> Result<Json<Vec<tmai_core::github::PrComment>>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = validate_repo(&params.repo)?;

    tmai_core::github::get_pr_comments(&repo_dir, params.pr_number)
        .await
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch PR comments",
            )
        })
        .map(Json)
}

/// GET /api/github/pr/files — fetch changed files for a PR
pub async fn get_pr_files(
    axum::extract::Query(params): axum::extract::Query<PrDetailParams>,
) -> Result<Json<Vec<tmai_core::github::PrChangedFile>>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = validate_repo(&params.repo)?;

    tmai_core::github::get_pr_files(&repo_dir, params.pr_number)
        .await
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch PR files",
            )
        })
        .map(Json)
}

/// GET /api/github/pr/merge-status — fetch merge readiness status for a PR
pub async fn get_pr_merge_status(
    axum::extract::Query(params): axum::extract::Query<PrDetailParams>,
) -> Result<Json<tmai_core::github::PrMergeStatus>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = validate_repo(&params.repo)?;

    tmai_core::github::get_pr_merge_status(&repo_dir, params.pr_number)
        .await
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch PR merge status",
            )
        })
        .map(Json)
}

/// POST /api/github/ci/rerun — re-run failed CI checks
pub async fn rerun_failed_checks(
    Json(body): Json<CiLogParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = validate_repo(&body.repo)?;

    tmai_core::github::rerun_failed_checks(&repo_dir, body.run_id)
        .await
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to re-run checks (may lack actions:write permission)",
            )
        })
        .map(|()| Json(serde_json::json!({"status": "ok"})))
}

/// Request body for PR review
#[derive(Debug, Deserialize)]
pub struct PrReviewRequest {
    pub repo: String,
    pub pr_number: u64,
    pub action: tmai_core::github::ReviewAction,
    #[serde(default)]
    pub body: Option<String>,
}

/// POST /api/github/pr/review — submit a review on a pull request
pub async fn review_pr(
    State(core): State<Arc<TmaiCore>>,
    headers: axum::http::HeaderMap,
    Json(body): Json<PrReviewRequest>,
) -> Result<Json<tmai_core::github::ReviewResult>, (StatusCode, Json<serde_json::Value>)> {
    let origin = parse_origin(&headers);
    let repo_dir = validate_repo(&body.repo)?;

    let result =
        tmai_core::github::review_pr(&repo_dir, body.pr_number, body.action, body.body.as_deref())
            .await
            .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))?;

    let _ = core.event_sender().send(CoreEvent::ActionPerformed {
        origin,
        action: "review_pr".to_string(),
        summary: format!("Reviewed PR #{} ({:?})", body.pr_number, body.action),
    });

    Ok(Json(result))
}

/// POST /api/github/pr/merge — merge a pull request
pub async fn merge_pr(
    State(core): State<Arc<TmaiCore>>,
    headers: axum::http::HeaderMap,
    Json(body): Json<PrMergeRequest>,
) -> Result<Json<tmai_core::github::MergeResult>, (StatusCode, Json<serde_json::Value>)> {
    let origin = parse_origin(&headers);
    let repo_dir = validate_repo(&body.repo)?;

    let mut result =
        tmai_core::github::merge_pr(&repo_dir, body.pr_number, body.method, body.delete_branch)
            .await
            .map_err(|e| json_error(StatusCode::BAD_REQUEST, &e))?;

    // Optional worktree cleanup after successful merge
    if body.delete_worktree {
        if let Some(ref worktree_name) = body.worktree_name {
            let repo_path = if repo_dir.ends_with(".git") {
                repo_dir.clone()
            } else {
                format!("{}/.git", repo_dir)
            };
            let req = tmai_core::worktree::WorktreeDeleteRequest {
                repo_path,
                worktree_name: worktree_name.clone(),
                force: true,
            };
            match tmai_core::worktree::delete_worktree(&req).await {
                Ok(()) => {
                    result.worktree_cleanup = Some(format!("Deleted worktree: {}", worktree_name));
                }
                Err(e) => {
                    result.worktree_cleanup = Some(format!("Worktree cleanup failed: {}", e));
                }
            }
        } else {
            result.worktree_cleanup = Some("Skipped: worktree_name not provided".to_string());
        }
    }

    let _ = core.event_sender().send(CoreEvent::ActionPerformed {
        origin,
        action: "merge_pr".to_string(),
        summary: format!("Merged PR #{}", body.pr_number),
    });

    Ok(Json(result))
}

/// GET /api/github/ci/failure-log — fetch failure log for a CI run
pub async fn get_ci_failure_log(
    axum::extract::Query(params): axum::extract::Query<CiLogParams>,
) -> Result<Json<tmai_core::github::CiFailureLog>, (StatusCode, Json<serde_json::Value>)> {
    let repo_dir = validate_repo(&params.repo)?;

    tmai_core::github::get_ci_failure_log(&repo_dir, params.run_id)
        .await
        .ok_or_else(|| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to fetch CI failure log",
            )
        })
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
    State(core): State<Arc<TmaiCore>>,
    axum::extract::Query(params): axum::extract::Query<FileReadParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let path = std::path::Path::new(&params.path);
    // Path traversal protection: must be within HOME or a registered project
    if !is_path_within_allowed_scope(path, Some(&core)) {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Path is outside allowed scope",
        ));
    }
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
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<FileWriteRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let path = std::path::Path::new(&req.path);
    // Path traversal protection: must be within HOME or a registered project
    if !is_path_within_allowed_scope(path, Some(&core)) {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Path is outside allowed scope",
        ));
    }
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
    State(core): State<Arc<TmaiCore>>,
    axum::extract::Query(params): axum::extract::Query<MdTreeParams>,
) -> Result<Json<Vec<MdTreeEntry>>, (StatusCode, Json<serde_json::Value>)> {
    let root = std::path::Path::new(&params.root);
    // Path traversal protection: must be within HOME or a registered project
    if !is_path_within_allowed_scope(root, Some(&core)) {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Path is outside allowed scope",
        ));
    }
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

/// Validate that a repo path points to an existing directory, returning the
/// path with any `.git` suffix stripped. Used by endpoints that accept a repo
/// path parameter.
fn validate_repo(repo: &str) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let dir = tmai_core::git::strip_git_suffix(repo);
    if !std::path::Path::new(dir).is_dir() {
        return Err(json_error(StatusCode::NOT_FOUND, "Repository not found"));
    }
    Ok(dir.to_string())
}

/// Re-export for convenience
fn strip_git_suffix(path: &str) -> &str {
    tmai_core::git::strip_git_suffix(path)
}

// =========================================================
// Preview settings
// =========================================================

/// Response for GET /api/settings/preview
#[derive(Debug, Serialize)]
pub struct PreviewSettingsResponse {
    pub show_cursor: bool,
    pub preview_poll_focused_ms: u64,
    pub preview_poll_unfocused_ms: u64,
    pub preview_poll_active_input_ms: u64,
    pub preview_active_input_window_ms: u64,
}

/// Request for PUT /api/settings/preview
#[derive(Debug, Deserialize)]
pub struct PreviewSettingsRequest {
    pub show_cursor: Option<bool>,
    pub preview_poll_focused_ms: Option<u64>,
    pub preview_poll_unfocused_ms: Option<u64>,
    pub preview_poll_active_input_ms: Option<u64>,
    pub preview_active_input_window_ms: Option<u64>,
}

/// GET /api/settings/preview
pub async fn get_preview_settings(
    State(core): State<Arc<TmaiCore>>,
) -> Json<PreviewSettingsResponse> {
    let web = &core.settings().web;
    Json(PreviewSettingsResponse {
        show_cursor: web.show_cursor,
        preview_poll_focused_ms: web.preview_poll_focused_ms,
        preview_poll_unfocused_ms: web.preview_poll_unfocused_ms,
        preview_poll_active_input_ms: web.preview_poll_active_input_ms,
        preview_active_input_window_ms: web.preview_active_input_window_ms,
    })
}

/// PUT /api/settings/preview — update preview settings and persist
pub async fn update_preview_settings(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<PreviewSettingsRequest>,
) -> Json<serde_json::Value> {
    if let Some(v) = req.show_cursor {
        tmai_core::config::Settings::save_toml_value(
            "web",
            "show_cursor",
            toml_edit::Value::from(v),
        );
    }
    if let Some(v) = req.preview_poll_focused_ms {
        tmai_core::config::Settings::save_toml_value(
            "web",
            "preview_poll_focused_ms",
            toml_edit::Value::from(v as i64),
        );
    }
    if let Some(v) = req.preview_poll_unfocused_ms {
        tmai_core::config::Settings::save_toml_value(
            "web",
            "preview_poll_unfocused_ms",
            toml_edit::Value::from(v as i64),
        );
    }
    if let Some(v) = req.preview_poll_active_input_ms {
        tmai_core::config::Settings::save_toml_value(
            "web",
            "preview_poll_active_input_ms",
            toml_edit::Value::from(v as i64),
        );
    }
    if let Some(v) = req.preview_active_input_window_ms {
        tmai_core::config::Settings::save_toml_value(
            "web",
            "preview_active_input_window_ms",
            toml_edit::Value::from(v as i64),
        );
    }

    // Reload live settings from config.toml
    core.reload_settings();

    Json(serde_json::json!({"ok": true}))
}

// =========================================================
// Notification settings
// =========================================================

/// Response for GET /api/settings/notification
#[derive(Debug, Serialize)]
pub struct NotificationSettingsResponse {
    pub notify_on_idle: bool,
    pub notify_idle_threshold_secs: u64,
}

/// Request for PUT /api/settings/notification
#[derive(Debug, Deserialize)]
pub struct NotificationSettingsRequest {
    pub notify_on_idle: Option<bool>,
    pub notify_idle_threshold_secs: Option<u64>,
}

/// GET /api/settings/notification
pub async fn get_notification_settings(
    State(core): State<Arc<TmaiCore>>,
) -> Json<NotificationSettingsResponse> {
    let web = &core.settings().web;
    Json(NotificationSettingsResponse {
        notify_on_idle: web.notify_on_idle,
        notify_idle_threshold_secs: web.notify_idle_threshold_secs,
    })
}

/// PUT /api/settings/notification — update notification settings and persist
pub async fn update_notification_settings(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<NotificationSettingsRequest>,
) -> Json<serde_json::Value> {
    if let Some(v) = req.notify_on_idle {
        tmai_core::config::Settings::save_toml_value(
            "web",
            "notify_on_idle",
            toml_edit::Value::from(v),
        );
    }
    if let Some(v) = req.notify_idle_threshold_secs {
        tmai_core::config::Settings::save_toml_value(
            "web",
            "notify_idle_threshold_secs",
            toml_edit::Value::from(v as i64),
        );
    }

    // Reload live settings from config.toml
    core.reload_settings();

    Json(serde_json::json!({"ok": true}))
}

// =========================================================
// Theme settings
// =========================================================

/// Response for GET /api/settings/theme
#[derive(Debug, Serialize)]
pub struct ThemeSettingsResponse {
    pub theme: String,
}

/// Request for PUT /api/settings/theme
#[derive(Debug, Deserialize)]
pub struct ThemeSettingsRequest {
    pub theme: Option<String>,
}

/// GET /api/settings/theme
pub async fn get_theme_settings(State(core): State<Arc<TmaiCore>>) -> Json<ThemeSettingsResponse> {
    Json(ThemeSettingsResponse {
        theme: core.settings().web.theme.clone(),
    })
}

/// PUT /api/settings/theme — update theme preference and persist
pub async fn update_theme_settings(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<ThemeSettingsRequest>,
) -> Json<serde_json::Value> {
    if let Some(ref v) = req.theme {
        // Validate value
        if v == "dark" || v == "light" || v == "system" {
            tmai_core::config::Settings::save_toml_value(
                "web",
                "theme",
                toml_edit::Value::from(v.as_str()),
            );
        }
    }

    // Reload live settings from config.toml
    core.reload_settings();

    Json(serde_json::json!({"ok": true}))
}

// =========================================================
// Workflow settings
// =========================================================

/// Response for GET /api/settings/workflow
#[derive(Debug, Serialize)]
pub struct WorkflowSettingsResponse {
    pub auto_rebase_on_merge: bool,
}

/// Request for PUT /api/settings/workflow
#[derive(Debug, Deserialize)]
pub struct WorkflowSettingsRequest {
    pub auto_rebase_on_merge: Option<bool>,
}

/// GET /api/settings/workflow
pub async fn get_workflow_settings(
    State(core): State<Arc<TmaiCore>>,
) -> Json<WorkflowSettingsResponse> {
    Json(WorkflowSettingsResponse {
        auto_rebase_on_merge: core.settings().workflow.auto_rebase_on_merge,
    })
}

/// PUT /api/settings/workflow — update workflow settings and persist
pub async fn update_workflow_settings(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<WorkflowSettingsRequest>,
) -> Json<serde_json::Value> {
    if let Some(v) = req.auto_rebase_on_merge {
        tmai_core::config::Settings::save_toml_value(
            "workflow",
            "auto_rebase_on_merge",
            toml_edit::Value::from(v),
        );
    }

    core.reload_settings();

    Json(serde_json::json!({"ok": true}))
}

// =========================================================
// Worktree settings
// =========================================================

/// Response for GET /api/settings/worktree
#[derive(Debug, Serialize)]
pub struct WorktreeSettingsResponse {
    pub setup_commands: Vec<String>,
    pub setup_timeout_secs: u64,
    pub branch_depth_warning: u32,
}

/// Request for PUT /api/settings/worktree
#[derive(Debug, Deserialize)]
pub struct WorktreeSettingsRequest {
    pub setup_commands: Option<Vec<String>>,
    pub setup_timeout_secs: Option<u64>,
    pub branch_depth_warning: Option<u32>,
}

/// GET /api/settings/worktree
pub async fn get_worktree_settings(
    State(core): State<Arc<TmaiCore>>,
) -> Json<WorktreeSettingsResponse> {
    let wt = &core.settings().worktree;
    Json(WorktreeSettingsResponse {
        setup_commands: wt.setup_commands.clone(),
        setup_timeout_secs: wt.setup_timeout_secs,
        branch_depth_warning: wt.branch_depth_warning,
    })
}

/// PUT /api/settings/worktree — update worktree settings and persist
pub async fn update_worktree_settings(
    State(core): State<Arc<TmaiCore>>,
    Json(req): Json<WorktreeSettingsRequest>,
) -> Json<serde_json::Value> {
    if let Some(ref cmds) = req.setup_commands {
        let mut arr = toml_edit::Array::new();
        for cmd in cmds {
            arr.push(cmd.as_str());
        }
        tmai_core::config::Settings::save_toml_value(
            "worktree",
            "setup_commands",
            toml_edit::Value::Array(arr),
        );
    }
    if let Some(v) = req.setup_timeout_secs {
        tmai_core::config::Settings::save_toml_value(
            "worktree",
            "setup_timeout_secs",
            toml_edit::Value::from(v as i64),
        );
    }
    if let Some(v) = req.branch_depth_warning {
        tmai_core::config::Settings::save_toml_value(
            "worktree",
            "branch_depth_warning",
            toml_edit::Value::from(v as i64),
        );
    }

    core.reload_settings();

    Json(serde_json::json!({"ok": true}))
}

// =========================================================
// Deferred tool call endpoints
// =========================================================

/// Request body for resolving a deferred tool call
#[derive(Debug, Deserialize)]
pub struct ResolveDeferRequest {
    /// "allow" or "deny"
    pub decision: String,
    /// Optional reason for the decision
    #[serde(default)]
    pub reason: String,
}

/// GET /api/defer — list pending deferred tool calls
pub async fn list_deferred(State(core): State<Arc<TmaiCore>>) -> Json<serde_json::Value> {
    let pending = core.defer_registry().list_pending();
    Json(serde_json::json!({
        "pending": pending,
        "count": pending.len()
    }))
}

/// POST /api/defer/{id}/resolve — approve or reject a deferred tool call
pub async fn resolve_deferred(
    State(core): State<Arc<TmaiCore>>,
    Path(id): Path<u64>,
    Json(req): Json<ResolveDeferRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let decision = match req.decision.as_str() {
        "allow" => tmai_core::auto_approve::PermissionDecision::Allow,
        "deny" => tmai_core::auto_approve::PermissionDecision::Deny,
        other => {
            return Err(json_error(
                StatusCode::BAD_REQUEST,
                &format!("Invalid decision '{}': must be 'allow' or 'deny'", other),
            ));
        }
    };

    let reason = if req.reason.is_empty() {
        format!("Manually {} via UI", req.decision)
    } else {
        req.reason
    };

    let resolution = tmai_core::auto_approve::DeferResolution {
        decision,
        reason,
        resolved_by: "human".into(),
    };

    if core.defer_registry().resolve(id, resolution) {
        tracing::info!(defer_id = id, decision = %req.decision, "Deferred call resolved via API");
        Ok(Json(serde_json::json!({"status": "ok", "defer_id": id})))
    } else {
        Err(json_error(
            StatusCode::NOT_FOUND,
            &format!("Deferred call {} not found or already resolved", id),
        ))
    }
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
            .route(
                "/agents/{id}/validate-project",
                post(validate_agent_project),
            )
            .route("/agents/{id}/select", post(select_choice))
            .route("/agents/{id}/submit", post(submit_selection))
            .route("/agents/{id}/input", post(send_text))
            .route("/agents/{id}/key", post(send_key))
            .route("/agents/{id}/preview", get(get_preview))
            .route("/agents/{id}/transcript", get(get_transcript))
            .route("/teams", get(get_teams))
            .route("/teams/{name}/tasks", get(get_team_tasks))
            .route("/config-audit/run", post(config_audit))
            .route("/config-audit/last", get(last_config_audit))
            .with_state(core)
    }

    /// Build a Router with default empty state
    fn test_router() -> Router {
        test_router_with_state(test_app_state())
    }

    /// Add an idle agent to the shared state
    fn add_idle_agent(state: &SharedState, id: &str) {
        add_agent_with_project(state, id, "/tmp", None);
    }

    /// Add an agent with a specific cwd and git_common_dir
    fn add_agent_with_project(
        state: &SharedState,
        id: &str,
        cwd: &str,
        git_common_dir: Option<&str>,
    ) {
        let mut s = state.write();
        let mut agent = tmai_core::agents::MonitoredAgent::new(
            id.to_string(),
            tmai_core::agents::AgentType::ClaudeCode,
            "Test".to_string(),
            cwd.to_string(),
            1234,
            "main".to_string(),
            "window".to_string(),
            0,
            0,
        );
        agent.status = AgentStatus::Idle;
        agent.git_common_dir = git_common_dir.map(|s| s.to_string());
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
        assert_eq!(agents[0]["id"].as_str().unwrap().len(), 8); // stable UUID short hash
        assert_eq!(agents[0]["pane_id"], "main:0.0");
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
    async fn test_config_audit_last_initially_null() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/config-audit/last")
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
    async fn test_config_audit_returns_ok() {
        let app = test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/config-audit/run")
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

    #[test]
    fn test_shell_quote_strips_control_chars() {
        // Normal strings pass through
        assert_eq!(shell_quote("hello"), "hello");
        // Control chars (e.g. \x01, \x1b) are stripped
        assert_eq!(shell_quote("he\x01llo"), "hello");
        assert_eq!(shell_quote("ab\x1bcd"), "abcd");
        // Newlines are preserved
        assert_eq!(shell_quote("a\nb"), "'a\nb'");
        // Tab (0x09) is a control char and stripped
        assert_eq!(shell_quote("a\tb"), "ab");
        // Shell-special chars get quoted
        assert_eq!(shell_quote("hello world"), "'hello world'");
        // Single quotes are escaped
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn test_is_path_within_allowed_scope() {
        // HOME directory should be allowed
        if let Some(home) = dirs::home_dir() {
            let test_path = home.join("some_file.txt");
            assert!(is_path_within_allowed_scope(&test_path, None));
        }
        // Root paths outside HOME should be rejected
        let outside = std::path::Path::new("/etc/passwd");
        assert!(!is_path_within_allowed_scope(outside, None));
    }

    #[tokio::test]
    async fn test_bulk_delete_branches_empty_list() {
        let req = BulkDeleteBranchesRequest {
            repo_path: "/tmp".to_string(),
            branches: vec![],
            delete_remote: false,
        };
        let result = bulk_delete_branches(Json(req)).await;
        assert!(result.is_err());
        let (status, _body) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_bulk_delete_branches_invalid_repo() {
        let req = BulkDeleteBranchesRequest {
            repo_path: "/nonexistent/repo".to_string(),
            branches: vec!["feature-a".to_string()],
            delete_remote: false,
        };
        let result = bulk_delete_branches(Json(req)).await;
        assert!(result.is_err());
        let (status, _body) = result.unwrap_err();
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_bulk_delete_branches_invalid_branch_name() {
        // Create a temp git repo so repo_path validation passes
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();
        std::process::Command::new("git")
            .args(["init", dir])
            .output()
            .unwrap();

        let req = BulkDeleteBranchesRequest {
            repo_path: dir.to_string(),
            branches: vec!["--exec=evil".to_string(), "valid-name".to_string()],
            delete_remote: false,
        };
        let result = bulk_delete_branches(Json(req)).await;
        assert!(result.is_ok());
        let body = result.unwrap().0;
        let results = body["results"].as_array().unwrap();
        // First branch should fail validation (starts with -)
        assert_eq!(results[0]["status"], "error");
        assert!(results[0]["error"]
            .as_str()
            .unwrap()
            .contains("Invalid branch name"));
    }

    // =========================================================
    // validate-project endpoint tests
    // =========================================================

    #[tokio::test]
    async fn test_validate_project_same_project() {
        let state = test_app_state();
        add_agent_with_project(
            &state,
            "main:0.0",
            "/home/user/project-a",
            Some("/home/user/project-a"),
        );
        let app = test_router_with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/main:0.0/validate-project")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"project":"/home/user/project-a"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_validate_project_worktree_agent_same_project() {
        let state = test_app_state();
        // Worktree agent: cwd differs but git_common_dir matches
        add_agent_with_project(
            &state,
            "main:0.0",
            "/home/user/project-a/.claude/worktrees/feat-x",
            Some("/home/user/project-a"),
        );
        let app = test_router_with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/main:0.0/validate-project")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"project":"/home/user/project-a"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_validate_project_different_project() {
        let state = test_app_state();
        add_agent_with_project(
            &state,
            "main:0.0",
            "/home/user/project-b",
            Some("/home/user/project-b"),
        );
        let app = test_router_with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/main:0.0/validate-project")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"project":"/home/user/project-a"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn test_validate_project_agent_not_found() {
        let app = test_router();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/nonexistent/validate-project")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"project":"/home/user/project-a"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_validate_project_git_suffix_normalization() {
        let state = test_app_state();
        add_agent_with_project(
            &state,
            "main:0.0",
            "/home/user/project-a",
            Some("/home/user/project-a"),
        );
        let app = test_router_with_state(state);

        // Pass project path WITH .git suffix — should still match
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/agents/main:0.0/validate-project")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"project":"/home/user/project-a/.git"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    /// Concurrent PTY spawns must return unique session IDs.
    /// Regression test for #337: dispatch_issue returned duplicate session_id.
    #[tokio::test]
    async fn concurrent_pty_spawns_return_unique_session_ids() {
        let state = test_app_state();
        let runtime: Arc<dyn tmai_core::runtime::RuntimeAdapter> =
            Arc::new(tmai_core::runtime::StandaloneAdapter::new());
        let cmd = CommandSender::new(None, runtime, state.clone());
        let core = Arc::new(
            TmaiCoreBuilder::new(tmai_core::config::Settings::default())
                .with_state(state)
                .with_command_sender(Arc::new(cmd))
                .build(),
        );

        let n = 5;
        let mut handles = Vec::new();
        for _ in 0..n {
            let core_clone = core.clone();
            handles.push(tokio::spawn(async move {
                let req = SpawnRequest {
                    command: "echo".to_string(),
                    args: vec!["hello".to_string()],
                    cwd: "/tmp".to_string(),
                    rows: 24,
                    cols: 80,
                    force_pty: false,
                };
                spawn_in_pty(&core_clone, &req).await
            }));
        }

        let mut session_ids = std::collections::HashSet::new();
        for handle in handles {
            let result = handle.await.unwrap();
            let resp = result.expect("spawn_in_pty should succeed");
            assert!(
                session_ids.insert(resp.session_id.clone()),
                "Duplicate session_id detected: {}",
                resp.session_id
            );
        }
        assert_eq!(session_ids.len(), n, "All session IDs must be unique");
    }
}
