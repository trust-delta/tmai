use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

use crate::agents::{
    AgentStatus, AgentTeamInfo, AgentType, ApprovalType, DetectionSource, MonitoredAgent,
    TeamTaskSummaryItem,
};
use crate::api::CoreEvent;
use crate::audit::{AuditEvent, AuditLogger};
use crate::config::{ClaudeSettingsCache, Settings};
use crate::detectors::ClaudeCodeDetector;
use crate::detectors::GeminiDetector;
use crate::detectors::{get_detector, DetectionConfidence, DetectionContext, DetectionReason};
use crate::git::GitCache;
use crate::ipc::protocol::{WrapApprovalType, WrapState, WrapStatus};
use crate::ipc::server::IpcRegistry;
use crate::state::{MonitorScope, SharedState, TeamSnapshot};
use crate::teams::{self, TaskStatus};
use crate::tmux::{PaneInfo, ProcessCache, TmuxClient};

/// Tracks the last committed (actually emitted) state for an agent
struct CommittedAgentState {
    status: String,
    /// Full AgentStatus preserved for debounce override (retains activity/error text)
    full_status: AgentStatus,
    #[allow(dead_code)]
    reason: DetectionReason,
    agent_type: String,
    committed_at_ms: u64,
}

/// A pending state transition waiting to be committed after debounce period
struct PendingTransition {
    new_status: String,
    new_reason: DetectionReason,
    first_seen: Instant,
}

/// Calculate debounce threshold for a state transition
fn debounce_threshold(from: &str, to: &str) -> Duration {
    // Approval should be shown immediately
    if to == "awaiting_approval" {
        return Duration::from_millis(0);
    }
    // User action after approval is fast
    if from == "awaiting_approval" {
        return Duration::from_millis(200);
    }
    // idle<->processing oscillation is the main noise source
    if (from == "idle" && to == "processing") || (from == "processing" && to == "idle") {
        return Duration::from_millis(500);
    }
    // Default
    Duration::from_millis(300)
}

/// Message sent from poller to main loop
#[derive(Debug)]
pub enum PollMessage {
    /// Updated list of agents
    AgentsUpdated(Vec<MonitoredAgent>),
    /// Error during polling
    Error(String),
}

/// Poller for monitoring tmux panes
pub struct Poller {
    client: TmuxClient,
    process_cache: Arc<ProcessCache>,
    /// Cache for Claude Code settings (spinnerVerbs)
    claude_settings_cache: Arc<ClaudeSettingsCache>,
    settings: Settings,
    state: SharedState,
    /// IPC registry for reading wrapper states
    ipc_registry: IpcRegistry,
    /// Current session name (captured at startup, unused while scope is disabled)
    #[allow(dead_code)]
    current_session: Option<String>,
    /// Current window index (captured at startup, unused while scope is disabled)
    #[allow(dead_code)]
    current_window: Option<u32>,
    /// Audit logger for detection events
    audit_logger: AuditLogger,
    /// Receiver for audit events from external sources (UI, Web API)
    audit_event_rx: Option<tokio::sync::mpsc::UnboundedReceiver<AuditEvent>>,
    /// Previous status per agent target for change detection
    previous_statuses: HashMap<String, CommittedAgentState>,
    /// Pending state transitions waiting for debounce period to elapse
    pending_transitions: HashMap<String, PendingTransition>,
    /// Set of agent targets seen in the previous poll
    previous_agent_ids: HashSet<String>,
    /// Grace period tracker: keeps agents in Processing for up to 6 seconds after
    /// the spinner disappears, preventing Processing→Idle→Processing flicker
    /// during tool call gaps.
    grace_periods: HashMap<String, Instant>,
    /// Git branch/dirty cache for agent cwd directories
    git_cache: GitCache,
    /// Core event sender for pushing TeammateIdle/TaskCompleted events
    event_tx: Option<tokio::sync::broadcast::Sender<CoreEvent>>,
}

impl Poller {
    /// Create a new poller
    pub fn new(
        settings: Settings,
        state: SharedState,
        ipc_registry: IpcRegistry,
        audit_event_rx: Option<tokio::sync::mpsc::UnboundedReceiver<AuditEvent>>,
    ) -> Self {
        let client = TmuxClient::with_capture_lines(settings.capture_lines);

        // Capture current location at startup for scope filtering
        let (current_session, current_window) = match client.get_current_location() {
            Ok((session, window)) => (Some(session), Some(window)),
            Err(_) => (None, None),
        };

        let audit_logger = AuditLogger::new(settings.audit.enabled, settings.audit.max_size_bytes);

        Self {
            client,
            process_cache: Arc::new(ProcessCache::new()),
            claude_settings_cache: Arc::new(ClaudeSettingsCache::new()),
            settings,
            state,
            ipc_registry,
            current_session,
            current_window,
            audit_logger,
            audit_event_rx,
            previous_statuses: HashMap::new(),
            pending_transitions: HashMap::new(),
            previous_agent_ids: HashSet::new(),
            grace_periods: HashMap::new(),
            git_cache: GitCache::new(),
            event_tx: None,
        }
    }

    /// Set the core event sender for TeammateIdle/TaskCompleted notifications
    pub fn with_event_tx(mut self, tx: tokio::sync::broadcast::Sender<CoreEvent>) -> Self {
        self.event_tx = Some(tx);
        self
    }

    /// Start polling in a background task
    pub fn start(self) -> mpsc::Receiver<PollMessage> {
        let (tx, rx) = mpsc::channel(32);

        tokio::spawn(async move {
            self.run(tx).await;
        });

        rx
    }

