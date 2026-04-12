//! Target-agent resolution for AutoActionExecutor.
//!
//! Uses `.task-meta/{branch}.json` to map a branch to the `agent_id`
//! (implementer) or `review_agent_id` (reviewer), then looks up the
//! currently-running agent by several possible identifiers (target,
//! stable_id, pty_session_id, id).

use std::path::Path;

use crate::agents::{MonitoredAgent, Phase};
use crate::task_meta::store;

/// Role of the agent an AutoAction targets.
///
/// `Reviewer` is reserved for future Phase-C handlers (e.g., `PrUpdated`)
/// and currently unused by any event handler in this PR.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentRole {
    Implementer,
    Reviewer,
}

/// Resolve the currently-running agent for `branch` in the given `role`.
///
/// Returns the agent's tmux target string (e.g., `"main:0.2"`) or `None` if:
/// - No task-meta file exists for the branch
/// - The requested role id is unset in the meta
/// - No running agent matches the stored id
pub fn resolve_target_agent(
    project_root: &Path,
    branch: &str,
    role: AgentRole,
    agents: &[MonitoredAgent],
) -> Option<String> {
    let meta = store::read_meta(project_root, branch)?;
    let id = match role {
        AgentRole::Implementer => meta.agent_id?,
        AgentRole::Reviewer => meta.review_agent_id?,
    };
    find_agent_by_id(agents, &id).map(|a| a.target.clone())
}

/// Locate an agent whose id, target, stable_id, or pty_session_id matches `id`.
pub fn find_agent_by_id<'a>(agents: &'a [MonitoredAgent], id: &str) -> Option<&'a MonitoredAgent> {
    agents.iter().find(|a| {
        a.id == id || a.target == id || a.stable_id == id || a.pty_session_id.as_deref() == Some(id)
    })
}

/// Whether `agent` is currently reachable (not offline/unknown).
pub fn is_agent_online(agent: &MonitoredAgent) -> bool {
    !matches!(agent.status.phase(), Phase::Offline)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType, MonitoredAgent};
    use crate::task_meta::store::TaskMeta;

    fn make_agent(target: &str) -> MonitoredAgent {
        MonitoredAgent::new(
            target.to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/tmp".to_string(),
            0,
            target.to_string(),
            String::new(),
            0,
            0,
        )
    }

    #[test]
    fn test_resolve_implementer_by_target() {
        let dir = tempfile::tempdir().unwrap();
        let branch = "feat/a";
        let agent = make_agent("main:0.2");
        let meta = TaskMeta::for_issue(10, Some("main:0.2".into()));
        store::write_meta(dir.path(), branch, &meta).unwrap();

        let resolved = resolve_target_agent(
            dir.path(),
            branch,
            AgentRole::Implementer,
            std::slice::from_ref(&agent),
        );
        assert_eq!(resolved.as_deref(), Some("main:0.2"));
    }

    #[test]
    fn test_resolve_implementer_by_stable_id() {
        let dir = tempfile::tempdir().unwrap();
        let branch = "feat/a";
        let agent = make_agent("main:0.2");
        let stable = agent.stable_id.clone();
        let meta = TaskMeta::for_issue(10, Some(stable));
        store::write_meta(dir.path(), branch, &meta).unwrap();

        let resolved = resolve_target_agent(
            dir.path(),
            branch,
            AgentRole::Implementer,
            std::slice::from_ref(&agent),
        );
        assert_eq!(resolved.as_deref(), Some("main:0.2"));
    }

    #[test]
    fn test_resolve_missing_meta() {
        let dir = tempfile::tempdir().unwrap();
        let resolved = resolve_target_agent(dir.path(), "nonexistent", AgentRole::Implementer, &[]);
        assert!(resolved.is_none());
    }

    #[test]
    fn test_resolve_missing_agent_id() {
        let dir = tempfile::tempdir().unwrap();
        let branch = "feat/a";
        // meta exists but agent_id is None
        let meta = TaskMeta::for_issue(10, None);
        store::write_meta(dir.path(), branch, &meta).unwrap();
        let resolved = resolve_target_agent(dir.path(), branch, AgentRole::Implementer, &[]);
        assert!(resolved.is_none());
    }

    #[test]
    fn test_resolve_reviewer_role() {
        let dir = tempfile::tempdir().unwrap();
        let branch = "feat/a";
        let agent = make_agent("review:0.0");
        let mut meta = TaskMeta::for_issue(10, Some("impl:0.0".into()));
        meta.review_agent_id = Some("review:0.0".into());
        store::write_meta(dir.path(), branch, &meta).unwrap();

        let resolved = resolve_target_agent(
            dir.path(),
            branch,
            AgentRole::Reviewer,
            std::slice::from_ref(&agent),
        );
        assert_eq!(resolved.as_deref(), Some("review:0.0"));
    }

    #[test]
    fn test_is_agent_online() {
        let mut agent = make_agent("x");
        agent.status = AgentStatus::Idle;
        assert!(is_agent_online(&agent));

        agent.status = AgentStatus::Offline;
        assert!(!is_agent_online(&agent));

        agent.status = AgentStatus::Unknown;
        assert!(!is_agent_online(&agent));
    }

    #[test]
    fn test_resolve_agent_offline_still_returns_target() {
        // Resolver does not filter by status — online check is a separate step
        let dir = tempfile::tempdir().unwrap();
        let branch = "feat/a";
        let mut agent = make_agent("main:0.2");
        agent.status = AgentStatus::Offline;
        let meta = TaskMeta::for_issue(10, Some("main:0.2".into()));
        store::write_meta(dir.path(), branch, &meta).unwrap();

        let resolved = resolve_target_agent(
            dir.path(),
            branch,
            AgentRole::Implementer,
            std::slice::from_ref(&agent),
        );
        assert_eq!(resolved.as_deref(), Some("main:0.2"));
        assert!(!is_agent_online(&agent));
    }
}
