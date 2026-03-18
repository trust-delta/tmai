//! Agent query and action commands exposed via Tauri IPC.

use std::sync::Arc;

use tauri::State;
use tmai_core::api::{AgentSnapshot, TmaiCore};

// ── Queries ──

/// List all monitored agents.
#[tauri::command]
pub async fn list_agents(core: State<'_, Arc<TmaiCore>>) -> Result<Vec<AgentSnapshot>, String> {
    Ok(core.list_agents())
}

/// Get a single agent by target ID.
#[tauri::command]
pub async fn get_agent(
    core: State<'_, Arc<TmaiCore>>,
    target: String,
) -> Result<AgentSnapshot, String> {
    core.get_agent(&target).map_err(|e| e.to_string())
}

/// Get the number of agents needing attention.
#[tauri::command]
pub async fn attention_count(core: State<'_, Arc<TmaiCore>>) -> Result<usize, String> {
    Ok(core.attention_count())
}

// ── Actions ──

/// Approve (accept permission request / continue) for an agent.
#[tauri::command]
pub async fn approve(core: State<'_, Arc<TmaiCore>>, target: String) -> Result<(), String> {
    core.approve(&target).map_err(|e| e.to_string())
}

/// Select a numbered choice for an agent's question.
#[tauri::command]
pub async fn select_choice(
    core: State<'_, Arc<TmaiCore>>,
    target: String,
    choice: usize,
) -> Result<(), String> {
    core.select_choice(&target, choice)
        .map_err(|e| e.to_string())
}

/// Submit multi-select choices for an agent's question.
#[tauri::command]
pub async fn submit_selection(
    core: State<'_, Arc<TmaiCore>>,
    target: String,
    choices: Vec<usize>,
) -> Result<(), String> {
    core.submit_selection(&target, &choices)
        .map_err(|e| e.to_string())
}

/// Send text input to an agent.
#[tauri::command]
pub async fn send_text(
    core: State<'_, Arc<TmaiCore>>,
    target: String,
    text: String,
) -> Result<(), String> {
    core.send_text(&target, &text)
        .await
        .map_err(|e| e.to_string())
}

/// Send a key to an agent (e.g. "Enter", "Escape", "y", "n").
#[tauri::command]
pub async fn send_key(
    core: State<'_, Arc<TmaiCore>>,
    target: String,
    key: String,
) -> Result<(), String> {
    core.send_key(&target, &key).map_err(|e| e.to_string())
}

/// Kill an agent's pane/process.
#[tauri::command]
pub async fn kill_agent(core: State<'_, Arc<TmaiCore>>, target: String) -> Result<(), String> {
    core.kill_pane(&target).map_err(|e| e.to_string())
}
