//! Auto-cleanup background service implementation.

use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::api::CoreEvent;
use crate::state::SharedState;

/// Background service that cleans up agents and worktrees when PRs close.
pub struct AutoCleanupService;

impl AutoCleanupService {
    /// Spawn the auto-cleanup service as a background task.
    ///
    /// Listens for `PrClosed` events and performs cleanup:
    /// - Kill agents whose `git_branch` matches the closed PR's branch
    /// - Delete worktrees associated with that branch
    pub fn spawn(
        state: SharedState,
        mut event_rx: broadcast::Receiver<CoreEvent>,
        event_tx: broadcast::Sender<CoreEvent>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                match event_rx.recv().await {
                    Ok(CoreEvent::PrClosed {
                        pr_number,
                        title,
                        branch,
                    }) => {
                        info!(
                            pr = pr_number,
                            branch = %branch,
                            "Auto-cleanup triggered for closed PR"
                        );
                        Self::cleanup_for_branch(&state, &event_tx, pr_number, &title, &branch)
                            .await;
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        debug!(skipped = n, "Auto-cleanup service lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Event channel closed, stopping auto-cleanup service");
                        break;
                    }
                    _ => {}
                }
            }
        })
    }

    /// Clean up agents and worktrees for a closed PR's branch.
    async fn cleanup_for_branch(
        state: &SharedState,
        event_tx: &broadcast::Sender<CoreEvent>,
        pr_number: u64,
        title: &str,
        branch: &str,
    ) {
        // Find agents working on this branch
        let agents_to_kill: Vec<(String, Option<String>)> = {
            let s = state.read();
            s.agents
                .iter()
                .filter(|(_, a)| a.git_branch.as_deref() == Some(branch) && !a.is_orchestrator)
                .map(|(target, a)| (target.clone(), a.worktree_name.clone()))
                .collect()
        };

        if agents_to_kill.is_empty() {
            debug!(
                branch = %branch,
                "No agents found for closed PR branch"
            );
            return;
        }

        for (target, worktree_name) in &agents_to_kill {
            // Kill the agent's PTY process
            let killed = {
                let s = state.read();
                if let Some(agent) = s.agents.get(target) {
                    if agent.pid > 0 {
                        // Send SIGTERM to the process group
                        #[cfg(unix)]
                        unsafe {
                            libc::kill(-(agent.pid as i32), libc::SIGTERM);
                        }
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            };

            if killed {
                info!(
                    target = %target,
                    branch = %branch,
                    "Auto-cleanup: killed agent for closed PR"
                );
            }

            // Delete worktree if present
            if let Some(wt_name) = worktree_name {
                // Get the repo path from the agent's git_common_dir
                let repo_path = {
                    let s = state.read();
                    s.agents
                        .get(target)
                        .and_then(|a| a.git_common_dir.clone())
                        .map(|d| format!("{d}/.git"))
                };

                if let Some(repo_path) = repo_path {
                    let req = crate::worktree::WorktreeDeleteRequest {
                        repo_path,
                        worktree_name: wt_name.clone(),
                        force: true,
                    };
                    match crate::worktree::delete_worktree(&req).await {
                        Ok(()) => {
                            info!(
                                worktree = %wt_name,
                                "Auto-cleanup: deleted worktree for closed PR"
                            );
                        }
                        Err(e) => {
                            warn!(
                                worktree = %wt_name,
                                error = %e,
                                "Auto-cleanup: failed to delete worktree"
                            );
                        }
                    }
                }
            }
        }

        // Emit ActionPerformed for the orchestrator
        let agent_count = agents_to_kill.len();
        let _ = event_tx.send(CoreEvent::ActionPerformed {
            origin: crate::api::ActionOrigin::system("auto_cleanup"),
            action: "auto_cleanup".to_string(),
            summary: format!(
                "Cleaned up {agent_count} agent(s) for PR #{pr_number} \"{title}\" (branch: {branch})"
            ),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType, MonitoredAgent};
    use crate::state::AppState;

    /// Helper: insert an agent with a branch
    fn insert_agent(state: &SharedState, target: &str, branch: &str, worktree: Option<&str>) {
        let mut s = state.write();
        let mut agent = MonitoredAgent::new(
            target.to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/tmp".to_string(),
            0,
            target.to_string(),
            String::new(),
            0,
            0,
        );
        agent.status = AgentStatus::Idle;
        agent.git_branch = Some(branch.to_string());
        agent.worktree_name = worktree.map(|s| s.to_string());
        agent.git_common_dir = Some("/tmp/repo".to_string());
        s.agents.insert(target.to_string(), agent);
    }

    #[tokio::test]
    async fn test_cleanup_finds_matching_agents() {
        let state = AppState::shared();
        insert_agent(&state, "worker:0.0", "feat/42-auth", Some("42-auth"));
        insert_agent(&state, "worker:0.1", "feat/99-other", Some("99-other"));

        let (tx, mut rx) = broadcast::channel(16);

        AutoCleanupService::cleanup_for_branch(&state, &tx, 42, "Add auth", "feat/42-auth").await;

        // Should emit ActionPerformed
        let event = rx.recv().await.unwrap();
        match event {
            CoreEvent::ActionPerformed {
                origin,
                action,
                summary,
            } => {
                assert!(matches!(origin, crate::api::ActionOrigin::System { .. }));
                assert_eq!(action, "auto_cleanup");
                assert!(summary.contains("1 agent(s)"));
                assert!(summary.contains("#42"));
            }
            _ => panic!("Expected ActionPerformed, got {event:?}"),
        }
    }

    #[tokio::test]
    async fn test_cleanup_skips_orchestrator() {
        let state = AppState::shared();
        // Insert an orchestrator on the same branch
        let mut s = state.write();
        let mut agent = MonitoredAgent::new(
            "orch:0.0".to_string(),
            AgentType::ClaudeCode,
            String::new(),
            "/tmp".to_string(),
            0,
            "orch:0.0".to_string(),
            String::new(),
            0,
            0,
        );
        agent.is_orchestrator = true;
        agent.git_branch = Some("feat/42-auth".to_string());
        s.agents.insert("orch:0.0".to_string(), agent);
        drop(s);

        let (tx, mut rx) = broadcast::channel(16);

        AutoCleanupService::cleanup_for_branch(&state, &tx, 42, "Add auth", "feat/42-auth").await;

        // Should not emit (no matching non-orchestrator agents)
        let result = tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await;
        assert!(result.is_err(), "Should not have emitted any event");
    }

    #[tokio::test]
    async fn test_cleanup_no_agents_for_branch() {
        let state = AppState::shared();
        insert_agent(&state, "worker:0.0", "feat/99-other", None);

        let (tx, mut rx) = broadcast::channel(16);

        AutoCleanupService::cleanup_for_branch(&state, &tx, 42, "Add auth", "feat/42-nonexistent")
            .await;

        // Should not emit (no agents found)
        let result = tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await;
        assert!(result.is_err(), "Should not have emitted any event");
    }
}