    /// Run the polling loop
    async fn run(mut self, tx: mpsc::Sender<PollMessage>) {
        let normal_interval = self.settings.poll_interval_ms;
        let fast_interval = self.settings.passthrough_poll_interval_ms;
        let mut backoff_ms: u64 = 0;
        let mut last_error: Option<String> = None;
        let mut last_error_at: Option<Instant> = None;
        let mut poll_count: u32 = 0;

        loop {
            // Check if we should stop and get passthrough state
            let (should_stop, is_passthrough) = {
                let state = self.state.read();
                (!state.running, state.is_passthrough_mode())
            };

            if should_stop {
                break;
            }

            // Use faster interval in passthrough mode for responsive preview updates
            let base_interval_ms = if is_passthrough {
                fast_interval
            } else {
                normal_interval
            };
            let interval_ms = base_interval_ms.saturating_add(backoff_ms);
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;

            match self.poll_once().await {
                Ok((mut agents, all_panes)) => {
                    backoff_ms = 0;
                    last_error = None;
                    last_error_at = None;

                    // Periodic cache cleanup (every 10 polls)
                    poll_count = poll_count.wrapping_add(1);
                    if poll_count.is_multiple_of(10) {
                        self.process_cache.cleanup();
                        // Remove expired grace periods (> 30s old to avoid unbounded growth)
                        self.grace_periods
                            .retain(|_, ts| ts.elapsed().as_secs() < 30);
                    }

                    // Team scanning at configured interval, or re-apply cached info
                    if self.settings.teams.enabled {
                        if poll_count.is_multiple_of(self.settings.teams.scan_interval) {
                            self.scan_and_apply_teams(&mut agents, &all_panes);
                        } else {
                            self.apply_cached_team_info(&mut agents);
                        }
                    }

                    // Git branch detection (every ~10 seconds)
                    if poll_count.is_multiple_of(20) {
                        self.update_git_info(&mut agents).await;
                        self.git_cache.cleanup();
                    } else {
                        self.apply_cached_git_info(&mut agents);
                    }

                    // Audit: track state transitions
                    self.emit_audit_events(&mut agents);

                    // Drain externally-submitted audit events (from UI/Web)
                    if let Some(ref mut rx) = self.audit_event_rx {
                        while let Ok(event) = rx.try_recv() {
                            self.audit_logger.log(&event);
                        }
                    }

                    if tx.send(PollMessage::AgentsUpdated(agents)).await.is_err() {
                        break; // Receiver dropped
                    }
                }
                Err(e) => {
                    let err_str = e.to_string();
                    let should_send = match &last_error {
                        Some(prev) if prev == &err_str => last_error_at
                            .map(|t| t.elapsed() >= Duration::from_secs(2))
                            .unwrap_or(true),
                        _ => true,
                    };

                    if should_send && tx.send(PollMessage::Error(err_str.clone())).await.is_err() {
                        break;
                    }

                    last_error = Some(err_str);
                    last_error_at = Some(Instant::now());
                    backoff_ms = if backoff_ms == 0 {
                        200
                    } else {
                        (backoff_ms * 2).min(2000)
                    };
                }
            }
        }
    }

