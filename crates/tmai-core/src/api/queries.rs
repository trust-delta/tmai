//! Read-only query methods on [`TmaiCore`].
//!
//! Every method acquires a read lock internally, converts to owned snapshots,
//! and releases the lock before returning. Callers never hold a lock.

use super::core::TmaiCore;
use super::types::{AgentDefinitionInfo, AgentSnapshot, ApiError, TeamSummary, TeamTaskInfo};

/// Compute effective auto-approve state from global mode and per-agent override
fn compute_auto_approve_effective(global_enabled: bool, override_val: Option<bool>) -> bool {
    match override_val {
        Some(v) => v,
        None => global_enabled,
    }
}

impl TmaiCore {
    // =========================================================
    // Agent ID resolution
    // =========================================================

    /// Resolve a user-supplied ID to the internal HashMap key.
    ///
    /// Accepts any of: stable_id (UUID short hash), internal key (target/session_id),
    /// or pty_session_id. Returns the HashMap key used in `state.agents`.
    pub fn resolve_agent_key(&self, id: &str) -> Result<String, ApiError> {
        let state = self.state().read();
        Self::resolve_agent_key_in_state(&state, id)
    }

    /// Resolve agent ID within an already-locked state (avoids double-lock).
    pub fn resolve_agent_key_in_state(
        state: &crate::state::AppState,
        id: &str,
    ) -> Result<String, ApiError> {
        // 1) Direct HashMap key match (existing behavior)
        if state.agents.contains_key(id) {
            return Ok(id.to_string());
        }
        // 2) Match by stable_id
        if let Some((key, _)) = state.agents.iter().find(|(_, a)| a.stable_id == id) {
            return Ok(key.clone());
        }
        // 3) Match by pty_session_id
        if let Some((key, _)) = state
            .agents
            .iter()
            .find(|(_, a)| a.pty_session_id.as_deref() == Some(id))
        {
            return Ok(key.clone());
        }
        Err(ApiError::AgentNotFound {
            target: id.to_string(),
        })
    }

    // =========================================================
    // Agent queries
    // =========================================================

    /// List all monitored agents as owned snapshots, in current display order.
    pub fn list_agents(&self) -> Vec<AgentSnapshot> {
        let state = self.state().read();
        let defs = &state.agent_definitions;
        let global_aa = self.settings().auto_approve.effective_mode()
            != crate::auto_approve::types::AutoApproveMode::Off;
        state
            .agent_order
            .iter()
            .filter_map(|id| state.agents.get(id))
            .map(|a| {
                let mut snap = AgentSnapshot::from_agent(a);
                snap.agent_definition = Self::match_agent_definition(a, defs);
                snap.auto_approve_effective =
                    compute_auto_approve_effective(global_aa, a.auto_approve_override);
                snap
            })
            .collect()
    }

    /// List agents filtered by project (git_common_dir).
    ///
    /// Agents are matched when their `git_common_dir` equals the given project path,
    /// or when `git_common_dir` is None, by checking if the agent's `cwd` starts with
    /// the project path. This ensures worktree agents are included since they share
    /// the same git_common_dir as the main repo.
    pub fn list_agents_by_project(&self, project: &str) -> Vec<AgentSnapshot> {
        let state = self.state().read();
        let defs = &state.agent_definitions;
        let project_git_dir = normalize_git_dir(project);
        let global_aa = self.settings().auto_approve.effective_mode()
            != crate::auto_approve::types::AutoApproveMode::Off;
        state
            .agent_order
            .iter()
            .filter_map(|id| state.agents.get(id))
            .filter(|a| agent_matches_project(a, &project_git_dir, project))
            .map(|a| {
                let mut snap = AgentSnapshot::from_agent(a);
                snap.agent_definition = Self::match_agent_definition(a, defs);
                snap.auto_approve_effective =
                    compute_auto_approve_effective(global_aa, a.auto_approve_override);
                snap
            })
            .collect()
    }

    /// Validate that an agent belongs to the given project scope.
    ///
    /// Returns Ok(()) if the agent's git_common_dir matches the project,
    /// or Err with a clear message if it belongs to a different project.
    pub fn validate_agent_project(&self, id: &str, project: &str) -> Result<(), ApiError> {
        let state = self.state().read();
        let key = Self::resolve_agent_key_in_state(&state, id)?;
        let agent = state.agents.get(&key).unwrap();
        let project_git_dir = normalize_git_dir(project);
        if agent_matches_project(agent, &project_git_dir, project) {
            Ok(())
        } else {
            Err(ApiError::ProjectScopeMismatch {
                agent_id: id.to_string(),
                agent_project: agent
                    .git_common_dir
                    .clone()
                    .unwrap_or_else(|| agent.cwd.clone()),
                expected_project: project.to_string(),
            })
        }
    }

