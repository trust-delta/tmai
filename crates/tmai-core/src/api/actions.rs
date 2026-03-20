//! Action methods on [`TmaiCore`].
//!
//! These methods perform side-effects (send keys, focus panes, etc.) and
//! centralise logic that was previously duplicated across TUI and Web.

use crate::agents::{AgentStatus, ApprovalType};
use crate::detectors::get_detector;

use super::core::TmaiCore;
use super::types::ApiError;

/// Maximum text length for send_text
const MAX_TEXT_LENGTH: usize = 1024;

/// Allowed special key names for send_key
const ALLOWED_KEYS: &[&str] = &[
    "Enter", "Escape", "Space", "Up", "Down", "Left", "Right", "Tab", "BSpace",
];

/// Check if choices use checkbox format ([ ], [x], [X], [×], [✔])
pub fn has_checkbox_format(choices: &[String]) -> bool {
    choices.iter().any(|c| {
        let t = c.trim();
        t.starts_with("[ ]")
            || t.starts_with("[x]")
            || t.starts_with("[X]")
            || t.starts_with("[×]")
            || t.starts_with("[✔]")
    })
}

impl TmaiCore {
    // =========================================================
    // Helper: get command sender or error
    // =========================================================

    /// Return the command sender, or `ApiError::NoCommandSender`
    fn require_command_sender(
        &self,
    ) -> Result<&std::sync::Arc<crate::command_sender::CommandSender>, ApiError> {
        self.command_sender_ref().ok_or(ApiError::NoCommandSender)
    }

    // =========================================================
    // Agent actions
    // =========================================================