    /// Perform a single poll
    ///
    /// Returns `(agents, all_panes)` where `all_panes` includes detached sessions
    /// for use in team scanning.
    async fn poll_once(&mut self) -> Result<(Vec<MonitoredAgent>, Vec<PaneInfo>)> {
        // Always get all panes (needed for team scanning)
        let all_panes = self.client.list_all_panes()?;

        // Use all panes (scope filtering temporarily disabled — always AllSessions)
        let panes = all_panes.clone();

        let selected_agent_id = {
            let state = self.state.read();
            state
                .agent_order
                .get(state.selection.selected_index)
                .cloned()
        };

        // Filter and convert to monitored agents
        let mut agents = Vec::new();

        for pane in panes {
            // Get cmdline from process cache for better detection
            // Try direct cmdline first, then child process cmdline (for shell -> agent)
            let direct_cmdline = self.process_cache.get_cmdline(pane.pid);
            let child_cmdline = self.process_cache.get_child_cmdline(pane.pid);

            // Try detection with child cmdline first (more specific for agents under shell)
            let agent_type = pane
                .detect_agent_type_with_cmdline(child_cmdline.as_deref())
                .or_else(|| pane.detect_agent_type_with_cmdline(direct_cmdline.as_deref()));

            if let Some(agent_type) = agent_type {
                // Try to read state from IPC registry first
                // Use pane_id (global unique ID like "5" from "%5") not pane_index (local window index)
                let wrap_state = {
                    let registry = self.ipc_registry.read();
                    registry.get(&pane.pane_id).cloned()
                };
                let is_selected = selected_agent_id.as_ref() == Some(&pane.target);

                // Optimize capture-pane based on selection and IPC state:
                // - Selected: ANSI capture for preview
                // - Non-selected + IPC: skip capture-pane entirely (state from IPC registry)
                // - Non-selected + capture-pane mode: plain capture for detection only
                let (content_ansi, mut content) = if is_selected {
                    // Selected agent: full ANSI capture for preview
                    let ansi = self.client.capture_pane(&pane.target).unwrap_or_default();
                    let plain = strip_ansi(&ansi);
                    (ansi, plain)
                } else if wrap_state.is_some() {
                    // Non-selected + IPC mode: skip capture-pane entirely
                    (String::new(), String::new())
                } else {
                    // Non-selected + capture-pane mode: plain capture for detection
                    let plain = self
                        .client
                        .capture_pane_plain(&pane.target)
                        .unwrap_or_default();
                    (String::new(), plain)
                };

                let title = self
                    .client
                    .get_pane_title(&pane.target)
                    .unwrap_or(pane.title.clone());

                // Determine status: use IPC state if available, otherwise detect from content
                let mut screen_override = false;
                let (status, context_warning, detection_reason) = if let Some(ref ws) = wrap_state {
                    // Convert WrapState to AgentStatus
                    let status = wrap_state_to_agent_status(ws);

                    // P1: IPC Approval lag correction — when IPC reports non-Approval,
                    // check screen content for High-confidence Approval patterns
                    if !matches!(status, AgentStatus::AwaitingApproval { .. }) {
                        // Reuse existing content if available (selected agent already has
                        // plain text from ANSI capture), otherwise capture for non-selected agents
                        let plain = if !content.is_empty() {
                            content.clone()
                        } else {
                            self.client
                                .capture_pane_plain(&pane.target)
                                .unwrap_or_default()
                        };
                        let detection_context = DetectionContext {
                            cwd: Some(pane.cwd.as_str()),
                            settings_cache: Some(&self.claude_settings_cache),
                        };
                        let detector = get_detector(&agent_type);
                        let result =
                            detector.detect_status_with_reason(&title, &plain, &detection_context);
                        if matches!(result.status, AgentStatus::AwaitingApproval { .. })
                            && result.reason.confidence == DetectionConfidence::High
                        {
                            // Screen override: Approval visible on screen but IPC lagging
                            let context_warning = detector.detect_context_warning(&plain);
                            content = plain;
                            screen_override = true;
                            (result.status, context_warning, Some(result.reason))
                        } else {
                            // Enrich IPC Processing with screen-detected activity
                            // (e.g., "Compacting..." from title or spinner verb)
                            let status = enrich_ipc_activity(status, &result.status, &title);
                            let matched_text =
                                if let AgentStatus::Processing { ref activity } = status {
                                    if !activity.is_empty() {
                                        Some(format!("enriched: {}", activity))
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                };
                            let reason = DetectionReason {
                                rule: "ipc_state".to_string(),
                                confidence: DetectionConfidence::High,
                                matched_text,
                            };
                            (status, None, Some(reason))
                        }
                    } else {
                        let reason = DetectionReason {
                            rule: "ipc_state".to_string(),
                            confidence: DetectionConfidence::High,
                            matched_text: None,
                        };
                        (status, None, Some(reason))
                    }
                } else {
                    // Build detection context for this pane
                    let detection_context = DetectionContext {
                        cwd: Some(pane.cwd.as_str()),
                        settings_cache: Some(&self.claude_settings_cache),
                    };

                    // Detect status using appropriate detector with reason
                    let detector = get_detector(&agent_type);
                    let result =
                        detector.detect_status_with_reason(&title, &content, &detection_context);
                    let context_warning = detector.detect_context_warning(&content);
                    (result.status, context_warning, Some(result.reason))
                };

                // Grace period: prevent Processing→Idle flicker during tool call gaps.
                // When Processing is detected, record the timestamp.
                // When Idle or fallback is detected, maintain Processing if within 6 seconds.
                // Approval and Error always bypass the grace period.
                let status = self.apply_grace_period(&pane.target, status, &detection_reason);

                let mut agent = MonitoredAgent::new(
                    pane.target.clone(),
                    agent_type,
                    title,
                    pane.cwd.clone(),
                    pane.pid,
                    pane.session.clone(),
                    pane.window_name.clone(),
                    pane.window_index,
                    pane.pane_index,
                );
                agent.status = status;
                agent.last_content = content;
                agent.last_content_ansi = content_ansi;
                agent.context_warning = context_warning;
                agent.detection_reason = detection_reason;
                agent.detection_source = if screen_override {
                    DetectionSource::CapturePane
                } else if wrap_state.is_some() {
                    DetectionSource::IpcSocket
                } else {
                    DetectionSource::CapturePane
                };

                // Detect permission mode from title/content
                match agent.agent_type {
                    AgentType::ClaudeCode => {
                        agent.mode = ClaudeCodeDetector::detect_mode(&agent.title);
                    }
                    AgentType::GeminiCli => {
                        agent.mode = GeminiDetector::detect_mode(&agent.last_content);
                    }
                    _ => {}
                }

                agents.push(agent);
            }
        }

        // Sort by session and window/pane
        agents.sort_by(|a, b| {
            a.session
                .cmp(&b.session)
                .then(a.window_index.cmp(&b.window_index))
                .then(a.pane_index.cmp(&b.pane_index))
        });

        // Build target → pane_id mapping for IPC key sending
        let target_to_pane_id: HashMap<String, String> = all_panes
            .iter()
            .map(|p| (p.target.clone(), p.pane_id.clone()))
            .collect();

        // Update in app state
        {
            let mut state = self.state.write();
            state.target_to_pane_id = target_to_pane_id;
        }

        Ok((agents, all_panes))
    }

    /// Scan for teams and apply team info to agents
    ///
    /// Also performs cross-session scanning and creates virtual agents
    /// for team members whose panes are not found.
    fn scan_and_apply_teams(&self, agents: &mut Vec<MonitoredAgent>, all_panes: &[PaneInfo]) {
        let team_configs = match teams::scan_teams() {
            Ok(configs) => configs,
            Err(_) => return,
        };

        if team_configs.is_empty() {
            // Clear teams from state
            let mut state = self.state.write();
            state.teams.clear();
            return;
        }

        // Collect agent pids for mapping (from already-detected agents)
        let agent_pids: Vec<(String, u32)> =
            agents.iter().map(|a| (a.target.clone(), a.pid)).collect();

        // Also collect pids from all panes for broader matching
        let all_pane_pids: Vec<(String, u32)> = all_panes
            .iter()
            .map(|p| (p.target.clone(), p.pid))
            .collect();

        // Pre-build cmdline cache to avoid duplicate lookups for overlapping pids
        let mut cmdline_cache: HashMap<u32, Option<String>> = HashMap::new();
        for (_, pid) in agent_pids.iter().chain(all_pane_pids.iter()) {
            cmdline_cache.entry(*pid).or_insert_with(|| {
                self.process_cache
                    .get_child_cmdline(*pid)
                    .or_else(|| self.process_cache.get_cmdline(*pid))
            });
        }

        // Deduplicate (target, pid) pairs to avoid redundant iterations
        let mut unique_pids: HashMap<u32, String> = HashMap::new();
        for (target, pid) in agent_pids.iter().chain(all_pane_pids.iter()) {
            unique_pids.entry(*pid).or_insert_with(|| target.clone());
        }

        let mut snapshots: HashMap<String, TeamSnapshot> = HashMap::new();

        for team_config in &team_configs {
            // Scan tasks for this team
            let tasks = teams::scan_tasks(&team_config.team_name).unwrap_or_default();

            // Map members to panes using all pane pids (broader scope)
            let member_panes = teams::map_members_to_panes(team_config, &all_pane_pids);

            // Try cmdline-based matching: child process cmdline contains --agent-id
            let mut cmdline_mapping: HashMap<String, String> = HashMap::new();
            let mut matched_members: std::collections::HashSet<&str> =
                std::collections::HashSet::new();
            for (pid, target) in &unique_pids {
                if matched_members.len() == team_config.members.len() {
                    break; // All members matched
                }
                if let Some(Some(cl)) = cmdline_cache.get(pid) {
                    for member in &team_config.members {
                        if matched_members.contains(member.name.as_str()) {
                            continue; // Already matched
                        }
                        // Match --agent-id member_agent_id in cmdline
                        let marker = format!("--agent-id {}", member.agent_id);
                        if cl.contains(&marker) {
                            cmdline_mapping.insert(member.name.clone(), target.clone());
                            matched_members.insert(&member.name);
                            break;
                        }
                    }
                }
            }

            // Merge mappings (cmdline-based takes priority over heuristic)
            let mut final_mapping = member_panes;
            for (name, target) in cmdline_mapping {
                final_mapping.insert(name, target);
            }

            // Fallback: match unmapped leader by cwd (leader has no --agent-id flag)
            if let Some(leader) = team_config.members.first() {
                if !final_mapping.contains_key(&leader.name) {
                    if let Some(leader_cwd) = &leader.cwd {
                        let mapped_targets: std::collections::HashSet<&str> =
                            final_mapping.values().map(|s| s.as_str()).collect();
                        // Find an agent with matching cwd that isn't already mapped
                        if let Some(agent) = agents.iter().find(|a| {
                            a.cwd == *leader_cwd
                                && !a.is_virtual
                                && !mapped_targets.contains(a.target.as_str())
                                && a.team_info.is_none()
                        }) {
                            final_mapping.insert(leader.name.clone(), agent.target.clone());
                        }
                    }
                }
            }

            // Apply team info to matching agents and detect out-of-scope panes
            for (member_name, pane_target) in &final_mapping {
                let is_lead = team_config
                    .members
                    .first()
                    .map(|m| &m.name == member_name)
                    .unwrap_or(false);

                let team_info =
                    build_member_team_info(&team_config.team_name, member_name, is_lead, &tasks);

                if let Some(agent) = agents.iter_mut().find(|a| &a.target == pane_target) {
                    // Agent already in list — apply team info
                    agent.team_info = Some(team_info);
                } else if let Some(pane) = all_panes.iter().find(|p| &p.target == pane_target) {
                    // Pane found but not in agents list (out of scope) — add as new agent
                    let agent_type = pane.detect_agent_type().unwrap_or(AgentType::ClaudeCode);
                    let mut new_agent = MonitoredAgent::new(
                        pane.target.clone(),
                        agent_type,
                        pane.title.clone(),
                        pane.cwd.clone(),
                        pane.pid,
                        pane.session.clone(),
                        pane.window_name.clone(),
                        pane.window_index,
                        pane.pane_index,
                    );
                    new_agent.team_info = Some(team_info);
                    agents.push(new_agent);
                }
            }

            // Determine cwd for virtual agents from any matched teammate
            let team_cwd: String = final_mapping
                .values()
                .find_map(|target| agents.iter().find(|a| &a.target == target))
                .map(|a| a.cwd.clone())
                .unwrap_or_default();

            // Create virtual agents for members without detected panes
            for member in &team_config.members {
                if !final_mapping.contains_key(&member.name) {
                    let is_lead = team_config
                        .members
                        .first()
                        .map(|m| m.name == member.name)
                        .unwrap_or(false);

                    let team_info = build_member_team_info(
                        &team_config.team_name,
                        &member.name,
                        is_lead,
                        &tasks,
                    );
                    agents.push(create_virtual_agent(
                        &team_config.team_name,
                        &member.name,
                        team_info,
                        &team_cwd,
                    ));
                }
            }

            // Collect worktree names from mapped agents
            let mut worktree_names = Vec::new();
            for (member_name, pane_target) in &final_mapping {
                if let Some(agent) = agents.iter_mut().find(|a| &a.target == pane_target) {
                    // Check if the member's cwd is within a worktree path
                    let wt_name = agent
                        .worktree_name
                        .clone()
                        .or_else(|| crate::git::extract_claude_worktree_name(&agent.cwd));

                    if let Some(ref name) = wt_name {
                        // Set worktree info on the agent if not already set
                        if agent.worktree_name.is_none() {
                            agent.worktree_name = Some(name.clone());
                        }
                        if agent.is_worktree != Some(true) {
                            agent.is_worktree = Some(true);
                        }
                        if !worktree_names.contains(name) {
                            worktree_names.push(name.clone());
                        }
                    }
                }
                // Also check member config cwd for unmapped members
                if let Some(member) = team_config.members.iter().find(|m| &m.name == member_name) {
                    if let Some(wt_name) = member.worktree_name() {
                        if !worktree_names.contains(&wt_name) {
                            worktree_names.push(wt_name);
                        }
                    }
                }
            }

            let task_done = tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Completed)
                .count();
            let task_total = tasks.len();
            let task_in_progress = tasks
                .iter()
                .filter(|t| t.status == TaskStatus::InProgress)
                .count();
            let task_pending = tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Pending)
                .count();

            snapshots.insert(
                team_config.team_name.clone(),
                TeamSnapshot {
                    config: team_config.clone(),
                    tasks,
                    member_panes: final_mapping,
                    last_scan: chrono::Utc::now(),
                    task_done,
                    task_total,
                    task_in_progress,
                    task_pending,
                    worktree_names,
                },
            );
        }