    /// Get a single agent snapshot by any accepted ID form (stable_id, target, pty_session_id).
    pub fn get_agent(&self, id: &str) -> Result<AgentSnapshot, ApiError> {
        let state = self.state().read();
        let key = Self::resolve_agent_key_in_state(&state, id)?;
        let defs = &state.agent_definitions;
        let global_aa = self.settings().auto_approve.effective_mode()
            != crate::auto_approve::types::AutoApproveMode::Off;
        let a = state.agents.get(&key).unwrap();
        let mut snap = AgentSnapshot::from_agent(a);
        snap.agent_definition = Self::match_agent_definition(a, defs);
        snap.auto_approve_effective =
            compute_auto_approve_effective(global_aa, a.auto_approve_override);
        Ok(snap)
    }

    /// Get the currently selected agent snapshot.
    pub fn selected_agent(&self) -> Result<AgentSnapshot, ApiError> {
        let state = self.state().read();
        let defs = &state.agent_definitions;
        let global_aa = self.settings().auto_approve.effective_mode()
            != crate::auto_approve::types::AutoApproveMode::Off;
        state
            .selected_agent()
            .map(|agent| {
                let mut snapshot = AgentSnapshot::from_agent(agent);
                snapshot.agent_definition = Self::match_agent_definition(agent, defs);
                snapshot.auto_approve_effective =
                    compute_auto_approve_effective(global_aa, agent.auto_approve_override);
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
        let global_aa = self.settings().auto_approve.effective_mode()
            != crate::auto_approve::types::AutoApproveMode::Off;
        state
            .agent_order
            .iter()
            .filter_map(|id| state.agents.get(id))
            .filter(|a| a.status.needs_attention())
            .map(|a| {
                let mut snap = AgentSnapshot::from_agent(a);
                snap.auto_approve_effective =
                    compute_auto_approve_effective(global_aa, a.auto_approve_override);
                snap
            })
            .collect()
    }

    // =========================================================
    // Preview
    // =========================================================

    /// Get the ANSI preview content for an agent.
    pub fn get_preview(&self, id: &str) -> Result<String, ApiError> {
        let state = self.state().read();
        let key = Self::resolve_agent_key_in_state(&state, id)?;
        Ok(state.agents.get(&key).unwrap().last_content_ansi.clone())
    }

    /// Get the plain-text content for an agent.
    pub fn get_content(&self, id: &str) -> Result<String, ApiError> {
        let state = self.state().read();
        let key = Self::resolve_agent_key_in_state(&state, id)?;
        Ok(state.agents.get(&key).unwrap().last_content.clone())
    }

    // =========================================================
    // Transcript queries
    // =========================================================

    /// Get transcript records for an agent (used for hybrid scrollback preview).
    ///
    /// Returns parsed JSONL records from the agent's Claude Code conversation log.
    /// The records are looked up by pane_id from the transcript registry.
    pub fn get_transcript(
        &self,
        id: &str,
    ) -> Result<Vec<crate::transcript::TranscriptRecord>, ApiError> {
        // Verify agent exists and get pane_id
        let pane_id = {
            let state = self.state().read();
            let key = Self::resolve_agent_key_in_state(&state, id)?;
            let agent = state.agents.get(&key).unwrap();
            // Use target_to_pane_id mapping, or fall back to using the internal key
            state
                .target_to_pane_id
                .get(&agent.id)
                .cloned()
                .unwrap_or_else(|| agent.id.clone())
        };

        // Look up transcript records from the registry
        let registry = match self.transcript_registry() {
            Some(reg) => reg,
            None => return Ok(Vec::new()),
        };

        let reg = registry.read();
        Ok(reg
            .get(&pane_id)
            .map(|state| state.recent_records.clone())
            .unwrap_or_default())
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
    // Security queries
    // =========================================================

    /// Run a config audit and cache the result in state.
    ///
    /// Acquires a read lock to gather project directories, releases it,
    /// runs the audit (no lock held), then acquires a write lock to store the result.
    pub fn config_audit(&self) -> crate::security::ScanResult {
        // Gather project directories from agent working_dir fields
        let dirs: Vec<std::path::PathBuf> = {
            let state = self.state().read();
            state
                .agents
                .values()
                .map(|a| std::path::PathBuf::from(&a.cwd))
                .collect()
        };

        // Run audit without holding any lock
        let result = crate::security::ConfigAuditScanner::scan(&dirs);

        // Store result
        {
            let mut state = self.state().write();
            state.config_audit = Some(result.clone());
        }

        result
    }

    /// Get the last cached config audit result (no new audit).
    pub fn last_config_audit(&self) -> Option<crate::security::ScanResult> {
        let state = self.state().read();
        state.config_audit.clone()
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

    // =========================================================
    // Project queries
    // =========================================================

    /// List registered project directories.
    pub fn list_projects(&self) -> Vec<String> {
        let state = self.state().read();
        state.registered_projects.clone()
    }

    /// Add a project directory. Persists to config.toml.
    pub fn add_project(&self, path: &str) -> Result<(), ApiError> {
        let canonical = std::path::Path::new(path);
        if !canonical.is_absolute() {
            return Err(ApiError::InvalidInput {
                message: "Project path must be absolute".to_string(),
            });
        }
        if !canonical.is_dir() {
            return Err(ApiError::InvalidInput {
                message: format!("Directory does not exist: {}", path),
            });
        }
        let canonical_str = canonical.to_string_lossy().to_string();

        let mut state = self.state().write();
        if state.registered_projects.contains(&canonical_str) {
            return Ok(()); // Already registered, idempotent
        }
        state.registered_projects.push(canonical_str);
        let projects = state.registered_projects.clone();
        drop(state);

        crate::config::Settings::save_projects(&projects);
        Ok(())
    }

    /// Remove a project directory. Persists to config.toml.
    pub fn remove_project(&self, path: &str) -> Result<(), ApiError> {
        let mut state = self.state().write();
        let before = state.registered_projects.len();
        state.registered_projects.retain(|p| p != path);
        if state.registered_projects.len() == before {
            return Err(ApiError::InvalidInput {
                message: format!("Project not found: {}", path),
            });
        }
        let projects = state.registered_projects.clone();
        drop(state);

        crate::config::Settings::save_projects(&projects);
        Ok(())
    }
}

/// Normalize a project path for comparison with agent git_common_dir.
///
/// Agents store git_common_dir **without** the `/.git` suffix (e.g., `/home/user/project`).
/// The MCP client's `resolve_git_common_dir` may return the path **with** `/.git`.
/// This function strips `/.git` if present to ensure consistent comparison.
fn normalize_git_dir(project: &str) -> String {
    let trimmed = project.trim_end_matches('/');
    trimmed.strip_suffix("/.git").unwrap_or(trimmed).to_string()
}

/// Check whether an agent belongs to a project by comparing git_common_dir or cwd.
fn agent_matches_project(
    agent: &crate::agents::MonitoredAgent,
    project_git_dir: &str,
    project_path: &str,
) -> bool {
    if let Some(ref gcd) = agent.git_common_dir {
        gcd == project_git_dir
    } else {
        // Fallback: check if agent cwd is within the project directory
        agent.cwd.starts_with(project_path)
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
                    activity: crate::agents::Activity::ToolExecution {
                        tool_name: "Bash".to_string(),
                    },
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
        assert_eq!(result.unwrap().pane_id, "main:0.0");
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
                    approval_type: crate::agents::ApprovalCategory::ShellCommand,
                    details: "rm -rf".to_string(),
                    interaction: None,
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
                    approval_type: crate::agents::ApprovalCategory::FileEdit,
                    details: String::new(),
                    interaction: None,
                },
            ),
        ]);

        let attention = core.agents_needing_attention();
        assert_eq!(attention.len(), 1);
        assert_eq!(attention[0].pane_id, "main:0.1");
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

    #[test]
    fn test_get_transcript_no_registry() {
        // Without transcript registry, returns empty vec
        let core = make_core_with_agents(vec![test_agent("main:0.0", AgentStatus::Idle)]);
        let records = core.get_transcript("main:0.0").unwrap();
        assert!(records.is_empty());
    }

    #[test]
    fn test_get_transcript_agent_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.get_transcript("nonexistent");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_get_transcript_with_registry() {
        use crate::transcript::types::TranscriptRecord;
        use crate::transcript::watcher::new_transcript_registry;

        let registry = new_transcript_registry();
        // Insert test records
        {
            let mut reg = registry.write();
            let mut state = crate::transcript::TranscriptState::new(
                "/tmp/test.jsonl".to_string(),
                "sess1".to_string(),
                "main:0.0".to_string(),
            );
            state.push_records(vec![
                TranscriptRecord::User {
                    text: "Hello".to_string(),
                    uuid: None,
                    timestamp: None,
                },
                TranscriptRecord::AssistantText {
                    text: "Hi there".to_string(),
                    uuid: None,
                    timestamp: None,
                },
            ]);
            reg.insert("main:0.0".to_string(), state);
        }

        let app_state = AppState::shared();
        {
            let mut s = app_state.write();
            s.update_agents(vec![test_agent("main:0.0", AgentStatus::Idle)]);
        }

        let core = TmaiCoreBuilder::new(Settings::default())
            .with_state(app_state)
            .with_transcript_registry(registry)
            .build();

        let records = core.get_transcript("main:0.0").unwrap();
        assert_eq!(records.len(), 2);
    }

    #[test]
    fn test_resolve_agent_key_by_internal_key() {
        let core = make_core_with_agents(vec![test_agent("main:0.0", AgentStatus::Idle)]);
        // Direct HashMap key lookup
        assert_eq!(core.resolve_agent_key("main:0.0").unwrap(), "main:0.0");
    }

    #[test]
    fn test_resolve_agent_key_by_stable_id() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let stable_id = agent.stable_id.clone();
        let core = make_core_with_agents(vec![agent]);
        // Lookup by stable_id
        assert_eq!(core.resolve_agent_key(&stable_id).unwrap(), "main:0.0");
    }

