//! Team scanning and pane-to-teammate mapping

use anyhow::Result;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use super::config::{read_team_config, TeamConfig};
use super::task::{read_all_tasks, TeamTask};

/// Scan for all teams in `~/.claude/teams/`
///
/// Skips UUID-named directories (subagent task lists) and only returns
/// human-readable team names.
pub fn scan_teams() -> Result<Vec<TeamConfig>> {
    let teams_dir = get_teams_dir();
    if !teams_dir.exists() {
        return Ok(Vec::new());
    }

    let mut teams = Vec::new();
    let entries = std::fs::read_dir(&teams_dir)?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let dir_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        // Skip UUID directories (subagent task lists)
        if is_uuid_like(&dir_name) {
            continue;
        }

        // Look for config.json in the team directory
        let config_path = path.join("config.json");
        if !config_path.exists() {
            continue;
        }

        match read_team_config(&config_path, &dir_name) {
            Ok(config) => teams.push(config),
            Err(e) => {
                eprintln!(
                    "Warning: Failed to read team config for '{}': {}",
                    dir_name, e
                );
            }
        }
    }

    // Sort by team name for consistent ordering
    teams.sort_by(|a, b| a.team_name.cmp(&b.team_name));
    Ok(teams)
}

/// Scan tasks for a specific team
///
/// Reads task files from `~/.claude/tasks/{team-name}/`
pub fn scan_tasks(team_name: &str) -> Result<Vec<TeamTask>> {
    let tasks_dir = get_tasks_dir().join(team_name);
    read_all_tasks(&tasks_dir)
}

/// Map team members to tmux panes using heuristic matching
///
/// Returns a HashMap of member_name → pane_target for matched members.
///
/// This performs position-based heuristic matching as a fallback.
/// Environment variable matching (higher priority) is handled by the Poller
/// via `ProcessCache.get_env_var()`.
pub fn map_members_to_panes(
    team: &TeamConfig,
    agent_pids: &[(String, u32)], // (pane_target, pid)
) -> HashMap<String, String> {
    let mut mapping: HashMap<String, String> = HashMap::new();

    if !team.members.is_empty() {
        heuristic_mapping(team, agent_pids, &mut mapping);
    }

    mapping
}

/// Heuristic mapping when environment variable matching fails
///
/// Matches panes to members by position if the count of Claude panes
/// in the same session matches the member count.
fn heuristic_mapping(
    team: &TeamConfig,
    agent_pids: &[(String, u32)],
    mapping: &mut HashMap<String, String>,
) {
    // Group panes by session (BTreeMap for deterministic iteration order)
    let mut session_panes: BTreeMap<String, Vec<&str>> = BTreeMap::new();
    for (target, _) in agent_pids {
        if let Some(session) = target.split(':').next() {
            session_panes
                .entry(session.to_string())
                .or_default()
                .push(target);
        }
    }

    // Sort panes within each session for stable ordering
    for panes in session_panes.values_mut() {
        panes.sort();
    }

    // Find a session where pane count matches member count
    for panes in session_panes.values() {
        if panes.len() == team.members.len() {
            // Position-based mapping
            for (member, pane_target) in team.members.iter().zip(panes.iter()) {
                mapping.insert(member.name.clone(), (*pane_target).to_string());
            }
            break;
        }
    }
}

/// Get the teams directory path
fn get_teams_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".claude/teams")
}

/// Get the tasks directory path
fn get_tasks_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".claude/tasks")
}

/// Check if a directory name looks like a UUID
///
/// UUIDs have the format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
fn is_uuid_like(name: &str) -> bool {
    if name.len() != 36 {
        return false;
    }

    let parts: Vec<&str> = name.split('-').collect();
    if parts.len() != 5 {
        return false;
    }

    // Check segment lengths: 8-4-4-4-12
    let expected_lengths = [8, 4, 4, 4, 12];
    for (part, &expected_len) in parts.iter().zip(expected_lengths.iter()) {
        if part.len() != expected_len {
            return false;
        }
        if !part.chars().all(|c| c.is_ascii_hexdigit()) {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_uuid_like() {
        assert!(is_uuid_like("550e8400-e29b-41d4-a716-446655440000"));
        assert!(is_uuid_like("a1b2c3d4-e5f6-7890-abcd-ef1234567890"));
        assert!(!is_uuid_like("my-project"));
        assert!(!is_uuid_like("test-team"));
        assert!(!is_uuid_like(""));
        assert!(!is_uuid_like("not-a-uuid-at-all-nope"));
        // Too short segments
        assert!(!is_uuid_like("550e840-e29b-41d4-a716-446655440000"));
    }

    #[test]
    fn test_heuristic_mapping_count_mismatch() {
        let team = TeamConfig {
            team_name: "test".to_string(),
            description: None,
            members: vec![
                super::super::config::TeamMember {
                    name: "lead".to_string(),
                    agent_id: "id1".to_string(),
                    agent_type: None,
                    cwd: None,
                },
                super::super::config::TeamMember {
                    name: "dev".to_string(),
                    agent_id: "id2".to_string(),
                    agent_type: None,
                    cwd: None,
                },
            ],
        };

        // Only 1 pane, 2 members - should not match
        let agent_pids = vec![("session:0.0".to_string(), 1234)];
        let mut mapping = HashMap::new();
        heuristic_mapping(&team, &agent_pids, &mut mapping);
        assert!(mapping.is_empty());
    }

    #[test]
    fn test_heuristic_mapping_count_match() {
        let team = TeamConfig {
            team_name: "test".to_string(),
            description: None,
            members: vec![
                super::super::config::TeamMember {
                    name: "lead".to_string(),
                    agent_id: "id1".to_string(),
                    agent_type: None,
                    cwd: None,
                },
                super::super::config::TeamMember {
                    name: "dev".to_string(),
                    agent_id: "id2".to_string(),
                    agent_type: None,
                    cwd: None,
                },
            ],
        };

        // 2 panes in same session, 2 members - should match by position
        let agent_pids = vec![
            ("session:0.0".to_string(), 1234),
            ("session:0.1".to_string(), 5678),
        ];
        let mut mapping = HashMap::new();
        heuristic_mapping(&team, &agent_pids, &mut mapping);
        assert_eq!(mapping.len(), 2);
        assert_eq!(mapping.get("lead").unwrap(), "session:0.0");
        assert_eq!(mapping.get("dev").unwrap(), "session:0.1");
    }
}
