// Agent action commands for approvals, text input, key sending

use tauri::State;
use tmai_core::api::TmaiCore;

/// Approve a pending approval for an agent
#[tauri::command]
pub async fn approve_agent(target: String, core: State<'_, TmaiCore>) -> Result<(), String> {
    core.approve(&target).map_err(|e| e.to_string())
}

/// Send text to an agent
#[tauri::command]
pub async fn send_text(
    target: String,
    text: String,
    core: State<'_, TmaiCore>,
) -> Result<(), String> {
    core.send_text(&target, &text)
        .await
        .map_err(|e| e.to_string())
}

/// Send a key to an agent
#[tauri::command]
pub async fn send_key(
    target: String,
    key: String,
    core: State<'_, TmaiCore>,
) -> Result<(), String> {
    core.send_key(&target, &key).map_err(|e| e.to_string())
}
