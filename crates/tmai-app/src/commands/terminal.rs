//! Terminal (PTY) commands exposed via Tauri IPC.
//!
//! Uses Tauri Channel API for high-throughput PTY output streaming.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use tmai_core::api::TmaiCore;
use tracing::info;

/// Spawn request from frontend
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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
}

fn default_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "/tmp".to_string())
}
fn default_rows() -> u16 {
    24
}
fn default_cols() -> u16 {
    80
}

/// Spawn response to frontend
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResponse {
    pub session_id: String,
    pub pid: u32,
    pub command: String,
}

/// Spawn an agent in a new PTY session.
#[tauri::command]
pub async fn spawn_pty(
    core: State<'_, Arc<TmaiCore>>,
    req: SpawnRequest,
) -> Result<SpawnResponse, String> {
    // Validate command whitelist
    let allowed = ["claude", "codex", "gemini", "bash", "sh", "zsh"];
    let base_cmd = req.command.split('/').next_back().unwrap_or(&req.command);
    if !allowed.contains(&base_cmd) {
        return Err(format!(
            "Command not allowed: {}. Allowed: {allowed:?}",
            req.command
        ));
    }

    // Validate cwd
    if !std::path::Path::new(&req.cwd).is_dir() {
        return Err(format!("Directory does not exist: {}", req.cwd));
    }

    let args: Vec<&str> = req.args.iter().map(|s| s.as_str()).collect();
    let rows = if req.rows > 0 { req.rows } else { 24 };
    let cols = if req.cols > 0 { req.cols } else { 80 };

    info!(
        "Spawn: command={} args={:?} cwd={}",
        req.command, req.args, req.cwd
    );

    // Empty env for now (no web token needed in Tauri mode)
    let env: Vec<(&str, &str)> = vec![];

    let session = core
        .pty_registry()
        .spawn_session(&req.command, &args, &req.cwd, rows, cols, &env)
        .map_err(|e| e.to_string())?;

    let session_id = session.id.clone();
    let response = SpawnResponse {
        session_id: session_id.clone(),
        pid: session.pid,
        command: session.command.clone(),
    };

    // Fetch git info asynchronously
    let git_info = tmai_core::git::GitCache::new().get_info(&req.cwd).await;

    // Register as MonitoredAgent in AppState
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

    info!(
        "Spawned session_id={} pid={}",
        response.session_id, response.pid
    );
    Ok(response)
}

/// Subscribe to PTY output via Tauri Channel API.
///
/// Sends scrollback snapshot first, then streams live output.
#[tauri::command]
pub async fn subscribe_pty(
    core: State<'_, Arc<TmaiCore>>,
    session_id: String,
    on_data: Channel<Vec<u8>>,
) -> Result<(), String> {
    let session = core
        .pty_registry()
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    // Send scrollback snapshot first
    let snapshot = session.scrollback_snapshot();
    if !snapshot.is_empty() {
        on_data.send(snapshot.to_vec()).map_err(|e| e.to_string())?;
    }

    // Subscribe to live output and forward via channel
    let mut rx = session.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(data) => {
                    if on_data.send(data.to_vec()).is_err() {
                        break; // Frontend disconnected
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    Ok(())
}

/// Write input bytes to a PTY session.
#[tauri::command]
pub async fn write_pty(
    core: State<'_, Arc<TmaiCore>>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let session = core
        .pty_registry()
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    session.write_input(&data).map_err(|e| e.to_string())
}

/// Resize a PTY session.
#[tauri::command]
pub async fn resize_pty(
    core: State<'_, Arc<TmaiCore>>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let session = core
        .pty_registry()
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    session.resize(rows, cols).map_err(|e| e.to_string())
}

/// Kill a PTY session.
#[tauri::command]
pub async fn kill_pty(core: State<'_, Arc<TmaiCore>>, session_id: String) -> Result<(), String> {
    let session = core
        .pty_registry()
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    session.kill();
    Ok(())
}
