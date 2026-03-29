use serde::{Deserialize, Serialize};
use tauri::State;
use tmai_core::api::TmaiCore;

/// Serializable agent info for the frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentInfo {
    pub id: String,
    pub target: String,
    #[serde(rename = "type")]
    pub agent_type: String,
    pub status: String,
    pub title: String,
    pub cwd: String,
    pub display_cwd: String,
    pub detection_source: String,
    pub effort: Option<String>,
    pub git_branch: Option<String>,
    pub git_dirty: Option<bool>,
    pub context_warning: Option<u8>,
    pub is_virtual: bool,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_name: Option<String>,
}

/// List all agents
#[tauri::command]
pub async fn list_agents(core: State<'_, TmaiCore>) -> Result<Vec<AgentInfo>, String> {
    Ok(core
        .list_agents()
        .iter()
        .map(|a| AgentInfo {
            id: a.id.clone(),
            target: a.target.clone(),
            agent_type: format!("{:?}", a.agent_type),
            status: format!("{:?}", a.status),
            title: a.title.clone(),
            cwd: a.cwd.clone(),
            display_cwd: a.display_cwd.clone(),
            detection_source: format!("{:?}", a.detection_source),
            effort: a.effort_level.as_ref().map(|e| format!("{:?}", e)),
            git_branch: a.git_branch.clone(),
            git_dirty: a.git_dirty,
            context_warning: a.context_warning,
            is_virtual: a.is_virtual,
            mode: format!("{:?}", a.mode),
            team_name: a.team_info.as_ref().map(|ti| ti.team_name.clone()),
        })
        .collect())
}

/// Get a specific agent
#[tauri::command]
pub async fn get_agent(target: String, core: State<'_, TmaiCore>) -> Result<AgentInfo, String> {
    core.get_agent(&target)
        .map(|a| AgentInfo {
            id: a.id.clone(),
            target: a.target.clone(),
            agent_type: format!("{:?}", a.agent_type),
            status: format!("{:?}", a.status),
            title: a.title.clone(),
            cwd: a.cwd.clone(),
            display_cwd: a.display_cwd.clone(),
            detection_source: format!("{:?}", a.detection_source),
            effort: a.effort_level.as_ref().map(|e| format!("{:?}", e)),
            git_branch: a.git_branch.clone(),
            git_dirty: a.git_dirty,
            context_warning: a.context_warning,
            is_virtual: a.is_virtual,
            mode: format!("{:?}", a.mode),
            team_name: a.team_info.as_ref().map(|ti| ti.team_name.clone()),
        })
        .map_err(|e| e.to_string())
}

/// Get count of agents needing attention
#[tauri::command]
pub async fn attention_count(core: State<'_, TmaiCore>) -> Result<usize, String> {
    Ok(core.attention_count())
}