    #[test]
    fn test_resolve_agent_key_by_pty_session_id() {
        let mut agent = test_agent("pty-session-123", AgentStatus::Idle);
        agent.pty_session_id = Some("pty-session-123".to_string());
        let core = make_core_with_agents(vec![agent]);
        // Lookup by pty_session_id
        assert_eq!(
            core.resolve_agent_key("pty-session-123").unwrap(),
            "pty-session-123"
        );
    }

    #[test]
    fn test_resolve_agent_key_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        assert!(matches!(
            core.resolve_agent_key("nonexistent"),
            Err(ApiError::AgentNotFound { .. })
        ));
    }

    #[test]
    fn test_stable_id_is_unique_per_agent() {
        let a1 = test_agent("main:0.0", AgentStatus::Idle);
        let a2 = test_agent("main:0.1", AgentStatus::Idle);
        assert_ne!(a1.stable_id, a2.stable_id);
        assert_eq!(a1.stable_id.len(), 8);
        assert_eq!(a2.stable_id.len(), 8);
    }

    #[test]
    fn test_agent_snapshot_returns_stable_id_as_primary() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let stable_id = agent.stable_id.clone();
        let snapshot = AgentSnapshot::from_agent(&agent);
        assert_eq!(snapshot.id, stable_id);
        assert_eq!(snapshot.pane_id, "main:0.0");
    }

    // =========================================================
    // Project-scoped filtering tests
    // =========================================================

    /// Create an agent with a specific cwd and git_common_dir
    fn test_agent_with_project(
        id: &str,
        cwd: &str,
        git_common_dir: Option<&str>,
    ) -> MonitoredAgent {
        let mut agent = MonitoredAgent::new(
            id.to_string(),
            AgentType::ClaudeCode,
            "Title".to_string(),
            cwd.to_string(),
            100,
            "main".to_string(),
            "win".to_string(),
            0,
            0,
        );
        agent.git_common_dir = git_common_dir.map(|s| s.to_string());
        agent
    }

    #[test]
    fn test_list_agents_by_project_filters_by_git_common_dir() {
        let agents = vec![
            test_agent_with_project(
                "main:0.0",
                "/home/user/project-a",
                Some("/home/user/project-a"),
            ),
            test_agent_with_project(
                "main:0.1",
                "/home/user/project-a/.claude/worktrees/feat-x",
                Some("/home/user/project-a"),
            ),
            test_agent_with_project(
                "main:0.2",
                "/home/user/project-b",
                Some("/home/user/project-b"),
            ),
        ];
        let core = make_core_with_agents(agents);

        // Filter by project-a
        let result = core.list_agents_by_project("/home/user/project-a");
        assert_eq!(result.len(), 2);
        assert!(result
            .iter()
            .all(|a| a.pane_id == "main:0.0" || a.pane_id == "main:0.1"));

        // Filter by project-b
        let result = core.list_agents_by_project("/home/user/project-b");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].pane_id, "main:0.2");
    }

    #[test]
    fn test_list_agents_by_project_cwd_fallback() {
        // Agents without git_common_dir fall back to cwd prefix matching
        let agents = vec![
            test_agent_with_project("main:0.0", "/home/user/project-a/src", None),
            test_agent_with_project("main:0.1", "/home/user/project-b/src", None),
        ];
        let core = make_core_with_agents(agents);

        let result = core.list_agents_by_project("/home/user/project-a");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].pane_id, "main:0.0");
    }

    #[test]
    fn test_list_agents_by_project_git_dir_suffix() {
        // Passing path with .git suffix should also work
        let agents = vec![test_agent_with_project(
            "main:0.0",
            "/home/user/project-a",
            Some("/home/user/project-a"),
        )];
        let core = make_core_with_agents(agents);

        let result = core.list_agents_by_project("/home/user/project-a/.git");
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_list_agents_by_project_empty_result() {
        let agents = vec![test_agent_with_project(
            "main:0.0",
            "/home/user/project-a",
            Some("/home/user/project-a"),
        )];
        let core = make_core_with_agents(agents);

        let result = core.list_agents_by_project("/home/user/project-c");
        assert!(result.is_empty());
    }

    #[test]
    fn test_validate_agent_project_same_project() {
        let agents = vec![test_agent_with_project(
            "main:0.0",
            "/home/user/project-a",
            Some("/home/user/project-a"),
        )];
        let core = make_core_with_agents(agents);

        assert!(core
            .validate_agent_project("main:0.0", "/home/user/project-a")
            .is_ok());
    }

    #[test]
    fn test_validate_agent_project_different_project() {
        let agents = vec![test_agent_with_project(
            "main:0.0",
            "/home/user/project-b",
            Some("/home/user/project-b"),
        )];
        let core = make_core_with_agents(agents);

        let result = core.validate_agent_project("main:0.0", "/home/user/project-a");
        assert!(matches!(result, Err(ApiError::ProjectScopeMismatch { .. })));
    }

    #[test]
    fn test_validate_agent_project_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.validate_agent_project("nonexistent", "/home/user/project-a");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_validate_agent_project_worktree_agent() {
        // Worktree agent shares git_common_dir with main repo
        let agents = vec![test_agent_with_project(
            "main:0.0",
            "/home/user/project-a/.claude/worktrees/feat-x",
            Some("/home/user/project-a"),
        )];
        let core = make_core_with_agents(agents);

        assert!(core
            .validate_agent_project("main:0.0", "/home/user/project-a")
            .is_ok());
    }

    #[test]
    fn test_normalize_git_dir() {
        // Already without .git — returned as-is
        assert_eq!(
            normalize_git_dir("/home/user/project"),
            "/home/user/project"
        );
        // Trailing slash stripped
        assert_eq!(
            normalize_git_dir("/home/user/project/"),
            "/home/user/project"
        );
        // .git suffix stripped to match agent git_common_dir format
        assert_eq!(
            normalize_git_dir("/home/user/project/.git"),
            "/home/user/project"
        );
    }

    #[test]
    fn test_agent_matches_project_with_git_common_dir() {
        // Agent git_common_dir is stored without .git suffix (as set by poller)
        let agent = test_agent_with_project(
            "main:0.0",
            "/home/user/project-a",
            Some("/home/user/project-a"),
        );
        assert!(agent_matches_project(
            &agent,
            "/home/user/project-a",
            "/home/user/project-a"
        ));
        assert!(!agent_matches_project(
            &agent,
            "/home/user/project-b",
            "/home/user/project-b"
        ));
    }

    #[test]
    fn test_agent_matches_project_cwd_fallback() {
        let agent = test_agent_with_project("main:0.0", "/home/user/project-a/subdir", None);
        assert!(agent_matches_project(
            &agent,
            "/home/user/project-a",
            "/home/user/project-a"
        ));
        assert!(!agent_matches_project(
            &agent,
            "/home/user/project-b",
            "/home/user/project-b"
        ));
    }

    // =========================================================
    // Auto-approve effective state tests
    // =========================================================

    #[test]
    fn test_compute_auto_approve_effective_global_off_no_override() {
        assert!(!compute_auto_approve_effective(false, None));
    }

    #[test]
    fn test_compute_auto_approve_effective_global_on_no_override() {
        assert!(compute_auto_approve_effective(true, None));
    }

    #[test]
    fn test_compute_auto_approve_effective_override_true_overrides_global_off() {
        assert!(compute_auto_approve_effective(false, Some(true)));
    }

    #[test]
    fn test_compute_auto_approve_effective_override_false_overrides_global_on() {
        assert!(!compute_auto_approve_effective(true, Some(false)));
    }
}
