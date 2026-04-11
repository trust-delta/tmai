//! Orchestrator notification service — forwards sub-agent state changes
//! to orchestrator agents via `send_prompt`.
//!
//! Subscribes to `CoreEvent` stream and sends human-readable notifications
//! to every registered orchestrator agent when significant events occur on
//! sub-agents (idle/stopped, CI status, PR review comments).
//!
//! Each event type has an independent ON/OFF toggle and an optional prompt
//! template override.  Settings are read from a shared `Arc<RwLock<>>` so
//! changes made via the WebUI take effect immediately without restart.

use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::broadcast;
use tracing::{debug, info};

use crate::api::CoreEvent;
use crate::config::OrchestratorNotifySettings;
use crate::state::SharedState;

/// Shared, hot-reloadable reference to notify settings
pub type SharedNotifySettings = Arc<RwLock<OrchestratorNotifySettings>>;

/// Background service that notifies orchestrator agents about sub-agent events
pub struct OrchestratorNotifier;

/// Contextual info about an agent at the time of notification
struct AgentContext {
    display_name: String,
    git_branch: Option<String>,
    worktree_name: Option<String>,
    session_name: Option<String>,
}

impl OrchestratorNotifier {
    /// Spawn the notifier as a background task.
    ///
    /// Listens for relevant `CoreEvent`s and sends notification prompts
    /// to all orchestrator agents (excluding the agent that triggered the event).
    ///
    /// Settings are read from the shared lock on each event so that WebUI
    /// changes take effect without restarting the service.
    pub fn spawn(
        settings: SharedNotifySettings,
        state: SharedState,
        mut event_rx: broadcast::Receiver<CoreEvent>,
        event_tx: broadcast::Sender<CoreEvent>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                let notification = match event_rx.recv().await {
                    Ok(event) => {
                        let s = settings.read().clone();
                        Self::build_notification(&event, &s, &state)
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        debug!(skipped = n, "Orchestrator notifier lagged, skipping events");
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Event channel closed, stopping orchestrator notifier");
                        break;
                    }
                };

                let Some((message, source_target)) = notification else {
                    continue;
                };

                // Find all orchestrator agents (excluding the source agent)
                let orchestrators: Vec<String> = {
                    let s = state.read();
                    s.agents
                        .iter()
                        .filter(|(target, a)| {
                            a.is_orchestrator
                                && !a.is_virtual
                                && a.status.is_idle()
                                && *target != &source_target
                                // Also skip when source_target is this orchestrator's
                                // pane_id (hook events use pane_id, not agent map key)
                                && s.target_to_pane_id.get(*target)
                                    != Some(&source_target)
                        })
                        .map(|(target, _)| target.clone())
                        .collect()
                };

                if orchestrators.is_empty() {
                    debug!(
                        message = %message,
                        "No idle orchestrator agents to notify"
                    );
                    continue;
                }

                for target in &orchestrators {
                    info!(
                        orchestrator = %target,
                        source = %source_target,
                        "Sending sub-agent notification to orchestrator"
                    );

                    // Queue the notification via PromptReady event so the
                    // existing prompt delivery infrastructure handles sending.
                    let _ = event_tx.send(CoreEvent::PromptReady {
                        target: target.clone(),
                        prompt: message.clone(),
                    });
                }
            }
        })
    }

    /// Build a notification message from an event, or None if the event is not relevant.
    fn build_notification(
        event: &CoreEvent,
        settings: &OrchestratorNotifySettings,
        state: &SharedState,
    ) -> Option<(String, String)> {
        match event {
            CoreEvent::AgentStopped {
                target,
                last_assistant_message,
                ..
            } => {
                if !settings.on_agent_stopped {
                    return None;
                }
                // Don't notify about orchestrator agents stopping
                if Self::is_orchestrator_or_untracked(target, state) {
                    return None;
                }

                let ctx = Self::agent_context(target, state);
                let name = Self::agent_label(&ctx);
                let branch = ctx.git_branch.as_deref().unwrap_or("");
                let summary = last_assistant_message
                    .as_deref()
                    .map(|m| truncate(m, 200))
                    .unwrap_or_default();

                let msg = render_template(
                    &settings.templates.agent_stopped,
                    &format!("[tmai] Agent \"{name}\" has stopped.\n  Branch: {branch}\n  Last message: {summary}"),
                    &[
                        ("name", &name),
                        ("branch", branch),
                        ("summary", &summary),
                    ],
                );

                Some((msg, target.clone()))
            }

            CoreEvent::AgentStatusChanged {
                target,
                old_status,
                new_status,
            } => {
                if Self::is_orchestrator_or_untracked(target, state) {
                    return None;
                }

                // Only notify on transitions to idle or error
                let is_error = new_status == "error";
                let is_idle = new_status == "idle";
                if !is_error && !is_idle {
                    return None;
                }

                // Error transitions
                if is_error {
                    if !settings.on_agent_error {
                        return None;
                    }
                    let ctx = Self::agent_context(target, state);
                    let name = Self::agent_label(&ctx);
                    let branch = ctx.git_branch.as_deref().unwrap_or("");

                    let msg = render_template(
                        &settings.templates.agent_error,
                        &format!("[tmai] Agent \"{name}\" is now Error.\n  Branch: {branch}"),
                        &[("name", &name), ("branch", branch)],
                    );
                    return Some((msg, target.clone()));
                }

                // Idle transitions — only if not covered by AgentStopped
                if !settings.on_agent_stopped {
                    return None;
                }
                // Avoid duplicate notification if AgentStopped will also fire
                if is_idle && old_status == "processing" {
                    return None;
                }

                let ctx = Self::agent_context(target, state);
                let name = Self::agent_label(&ctx);
                let mut msg = format!("[tmai] Agent \"{name}\" is now Idle.");
                Self::append_branch_info(&mut msg, &ctx);

                Some((msg, target.clone()))
            }

            CoreEvent::RebaseConflict {
                branch,
                worktree_path,
                error,
            } => {
                if !settings.on_rebase_conflict {
                    return None;
                }
                let source = Self::find_agent_by_branch(branch, state)
                    .unwrap_or_else(|| worktree_path.clone());

                let msg = render_template(
                    &settings.templates.rebase_conflict,
                    &format!("[tmai] Rebase conflict on branch \"{branch}\".\n  Error: {error}"),
                    &[("branch", branch.as_str()), ("error", error.as_str())],
                );
                Some((msg, source))
            }

            CoreEvent::PrCreated {
                pr_number,
                title,
                branch,
            } => {
                if !settings.on_pr_created {
                    return None;
                }
                let pr = pr_number.to_string();
                let msg = render_template(
                    &settings.templates.pr_created,
                    &format!(
                        "[PR Monitor] PR #{pr_number} created: \"{title}\" (branch: {branch})"
                    ),
                    &[
                        ("pr_number", &pr),
                        ("title", title.as_str()),
                        ("branch", branch.as_str()),
                    ],
                );
                Some((msg, branch.clone()))
            }

            CoreEvent::PrCiPassed {
                pr_number,
                title,
                checks_summary,
            } => {
                if !settings.on_ci_passed {
                    return None;
                }
                let pr = pr_number.to_string();
                let msg = render_template(
                    &settings.templates.ci_passed,
                    &format!(
                        "[PR Monitor] PR #{pr_number} \"{title}\" CI passed. Ready to merge. {checks_summary}"
                    ),
                    &[
                        ("pr_number", &pr),
                        ("title", title.as_str()),
                        ("summary", checks_summary.as_str()),
                    ],
                );
                Some((msg, format!("pr-{pr_number}")))
            }

            CoreEvent::PrCiFailed {
                pr_number,
                title,
                failed_details,
            } => {
                if !settings.on_ci_failed {
                    return None;
                }
                let pr = pr_number.to_string();
                let msg = render_template(
                    &settings.templates.ci_failed,
                    &format!(
                        "[PR Monitor] PR #{pr_number} \"{title}\" CI failed. {failed_details}"
                    ),
                    &[
                        ("pr_number", &pr),
                        ("title", title.as_str()),
                        ("failed_details", failed_details.as_str()),
                    ],
                );
                Some((msg, format!("pr-{pr_number}")))
            }

            CoreEvent::PrReviewFeedback {
                pr_number,
                title,
                comments_summary,
            } => {
                if !settings.on_pr_comment {
                    return None;
                }
                let pr = pr_number.to_string();
                let msg = render_template(
                    &settings.templates.pr_comment,
                    &format!(
                        "[PR Monitor] PR #{pr_number} \"{title}\" has review feedback: {comments_summary}"
                    ),
                    &[
                        ("pr_number", &pr),
                        ("title", title.as_str()),
                        ("comments_summary", comments_summary.as_str()),
                    ],
                );
                Some((msg, format!("pr-{pr_number}")))
            }

            CoreEvent::PrClosed {
                pr_number,
                title,
                branch,
            } => {
                if !settings.on_pr_closed {
                    return None;
                }
                let pr = pr_number.to_string();
                let msg = render_template(
                    &settings.templates.pr_closed,
                    &format!("[PR Monitor] PR #{pr_number} \"{title}\" closed (branch: {branch})"),
                    &[
                        ("pr_number", &pr),
                        ("title", title.as_str()),
                        ("branch", branch.as_str()),
                    ],
                );
                Some((msg, format!("pr-{pr_number}")))
            }

            CoreEvent::ActionPerformed {
                origin,
                action,
                summary,
            } => {
                // Don't notify the orchestrator about its own actions
                if let crate::api::ActionOrigin::Agent {
                    is_orchestrator: true,
                    ..
                } = origin
                {
                    return None;
                }
                let msg = format!("[tmai] {origin} performed {action}: {summary}");
                // Use action as pseudo-target (no specific agent)
                Some((msg, format!("action-{action}")))
            }

            _ => None,
        }
    }

    /// Check if a target agent is an orchestrator or untracked (not in state).
    ///
    /// Returns true for orchestrator agents AND for targets not found in state.
    /// Untracked agents (e.g., the user's own Claude Code session sending hooks)
    /// should not generate notifications — they would be noise that triggers
    /// unnecessary LLM responses.
    ///
    /// Handles ID mismatch between hook-sourced pane_ids (e.g. "0") and
    /// agent map keys (e.g. "main:0.0") via reverse `target_to_pane_id` lookup.
    fn is_orchestrator_or_untracked(target: &str, state: &SharedState) -> bool {
        let s = state.read();
        // Direct lookup by agent ID
        if let Some(a) = s.agents.get(target) {
            return a.is_orchestrator;
        }
        // Reverse lookup: target might be a pane_id (from hook handler) that
        // maps to a known agent via target_to_pane_id (agent_target → pane_id).
        for (agent_target, pane_id) in &s.target_to_pane_id {
            if pane_id == target {
                if let Some(agent) = s.agents.get(agent_target) {
                    return agent.is_orchestrator;
                }
            }
        }
        // Check pending orchestrators (spawned but not yet detected by poller)
        if s.pending_orchestrator_ids.contains(target) {
            return true;
        }
        true // untracked session — suppress notification
    }

    /// Gather contextual info about an agent for notification formatting
    fn agent_context(target: &str, state: &SharedState) -> AgentContext {
        let s = state.read();
        match s.agents.get(target) {
            Some(a) => AgentContext {
                display_name: a.display_name(),
                git_branch: a.git_branch.clone(),
                worktree_name: a.worktree_name.clone(),
                session_name: a.session_name.clone(),
            },
            None => AgentContext {
                display_name: target.to_string(),
                git_branch: None,
                worktree_name: None,
                session_name: None,
            },
        }
    }

    /// Build a human-readable label for the agent
    fn agent_label(ctx: &AgentContext) -> String {
        // Prefer session_name > worktree_name > display_name
        if let Some(ref name) = ctx.session_name {
            return name.clone();
        }
        if let Some(ref name) = ctx.worktree_name {
            return name.clone();
        }
        ctx.display_name.clone()
    }

    /// Append branch info line if available
    fn append_branch_info(msg: &mut String, ctx: &AgentContext) {
        if let Some(ref branch) = ctx.git_branch {
            msg.push_str(&format!("\n  Branch: {branch}"));
        }
    }

    /// Find an agent target by git branch name
    fn find_agent_by_branch(branch: &str, state: &SharedState) -> Option<String> {
        let s = state.read();
        s.agents
            .iter()
            .find(|(_, a)| a.git_branch.as_deref() == Some(branch))
            .map(|(target, _)| target.clone())
    }
}