        // Detect newly completed tasks by comparing with previous snapshots
        {
            let prev_state = self.state.read();
            for (team_name, new_snapshot) in &snapshots {
                if let Some(prev_snapshot) = prev_state.teams.get(team_name) {
                    let prev_completed: HashSet<&str> = prev_snapshot
                        .tasks
                        .iter()
                        .filter(|t| t.status == TaskStatus::Completed)
                        .map(|t| t.id.as_str())
                        .collect();

                    for task in &new_snapshot.tasks {
                        if task.status == TaskStatus::Completed
                            && !prev_completed.contains(task.id.as_str())
                        {
                            if let Some(ref tx) = self.event_tx {
                                let _ = tx.send(CoreEvent::TaskCompleted {
                                    team_name: team_name.clone(),
                                    task_id: task.id.clone(),
                                    task_subject: task.subject.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // Scan agent definitions from project directories
        let project_dir = self.detect_project_dir(agents);
        let agent_defs =
            crate::teams::agents_scanner::scan_agent_definitions(project_dir.as_deref());

        // Update state with team snapshots and agent definitions
        let mut state = self.state.write();
        state.teams = snapshots;
        state.agent_definitions = agent_defs;
    }

    /// Detect project directory from agent cwds
    ///
    /// Uses the first non-virtual agent's cwd as a heuristic for the project root.
    fn detect_project_dir(&self, agents: &[MonitoredAgent]) -> Option<std::path::PathBuf> {
        agents
            .iter()
            .find(|a| !a.is_virtual && !a.cwd.is_empty())
            .map(|a| std::path::PathBuf::from(&a.cwd))
    }

    /// Re-apply cached team info from stored snapshots on non-scan polls
    ///
    /// Since `poll_once()` creates fresh `MonitoredAgent` instances every poll,
    /// team info would be lost on polls where `scan_and_apply_teams` doesn't run.
    /// This method uses the persisted `TeamSnapshot` data to re-apply team info.
    fn apply_cached_team_info(&self, agents: &mut Vec<MonitoredAgent>) {
        let state = self.state.read();
        if state.teams.is_empty() {
            return;
        }

        for snapshot in state.teams.values() {
            for (member_name, pane_target) in &snapshot.member_panes {
                let is_lead = snapshot
                    .config
                    .members
                    .first()
                    .map(|m| &m.name == member_name)
                    .unwrap_or(false);

                let team_info = build_member_team_info(
                    &snapshot.config.team_name,
                    member_name,
                    is_lead,
                    &snapshot.tasks,
                );

                if let Some(agent) = agents.iter_mut().find(|a| &a.target == pane_target) {
                    agent.team_info = Some(team_info);
                }
            }

            // Determine cwd for virtual agents from any matched teammate
            let team_cwd: String = snapshot
                .member_panes
                .values()
                .find_map(|target| agents.iter().find(|a| &a.target == target))
                .map(|a| a.cwd.clone())
                .unwrap_or_default();

            // Re-create virtual agents for unmapped members
            for member in &snapshot.config.members {
                if !snapshot.member_panes.contains_key(&member.name) {
                    let is_lead = snapshot
                        .config
                        .members
                        .first()
                        .map(|m| m.name == member.name)
                        .unwrap_or(false);

                    let team_info = build_member_team_info(
                        &snapshot.config.team_name,
                        &member.name,
                        is_lead,
                        &snapshot.tasks,
                    );
                    agents.push(create_virtual_agent(
                        &snapshot.config.team_name,
                        &member.name,
                        team_info,
                        &team_cwd,
                    ));
                }
            }
        }
    }

    /// Check if a pane matches the current monitor scope (temporarily unused)
    #[allow(dead_code)]
    fn matches_scope(&self, pane: &PaneInfo, scope: MonitorScope) -> bool {
        match scope {
            MonitorScope::AllSessions => true,
            MonitorScope::CurrentSession => self
                .current_session
                .as_ref()
                .map(|s| s == &pane.session)
                .unwrap_or(true),
            MonitorScope::CurrentWindow => {
                let session_match = self
                    .current_session
                    .as_ref()
                    .map(|s| s == &pane.session)
                    .unwrap_or(true);
                let window_match = self
                    .current_window
                    .map(|w| w == pane.window_index)
                    .unwrap_or(true);
                session_match && window_match
            }
        }
    }

    /// Emit audit events for state transitions with debounce
    fn emit_audit_events(&mut self, agents: &mut [MonitoredAgent]) {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let current_ids: HashSet<String> = agents
            .iter()
            .filter(|a| !a.is_virtual)
            .map(|a| a.target.clone())
            .collect();

        // AgentDisappeared: was in previous, not in current
        for target in &self.previous_agent_ids {
            if !current_ids.contains(target) {
                let (last_status, agent_type) = self
                    .previous_statuses
                    .get(target)
                    .map(|c| (c.status.clone(), c.agent_type.clone()))
                    .unwrap_or_else(|| ("unknown".to_string(), "unknown".to_string()));
                self.audit_logger.log(&AuditEvent::AgentDisappeared {
                    ts,
                    pane_id: target.clone(),
                    agent_type,
                    last_status,
                });
                // Clean up pending transition for disappeared agent
                self.pending_transitions.remove(target);
            }
        }

        for agent in agents.iter_mut() {
            if agent.is_virtual {
                continue;
            }

            let current_status_name = status_name(&agent.status).to_string();
            let reason = agent
                .detection_reason
                .clone()
                .unwrap_or_else(|| DetectionReason {
                    rule: "unknown".to_string(),
                    confidence: DetectionConfidence::Low,
                    matched_text: None,
                });
            let source = agent.detection_source.label().to_string();

            if !self.previous_agent_ids.contains(&agent.target) {
                // AgentAppeared - no debounce needed
                self.audit_logger.log(&AuditEvent::AgentAppeared {
                    ts,
                    pane_id: agent.target.clone(),
                    agent_type: agent.agent_type.short_name().to_string(),
                    source,
                    initial_status: current_status_name.clone(),
                });
                self.previous_statuses.insert(
                    agent.target.clone(),
                    CommittedAgentState {
                        status: current_status_name,
                        full_status: agent.status.clone(),
                        reason,
                        agent_type: agent.agent_type.short_name().to_string(),
                        committed_at_ms: ts,
                    },
                );
                continue;
            }

            let committed = self.previous_statuses.get(&agent.target);
            let committed_status = committed.map(|c| c.status.as_str()).unwrap_or("unknown");

            if committed_status == current_status_name {
                // Status same as committed - cancel any pending transition (oscillation)
                self.pending_transitions.remove(&agent.target);
                continue;
            }

            // Status differs from committed - check debounce
            let threshold = debounce_threshold(committed_status, &current_status_name);

            if threshold.is_zero() {
                // Immediate commit (e.g., -> awaiting_approval)
                self.pending_transitions.remove(&agent.target);
                let prev_duration = committed.map(|c| ts.saturating_sub(c.committed_at_ms));

                let screen_context = if !agent.last_content.is_empty() {
                    let lines: Vec<&str> = agent.last_content.lines().collect();
                    let start = lines.len().saturating_sub(20);
                    let tail = lines[start..].join("\n");
                    Some(if tail.len() > 2000 {
                        tail[..tail.floor_char_boundary(2000)].to_string()
                    } else {
                        tail
                    })
                } else {
                    None
                };

                let (approval_type, approval_details) = extract_approval_info(&agent.status);
                self.audit_logger.log(&AuditEvent::StateChanged {
                    ts,
                    pane_id: agent.target.clone(),
                    agent_type: agent.agent_type.short_name().to_string(),
                    source,
                    prev_status: committed_status.to_string(),
                    new_status: current_status_name.clone(),
                    reason: reason.clone(),
                    screen_context,
                    prev_state_duration_ms: prev_duration,
                    approval_type,
                    approval_details,
                });

                // Emit TeammateIdle when a team member transitions to idle
                if current_status_name == "idle" && committed_status != "idle" {
                    self.emit_teammate_idle(agent);
                }

                self.previous_statuses.insert(
                    agent.target.clone(),
                    CommittedAgentState {
                        status: current_status_name,
                        full_status: agent.status.clone(),
                        reason,
                        agent_type: agent.agent_type.short_name().to_string(),
                        committed_at_ms: ts,
                    },
                );
            } else if let Some(pending) = self.pending_transitions.get(&agent.target) {
                if pending.new_status == current_status_name {
                    // Still in same pending transition - check if threshold elapsed
                    if pending.first_seen.elapsed() >= threshold {
                        // Commit the transition
                        let pending = self.pending_transitions.remove(&agent.target).unwrap();
                        let prev_duration = committed.map(|c| ts.saturating_sub(c.committed_at_ms));

                        let screen_context = if !agent.last_content.is_empty() {
                            let lines: Vec<&str> = agent.last_content.lines().collect();
                            let start = lines.len().saturating_sub(20);
                            let tail = lines[start..].join("\n");
                            Some(if tail.len() > 2000 {
                                tail[..tail.floor_char_boundary(2000)].to_string()
                            } else {
                                tail
                            })
                        } else {
                            None
                        };

                        let (approval_type, approval_details) =
                            extract_approval_info(&agent.status);
                        self.audit_logger.log(&AuditEvent::StateChanged {
                            ts,
                            pane_id: agent.target.clone(),
                            agent_type: agent.agent_type.short_name().to_string(),
                            source,
                            prev_status: committed_status.to_string(),
                            new_status: current_status_name.clone(),
                            reason: pending.new_reason.clone(),
                            screen_context,
                            prev_state_duration_ms: prev_duration,
                            approval_type,
                            approval_details,
                        });

                        // Emit TeammateIdle when a team member transitions to idle
                        if current_status_name == "idle" && committed_status != "idle" {
                            self.emit_teammate_idle(agent);
                        }

                        self.previous_statuses.insert(
                            agent.target.clone(),
                            CommittedAgentState {
                                status: current_status_name.clone(),
                                full_status: agent.status.clone(),
                                reason: pending.new_reason,
                                agent_type: agent.agent_type.short_name().to_string(),
                                committed_at_ms: ts,
                            },
                        );
                    } else {
                        // Still within debounce window - override agent status for UI stability
                        if let Some(committed) = self.previous_statuses.get(&agent.target) {
                            agent.status = committed.full_status.clone();
                        }
                    }
                } else {
                    // Different pending status - replace pending transition
                    self.pending_transitions.insert(
                        agent.target.clone(),
                        PendingTransition {
                            new_status: current_status_name.clone(),
                            new_reason: reason,
                            first_seen: Instant::now(),
                        },
                    );
                    // Override agent status for UI stability
                    if let Some(committed) = self.previous_statuses.get(&agent.target) {
                        agent.status = match committed.status.as_str() {
                            "idle" => AgentStatus::Idle,
                            "processing" => AgentStatus::Processing {
                                activity: String::new(),
                            },
                            "error" => AgentStatus::Error {
                                message: String::new(),
                            },
                            _ => agent.status.clone(),
                        };
                    }
                }
            } else {
                // No pending transition yet - start one
                self.pending_transitions.insert(
                    agent.target.clone(),
                    PendingTransition {
                        new_status: current_status_name.clone(),
                        new_reason: reason,
                        first_seen: Instant::now(),
                    },
                );
                // Override agent status for UI stability
                if let Some(committed) = self.previous_statuses.get(&agent.target) {
                    agent.status = match committed.status.as_str() {
                        "idle" => AgentStatus::Idle,
                        "processing" => AgentStatus::Processing {
                            activity: String::new(),
                        },
                        "error" => AgentStatus::Error {
                            message: String::new(),
                        },
                        _ => agent.status.clone(),
                    };
                }
            }
        }

        self.previous_agent_ids = current_ids;
    }

    /// Emit a TeammateIdle event if the agent belongs to a team
    fn emit_teammate_idle(&self, agent: &MonitoredAgent) {
        if let Some(ref team_info) = agent.team_info {
            if let Some(ref tx) = self.event_tx {
                let _ = tx.send(CoreEvent::TeammateIdle {
                    target: agent.target.clone(),
                    team_name: team_info.team_name.clone(),
                    member_name: team_info.member_name.clone(),
                });
            }
        }
    }

    /// Apply spinner grace period to prevent Processing→Idle flicker.
    ///
    /// When a spinner disappears between tool calls, the detector briefly sees Idle
    /// before the next tool starts. This method holds the agent in Processing for
    /// up to 6 seconds after the last Processing detection.
    ///
    /// Approval and Error statuses always bypass the grace period.
    fn apply_grace_period(
        &mut self,
        target: &str,
        status: AgentStatus,
        detection_reason: &Option<DetectionReason>,
    ) -> AgentStatus {
        const GRACE_PERIOD_SECS: u64 = 6;

        match &status {
            AgentStatus::Processing { .. } => {
                // Update grace period timestamp
                self.grace_periods
                    .insert(target.to_string(), Instant::now());
                status
            }
            AgentStatus::AwaitingApproval { .. } | AgentStatus::Error { .. } => {
                // Always pass through immediately — these are high-priority states
                self.grace_periods.remove(target);
                status
            }
            AgentStatus::Idle | AgentStatus::Unknown => {
                // Check if grace period applies (Idle or low-confidence fallback)
                let is_low_confidence = detection_reason
                    .as_ref()
                    .map(|r| {
                        r.rule == "fallback_no_indicator"
                            || r.confidence == DetectionConfidence::Low
                    })
                    .unwrap_or(false);

                if is_low_confidence || matches!(status, AgentStatus::Idle) {
                    if let Some(last_processing) = self.grace_periods.get(target) {
                        if last_processing.elapsed().as_secs() < GRACE_PERIOD_SECS {
                            // Within grace period — maintain Processing
                            return AgentStatus::Processing {
                                activity: String::new(),
                            };
                        } else {
                            // Grace period expired — allow transition
                            self.grace_periods.remove(target);
                        }
                    }
                }
                status
            }
            _ => status,
        }
    }

    /// Fetch and apply git branch/dirty info for all agents
    async fn update_git_info(&mut self, agents: &mut [MonitoredAgent]) {
        for agent in agents.iter_mut() {
            if agent.is_virtual || agent.cwd.is_empty() {
                continue;
            }
            if let Some(info) = self.git_cache.get_info(&agent.cwd).await {
                agent.git_branch = Some(info.branch);
                agent.git_dirty = Some(info.dirty);
                agent.is_worktree = Some(info.is_worktree);
                agent.git_common_dir = info.common_dir.clone();
                agent.worktree_name = crate::git::extract_claude_worktree_name(&agent.cwd);
            }
        }
    }

    /// Apply cached git info on non-refresh polls (no git commands executed)
    fn apply_cached_git_info(&self, agents: &mut [MonitoredAgent]) {
        for agent in agents.iter_mut() {
            if agent.is_virtual || agent.cwd.is_empty() {
                continue;
            }
            if let Some(info) = self.git_cache.get_cached(&agent.cwd) {
                agent.git_branch = Some(info.branch);
                agent.git_dirty = Some(info.dirty);
                agent.is_worktree = Some(info.is_worktree);
                agent.git_common_dir = info.common_dir.clone();
                agent.worktree_name = crate::git::extract_claude_worktree_name(&agent.cwd);
            }
        }
    }

    /// Cleanup the process cache
    pub fn cleanup_cache(&self) {
        self.process_cache.cleanup();
    }
}

/// Helper to detect agent from pane info
#[allow(dead_code)]
pub fn detect_agent_from_pane(pane: &PaneInfo, client: &TmuxClient) -> Option<MonitoredAgent> {
    let agent_type = pane.detect_agent_type()?;

    let content_ansi = client.capture_pane(&pane.target).unwrap_or_default();
    let content = strip_ansi(&content_ansi);
    let title = client
        .get_pane_title(&pane.target)
        .unwrap_or(pane.title.clone());

    let detector = get_detector(&agent_type);
    let status = detector.detect_status(&title, &content);
    let context_warning = detector.detect_context_warning(&content);

    let mut agent = MonitoredAgent::new(
        pane.target.clone(),
        agent_type,
        title,
        pane.cwd.clone(),
        pane.pid,
        pane.session.clone(),
        pane.window_name.clone(),
        pane.window_index,
        pane.pane_index,
    );
    agent.status = status;
    agent.last_content = content;
    agent.last_content_ansi = content_ansi;
    agent.context_warning = context_warning;

    Some(agent)
}

fn strip_ansi(input: &str) -> String {
    // Remove OSC and CSI sequences for detection logic.
    static OSC_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)").unwrap());
    static CSI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]").unwrap());

    let without_osc = OSC_RE.replace_all(input, "");
    CSI_RE.replace_all(&without_osc, "").to_string()
}

/// Build `AgentTeamInfo` for a team member, finding their current in-progress task.
fn build_member_team_info(
    team_name: &str,
    member_name: &str,
    is_lead: bool,
    tasks: &[teams::TeamTask],
) -> AgentTeamInfo {
    let current_task = tasks
        .iter()
        .find(|t| t.owner.as_deref() == Some(member_name) && t.status == TaskStatus::InProgress)
        .map(|t| TeamTaskSummaryItem {
            id: t.id.clone(),
            subject: t.subject.clone(),
            status: t.status,
            active_form: t.active_form.clone(),
        });

    AgentTeamInfo {
        team_name: team_name.to_string(),
        member_name: member_name.to_string(),
        is_lead,
        current_task,
    }
}

/// Create a virtual `MonitoredAgent` for a team member whose pane was not found.
///
/// `cwd` is inherited from a matched teammate so virtual agents group correctly.
fn create_virtual_agent(
    team_name: &str,
    member_name: &str,
    team_info: AgentTeamInfo,
    cwd: &str,
) -> MonitoredAgent {
    let virtual_target = format!("~team:{}:{}", team_name, member_name);
    let mut agent = MonitoredAgent::new(
        virtual_target,
        AgentType::ClaudeCode,
        String::new(),
        cwd.to_string(),
        0,
        String::new(),
        String::new(),
        0,
        0,
    );
    agent.status = AgentStatus::Offline;
    agent.is_virtual = true;
    agent.team_info = Some(team_info);
    agent
}

/// Extract approval_type and approval_details from an AgentStatus for audit logging
fn extract_approval_info(status: &AgentStatus) -> (Option<String>, Option<String>) {
    if let AgentStatus::AwaitingApproval {
        approval_type,
        details,
    } = status
    {
        let type_str = match approval_type {
            ApprovalType::FileEdit => "file_edit".to_string(),
            ApprovalType::FileCreate => "file_create".to_string(),
            ApprovalType::FileDelete => "file_delete".to_string(),
            ApprovalType::ShellCommand => "shell_command".to_string(),
            ApprovalType::McpTool => "mcp_tool".to_string(),
            ApprovalType::UserQuestion { .. } => "user_question".to_string(),
            ApprovalType::Other(s) => format!("other:{}", s),
        };
        let details_opt = if details.is_empty() {
            None
        } else {
            Some(details.clone())
        };
        (Some(type_str), details_opt)
    } else {
        (None, None)
    }
}

/// Get a short name for an AgentStatus variant
fn status_name(status: &AgentStatus) -> &'static str {
    match status {
        AgentStatus::Idle => "idle",
        AgentStatus::Processing { .. } => "processing",
        AgentStatus::AwaitingApproval { .. } => "awaiting_approval",
        AgentStatus::Error { .. } => "error",
        AgentStatus::Offline => "offline",
        AgentStatus::Unknown => "unknown",
    }
}

/// Extract activity text from a tmux pane title
///
/// Strips Braille spinner characters (`⠂`, `⠐`) and mode icons, returning the
/// remaining text as activity.  Returns empty string when an idle indicator (`✳`)
/// is present or when no meaningful text remains.
fn extract_activity_from_title(title: &str) -> String {
    // Idle indicator means no processing activity
    if title.contains('✳') {
        return String::new();
    }
    let cleaned: String = title
        .chars()
        .filter(|&c| !matches!(c, '⠂' | '⠐' | '⏸' | '⇢' | '⏵'))
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.to_string()
}

/// Enrich IPC Processing status with screen-detected activity
///
/// When IPC reports Processing with empty activity, first try the screen-detected
/// activity, then fall back to extracting activity directly from the pane title.
fn enrich_ipc_activity(
    ipc_status: AgentStatus,
    screen_status: &AgentStatus,
    title: &str,
) -> AgentStatus {
    if let AgentStatus::Processing { ref activity } = ipc_status {
        if activity.is_empty() {
            // 1. Try screen-detected activity
            if let AgentStatus::Processing {
                activity: ref screen_activity,
            } = screen_status
            {
                if !screen_activity.is_empty() {
                    return AgentStatus::Processing {
                        activity: screen_activity.clone(),
                    };
                }
            }
            // 2. Fall back to title-based extraction
            let title_activity = extract_activity_from_title(title);
            if !title_activity.is_empty() {
                return AgentStatus::Processing {
                    activity: title_activity,
                };
            }
        }
    }
    ipc_status
}

/// Convert WrapState from state file to AgentStatus
fn wrap_state_to_agent_status(ws: &WrapState) -> AgentStatus {
    match ws.status {
        WrapStatus::Processing => AgentStatus::Processing {
            activity: String::new(),
        },
        WrapStatus::Idle => AgentStatus::Idle,
        WrapStatus::AwaitingApproval => {
            let approval_type = match ws.approval_type {
                Some(WrapApprovalType::UserQuestion) => ApprovalType::UserQuestion {
                    choices: ws.choices.clone(),
                    multi_select: ws.multi_select,
                    cursor_position: ws.cursor_position,
                },
                Some(WrapApprovalType::FileEdit) => ApprovalType::FileEdit,
                Some(WrapApprovalType::ShellCommand) => ApprovalType::ShellCommand,
                Some(WrapApprovalType::McpTool) => ApprovalType::McpTool,
                Some(WrapApprovalType::YesNo) => ApprovalType::Other("Yes/No".to_string()),
                Some(WrapApprovalType::Other) => ApprovalType::Other("Approval".to_string()),
                None => ApprovalType::Other("Approval".to_string()),
            };
            let details = ws.details.clone().unwrap_or_default();
            AgentStatus::AwaitingApproval {
                approval_type,
                details,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn test_poller_creation() {
        let settings = Settings::default();
        let state = AppState::shared();
        let ipc_registry = Arc::new(parking_lot::RwLock::new(std::collections::HashMap::new()));
        let _poller = Poller::new(settings, state, ipc_registry, None);
    }

    #[test]
    fn test_extract_activity_from_title() {
        // Braille spinner + text
        assert_eq!(extract_activity_from_title("⠐ Compacting"), "Compacting");
        assert_eq!(extract_activity_from_title("⠂ Levitating"), "Levitating");
        // Idle indicator → empty
        assert_eq!(extract_activity_from_title("✳"), "");
        assert_eq!(extract_activity_from_title("✳ idle text"), "");
        // Empty / whitespace
        assert_eq!(extract_activity_from_title(""), "");
        assert_eq!(extract_activity_from_title("   "), "");
        // Pure spinner chars
        assert_eq!(extract_activity_from_title("⠐"), "");
        // Mode icons stripped
        assert_eq!(extract_activity_from_title("⏸ ⠐ Planning"), "Planning");
    }

    #[test]
    fn test_enrich_ipc_activity_screen_priority() {
        let ipc = AgentStatus::Processing {
            activity: String::new(),
        };
        let screen = AgentStatus::Processing {
            activity: "✶ Compacting…".to_string(),
        };
        let result = enrich_ipc_activity(ipc, &screen, "⠐ Compacting");
        assert!(
            matches!(result, AgentStatus::Processing { ref activity } if activity == "✶ Compacting…")
        );
    }

    #[test]
    fn test_enrich_ipc_activity_title_fallback() {
        let ipc = AgentStatus::Processing {
            activity: String::new(),
        };
        // Screen returns Idle (e.g., ✳ in title caused screen detector to return Idle)
        let screen = AgentStatus::Idle;
        let result = enrich_ipc_activity(ipc, &screen, "⠐ Compacting");
        assert!(
            matches!(result, AgentStatus::Processing { ref activity } if activity == "Compacting")
        );
    }

    #[test]
    fn test_enrich_ipc_activity_no_enrichment_when_filled() {
        let ipc = AgentStatus::Processing {
            activity: "Already set".to_string(),
        };
        let screen = AgentStatus::Processing {
            activity: "Other".to_string(),
        };
        let result = enrich_ipc_activity(ipc, &screen, "⠐ Compacting");
        assert!(
            matches!(result, AgentStatus::Processing { ref activity } if activity == "Already set")
        );
    }
}
