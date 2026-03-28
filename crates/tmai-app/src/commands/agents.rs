use serde::{Deserialize, Serialize};
use tauri::State;
use tmai_core::api::TmaiCore;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentInfo {
    pub id: String,
    pub status: String,
}

/// List all agents
#[tauri::command]
pub async fn list_agents(core: State<'_, TmaiCore>) -> Result<Vec<AgentInfo>, String> {
    Ok(core
        .list_agents()
        .iter()
        .map(|a| AgentInfo {
            id: a.id.clone(),
            status: format!("{:?}", a.status),
        })
        .collect())
}

/// Get a specific agent
#[tauri::command]
pub async fn get_agent(target: String, core: State<'_, TmaiCore>) -> Result<AgentInfo, String> {
    core.get_agent(&target)
        .map(|a| AgentInfo {
            id: a.id.clone(),
            status: format!("{:?}", a.status),
        })
        .map_err(|e| e.to_string())
}

/// Get count of agents needing attention
#[tauri::command]
pub async fn attention_count(core: State<'_, TmaiCore>) -> Result<usize, String> {
    Ok(core.attention_count())
}