/// Render a notification message using a custom template or the built-in default.
///
/// If `custom_template` is empty, `default_msg` is returned as-is.
/// Otherwise, `{{variable}}` placeholders in the template are expanded.
fn render_template(custom_template: &str, default_msg: &str, vars: &[(&str, &str)]) -> String {
    if custom_template.is_empty() {
        return default_msg.to_string();
    }
    let mut result = custom_template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{{{key}}}}}"), value);
    }
    result
}

/// Truncate a string to max_chars, appending "..." if truncated
fn truncate(s: &str, max_chars: usize) -> String {
    // Take first line only, then truncate
    let first_line = s.lines().next().unwrap_or(s);
    if first_line.chars().count() > max_chars {
        let truncated: String = first_line.chars().take(max_chars).collect();
        format!("{truncated}...")
    } else {
        first_line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType, MonitoredAgent};
    use crate::api::TmaiCoreBuilder;
    use crate::config::{OrchestratorNotifySettings, Settings};
    use crate::state::AppState;

    /// Helper: insert a sub-agent into state
    fn insert_agent(state: &SharedState, target: &str, is_orchestrator: bool, status: AgentStatus) {
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
        agent.is_orchestrator = is_orchestrator;
        agent.status = status;
        agent.git_branch = Some(format!("feat/{target}"));
        s.agents.insert(target.to_string(), agent);
    }

    #[test]
    fn test_truncate_short() {
        assert_eq!(truncate("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_long() {
        let long = "a".repeat(300);
        let result = truncate(&long, 200);
        assert!(result.ends_with("..."));
        // 200 chars + "..."
        assert_eq!(result.chars().count(), 203);
    }

    #[test]
    fn test_truncate_multiline() {
        let text = "First line\nSecond line\nThird line";
        assert_eq!(truncate(text, 100), "First line");
    }

    #[test]
    fn test_render_template_default() {
        let msg = render_template("", "default message", &[("name", "test")]);
        assert_eq!(msg, "default message");
    }

    #[test]
    fn test_render_template_custom() {
        let msg = render_template(
            "[action required] Agent {{name}} on {{branch}} stopped",
            "default",
            &[("name", "worker-1"), ("branch", "feat/foo")],
        );
        assert_eq!(msg, "[action required] Agent worker-1 on feat/foo stopped");
    }

    #[test]
    fn test_render_template_missing_var() {
        let msg = render_template(
            "PR #{{pr_number}} — {{missing_var}}",
            "default",
            &[("pr_number", "42")],
        );
        assert_eq!(msg, "PR #42 — {{missing_var}}");
    }

    #[test]
    fn test_agent_stopped_notification() {
        let state = AppState::shared();
        insert_agent(&state, "sub:0.0", false, AgentStatus::Idle);

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStopped {
            target: "sub:0.0".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: Some("Done implementing the feature.".to_string()),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_some());
        let (msg, source) = result.unwrap();
        assert_eq!(source, "sub:0.0");
        assert!(msg.contains("[tmai]"));
        assert!(msg.contains("has stopped"));
        assert!(msg.contains("Branch: feat/sub:0.0"));
        assert!(msg.contains("Last message: Done implementing the feature."));
    }

    #[test]
    fn test_agent_stopped_with_custom_template() {
        let state = AppState::shared();
        insert_agent(&state, "sub:0.0", false, AgentStatus::Idle);

        let mut settings = OrchestratorNotifySettings::default();
        settings.templates.agent_stopped =
            "[notice] {{name}} stopped on {{branch}}. Summary: {{summary}}".to_string();

        let event = CoreEvent::AgentStopped {
            target: "sub:0.0".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: Some("All done.".to_string()),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_some());
        let (msg, _) = result.unwrap();
        assert!(msg.starts_with("[notice]"));
        assert!(msg.contains("feat/sub:0.0"));
        assert!(msg.contains("All done."));
    }

    #[test]
    fn test_orchestrator_stopped_not_notified() {
        let state = AppState::shared();
        insert_agent(&state, "orch:0.0", true, AgentStatus::Idle);

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStopped {
            target: "orch:0.0".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: None,
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_none());
    }

    #[test]
    fn test_status_changed_to_error() {
        let state = AppState::shared();
        insert_agent(
            &state,
            "sub:0.0",
            false,
            AgentStatus::Error {
                message: "OOM".to_string(),
            },
        );

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStatusChanged {
            target: "sub:0.0".to_string(),
            old_status: "idle".to_string(),
            new_status: "error".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_some());
        let (msg, _) = result.unwrap();
        assert!(msg.contains("Error"));
    }

    #[test]
    fn test_status_changed_processing_to_idle_skipped() {
        // processing->idle is covered by AgentStopped, so skip
        let state = AppState::shared();
        insert_agent(&state, "sub:0.0", false, AgentStatus::Idle);

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStatusChanged {
            target: "sub:0.0".to_string(),
            old_status: "processing".to_string(),
            new_status: "idle".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_none());
    }

    #[test]
    fn test_disabled_on_agent_stopped_skips() {
        let state = AppState::shared();
        insert_agent(&state, "sub:0.0", false, AgentStatus::Idle);

        let mut settings = OrchestratorNotifySettings::default();
        settings.on_agent_stopped = false;

        let event = CoreEvent::AgentStopped {
            target: "sub:0.0".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: None,
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_none());
    }

    #[test]
    fn test_disabled_on_agent_error_skips() {
        let state = AppState::shared();
        insert_agent(
            &state,
            "sub:0.0",
            false,
            AgentStatus::Error {
                message: "OOM".to_string(),
            },
        );

        let mut settings = OrchestratorNotifySettings::default();
        settings.on_agent_error = false;

        let event = CoreEvent::AgentStatusChanged {
            target: "sub:0.0".to_string(),
            old_status: "idle".to_string(),
            new_status: "error".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_none());
    }

    #[test]
    fn test_ci_passed_off_by_default() {
        let settings = OrchestratorNotifySettings::default();
        let state = AppState::shared();

        let event = CoreEvent::PrCiPassed {
            pr_number: 42,
            title: "feat: stuff".to_string(),
            checks_summary: "all green".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_none(), "CI passed should be OFF by default");
    }

    #[test]
    fn test_ci_failed_on_by_default() {
        let settings = OrchestratorNotifySettings::default();
        let state = AppState::shared();

        let event = CoreEvent::PrCiFailed {
            pr_number: 42,
            title: "feat: stuff".to_string(),
            failed_details: "lint failed".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_some(), "CI failed should be ON by default");
    }

    #[test]
    fn test_pr_closed_configurable() {
        let state = AppState::shared();
        let mut settings = OrchestratorNotifySettings::default();
        settings.on_pr_closed = false;

        let event = CoreEvent::PrClosed {
            pr_number: 42,
            title: "feat: stuff".to_string(),
            branch: "feat/stuff".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(
            result.is_none(),
            "PR closed should respect on_pr_closed flag"
        );
    }

    #[test]
    fn test_rebase_conflict_notification() {
        let state = AppState::shared();
        insert_agent(&state, "sub:0.0", false, AgentStatus::Idle);
        {
            let mut s = state.write();
            s.agents.get_mut("sub:0.0").unwrap().git_branch = Some("feat/foo".to_string());
        }

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::RebaseConflict {
            branch: "feat/foo".to_string(),
            worktree_path: "/tmp/wt".to_string(),
            error: "CONFLICT in file.rs".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_some());
        let (msg, source) = result.unwrap();
        assert_eq!(source, "sub:0.0");
        assert!(msg.contains("Rebase conflict"));
        assert!(msg.contains("feat/foo"));
    }

    #[test]
    fn test_agent_label_prefers_session_name() {
        let ctx = AgentContext {
            display_name: "main:0.0".to_string(),
            git_branch: Some("feat/foo".to_string()),
            worktree_name: Some("foo-worktree".to_string()),
            session_name: Some("my-task".to_string()),
        };
        assert_eq!(OrchestratorNotifier::agent_label(&ctx), "my-task");
    }

    #[test]
    fn test_agent_label_falls_back_to_worktree() {
        let ctx = AgentContext {
            display_name: "main:0.0".to_string(),
            git_branch: None,
            worktree_name: Some("foo-worktree".to_string()),
            session_name: None,
        };
        assert_eq!(OrchestratorNotifier::agent_label(&ctx), "foo-worktree");
    }

    #[tokio::test]
    async fn test_spawn_delivers_to_orchestrator() {
        let state = AppState::shared();
        insert_agent(&state, "orch:0.0", true, AgentStatus::Idle);
        insert_agent(
            &state,
            "sub:0.0",
            false,
            AgentStatus::Processing {
                activity: crate::agents::Activity::Thinking,
            },
        );

        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let event_tx = core.event_sender();
        let event_rx = core.subscribe();
        let mut listen_rx = core.subscribe();

        let settings = Arc::new(RwLock::new(OrchestratorNotifySettings::default()));
        let _handle =
            OrchestratorNotifier::spawn(settings, state.clone(), event_rx, event_tx.clone());

        // Emit an AgentStopped event for the sub-agent
        let _ = event_tx.send(CoreEvent::AgentStopped {
            target: "sub:0.0".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: Some("All done.".to_string()),
        });

        // The notifier should emit a PromptReady for the orchestrator
        let mut found = false;
        for _ in 0..10 {
            match tokio::time::timeout(std::time::Duration::from_millis(100), listen_rx.recv())
                .await
            {
                Ok(Ok(CoreEvent::PromptReady { target, prompt })) => {
                    if target == "orch:0.0" {
                        assert!(prompt.contains("[tmai]"));
                        assert!(prompt.contains("has stopped"));
                        found = true;
                        break;
                    }
                }
                _ => continue,
            }
        }
        assert!(found, "Expected PromptReady for orchestrator");
    }

    #[test]
    fn test_action_performed_from_human_notifies() {
        let state = AppState::shared();
        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::ActionPerformed {
            origin: crate::api::ActionOrigin::webui(),
            action: "kill_agent".to_string(),
            summary: "Killed agent worker:0.1".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_some());
        let (msg, _) = result.unwrap();
        assert!(msg.contains("Human (webui)"));
        assert!(msg.contains("kill_agent"));
        assert!(msg.contains("Killed agent worker:0.1"));
    }

    #[test]
    fn test_action_performed_from_orchestrator_skipped() {
        let state = AppState::shared();
        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::ActionPerformed {
            origin: crate::api::ActionOrigin::agent("orch:0.0", true),
            action: "dispatch_issue".to_string(),
            summary: "Spawned worktree".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(
            result.is_none(),
            "Orchestrator's own actions should not trigger notification"
        );
    }

    #[test]
    fn test_action_performed_from_mcp_agent_notifies() {
        let state = AppState::shared();
        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::ActionPerformed {
            origin: crate::api::ActionOrigin::agent("mcp", false),
            action: "merge_pr".to_string(),
            summary: "Merged PR #42".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(result.is_some());
        let (msg, _) = result.unwrap();
        assert!(msg.contains("Agent (mcp)"));
        assert!(msg.contains("merge_pr"));
    }

    #[test]
    fn test_untracked_agent_stopped_not_notified() {
        // An agent not in state (e.g., user's own Claude Code session)
        // should not generate notifications
        let state = AppState::shared();
        // Don't insert any agent — "0" is untracked

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStopped {
            target: "0".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: Some("done".to_string()),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(
            result.is_none(),
            "Untracked agent stop should not generate notification"
        );
    }

    #[test]
    fn test_untracked_agent_status_change_not_notified() {
        let state = AppState::shared();
        // Don't insert agent — untracked

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStatusChanged {
            target: "unknown:0.0".to_string(),
            old_status: "idle".to_string(),
            new_status: "error".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(
            result.is_none(),
            "Untracked agent status change should not generate notification"
        );
    }

    #[test]
    fn test_orchestrator_stopped_via_pane_id_not_notified() {
        // Simulate: orchestrator registered as "main:0.0" but AgentStopped
        // target is pane_id "5" (from hook handler). The reverse lookup via
        // target_to_pane_id should identify the orchestrator and suppress.
        let state = AppState::shared();
        insert_agent(&state, "main:0.0", true, AgentStatus::Idle);
        {
            let mut s = state.write();
            s.target_to_pane_id
                .insert("main:0.0".to_string(), "5".to_string());
        }

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStopped {
            target: "5".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: Some("done".to_string()),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(
            result.is_none(),
            "Orchestrator stop via pane_id should be suppressed"
        );
    }

    #[test]
    fn test_orchestrator_status_changed_via_pane_id_not_notified() {
        // Same pane_id mismatch scenario but for AgentStatusChanged
        let state = AppState::shared();
        insert_agent(
            &state,
            "main:0.0",
            true,
            AgentStatus::Error {
                message: "OOM".to_string(),
            },
        );
        {
            let mut s = state.write();
            s.target_to_pane_id
                .insert("main:0.0".to_string(), "5".to_string());
        }

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStatusChanged {
            target: "5".to_string(),
            old_status: "idle".to_string(),
            new_status: "error".to_string(),
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(
            result.is_none(),
            "Orchestrator status change via pane_id should be suppressed"
        );
    }

    #[test]
    fn test_pending_orchestrator_stopped_not_notified() {
        // Agent not yet detected by poller but queued in pending_orchestrator_ids
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.pending_orchestrator_ids
                .insert("pending-orch".to_string());
        }

        let settings = OrchestratorNotifySettings::default();
        let event = CoreEvent::AgentStopped {
            target: "pending-orch".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: None,
        };

        let result = OrchestratorNotifier::build_notification(&event, &settings, &state);
        assert!(
            result.is_none(),
            "Pending orchestrator stop should be suppressed"
        );
    }

    #[tokio::test]
    async fn test_spawn_does_not_deliver_to_self_via_pane_id() {
        // Orchestrator "main:0.0" with pane_id "5". A non-orchestrator sub-agent
        // event with source_target "5" should NOT be delivered to "main:0.0"
        // because "5" is that orchestrator's pane_id.
        let state = AppState::shared();
        insert_agent(&state, "main:0.0", true, AgentStatus::Idle);
        insert_agent(&state, "sub:0.1", false, AgentStatus::Idle);
        {
            let mut s = state.write();
            s.target_to_pane_id
                .insert("main:0.0".to_string(), "5".to_string());
        }

        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let event_tx = core.event_sender();
        let event_rx = core.subscribe();
        let mut listen_rx = core.subscribe();

        let settings = Arc::new(RwLock::new(OrchestratorNotifySettings::default()));
        let _handle =
            OrchestratorNotifier::spawn(settings, state.clone(), event_rx, event_tx.clone());

        // Emit AgentStopped with pane_id "5" (same as orchestrator's pane_id)
        let _ = event_tx.send(CoreEvent::AgentStopped {
            target: "5".to_string(),
            cwd: "/tmp".to_string(),
            last_assistant_message: Some("done".to_string()),
        });

        // The notifier should NOT emit PromptReady for the orchestrator
        let mut found_prompt = false;
        for _ in 0..10 {
            match tokio::time::timeout(std::time::Duration::from_millis(50), listen_rx.recv()).await
            {
                Ok(Ok(CoreEvent::PromptReady { target, .. })) => {
                    if target == "main:0.0" {
                        found_prompt = true;
                        break;
                    }
                }
                _ => continue,
            }
        }
        assert!(
            !found_prompt,
            "Orchestrator should NOT receive its own stop notification via pane_id"
        );
    }
}
