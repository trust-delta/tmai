//! Team configuration reading from `~/.claude/teams/{team-name}/config.json`

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Team configuration from config.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamConfig {
    /// Team name (derived from directory name)
    #[serde(skip)]
    pub team_name: String,
    /// Team description
    #[serde(default)]
    pub description: Option<String>,
    /// Team members
    #[serde(default)]
    pub members: Vec<TeamMember>,
}

/// A member of a team
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    /// Human-readable name (used for messaging and task assignment)
    #[serde(default)]
    pub name: String,
    /// Unique agent identifier (UUID)
    #[serde(default, rename = "agentId")]
    pub agent_id: String,
    /// Role/type of the agent
    #[serde(default, rename = "agentType")]
    pub agent_type: Option<String>,
    /// Working directory of the member
    #[serde(default)]
    pub cwd: Option<String>,
}

impl TeamMember {
    /// Extract worktree name from cwd if it's within a `.claude/worktrees/{name}` path
    pub fn worktree_name(&self) -> Option<String> {
        self.cwd
            .as_ref()
            .and_then(|cwd| crate::git::extract_claude_worktree_name(cwd))
    }
}

/// Read a team config from a config.json file
///
/// # Arguments
/// * `config_path` - Path to the config.json file
/// * `team_name` - Name of the team (directory name)
pub fn read_team_config(config_path: &Path, team_name: &str) -> Result<TeamConfig> {
    let content = std::fs::read_to_string(config_path)
        .with_context(|| format!("Failed to read team config: {:?}", config_path))?;

    let mut config: TeamConfig = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse team config: {:?}", config_path))?;

    config.team_name = team_name.to_string();
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_team_config_deserialization() {
        let json = r#"{
            "description": "Working on feature X",
            "members": [
                {
                    "name": "team-lead",
                    "agentId": "550e8400-e29b-41d4-a716-446655440000",
                    "agentType": "general-purpose"
                },
                {
                    "name": "researcher",
                    "agentId": "550e8400-e29b-41d4-a716-446655440001"
                }
            ]
        }"#;

        let mut config: TeamConfig = serde_json::from_str(json).unwrap();
        config.team_name = "test-team".to_string();

        assert_eq!(config.team_name, "test-team");
        assert_eq!(config.description.as_deref(), Some("Working on feature X"));
        assert_eq!(config.members.len(), 2);
        assert_eq!(config.members[0].name, "team-lead");
        assert_eq!(
            config.members[0].agent_id,
            "550e8400-e29b-41d4-a716-446655440000"
        );
        assert_eq!(
            config.members[0].agent_type.as_deref(),
            Some("general-purpose")
        );
        assert_eq!(config.members[1].name, "researcher");
        assert!(config.members[1].agent_type.is_none());
    }

    #[test]
    fn test_team_config_empty_members() {
        let json = r#"{}"#;
        let config: TeamConfig = serde_json::from_str(json).unwrap();
        assert!(config.members.is_empty());
        assert!(config.description.is_none());
    }

    #[test]
    fn test_team_config_forward_compat() {
        // Unknown fields should be ignored
        let json = r#"{
            "description": "test",
            "members": [],
            "unknown_field": "should be ignored",
            "another_new_field": 42
        }"#;
        let config: TeamConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.description.as_deref(), Some("test"));
    }
}