    /// Approve an agent action (send approval keys based on agent type).
    ///
    /// Returns `Ok(())` if approval was sent or the agent was already not awaiting.
    pub fn approve(&self, target: &str) -> Result<(), ApiError> {
        let (is_awaiting, agent_type, is_virtual) = {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) => (
                    matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                    a.agent_type.clone(),
                    a.is_virtual,
                ),
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    })
                }
            }
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent {
                target: target.to_string(),
            });
        }

        if !is_awaiting {
            // Already handled — idempotent success
            return Ok(());
        }

        let cmd = self.require_command_sender()?;
        let detector = get_detector(&agent_type);
        cmd.send_keys(target, detector.approval_keys())?;
        Ok(())
    }

    /// Select a choice for a UserQuestion prompt.
    ///
    /// `choice` is 1-indexed (1 = first option, N+1 = "Other").
    pub fn select_choice(&self, target: &str, choice: usize) -> Result<(), ApiError> {
        // Virtual agents cannot receive key input
        {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) if a.is_virtual => {
                    return Err(ApiError::VirtualAgent {
                        target: target.to_string(),
                    });
                }
                Some(_) => {}
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    });
                }
            }
        }

        let question_info = {
            let state = self.state().read();
            state.agents.get(target).and_then(|agent| {
                if let AgentStatus::AwaitingApproval {
                    approval_type:
                        ApprovalType::UserQuestion {
                            choices,
                            multi_select,
                            cursor_position,
                        },
                    ..
                } = &agent.status
                {
                    Some((choices.clone(), *multi_select, *cursor_position))
                } else {
                    None
                }
            })
        };

        match question_info {
            Some((choices, multi_select, cursor_pos))
                if choice >= 1 && choice <= choices.len() + 1 =>
            {
                let cmd = self.require_command_sender()?;
                let cursor = if cursor_pos == 0 { 1 } else { cursor_pos };
                let steps = choice as i32 - cursor as i32;
                let key = if steps > 0 { "Down" } else { "Up" };
                for _ in 0..steps.unsigned_abs() {
                    cmd.send_keys(target, key)?;
                }

                // Confirm: single-select always, multi-select only for checkbox toggle
                if !multi_select || has_checkbox_format(&choices) {
                    cmd.send_keys(target, "Enter")?;
                }

                Ok(())
            }
            Some(_) => Err(ApiError::InvalidInput {
                message: "Invalid choice number".to_string(),
            }),
            // Agent exists but not in UserQuestion state — idempotent Ok
            None => Ok(()),
        }
    }

    /// Submit multi-select choices (checkbox or legacy format).
    ///
    /// `selected_choices` is a list of 1-indexed choice numbers.
    pub fn submit_selection(
        &self,
        target: &str,
        selected_choices: &[usize],
    ) -> Result<(), ApiError> {
        // Virtual agents cannot receive key input
        {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) if a.is_virtual => {
                    return Err(ApiError::VirtualAgent {
                        target: target.to_string(),
                    });
                }
                Some(_) => {}
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    });
                }
            }
        }

        let multi_info = {
            let state = self.state().read();
            state.agents.get(target).and_then(|agent| {
                if let AgentStatus::AwaitingApproval {
                    approval_type:
                        ApprovalType::UserQuestion {
                            choices,
                            multi_select: true,
                            cursor_position,
                        },
                    ..
                } = &agent.status
                {
                    Some((choices.clone(), *cursor_position))
                } else {
                    None
                }
            })
        };

        match multi_info {
            Some((choices, cursor_pos)) => {
                let cmd = self.require_command_sender()?;
                let is_checkbox = has_checkbox_format(&choices);

                if is_checkbox && !selected_choices.is_empty() {
                    // Checkbox format: navigate to each selected choice and toggle
                    let mut sorted: Vec<usize> = selected_choices
                        .iter()
                        .copied()
                        .filter(|&c| c >= 1 && c <= choices.len())
                        .collect();
                    if sorted.is_empty() {
                        return Err(ApiError::InvalidInput {
                            message: "No valid choices".to_string(),
                        });
                    }
                    sorted.sort();
                    let mut current_pos = if cursor_pos == 0 { 1 } else { cursor_pos };

                    for &choice in &sorted {
                        let steps = choice as i32 - current_pos as i32;
                        let key = if steps > 0 { "Down" } else { "Up" };
                        for _ in 0..steps.unsigned_abs() {
                            cmd.send_keys(target, key)?;
                        }
                        // Enter to toggle checkbox
                        cmd.send_keys(target, "Enter")?;
                        current_pos = choice;
                    }
                    // Right + Enter to submit
                    cmd.send_keys(target, "Right")?;
                    cmd.send_keys(target, "Enter")?;
                } else {
                    // Legacy format: navigate past all choices then Enter
                    let downs_needed = choices.len().saturating_sub(cursor_pos.saturating_sub(1));
                    for _ in 0..downs_needed {
                        cmd.send_keys(target, "Down")?;
                    }
                    cmd.send_keys(target, "Enter")?;
                }
                Ok(())
            }
            // Agent exists but not in multi-select UserQuestion state — idempotent Ok
            None => Ok(()),
        }
    }

    /// Send text input to an agent followed by Enter.
    ///
    /// Includes a 50ms delay between text and Enter to prevent paste-burst issues.
    pub async fn send_text(&self, target: &str, text: &str) -> Result<(), ApiError> {
        if text.chars().count() > MAX_TEXT_LENGTH {
            return Err(ApiError::InvalidInput {
                message: format!(
                    "Text exceeds maximum length of {} characters",
                    MAX_TEXT_LENGTH
                ),
            });
        }

        let is_virtual = {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) => a.is_virtual,
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    })
                }
            }
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent {
                target: target.to_string(),
            });
        }

        let cmd = self.require_command_sender()?;
        cmd.send_keys_literal(target, text)?;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        cmd.send_keys(target, "Enter")?;

        self.audit_helper()
            .maybe_emit_input(target, "input_text", "api_input", None);

        Ok(())
    }

    /// Send a special key to an agent (whitelist-validated).
    pub fn send_key(&self, target: &str, key: &str) -> Result<(), ApiError> {
        if !ALLOWED_KEYS.contains(&key) {
            return Err(ApiError::InvalidInput {
                message: "Invalid key name".to_string(),
            });
        }

        let (is_virtual, has_pty) = {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) => (a.is_virtual, a.pty_session_id.is_some()),
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    })
                }
            }
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent {
                target: target.to_string(),
            });
        }

        // PTY-spawned agents: write directly to PTY session
        if has_pty {
            if let Some(session) = self.pty_registry().get(target) {
                let data = crate::utils::keys::tmux_key_to_bytes(key);
                session.write_input(&data).map_err(ApiError::CommandError)?;
            } else {
                // PTY session gone — agent may have exited
                return Err(ApiError::CommandError(anyhow::anyhow!(
                    "PTY session not found for agent"
                )));
            }
        } else {
            let cmd = self.require_command_sender()?;
            cmd.send_keys(target, key)?;
        }

        self.audit_helper()
            .maybe_emit_input(target, "special_key", "api_input", None);

        Ok(())
    }

    /// Focus on a specific pane in tmux
    pub fn focus_pane(&self, target: &str) -> Result<(), ApiError> {
        // Validate agent exists and is not virtual
        {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) if a.is_virtual => {
                    return Err(ApiError::VirtualAgent {
                        target: target.to_string(),
                    });
                }
                Some(_) => {}
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    });
                }
            }
        }

        let cmd = self.require_command_sender()?;
        cmd.runtime().focus_pane(target)?;
        Ok(())
    }

    /// Request a fresh-session code review for a specific agent.
    ///
    /// Directly launches a review session in a new tmux window (blocking I/O
    /// is offloaded to `spawn_blocking`). Works regardless of `review.enabled`.
    pub fn request_review(&self, target: &str) -> Result<(), ApiError> {
        let (cwd, branch) = {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) => (a.cwd.clone(), a.git_branch.clone()),
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    })
                }
            }
        };

        let request = crate::review::ReviewRequest {
            target: target.to_string(),
            cwd,
            branch,
            base_branch: self.settings().review.base_branch.clone(),
            last_message: None,
        };

        let settings = self.settings().review.clone();
        let event_tx = self.event_sender();
        let req_target = request.target.clone();

        tokio::task::spawn_blocking(move || {
            match crate::review::service::launch_review(&request, &settings, None) {
                Ok((review_target, output_file)) => {
                    tracing::info!(
                        source_target = %req_target,
                        review_target = %review_target,
                        output = %output_file.display(),
                        "Review session launched"
                    );
                    let _ = event_tx.send(super::events::CoreEvent::ReviewLaunched {
                        source_target: req_target,
                        review_target,
                    });
                }
                Err(e) => {
                    tracing::warn!(target = %req_target, %e, "Failed to launch review");
                }
            }
        });

        Ok(())
    }

    // =========================================================
    // Worktree actions
    // =========================================================

    /// List all worktrees from state as owned snapshots
    pub fn list_worktrees(&self) -> Vec<super::types::WorktreeSnapshot> {
        let state = self.state().read();
        let mut snapshots = Vec::new();
        for repo in &state.worktree_info {
            for wt in &repo.worktrees {
                snapshots.push(super::types::WorktreeSnapshot::from_detail(
                    &repo.repo_name,
                    &repo.repo_path,
                    wt,
                ));
            }
        }
        snapshots
    }

    /// Create a new git worktree, then optionally run setup commands
    pub async fn create_worktree(
        &self,
        req: &crate::worktree::WorktreeCreateRequest,
    ) -> Result<crate::worktree::types::WorktreeCreateResult, ApiError> {
        let result = crate::worktree::create_worktree(req).await?;

        // Emit event
        let _ = self
            .event_sender()
            .send(super::events::CoreEvent::WorktreeCreated {
                target: result.path.clone(),
                worktree: Some(crate::hooks::types::WorktreeInfo {
                    name: Some(result.branch.clone()),
                    path: Some(result.path.clone()),
                    branch: Some(result.branch.clone()),
                    original_repo: Some(req.repo_path.clone()),
                }),
            });

        // Spawn setup commands in background if configured
        let setup_commands = self.settings().worktree.setup_commands.clone();
        if !setup_commands.is_empty() {
            let timeout = self.settings().worktree.setup_timeout_secs;
            let wt_path = result.path.clone();
            let branch = result.branch.clone();
            let event_tx = self.event_sender();
            tokio::spawn(async move {
                match crate::worktree::run_setup_commands(&wt_path, &setup_commands, timeout).await
                {
                    Ok(()) => {
                        tracing::info!(
                            worktree = wt_path,
                            branch = branch,
                            "Worktree setup completed"
                        );
                        let _ = event_tx.send(super::events::CoreEvent::WorktreeSetupCompleted {
                            worktree_path: wt_path,
                            branch,
                        });
                    }
                    Err(e) => {
                        tracing::warn!(
                            worktree = wt_path,
                            branch = branch,
                            error = %e,
                            "Worktree setup failed"
                        );
                        let _ = event_tx.send(super::events::CoreEvent::WorktreeSetupFailed {
                            worktree_path: wt_path,
                            branch,
                            error: e,
                        });
                    }
                }
            });
        }

        Ok(result)
    }

    /// Fetch full diff for a worktree (on-demand, for diff viewer)
    pub async fn get_worktree_diff(
        &self,
        worktree_path: &str,
        base_branch: &str,
    ) -> Result<(Option<String>, Option<crate::git::DiffSummary>), ApiError> {
        let diff = crate::git::fetch_full_diff(worktree_path, base_branch).await;
        let summary = crate::git::fetch_diff_stat(worktree_path, base_branch).await;
        Ok((diff, summary))
    }

    /// Delete a git worktree
    ///
    /// Checks for running agents and uncommitted changes before removal.
    pub async fn delete_worktree(
        &self,
        req: &crate::worktree::WorktreeDeleteRequest,
    ) -> Result<(), ApiError> {
        // Check for running agents in this worktree
        {
            let state = self.state().read();
            let worktree_path = std::path::Path::new(&req.repo_path)
                .join(".claude")
                .join("worktrees")
                .join(&req.worktree_name);
            let wt_path_str = worktree_path.to_string_lossy().to_string();

            for repo in &state.worktree_info {
                for wt in &repo.worktrees {
                    if wt.path == wt_path_str && wt.agent_target.is_some() {
                        return Err(ApiError::WorktreeError(
                            crate::worktree::WorktreeOpsError::AgentStillRunning(
                                req.worktree_name.clone(),
                            ),
                        ));
                    }
                }
            }
        }

        crate::worktree::delete_worktree(req).await?;

        // Emit event
        let worktree_path = std::path::Path::new(&req.repo_path)
            .join(".claude")
            .join("worktrees")
            .join(&req.worktree_name)
            .to_string_lossy()
            .to_string();
        let _ = self
            .event_sender()
            .send(super::events::CoreEvent::WorktreeRemoved {
                target: worktree_path,
                worktree: Some(crate::hooks::types::WorktreeInfo {
                    name: Some(req.worktree_name.clone()),
                    path: None,
                    branch: None,
                    original_repo: Some(req.repo_path.clone()),
                }),
            });

        Ok(())
    }

    /// Launch an agent in a worktree via tmux
    ///
    /// Creates a new tmux window in the worktree directory and starts the agent.
    /// Returns the new pane target identifier.
    pub fn launch_agent_in_worktree(
        &self,
        worktree_path: &str,
        agent_type: &crate::agents::AgentType,
        session: Option<&str>,
    ) -> Result<String, ApiError> {
        let cmd = self.require_command_sender()?;
        let rt = cmd.runtime();

        // Determine session to use (prefer first agent in display order for determinism)
        let session_name = session
            .map(|s| s.to_string())
            .or_else(|| {
                let state = self.state().read();
                state
                    .agent_order
                    .first()
                    .and_then(|key| state.agents.get(key))
                    .map(|a| a.session.clone())
            })
            .unwrap_or_else(|| "main".to_string());

        // Create a new window in the worktree directory
        let window_name = agent_type.short_name();
        let target = rt.new_window(&session_name, worktree_path, Some(window_name))?;

        // Build the launch command based on agent type
        let launch_cmd = match agent_type {
            crate::agents::AgentType::ClaudeCode => {
                // Extract worktree name from path for --worktree flag
                let wt_name = crate::git::extract_claude_worktree_name(worktree_path);
                match wt_name {
                    Some(name) if crate::git::is_valid_worktree_name(&name) => {
                        format!("claude --worktree {}", name)
                    }
                    _ => "claude".to_string(),
                }
            }
            crate::agents::AgentType::CodexCli => "codex".to_string(),
            crate::agents::AgentType::GeminiCli => "gemini".to_string(),
            crate::agents::AgentType::OpenCode => "opencode".to_string(),
            crate::agents::AgentType::Custom(name) => name.clone(),
        };

        // Run via tmai wrap for PTY monitoring
        rt.run_command_wrapped(&target, &launch_cmd)?;

        tracing::info!(
            worktree = worktree_path,
            agent = %agent_type.short_name(),
            target = %target,
            "Launched agent in worktree"
        );

        Ok(target)
    }

    /// Kill a specific agent (PTY session or tmux pane)
    pub fn kill_pane(&self, target: &str) -> Result<(), ApiError> {
        // Validate agent exists and is not virtual
        let has_pty = {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) if a.is_virtual => {
                    return Err(ApiError::VirtualAgent {
                        target: target.to_string(),
                    });
                }
                Some(a) => a.pty_session_id.is_some(),
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    });
                }
            }
        };

        if has_pty {
            // PTY-spawned agent: kill the child process
            if let Some(session) = self.pty_registry().get(target) {
                session.kill();
            }
            // Remove from agent list
            {
                let mut state = self.state().write();
                state.agents.remove(target);
                state.agent_order.retain(|id| id != target);
            }
            self.notify_agents_updated();
            Ok(())
        } else {
            let cmd = self.require_command_sender()?;
            cmd.runtime().kill_pane(target)?;
            Ok(())
        }
    }

    /// Sync PTY-spawned agent statuses with actual PTY session liveness
    /// and hook registry state.
    ///
    /// - Hook status available: apply hook-derived status (highest fidelity)
    /// - Running sessions without hooks: set to `Processing`
    /// - Dead sessions: set to `Offline` and clean up from registry
    ///
    /// Returns true if any agent status was changed.
    pub fn sync_pty_sessions(&self) -> bool {
        let dead_ids = self.pty_registry().cleanup_dead();
        let mut changed = false;

        // Read hook states for PTY agents
        let hook_reg = self.hook_registry().read();

        let mut state = self.state().write();
        for (id, agent) in state.agents.iter_mut() {
            if agent.pty_session_id.is_none() {
                continue;
            }

            if dead_ids.contains(id) {
                // Process exited — set Offline and clean up mappings
                agent.status = crate::agents::AgentStatus::Offline;
                changed = true;
                // Remove from session_pane_map to prevent stale routing
                if let Some(sid) = &agent.pty_session_id {
                    let mut spm = self.session_pane_map().write();
                    spm.remove(sid);
                }
                continue;
            }

            // Try to apply hook-derived status.
            // PTY agent's ID is a session_id (UUID), but HookRegistry keys are
            // pane_ids from resolve_pane_id(). Try: direct match, then
            // session_pane_map lookup, then scan by session_id.
            let hook_state_ref = hook_reg
                .get(id)
                .or_else(|| {
                    // Lookup via session_pane_map (session_id → pane_id)
                    let spm = self.session_pane_map().read();
                    let sid = agent.pty_session_id.as_deref().unwrap_or(id);
                    spm.get(sid).and_then(|pane_id| hook_reg.get(pane_id))
                })
                .or_else(|| {
                    // Scan HookRegistry for matching session_id
                    let sid = agent.pty_session_id.as_deref().unwrap_or(id);
                    hook_reg.values().find(|hs| hs.session_id == sid)
                });
            if let Some(hook_state) = hook_state_ref {
                let new_status = crate::hooks::handler::hook_status_to_agent_status(hook_state);
                if agent.status != new_status {
                    agent.status = new_status;
                    agent.detection_source = crate::agents::DetectionSource::HttpHook;
                    changed = true;
                }
                // Update last_content from activity log
                let activity = crate::hooks::handler::format_activity_log(&hook_state.activity_log);
                if !activity.is_empty() && agent.last_content != activity {
                    agent.last_content = activity;
                    changed = true;
                }
                continue;
            }

            // No hook state — detect status from PTY scrollback (capture-pane equivalent)
            if let Some(session) = self.pty_registry().get(id) {
                let snapshot = session.scrollback_snapshot();
                let raw_text = String::from_utf8_lossy(&snapshot);
                // Take last ~4KB for detection (equivalent to capture-pane last N lines)
                let tail = if raw_text.len() > 4096 {
                    let start = raw_text.floor_char_boundary(raw_text.len() - 4096);
                    &raw_text[start..]
                } else {
                    &raw_text
                };
                let content = crate::utils::strip_ansi(tail);
                let detector = crate::detectors::get_detector(&agent.agent_type);
                let new_status = detector.detect_status("", &content);
                if agent.status != new_status {
                    agent.status = new_status;
                    agent.detection_source = crate::agents::DetectionSource::CapturePane;
                    changed = true;
                }
                // Update last_content for preview
                if agent.last_content != content {
                    agent.last_content = content;
                    changed = true;
                }
            }
        }

        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentType, MonitoredAgent};
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
    fn test_has_checkbox_format() {
        assert!(has_checkbox_format(&[
            "[ ] Option A".to_string(),
            "[ ] Option B".to_string(),
        ]));
        assert!(has_checkbox_format(&[
            "[x] Option A".to_string(),
            "[ ] Option B".to_string(),
        ]));
        assert!(has_checkbox_format(&[
            "[✔] Done".to_string(),
            "[ ] Not done".to_string(),
        ]));
        assert!(!has_checkbox_format(&[
            "Option A".to_string(),
            "Option B".to_string(),
        ]));
        assert!(!has_checkbox_format(&[]));
    }

    #[test]
    fn test_approve_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.approve("nonexistent");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_approve_virtual_agent() {
        let mut agent = test_agent(
            "main:0.0",
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::FileEdit,
                details: "edit foo.rs".to_string(),
            },
        );
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.approve("main:0.0");
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[test]
    fn test_approve_not_awaiting_is_ok() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        // No command sender, but should return Ok since not awaiting
        let result = core.approve("main:0.0");
        assert!(result.is_ok());
    }

    #[test]
    fn test_approve_awaiting_no_command_sender() {
        let agent = test_agent(
            "main:0.0",
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::ShellCommand,
                details: "rm -rf".to_string(),
            },
        );
        let core = make_core_with_agents(vec![agent]);
        let result = core.approve("main:0.0");
        assert!(matches!(result, Err(ApiError::NoCommandSender)));
    }

    #[test]
    fn test_send_key_invalid() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        let result = core.send_key("main:0.0", "Delete");
        assert!(matches!(result, Err(ApiError::InvalidInput { .. })));
    }

    #[test]
    fn test_send_key_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.send_key("nonexistent", "Enter");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_send_key_virtual_agent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.send_key("main:0.0", "Enter");
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[test]
    fn test_select_choice_not_in_question() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        // Agent exists but not in UserQuestion state — idempotent Ok
        let result = core.select_choice("main:0.0", 1);
        assert!(result.is_ok());
    }

    #[test]
    fn test_select_choice_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.select_choice("nonexistent", 1);
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_select_choice_virtual_agent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.select_choice("main:0.0", 1);
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[test]
    fn test_select_choice_invalid_number() {
        let agent = test_agent(
            "main:0.0",
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::UserQuestion {
                    choices: vec!["A".to_string(), "B".to_string()],
                    multi_select: false,
                    cursor_position: 1,
                },
                details: "Pick one".to_string(),
            },
        );
        let core = make_core_with_agents(vec![agent]);
        // choice 0 is invalid (1-indexed)
        let result = core.select_choice("main:0.0", 0);
        assert!(matches!(result, Err(ApiError::InvalidInput { .. })));
        // choice 4 is invalid (only 2 choices + 1 Other = max 3)
        let result = core.select_choice("main:0.0", 4);
        assert!(matches!(result, Err(ApiError::InvalidInput { .. })));
    }

    #[tokio::test]
    async fn test_send_text_too_long() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        let long_text = "x".repeat(1025);
        let result = core.send_text("main:0.0", &long_text).await;
        assert!(matches!(result, Err(ApiError::InvalidInput { .. })));
    }

    #[tokio::test]
    async fn test_send_text_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.send_text("nonexistent", "hello").await;
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[tokio::test]
    async fn test_send_text_virtual_agent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.send_text("main:0.0", "hello").await;
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[tokio::test]
    async fn test_send_text_at_max_length() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        // MAX_TEXT_LENGTH chars exactly should pass validation (fail at NoCommandSender)
        let text = "x".repeat(MAX_TEXT_LENGTH);
        let result = core.send_text("main:0.0", &text).await;
        assert!(!matches!(result, Err(ApiError::InvalidInput { .. })));
    }

    #[test]
    fn test_focus_pane_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.focus_pane("nonexistent");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_focus_pane_virtual_agent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.focus_pane("main:0.0");
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[test]
    fn test_kill_pane_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.kill_pane("nonexistent");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_kill_pane_virtual_agent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.kill_pane("main:0.0");
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[test]
    fn test_submit_selection_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.submit_selection("nonexistent", &[1]);
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_submit_selection_virtual_agent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.submit_selection("main:0.0", &[1]);
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[test]
    fn test_submit_selection_not_in_multiselect() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        // Agent exists but not in multi-select state — idempotent Ok
        let result = core.submit_selection("main:0.0", &[1]);
        assert!(result.is_ok());
    }
}
