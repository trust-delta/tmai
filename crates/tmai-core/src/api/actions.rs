//! Action methods on [`TmaiCore`].
//!
//! These methods perform side-effects (send keys, focus panes, etc.) and
//! centralise logic that was previously duplicated across TUI and Web.

use crate::agents::{AgentStatus, ApprovalType};
use crate::detectors::get_detector;

use super::core::TmaiCore;
use super::types::{ApiError, SendPromptResult};

/// Maximum text length for send_text / send_prompt (32KB)
const MAX_TEXT_LENGTH: usize = 32_768;

/// Maximum number of queued prompts per agent
const MAX_PROMPT_QUEUE_SIZE: usize = 5;

/// Allowed special key names for send_key
const ALLOWED_KEYS: &[&str] = &[
    "Enter", "Escape", "Space", "Up", "Down", "Left", "Right", "Tab", "BTab", "BSpace",
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
    pub fn approve(&self, id: &str) -> Result<(), ApiError> {
        let target = self.resolve_agent_key(id)?;
        let (is_awaiting, agent_type, is_virtual) = {
            let state = self.state().read();
            let a = state.agents.get(&target).unwrap();
            (
                matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                a.agent_type.clone(),
                a.is_virtual,
            )
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent { target });
        }

        if !is_awaiting {
            return Ok(());
        }

        let cmd = self.require_command_sender()?;
        let detector = get_detector(&agent_type);
        cmd.send_keys(&target, detector.approval_keys())?;
        Ok(())
    }

    /// Select a choice for a UserQuestion prompt.
    ///
    /// `choice` is 1-indexed (1 = first option, N+1 = "Other").
    pub fn select_choice(&self, id: &str, choice: usize) -> Result<(), ApiError> {
        let target = self.resolve_agent_key(id)?;
        // Virtual agents cannot receive key input
        {
            let state = self.state().read();
            let a = state.agents.get(&target).unwrap();
            if a.is_virtual {
                return Err(ApiError::VirtualAgent { target });
            }
        }

        let question_info = {
            let state = self.state().read();
            state.agents.get(&target).and_then(|agent| {
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
                    cmd.send_keys(&target, key)?;
                }

                // Confirm: single-select always, multi-select only for checkbox toggle
                if !multi_select || has_checkbox_format(&choices) {
                    cmd.send_keys(&target, "Enter")?;
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
    pub fn submit_selection(&self, id: &str, selected_choices: &[usize]) -> Result<(), ApiError> {
        let target = self.resolve_agent_key(id)?;
        // Virtual agents cannot receive key input
        {
            let state = self.state().read();
            let a = state.agents.get(&target).unwrap();
            if a.is_virtual {
                return Err(ApiError::VirtualAgent { target });
            }
        }

        let multi_info = {
            let state = self.state().read();
            state.agents.get(&target).and_then(|agent| {
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
                            cmd.send_keys(&target, key)?;
                        }
                        // Enter to toggle checkbox
                        cmd.send_keys(&target, "Enter")?;
                        current_pos = choice;
                    }
                    // Right + Enter to submit
                    cmd.send_keys(&target, "Right")?;
                    cmd.send_keys(&target, "Enter")?;
                } else {
                    // Legacy format: navigate past all choices then Enter
                    let downs_needed = choices.len().saturating_sub(cursor_pos.saturating_sub(1));
                    for _ in 0..downs_needed {
                        cmd.send_keys(&target, "Down")?;
                    }
                    cmd.send_keys(&target, "Enter")?;
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
    pub async fn send_text(&self, id: &str, text: &str) -> Result<(), ApiError> {
        if text.chars().count() > MAX_TEXT_LENGTH {
            return Err(ApiError::InvalidInput {
                message: format!(
                    "Text exceeds maximum length of {} characters",
                    MAX_TEXT_LENGTH
                ),
            });
        }

        let target = self.resolve_agent_key(id)?;
        let is_virtual = {
            let state = self.state().read();
            state.agents.get(&target).unwrap().is_virtual
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent { target });
        }

        let cmd = self.require_command_sender()?;
        cmd.send_keys_literal(&target, text)?;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        cmd.send_keys(&target, "Enter")?;

        self.audit_helper()
            .maybe_emit_input(&target, "input_text", "api_input", None);

        Ok(())
    }

    /// Send a prompt to an agent with status-aware behavior.
    ///
    /// - **Idle**: sends the prompt immediately (text + Enter).
    /// - **Offline** (stopped): sends the prompt to restart the agent.
    /// - **Processing**: queues the prompt (max 5); delivered when agent becomes Idle.
    /// - **Other** (AwaitingApproval, Error, Unknown): queues like Processing.
    ///
    /// Returns a JSON-serializable status indicating the action taken.
    pub async fn send_prompt(&self, id: &str, prompt: &str) -> Result<SendPromptResult, ApiError> {
        if prompt.chars().count() > MAX_TEXT_LENGTH {
            return Err(ApiError::InvalidInput {
                message: format!(
                    "Prompt exceeds maximum length of {} characters",
                    MAX_TEXT_LENGTH
                ),
            });
        }

        let target = self.resolve_agent_key(id)?;
        let (status, is_virtual) = {
            let state = self.state().read();
            let a = state.agents.get(&target).unwrap();
            (a.status.clone(), a.is_virtual)
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent { target });
        }

        match status {
            AgentStatus::Idle | AgentStatus::Offline => {
                self.send_text(&target, prompt).await?;
                let action = if status.is_idle() {
                    "sent"
                } else {
                    "sent_restart"
                };
                Ok(SendPromptResult {
                    action: action.to_string(),
                    queue_size: 0,
                })
            }
            _ => {
                let queue_size = {
                    let mut state = self.state().write();
                    let queue = state.prompt_queue.entry(target.to_string()).or_default();
                    if queue.len() >= MAX_PROMPT_QUEUE_SIZE {
                        return Err(ApiError::InvalidInput {
                            message: format!(
                                "Prompt queue full (max {} per agent)",
                                MAX_PROMPT_QUEUE_SIZE
                            ),
                        });
                    }
                    queue.push_back(prompt.to_string());
                    queue.len()
                };
                Ok(SendPromptResult {
                    action: "queued".to_string(),
                    queue_size,
                })
            }
        }
    }

    /// Send a special key to an agent (whitelist-validated).
    pub fn send_key(&self, id: &str, key: &str) -> Result<(), ApiError> {
        if !ALLOWED_KEYS.contains(&key) {
            return Err(ApiError::InvalidInput {
                message: "Invalid key name".to_string(),
            });
        }

        let target = self.resolve_agent_key(id)?;
        let (is_virtual, has_pty) = {
            let state = self.state().read();
            let a = state.agents.get(&target).unwrap();
            (a.is_virtual, a.pty_session_id.is_some())
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent { target });
        }

        if has_pty {
            if let Some(session) = self.pty_registry().get(&target) {
                let data = crate::utils::keys::tmux_key_to_bytes(key);
                session.write_input(&data).map_err(ApiError::CommandError)?;
            } else {
                return Err(ApiError::CommandError(anyhow::anyhow!(
                    "PTY session not found for agent"
                )));
            }
        } else {
            let cmd = self.require_command_sender()?;
            cmd.send_keys(&target, key)?;
        }

        self.audit_helper()
            .maybe_emit_input(&target, "special_key", "api_input", None);

        Ok(())
    }

    /// Toggle per-agent auto-approve override.
    ///
    /// - `None` → follow global setting (default)
    /// - `Some(true)` → force enabled for this agent
    /// - `Some(false)` → force disabled for this agent
    pub fn set_auto_approve_override(
        &self,
        id: &str,
        enabled: Option<bool>,
    ) -> Result<(), ApiError> {
        let target = self.resolve_agent_key(id)?;
        let mut state = self.state().write();
        state.agents.get_mut(&target).unwrap().auto_approve_override = enabled;
        Ok(())
    }

    /// Focus on a specific pane in tmux
    pub fn focus_pane(&self, id: &str) -> Result<(), ApiError> {
        let target = self.resolve_agent_key(id)?;
        {
            let state = self.state().read();
            let a = state.agents.get(&target).unwrap();
            if a.is_virtual {
                return Err(ApiError::VirtualAgent { target });
            }
        }

        let cmd = self.require_command_sender()?;
        cmd.runtime().focus_pane(&target)?;
        Ok(())
    }

    /// Request a fresh-session code review for a specific agent.
    ///
    /// Directly launches a review session in a new tmux window (blocking I/O
    /// is offloaded to `spawn_blocking`). Works regardless of `review.enabled`.
    pub fn request_review(&self, id: &str) -> Result<(), ApiError> {
        let target = self.resolve_agent_key(id)?;
        let (cwd, branch) = {
            let state = self.state().read();
            let a = state.agents.get(&target).unwrap();
            (a.cwd.clone(), a.git_branch.clone())
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
    /// When force is true, kills the associated agent pane before deletion.
    pub async fn delete_worktree(
        &self,
        req: &crate::worktree::WorktreeDeleteRequest,
    ) -> Result<(), ApiError> {
        let worktree_path = std::path::Path::new(&req.repo_path)
            .join(".claude")
            .join("worktrees")
            .join(&req.worktree_name);
        let wt_path_str = worktree_path.to_string_lossy().to_string();

        // Find agent target associated with this worktree
        let agent_target = {
            let state = self.state().read();
            state
                .worktree_info
                .iter()
                .flat_map(|repo| &repo.worktrees)
                .find(|wt| wt.path == wt_path_str)
                .and_then(|wt| wt.agent_target.clone())
        };

        if let Some(ref target) = agent_target {
            if req.force {
                // Force mode: kill the agent pane before deletion
                tracing::info!(
                    target = %target,
                    worktree = %req.worktree_name,
                    "Killing agent pane before worktree deletion"
                );
                if let Err(e) = self.kill_pane(target) {
                    tracing::warn!(
                        target = %target,
                        error = %e,
                        "Failed to kill agent pane during worktree deletion"
                    );
                }
            } else {
                // Non-force mode: block deletion if agent is running
                return Err(ApiError::WorktreeError(
                    crate::worktree::WorktreeOpsError::AgentStillRunning(req.worktree_name.clone()),
                ));
            }
        }

        // Check for pending agent detection (spawned but not yet detected)
        {
            const PENDING_AGENT_GRACE_SECS: u64 = 60;
            let state = self.state().read();
            if let Some(spawned_at) = state.pending_agent_worktrees.get(&wt_path_str) {
                if spawned_at.elapsed().as_secs() < PENDING_AGENT_GRACE_SECS {
                    return Err(ApiError::WorktreeError(
                        crate::worktree::WorktreeOpsError::AgentPendingDetection(
                            req.worktree_name.clone(),
                        ),
                    ));
                }
            }
        }

        crate::worktree::delete_worktree(req).await?;

        // Emit event
        let _ = self
            .event_sender()
            .send(super::events::CoreEvent::WorktreeRemoved {
                target: wt_path_str,
                worktree: Some(crate::hooks::types::WorktreeInfo {
                    name: Some(req.worktree_name.clone()),
                    path: None,
                    branch: None,
                    original_repo: Some(req.repo_path.clone()),
                }),
            });

        Ok(())
    }

    /// Move an existing branch into a worktree.
    ///
    /// Auto-commits WIP changes if dirty, creates the worktree, and checks out the default branch.
    pub async fn move_to_worktree(
        &self,
        req: &crate::worktree::WorktreeMoveRequest,
    ) -> Result<crate::worktree::types::WorktreeCreateResult, ApiError> {
        let result = crate::worktree::move_to_worktree(req).await?;

        // Emit worktree created event
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

        // Run setup commands in background if configured
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

        // Record pending agent state to prevent premature worktree deletion
        {
            let state = self.state();
            let mut s = state.write();
            s.pending_agent_worktrees
                .insert(worktree_path.to_string(), std::time::Instant::now());
        }

        tracing::info!(
            worktree = worktree_path,
            agent = %agent_type.short_name(),
            target = %target,
            "Launched agent in worktree"
        );

        Ok(target)
    }

    // =========================================================
    // Usage actions
    // =========================================================

    /// Get the cached usage snapshot from state.
    pub fn get_usage(&self) -> crate::usage::UsageSnapshot {
        self.state().read().usage.clone()
    }

    /// Start a background usage fetch.
    ///
    /// If a fetch is already in progress, this is a no-op.
    /// On completion, updates state and emits `CoreEvent::UsageUpdated`.
    pub fn fetch_usage(&self) {
        // Check and set fetching flag atomically
        {
            let mut state = self.state().write();
            if state.usage.fetching {
                return;
            }
            state.usage.fetching = true;
        }

        let state = self.state().clone();
        let event_tx = self.event_sender();

        // Determine if tmux is available by checking runtime
        let tmux_session = self.runtime().and_then(|_rt| {
            // If runtime supports tmux, try to get a session name from agents
            let s = self.state().read();
            s.agent_order
                .first()
                .and_then(|key| s.agents.get(key))
                .map(|a| a.session.clone())
        });

        tokio::spawn(async move {
            let result = crate::usage::fetch_usage_auto(tmux_session.as_deref()).await;

            let mut s = state.write();
            match result {
                Ok(snapshot) => {
                    s.usage = snapshot;
                    s.usage.fetching = false;
                    s.usage.error = None;
                }
                Err(e) => {
                    tracing::warn!("Usage fetch failed: {e}");
                    s.usage.fetching = false;
                    s.usage.error = Some(e.to_string());
                }
            }
            drop(s);
            let _ = event_tx.send(super::events::CoreEvent::UsageUpdated);
        });
    }

    /// Auto-fetch usage on startup if enabled in settings.
    pub fn start_initial_usage_fetch(&self) {
        let settings = self.settings();
        if settings.usage.enabled {
            tracing::info!("Usage monitoring enabled — starting initial fetch");
            self.fetch_usage();
        }
    }

    /// Kill a specific agent (PTY session or tmux pane).
    /// Uses stable pane ID (%N) when available to avoid index-shift issues
    /// during sequential kills.
    pub fn kill_pane(&self, id: &str) -> Result<(), ApiError> {
        let target = self.resolve_agent_key(id)?;
        let (has_pty, pane_id) = {
            let state = self.state().read();
            let a = state.agents.get(&target).unwrap();
            if a.is_virtual {
                return Err(ApiError::VirtualAgent {
                    target: target.clone(),
                });
            }
            let pane_id = state.target_to_pane_id.get(&target).cloned();
            (a.pty_session_id.is_some(), pane_id)
        };

        if has_pty {
            if let Some(session) = self.pty_registry().get(&target) {
                session.kill();
            }
            // Also kill the tmux pane if one exists, otherwise the parent
            // shell survives after the PTY child process exits.
            if let Some(runtime) = self.runtime() {
                if let Some(pid) = &pane_id {
                    let pane_id_target = format!("%{}", pid);
                    let _ = runtime.kill_pane_by_id(&pane_id_target);
                } else {
                    let _ = runtime.kill_pane(&target);
                }
            }
            {
                let mut state = self.state().write();
                state.agents.remove(&target);
                state.agent_order.retain(|k| k != &target);
            }
            self.notify_agents_updated();
            Ok(())
        } else {
            let cmd = self.require_command_sender()?;
            // Prefer stable pane ID to avoid index-shift when killing multiple panes
            if let Some(pid) = pane_id {
                let pane_id_target = format!("%{}", pid);
                cmd.runtime().kill_pane_by_id(&pane_id_target)?;
            } else {
                cmd.runtime().kill_pane(&target)?;
            }
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

    // =========================================================
    // Orchestrator
    // =========================================================

    /// Mark an existing agent as the orchestrator for its project.
    ///
    /// Any previous orchestrator for the same project is automatically demoted.
    /// Emits `AgentsUpdated` so all subscribers (WebUI, notifier) reflect the change.
    pub fn set_orchestrator(&self, id: &str) -> Result<(), ApiError> {
        let target = self.resolve_agent_key(id)?;

        let mut state = self.state().write();

        // Determine the project (cwd) of the target agent
        let project = state
            .agents
            .get(&target)
            .map(|a| a.cwd.clone())
            .unwrap_or_default();

        // Demote any existing orchestrator for the same project
        for agent in state.agents.values_mut() {
            if agent.is_orchestrator && agent.cwd == project {
                agent.is_orchestrator = false;
            }
        }

        // Promote the target agent
        if let Some(agent) = state.agents.get_mut(&target) {
            agent.is_orchestrator = true;
        }

        drop(state);
        self.notify_agents_updated();
        Ok(())
    }

    /// Compose a system prompt from orchestrator settings.
    ///
    /// The prompt includes the role description, any non-empty workflow rules,
    /// and an instruction to use tmai MCP tools.
    /// When `project_path` is provided, uses per-project orchestrator override if set.
    pub fn compose_orchestrator_prompt(&self, project_path: Option<&str>) -> String {
        let settings = self.settings();
        let orch = settings.resolve_orchestrator(project_path);
        let mut parts: Vec<String> = Vec::new();

        // Role
        parts.push(orch.role.clone());

        // Rules (only include non-empty ones)
        let mut rule_lines: Vec<String> = Vec::new();
        if !orch.rules.branch.is_empty() {
            rule_lines.push(format!("- Branch: {}", orch.rules.branch));
        }
        if !orch.rules.merge.is_empty() {
            rule_lines.push(format!("- Merge: {}", orch.rules.merge));
        }
        if !orch.rules.review.is_empty() {
            rule_lines.push(format!("- Review: {}", orch.rules.review));
        }
        if !orch.rules.custom.is_empty() {
            rule_lines.push(format!("- {}", orch.rules.custom));
        }
        if !rule_lines.is_empty() {
            parts.push(format!("\nWorkflow rules:\n{}", rule_lines.join("\n")));
        }

        // MCP instruction
        parts.push(
            "\nUse tmai MCP tools to manage agents: list_agents, spawn_worktree, \
             dispatch_issue, get_agent_output, send_prompt, approve, etc."
                .to_string(),
        );

        parts.join("\n")
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
        let long_text = "x".repeat(32_769);
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

    #[tokio::test]
    async fn test_initial_usage_fetch_sets_fetching_when_enabled() {
        let mut settings = Settings::default();
        settings.usage.enabled = true;
        let state = AppState::shared();
        let core = TmaiCoreBuilder::new(settings)
            .with_state(state.clone())
            .build();
        // Should set fetching=true since usage is enabled
        core.start_initial_usage_fetch();
        assert!(state.read().usage.fetching);
    }

    #[test]
    fn test_initial_usage_fetch_noop_when_disabled() {
        let mut settings = Settings::default();
        settings.usage.enabled = false;
        let state = AppState::shared();
        let core = TmaiCoreBuilder::new(settings)
            .with_state(state.clone())
            .build();
        core.start_initial_usage_fetch();
        // Should not set fetching since usage is disabled
        assert!(!state.read().usage.fetching);
    }

    /// Helper to set up worktree_info with an agent running in the given worktree path
    fn setup_worktree_info(
        state: &crate::state::SharedState,
        repo_path: &str,
        worktree_name: &str,
        agent_target: Option<String>,
    ) {
        use crate::state::{RepoWorktreeInfo, WorktreeDetail};
        let wt_path = std::path::Path::new(repo_path)
            .join(".claude")
            .join("worktrees")
            .join(worktree_name)
            .to_string_lossy()
            .to_string();
        let mut s = state.write();
        s.worktree_info = vec![RepoWorktreeInfo {
            repo_name: "test-repo".to_string(),
            repo_path: repo_path.to_string(),
            worktrees: vec![WorktreeDetail {
                name: worktree_name.to_string(),
                path: wt_path,
                branch: Some("feat/test".to_string()),
                is_main: false,
                agent_target,
                agent_status: Some(AgentStatus::Processing {
                    activity: crate::agents::Activity::Thinking,
                }),
                is_dirty: Some(false),
                diff_summary: None,
                agent_pending: false,
            }],
        }];
    }

    #[tokio::test]
    async fn test_delete_worktree_blocks_when_agent_running() {
        let state = AppState::shared();
        setup_worktree_info(&state, "/tmp/repo", "my-wt", Some("main:0.1".to_string()));
        let core = TmaiCoreBuilder::new(Settings::default())
            .with_state(state)
            .build();

        let req = crate::worktree::WorktreeDeleteRequest {
            repo_path: "/tmp/repo".to_string(),
            worktree_name: "my-wt".to_string(),
            force: false,
        };
        let result = core.delete_worktree(&req).await;
        assert!(
            matches!(
                result,
                Err(ApiError::WorktreeError(
                    crate::worktree::WorktreeOpsError::AgentStillRunning(_)
                ))
            ),
            "Should block deletion when agent is running and force=false"
        );
    }

    #[tokio::test]
    async fn test_delete_worktree_no_block_without_agent() {
        let state = AppState::shared();
        // No agent_target set for the worktree
        setup_worktree_info(&state, "/tmp/repo", "my-wt", None);
        let core = TmaiCoreBuilder::new(Settings::default())
            .with_state(state)
            .build();

        let req = crate::worktree::WorktreeDeleteRequest {
            repo_path: "/tmp/repo".to_string(),
            worktree_name: "my-wt".to_string(),
            force: false,
        };
        // Will fail at the git worktree level (path doesn't exist), but should NOT
        // fail with AgentStillRunning
        let result = core.delete_worktree(&req).await;
        assert!(
            !matches!(
                result,
                Err(ApiError::WorktreeError(
                    crate::worktree::WorktreeOpsError::AgentStillRunning(_)
                ))
            ),
            "Should not block deletion when no agent is running"
        );
    }

    // =========================================================
    // send_prompt tests
    // =========================================================

    #[tokio::test]
    async fn test_send_prompt_queues_when_processing() {
        let agent = test_agent(
            "test:0.0",
            AgentStatus::Processing {
                activity: crate::agents::Activity::Thinking,
            },
        );
        let core = make_core_with_agents(vec![agent]);

        // send_prompt should queue (no command sender, but queue is written before send)
        let result = core.send_prompt("test:0.0", "do something").await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.action, "queued");
        assert_eq!(r.queue_size, 1);

        // Verify queue state
        let state = core.state().read();
        let q = state.prompt_queue.get("test:0.0").unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!(q[0], "do something");
    }

    #[tokio::test]
    async fn test_send_prompt_queue_overflow() {
        let agent = test_agent(
            "test:0.0",
            AgentStatus::Processing {
                activity: crate::agents::Activity::Thinking,
            },
        );
        let core = make_core_with_agents(vec![agent]);

        // Fill up the queue (MAX_PROMPT_QUEUE_SIZE = 5)
        for i in 0..5 {
            let result = core.send_prompt("test:0.0", &format!("prompt {}", i)).await;
            assert!(result.is_ok());
            assert_eq!(result.unwrap().queue_size, i + 1);
        }

        // 6th prompt should fail
        let result = core.send_prompt("test:0.0", "overflow").await;
        assert!(result.is_err());
        match result {
            Err(ApiError::InvalidInput { message }) => {
                assert!(message.contains("queue full"));
            }
            other => panic!("Expected InvalidInput, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_send_prompt_idle_sends_immediately() {
        let agent = test_agent("test:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);

        // Idle agent — send_prompt tries to send immediately.
        // Without a CommandSender, it will fail at the send_text level, not the queue level.
        let result = core.send_prompt("test:0.0", "hello").await;
        // Should fail because no CommandSender, not because of queueing
        assert!(result.is_err());
        match result {
            Err(ApiError::NoCommandSender) => {} // expected
            other => panic!("Expected NoCommandSender, got {:?}", other),
        }

        // Queue should remain empty (not queued)
        let state = core.state().read();
        assert!(state.prompt_queue.get("test:0.0").is_none());
    }

    #[tokio::test]
    async fn test_send_prompt_offline_sends_immediately() {
        let agent = test_agent("test:0.0", AgentStatus::Offline);
        let core = make_core_with_agents(vec![agent]);

        // Offline agent — should try to send immediately (restart)
        let result = core.send_prompt("test:0.0", "restart prompt").await;
        assert!(result.is_err());
        match result {
            Err(ApiError::NoCommandSender) => {} // expected without tmux
            other => panic!("Expected NoCommandSender, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_send_prompt_not_found() {
        let core = make_core_with_agents(vec![]);

        let result = core.send_prompt("nonexistent", "hello").await;
        assert!(result.is_err());
        match result {
            Err(ApiError::AgentNotFound { target }) => {
                assert_eq!(target, "nonexistent");
            }
            other => panic!("Expected AgentNotFound, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_send_prompt_virtual_agent() {
        let mut agent = test_agent("test:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);

        let result = core.send_prompt("test:0.0", "hello").await;
        assert!(result.is_err());
        match result {
            Err(ApiError::VirtualAgent { .. }) => {} // expected
            other => panic!("Expected VirtualAgent, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_send_prompt_too_long() {
        let agent = test_agent("test:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);

        let long_text = "a".repeat(MAX_TEXT_LENGTH + 1);
        let result = core.send_prompt("test:0.0", &long_text).await;
        assert!(result.is_err());
        match result {
            Err(ApiError::InvalidInput { message }) => {
                assert!(message.contains("maximum length"));
            }
            other => panic!("Expected InvalidInput, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_send_prompt_queues_when_awaiting_approval() {
        let agent = test_agent(
            "test:0.0",
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::McpTool,
                details: "read file".to_string(),
            },
        );
        let core = make_core_with_agents(vec![agent]);

        let result = core.send_prompt("test:0.0", "after approval").await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().action, "queued");
    }

    #[test]
    fn test_prompt_queue_drain() {
        // Test the drain behavior by directly manipulating AppState
        let state = AppState::shared();
        {
            let mut s = state.write();
            let mut q = std::collections::VecDeque::new();
            q.push_back("first".to_string());
            q.push_back("second".to_string());
            s.prompt_queue.insert("agent1".to_string(), q);
        }

        // Pop front (simulating what the poller does)
        let prompt = {
            let mut s = state.write();
            s.prompt_queue.get_mut("agent1").and_then(|q| q.pop_front())
        };
        assert_eq!(prompt, Some("first".to_string()));

        // Verify second is still there
        let remaining = {
            let s = state.read();
            s.prompt_queue.get("agent1").unwrap().len()
        };
        assert_eq!(remaining, 1);
    }

    #[test]
    fn test_compose_orchestrator_prompt_default() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let prompt = core.compose_orchestrator_prompt(None);
        // Should contain default role
        assert!(prompt.contains("orchestrator agent"));
        // Should contain MCP tools instruction
        assert!(prompt.contains("tmai MCP tools"));
        // No rules section with empty rules
        assert!(!prompt.contains("Workflow rules:"));
    }

    #[test]
    fn test_compose_orchestrator_prompt_with_rules() {
        let mut settings = Settings::default();
        settings.orchestrator.role = "You are the boss.".to_string();
        settings.orchestrator.rules.branch = "feat/{issue}-{slug}".to_string();
        settings.orchestrator.rules.review = "Run CI first".to_string();

        let core = TmaiCoreBuilder::new(settings).build();
        let prompt = core.compose_orchestrator_prompt(None);
        assert!(prompt.contains("You are the boss."));
        assert!(prompt.contains("Workflow rules:"));
        assert!(prompt.contains("- Branch: feat/{issue}-{slug}"));
        assert!(prompt.contains("- Review: Run CI first"));
        // Merge rule is empty, should not appear
        assert!(!prompt.contains("- Merge:"));
    }

    #[test]
    fn test_set_orchestrator_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.set_orchestrator("nonexistent");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_set_orchestrator_promotes_agent() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        assert!(core.set_orchestrator("main:0.0").is_ok());
        let state = core.state().read();
        assert!(state.agents.get("main:0.0").unwrap().is_orchestrator);
    }

    #[test]
    fn test_set_orchestrator_demotes_previous() {
        let mut agent1 = test_agent("main:0.0", AgentStatus::Idle);
        agent1.is_orchestrator = true;
        let agent2 = test_agent("main:0.1", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent1, agent2]);

        // Promote agent2 — agent1 should be demoted (same cwd)
        assert!(core.set_orchestrator("main:0.1").is_ok());
        let state = core.state().read();
        assert!(!state.agents.get("main:0.0").unwrap().is_orchestrator);
        assert!(state.agents.get("main:0.1").unwrap().is_orchestrator);
    }

    #[test]
    fn test_set_orchestrator_different_project_not_demoted() {
        let mut agent1 = test_agent("main:0.0", AgentStatus::Idle);
        agent1.is_orchestrator = true;
        agent1.cwd = "/project-a".to_string();
        let mut agent2 = test_agent("main:0.1", AgentStatus::Idle);
        agent2.cwd = "/project-b".to_string();
        let core = make_core_with_agents(vec![agent1, agent2]);

        // Promote agent2 in project-b — agent1 in project-a stays orchestrator
        assert!(core.set_orchestrator("main:0.1").is_ok());
        let state = core.state().read();
        assert!(state.agents.get("main:0.0").unwrap().is_orchestrator);
        assert!(state.agents.get("main:0.1").unwrap().is_orchestrator);
    }

    #[test]
    fn test_set_orchestrator_idempotent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_orchestrator = true;
        let core = make_core_with_agents(vec![agent]);

        // Re-setting the same agent should succeed
        assert!(core.set_orchestrator("main:0.0").is_ok());
        let state = core.state().read();
        assert!(state.agents.get("main:0.0").unwrap().is_orchestrator);
    }
}
