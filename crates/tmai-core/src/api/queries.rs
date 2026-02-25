//! Read-only query methods on [`TmaiCore`].
//!
//! Every method acquires a read lock internally, converts to owned snapshots,
//! and releases the lock before returning. Callers never hold a lock.

use super::core::TmaiCore;
use super::types::{AgentDefinitionInfo, AgentSnapshot, ApiError, TeamSummary, TeamTaskInfo};

impl TmaiCore {
    // =========================================================
    // Agent queries
    // =========================================================

    /// List all monitored agents as owned snapshots, in current display order.
    pub fn list_agents(&self) -> Vec<AgentSnapshot> {
        let state = self.state().read();
        let defs = &state.agent_definitions;
        state
            .agent_order
            .iter()
            .filter_map(|id| state.agents.get(id))
            .map(|a| {
                let mut snap = AgentSnapshot::from_agent(a);
                snap.agent_definition = Self::match_agent_definition(a, defs);
                snap
            })
            .collect()
    }

    /// Get a single agent snapshot by target ID.
    pub fn get_agent(&self, target: &str) -> Result<AgentSnapshot, ApiError> {
        let state = self.state().read();
        let defs = &state.agent_definitions;
        state
            .agents
            .get(target)
            .map(|a| {
                let mut snap = AgentSnapshot::from_agent(a);
                snap.agent_definition = Self::match_agent_definition(a, defs);
                snap
            })
            .ok_or_else(|| ApiError::AgentNotFound {
                target: target.to_string(),
            })
    }

    /// Get the currently selected agent snapshot.
    pub fn selected_agent(&self) -> Result<AgentSnapshot, ApiError> {
        let state = self.state().read();
        let defs = &state.agent_definitions;
        state
            .selected_agent()
            .map(|agent| {
                let mut snapshot = AgentSnapshot::from_agent(agent);
                snapshot.agent_definition = Self::match_agent_definition(agent, defs);
                snapshot
            })
            .ok_or(ApiError::NoSelection)
    }

    /// Get the number of agents that need user attention.
    pub fn attention_count(&self) -> usize {
        let state = self.state().read();
        state.attention_count()
    }

    /// Get the total number of monitored agents.
    pub fn agent_count(&self) -> usize {
        let state = self.state().read();
        state.agents.len()
    }

    /// List agents that need attention (awaiting approval or error).
    pub fn agents_needing_attention(&self) -> Vec<AgentSnapshot> {
        let state = self.state().read();
        state
            .agent_order
            .iter()
            .filter_map(|id| state.agents.get(id))
            .filter(|a| a.status.needs_attention())
            .map(AgentSnapshot::from_agent)
            .collect()
    }

    // =========================================================
    // Preview
    // =========================================================

    /// Get the ANSI preview content for an agent.
    pub fn get_preview(&self, target: &str) -> Result<String, ApiError> {
        let state = self.state().read();
        state
            .agents
            .get(target)
            .map(|a| a.last_content_ansi.clone())
            .ok_or_else(|| ApiError::AgentNotFound {
                target: target.to_string(),
            })
    }

    /// Get the plain-text content for an agent.
    pub fn get_content(&self, target: &str) -> Result<String, ApiError> {
        let state = self.state().read();
        state
            .agents
            .get(target)
            .map(|a| a.last_content.clone())
            .ok_or_else(|| ApiError::AgentNotFound {
                target: target.to_string(),
            })
    }

    // =========================================================
    // Team queries
    // =========================================================

    /// List all known teams as owned summaries.
    pub fn list_teams(&self) -> Vec<TeamSummary> {
        let state = self.state().read();
        let mut teams: Vec<TeamSummary> = state
            .teams
            .values()
            .map(TeamSummary::from_snapshot)
            .collect();
        teams.sort_by(|a, b| a.name.cmp(&b.name));
        teams
    }

    /// Get a single team summary by name.
    pub fn get_team(&self, name: &str) -> Result<TeamSummary, ApiError> {
        let state = self.state().read();
        state
            .teams
            .get(name)
            .map(TeamSummary::from_snapshot)
            .ok_or_else(|| ApiError::TeamNotFound {
                name: name.to_string(),
            })
    }

    /// Get tasks for a team.
    pub fn get_team_tasks(&self, name: &str) -> Result<Vec<TeamTaskInfo>, ApiError> {
        let state = self.state().read();
        state
            .teams
            .get(name)
            .map(|ts| ts.tasks.iter().map(TeamTaskInfo::from_task).collect())
            .ok_or_else(|| ApiError::TeamNotFound {
                name: name.to_string(),
            })
    }

    // =========================================================
    // Miscellaneous queries
    // =========================================================

