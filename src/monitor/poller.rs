use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

use crate::agents::{
    AgentStatus, AgentTeamInfo, ApprovalType, DetectionSource, MonitoredAgent, TeamTaskSummaryItem,
};
use crate::config::{ClaudeSettingsCache, Settings};
use crate::detectors::{get_detector, DetectionContext};
use crate::state::{MonitorScope, SharedState, TeamSnapshot};
use crate::teams::{self, TaskStatus};
use crate::tmux::{PaneInfo, ProcessCache, TmuxClient};
use crate::wrap::state_file::{self, WrapApprovalType, WrapState, WrapStatus};

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
    /// Current session name (captured at startup)
    current_session: Option<String>,
    /// Current window index (captured at startup)
    current_window: Option<u32>,
}

impl Poller {
    /// Create a new poller
    pub fn new(settings: Settings, state: SharedState) -> Self {
        let client = TmuxClient::with_capture_lines(settings.capture_lines);

        // Capture current location at startup for scope filtering
        let (current_session, current_window) = match client.get_current_location() {
            Ok((session, window)) => (Some(session), Some(window)),
            Err(_) => (None, None),
        };

        Self {
            client,
            process_cache: Arc::new(ProcessCache::new()),
            claude_settings_cache: Arc::new(ClaudeSettingsCache::new()),
            settings,
            state,
            current_session,
            current_window,
        }
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
    async fn run(self, tx: mpsc::Sender<PollMessage>) {
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
                Ok(mut agents) => {
                    backoff_ms = 0;
                    last_error = None;
                    last_error_at = None;

                    // Periodic cache cleanup (every 10 polls)
                    poll_count = poll_count.wrapping_add(1);
                    if poll_count.is_multiple_of(10) {
                        self.process_cache.cleanup();
                    }

                    // Team scanning at configured interval
                    if self.settings.teams.enabled
                        && poll_count.is_multiple_of(self.settings.teams.scan_interval)
                    {
                        self.scan_and_apply_teams(&mut agents);
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

                    if should_send {
                        if tx.send(PollMessage::Error(err_str.clone())).await.is_err() {
                            break;
                        }
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
    async fn poll_once(&self) -> Result<Vec<MonitoredAgent>> {
        // List all panes
        let panes = if self.settings.attached_only {
            self.client.list_panes()?
        } else {
            self.client.list_all_panes()?
        };

        // Get current monitor scope and selected agent ID from state
        let (monitor_scope, selected_agent_id) = {
            let state = self.state.read();
            let selected_id = state.agent_order.get(state.selected_index).cloned();
            (state.monitor_scope, selected_id)
        };

        // Filter panes based on scope
        let panes: Vec<PaneInfo> = panes
            .into_iter()
            .filter(|pane| self.matches_scope(pane, monitor_scope))
            .collect();

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
                // Try to read state from wrap state file first
                // Use pane_id (global unique ID like "5" from "%5") not pane_index (local window index)
                let wrap_state = state_file::read_state(&pane.pane_id).ok();
                let is_selected = selected_agent_id.as_ref() == Some(&pane.target);

                // Optimize capture-pane based on selection and PTY state:
                // - Selected: ANSI capture for preview
                // - Non-selected + PTY: skip capture-pane entirely (state from file)
                // - Non-selected + capture-pane mode: plain capture for detection only
                let (content_ansi, content) = if is_selected {
                    // Selected agent: full ANSI capture for preview
                    let ansi = self.client.capture_pane(&pane.target).unwrap_or_default();
                    let plain = strip_ansi(&ansi);
                    (ansi, plain)
                } else if wrap_state.is_some() {
                    // Non-selected + PTY mode: skip capture-pane entirely
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

                // Determine status: use wrap state file if available, otherwise detect from content
                let (status, context_warning) = if let Some(ref ws) = wrap_state {
                    // Convert WrapState to AgentStatus
                    let status = wrap_state_to_agent_status(ws);
                    // No context warning from wrap state for now
                    (status, None)
                } else {
                    // Build detection context for this pane
                    let detection_context = DetectionContext {
                        cwd: Some(pane.cwd.as_str()),
                        settings_cache: Some(&self.claude_settings_cache),
                    };

                    // Detect status using appropriate detector
                    let detector = get_detector(&agent_type);
                    let status =
                        detector.detect_status_with_context(&title, &content, &detection_context);
                    let context_warning = detector.detect_context_warning(&content);
                    (status, context_warning)
                };

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
                agent.detection_source = if wrap_state.is_some() {
                    DetectionSource::PtyStateFile
                } else {
                    DetectionSource::CapturePane
                };

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

        Ok(agents)
    }

    /// Scan for teams and apply team info to agents
    fn scan_and_apply_teams(&self, agents: &mut [MonitoredAgent]) {
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

        // Collect agent pids for mapping
        let agent_pids: Vec<(String, u32)> =
            agents.iter().map(|a| (a.target.clone(), a.pid)).collect();

        let mut snapshots: HashMap<String, TeamSnapshot> = HashMap::new();

        for team_config in &team_configs {
            // Scan tasks for this team
            let tasks = teams::scan_tasks(&team_config.team_name).unwrap_or_default();

            // Map members to panes
            let member_panes = teams::map_members_to_panes(team_config, &agent_pids);

            // Also try env var based matching via process cache
            let mut env_mapping: HashMap<String, String> = HashMap::new();
            for (target, pid) in &agent_pids {
                if let Some(task_list_id) = self
                    .process_cache
                    .get_env_var(*pid, "CLAUDE_CODE_TASK_LIST_ID")
                {
                    if task_list_id == team_config.team_name {
                        // Found a match - try to identify which member
                        for member in &team_config.members {
                            if let Some(agent_id) =
                                self.process_cache.get_env_var(*pid, "CLAUDE_AGENT_ID")
                            {
                                if agent_id == member.agent_id {
                                    env_mapping.insert(member.name.clone(), target.clone());
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Merge mappings (env-based takes priority)
            let mut final_mapping = member_panes;
            for (name, target) in env_mapping {
                final_mapping.insert(name, target);
            }

            // Apply team info to matching agents
            for (member_name, pane_target) in &final_mapping {
                if let Some(agent) = agents.iter_mut().find(|a| &a.target == pane_target) {
                    let is_lead = team_config
                        .members
                        .first()
                        .map(|m| &m.name == member_name)
                        .unwrap_or(false);

                    // Find current task for this member
                    let current_task = tasks
                        .iter()
                        .find(|t| {
                            t.owner.as_deref() == Some(member_name)
                                && t.status == TaskStatus::InProgress
                        })
                        .map(|t| TeamTaskSummaryItem {
                            id: t.id.clone(),
                            subject: t.subject.clone(),
                            status: t.status,
                        });

                    agent.team_info = Some(AgentTeamInfo {
                        team_name: team_config.team_name.clone(),
                        member_name: member_name.clone(),
                        is_lead,
                        current_task,
                    });
                }
            }

            snapshots.insert(
                team_config.team_name.clone(),
                TeamSnapshot {
                    config: team_config.clone(),
                    tasks,
                    member_panes: final_mapping,
                    last_scan: chrono::Utc::now(),
                },
            );
        }

        // Update state with team snapshots
        let mut state = self.state.write();
        state.teams = snapshots;
    }

    /// Check if a pane matches the current monitor scope
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
        let _poller = Poller::new(settings, state);
    }
}