    /// Match an agent to its definition by configured agent_type or member name.
    fn match_agent_definition(
        agent: &crate::agents::MonitoredAgent,
        defs: &[crate::teams::AgentDefinition],
    ) -> Option<AgentDefinitionInfo> {
        if defs.is_empty() {
            return None;
        }
        if let Some(ref team_info) = agent.team_info {
            // 1) Try configured agent_type (explicit mapping from team config)
            if let Some(ref agent_type) = team_info.agent_type {
                if let Some(def) = defs.iter().find(|d| d.name == *agent_type) {
                    return Some(AgentDefinitionInfo::from_definition(def));
                }
            }
            // 2) Fallback: try member_name as agent definition name
            if let Some(def) = defs.iter().find(|d| d.name == team_info.member_name) {
                return Some(AgentDefinitionInfo::from_definition(def));
            }
        }
        None
    }

    /// Check if the application is still running.
    pub fn is_running(&self) -> bool {
        let state = self.state().read();
        state.running
    }

    /// Get the last poll timestamp.
    pub fn last_poll(&self) -> Option<chrono::DateTime<chrono::Utc>> {
        let state = self.state().read();
        state.last_poll
    }

    /// Get known working directories from current agents.
    pub fn known_directories(&self) -> Vec<String> {
        let state = self.state().read();
        state.get_known_directories()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType, MonitoredAgent};
    use crate::api::builder::TmaiCoreBuilder;
    use crate::config::Settings;
    use crate::state::AppState;

    fn make_core_with_agents(agents: Vec<MonitoredAgent>) -> TmaiCore {
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.update_agents(agents);
        }
        TmaiCoreBuilder::new(Settings::default())
            .with_state(state)
            .build()
    }

    fn test_agent(id: &str, status: AgentStatus) -> MonitoredAgent {
        let mut agent = MonitoredAgent::new(
            id.to_string(),
            AgentType::ClaudeCode,
            "Title".to_string(),
            "/home/user".to_string(),
            100,
            "main".to_string(),
            "win".to_string(),
            0,
            0,
        );
        agent.status = status;
        agent
    }

    #[test]
    fn test_list_agents_empty() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        assert!(core.list_agents().is_empty());
    }

    #[test]
    fn test_list_agents() {
        let core = make_core_with_agents(vec![
            test_agent("main:0.0", AgentStatus::Idle),
            test_agent(
                "main:0.1",
                AgentStatus::Processing {
                    activity: "Bash".to_string(),
                },
            ),
        ]);

        let agents = core.list_agents();
        assert_eq!(agents.len(), 2);
    }

    #[test]
    fn test_get_agent_found() {
        let core = make_core_with_agents(vec![test_agent("main:0.0", AgentStatus::Idle)]);

        let result = core.get_agent("main:0.0");
        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "main:0.0");
    }

    #[test]
    fn test_get_agent_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.get_agent("nonexistent");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_attention_count() {
        let core = make_core_with_agents(vec![
            test_agent("main:0.0", AgentStatus::Idle),
            test_agent(
                "main:0.1",
                AgentStatus::AwaitingApproval {
                    approval_type: crate::agents::ApprovalType::ShellCommand,
                    details: "rm -rf".to_string(),
                },
            ),
            test_agent(
                "main:0.2",
                AgentStatus::Error {
                    message: "oops".to_string(),
                },
            ),
        ]);

        assert_eq!(core.attention_count(), 2);
        assert_eq!(core.agent_count(), 3);
    }

    #[test]
    fn test_agents_needing_attention() {
        let core = make_core_with_agents(vec![
            test_agent("main:0.0", AgentStatus::Idle),
            test_agent(
                "main:0.1",
                AgentStatus::AwaitingApproval {
                    approval_type: crate::agents::ApprovalType::FileEdit,
                    details: String::new(),
                },
            ),
        ]);

        let attention = core.agents_needing_attention();
        assert_eq!(attention.len(), 1);
        assert_eq!(attention[0].id, "main:0.1");
    }

    #[test]
    fn test_get_preview() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.last_content_ansi = "\x1b[32mHello\x1b[0m".to_string();
        agent.last_content = "Hello".to_string();

        let core = make_core_with_agents(vec![agent]);

        let preview = core.get_preview("main:0.0").unwrap();
        assert!(preview.contains("Hello"));

        let content = core.get_content("main:0.0").unwrap();
        assert_eq!(content, "Hello");
    }

    #[test]
    fn test_list_teams_empty() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        assert!(core.list_teams().is_empty());
    }

    #[test]
    fn test_is_running() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        assert!(core.is_running());
    }
}
