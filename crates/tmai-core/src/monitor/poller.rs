use anyhow::Result;
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
use crate::hooks::registry::HookRegistry;
use crate::hooks::{HookState, HookStatus};
use crate::ipc::protocol::{WrapApprovalType, WrapState, WrapStatus};
use crate::ipc::server::IpcRegistry;
use crate::state::{MonitorScope, SharedState, TeamSnapshot};
use crate::teams::{self, TaskStatus};
use crate::tmux::{PaneInfo, ProcessCache};

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
    runtime: Arc<dyn crate::runtime::RuntimeAdapter>,
    process_cache: Arc<ProcessCache>,
    /// Cache for Claude Code settings (spinnerVerbs)
    claude_settings_cache: Arc<ClaudeSettingsCache>,
    settings: Settings,
    state: SharedState,
    /// IPC registry for reading wrapper states
    ipc_registry: IpcRegistry,
    /// Hook registry for HTTP hook-based agent state (highest priority)
    hook_registry: HookRegistry,
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
    /// Session discovery scanner for finding Claude Code instances without hooks
    session_scanner: crate::session_discovery::SessionDiscoveryScanner,
    /// Transcript watcher for JSONL conversation log monitoring
    transcript_watcher: crate::transcript::TranscriptWatcher,
}

/// Check if a PID is a descendant (child, grandchild, ...) of any PID in the set.
/// Walks up the process tree via /proc/{pid}/stat (max 5 levels to avoid loops).
fn is_descendant_of_any(pid: u32, ancestor_pids: &HashSet<u32>) -> bool {
    if ancestor_pids.contains(&pid) {
        return true;
    }
    let mut current = pid;
    for _ in 0..5 {
        let ppid = std::fs::read_to_string(format!("/proc/{}/stat", current))
            .ok()
            .and_then(|stat| {
                stat.split_whitespace()
                    .nth(3)
                    .and_then(|s| s.parse::<u32>().ok())
            });
        match ppid {
            Some(p) if p > 1 => {
                if ancestor_pids.contains(&p) {
                    return true;
                }
                current = p;
            }
            _ => break,
        }
    }
    false
}

impl Poller {
    /// Create a new poller
    pub fn new(
        settings: Settings,
        state: SharedState,
        runtime: Arc<dyn crate::runtime::RuntimeAdapter>,
        ipc_registry: IpcRegistry,
        hook_registry: HookRegistry,
        audit_event_rx: Option<tokio::sync::mpsc::UnboundedReceiver<AuditEvent>>,
    ) -> Self {
        // Capture current location at startup for scope filtering
        let (current_session, current_window) = match runtime.get_current_location() {
            Ok((session, window)) => (Some(session), Some(window)),
            Err(_) => (None, None),
        };

        let audit_logger = AuditLogger::new(settings.audit.enabled, settings.audit.max_size_bytes);

        Self {
            runtime,
            process_cache: Arc::new(ProcessCache::new()),
            claude_settings_cache: Arc::new(ClaudeSettingsCache::new()),
            settings,
            state,
            ipc_registry,
            hook_registry,
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
            session_scanner: crate::session_discovery::SessionDiscoveryScanner::new(),
            transcript_watcher: crate::transcript::TranscriptWatcher::new(
                crate::transcript::watcher::new_transcript_registry(),
            ),
        }
    }

    /// Create a new poller with a shared transcript registry
    ///
    /// Allows the transcript registry to be shared with TmaiCore for API access.
    pub fn new_with_transcript_registry(
        settings: Settings,
        state: SharedState,
        runtime: Arc<dyn crate::runtime::RuntimeAdapter>,
        ipc_registry: IpcRegistry,
        hook_registry: HookRegistry,
        audit_event_rx: Option<tokio::sync::mpsc::UnboundedReceiver<AuditEvent>>,
        transcript_registry: crate::transcript::TranscriptRegistry,
    ) -> Self {
        let (current_session, current_window) = match runtime.get_current_location() {
            Ok((session, window)) => (Some(session), Some(window)),
            Err(_) => (None, None),
        };

        let audit_logger = AuditLogger::new(settings.audit.enabled, settings.audit.max_size_bytes);

        Self {
            runtime,
            process_cache: Arc::new(ProcessCache::new()),
            claude_settings_cache: Arc::new(ClaudeSettingsCache::new()),
            settings,
            state,
            ipc_registry,
            hook_registry,
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
            session_scanner: crate::session_discovery::SessionDiscoveryScanner::new(),
            transcript_watcher: crate::transcript::TranscriptWatcher::new(transcript_registry),
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
        // Initialize grace periods for already-registered agents (e.g., restored PTY sessions)
        // so they don't immediately drop to Idle on the first poll.
        {
            let state = self.state.read();
            for (id, agent) in &state.agents {
                if matches!(agent.status, AgentStatus::Processing { .. }) {
                    self.grace_periods.insert(id.clone(), Instant::now());
                }
            }
        }

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
                        // Remove stale hook entries (> 2 minutes without events),
                        // but only if the process is confirmed dead.
                        // This prevents premature removal when hooks are slow.
                        const HOOK_STALE_MS: u64 = 120_000;
                        {
                            let mut reg = self.hook_registry.write();
                            reg.retain(|_pane_id, state| {
                                if state.is_fresh(HOOK_STALE_MS) {
                                    return true; // Still fresh, keep
                                }
                                // Stale — check process liveness before removing
                                if let Some(pid) = state.pid {
                                    if std::path::Path::new(&format!("/proc/{}", pid)).exists() {
                                        // Process alive, keep entry (hooks may resume)
                                        return true;
                                    }
                                }
                                false // Stale + dead process, remove
                            });
                        }
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

                    // Worktree scan (every 30 polls, offset from git scan)
                    if poll_count % 30 == 5 {
                        self.scan_worktrees(&agents).await;
                    }

                    // Session discovery (every 10 polls ≈ 5 seconds)
                    if poll_count.is_multiple_of(10) {
                        self.discover_sessions();
                    }

                    // Transcript polling (every 2 polls ≈ 1 second)
                    if poll_count.is_multiple_of(2) {
                        self.transcript_watcher.poll_updates();
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
        let mut all_panes = self.runtime.list_all_panes()?;

        // In standalone mode (or when panes are empty), synthesize PaneInfo
        // from HookRegistry entries that have no matching pane.
        // This allows hook-only agents to appear in the agent list.
        // Dedup by session_id: if multiple registry entries share the same
        // session_id (e.g., hook event and auto-discovery for the same instance),
        // prefer the non-discovered (hook) entry. Different sessions with the
        // same cwd are distinct agents and must all appear.
        {
            let hook_reg = self.hook_registry.read();
            let existing_pane_ids: HashSet<String> = all_panes
                .iter()
                .flat_map(|p| [p.pane_id.clone(), p.target.clone()])
                .collect();
            // Collect PIDs of existing tmux panes for dedup.
            let existing_pane_pids: HashSet<u32> = all_panes
                .iter()
                .filter(|p| p.pid > 0)
                .map(|p| p.pid)
                .collect();

            // Track which session_ids and PIDs we've already synthesized.
            // Both are needed because Claude Code can change session_id
            // within the same process (context restart / compaction).
            let mut synthesized_sids: HashSet<String> = HashSet::new();
            let mut synthesized_pids: HashSet<u32> = HashSet::new();

            // Collect identifiers of PTY-spawned agents — these are managed
            // separately via sync_pty_sessions and should not get duplicates.
            // Also collect their cwds to prevent hook synthesis for the same dir.
            let mut pty_cwds: HashSet<String> = HashSet::new();
            {
                let app_state = self.state.read();
                for agent in app_state.agents.values() {
                    if let Some(sid) = &agent.pty_session_id {
                        synthesized_sids.insert(sid.clone());
                    }
                    if agent.pty_session_id.is_some() {
                        if agent.pid > 0 {
                            synthesized_pids.insert(agent.pid);
                        }
                        pty_cwds.insert(agent.cwd.clone());
                    }
                }
            }

            // First pass: collect non-discovered entries (hook events have priority)
            let mut entries: Vec<(&String, &HookState)> = hook_reg.iter().collect();
            // Sort so that non-"discovered:" entries come first
            entries.sort_by_key(|(k, _)| k.starts_with("discovered:"));

            for (idx, (pane_id, hook_state)) in entries.iter().enumerate() {
                if !existing_pane_ids.contains(*pane_id) {
                    // Skip very stale entries (no activity for 2 minutes)
                    // These are leftover from previous tmai sessions
                    if !hook_state.is_fresh(120_000) {
                        continue;
                    }
                    let sid = &hook_state.session_id;
                    let pid = hook_state.pid.unwrap_or(0);

                    let hook_cwd = hook_state.cwd.as_deref().unwrap_or("");
                    // Skip Codex WS synthetic entries when a Codex agent with the
                    // same cwd already exists in the pane list (via tmux pane or
                    // another hook entry). The WS hook state enriches the existing
                    // agent's detection; it should not create a duplicate.
                    if pane_id.starts_with("codex-ws-") && !hook_cwd.is_empty() {
                        let codex_already_present = all_panes
                            .iter()
                            .any(|p| p.cwd == hook_cwd && !p.pane_id.starts_with("codex-ws-"));
                        if codex_already_present {
                            continue;
                        }
                    }
                    // Skip if we already have an entry for this session_id, PID,
                    // if a PTY agent with the same cwd exists, or if this PID
                    // is a child of an existing tmux pane process
                    let is_pane_child = pid > 0 && is_descendant_of_any(pid, &existing_pane_pids);
                    if synthesized_sids.contains(sid)
                        || (pid > 0 && synthesized_pids.contains(&pid))
                        || is_pane_child
                        || (!hook_cwd.is_empty() && pty_cwds.contains(hook_cwd))
                    {
                        continue;
                    }
                    synthesized_sids.insert(sid.clone());
                    if pid > 0 {
                        synthesized_pids.insert(pid);
                    }

                    let cwd = hook_state.cwd.as_deref().unwrap_or("/unknown").to_string();

                    // Synthesize a PaneInfo for this hook-only agent
                    // Use source_agent from HookState to determine the correct command name
                    let agent_cmd = hook_state
                        .source_agent
                        .as_ref()
                        .map(|a| a.command().to_string())
                        .unwrap_or_else(|| "claude".to_string());
                    let pane_idx = (idx + 1) as u32;
                    let target = format!("hook:0.{}", pane_idx);
                    all_panes.push(PaneInfo {
                        target,
                        session: "hook".to_string(),
                        window_index: 0,
                        pane_index: pane_idx,
                        pane_id: (*pane_id).clone(),
                        window_name: agent_cmd.clone(),
                        command: agent_cmd,
                        pid: hook_state.pid.unwrap_or(0),
                        title: String::new(),
                        cwd,
                    });
                }
            }
        }

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
                // 3-tier detection: Hook → IPC → capture-pane
                // Read state from each registry
                let hook_state = {
                    let registry = self.hook_registry.read();
                    // Look up by pane_id first (HTTP hooks), then by target (WS hooks)
                    registry
                        .get(&pane.pane_id)
                        .or_else(|| registry.get(&pane.target))
                        .cloned()
                };
                let wrap_state = {
                    let registry = self.ipc_registry.read();
                    registry.get(&pane.pane_id).cloned()
                };
                let is_selected = selected_agent_id.as_ref() == Some(&pane.target);

                // Hook freshness threshold: 30 seconds
                const HOOK_FRESHNESS_MS: u64 = 30_000;
                // Processing timeout: if Processing with no event for this long,
                // assume Stop event was missed and check process liveness
                const PROCESSING_TIMEOUT_MS: u64 = 120_000;
                let has_fresh_hook = hook_state
                    .as_ref()
                    .map(|hs| hs.is_fresh(HOOK_FRESHNESS_MS))
                    .unwrap_or(false);

                // Optimize capture-pane based on selection and detection source:
                // - Selected: ANSI capture for preview (always needed)
                // - Non-selected + audit + hook: plain capture for validation
                // - Non-selected + hook/IPC (no audit): skip capture-pane entirely
                // - Non-selected + capture-pane mode: plain capture for detection only
                let audit_enabled = self.settings.audit.enabled;
                let (mut content_ansi, mut content) = if is_selected {
                    // Selected agent: full ANSI capture for preview
                    let ansi = self.runtime.capture_pane(&pane.target).unwrap_or_default();
                    let plain = strip_ansi(&ansi);
                    (ansi, plain)
                } else if audit_enabled && has_fresh_hook {
                    // Non-selected + audit + hook: plain capture for validation
                    let plain = self
                        .runtime
                        .capture_pane_plain(&pane.target)
                        .unwrap_or_default();
                    (String::new(), plain)
                } else if has_fresh_hook || wrap_state.is_some() {
                    // Non-selected + hook/IPC mode: skip capture-pane entirely
                    (String::new(), String::new())
                } else {
                    // Non-selected + capture-pane mode: plain capture for detection
                    let plain = self
                        .runtime
                        .capture_pane_plain(&pane.target)
                        .unwrap_or_default();
                    (String::new(), plain)
                };

                // Fallback chain for empty content (standalone/webui mode):
                // 1. transcript preview (D-2) — richest
                // 2. activity log (D-1) — lightweight
                if content.trim().is_empty() {
                    // Try transcript preview first
                    let transcript_preview = {
                        let t_reg = self.transcript_watcher.registry().read();
                        t_reg
                            .get(&pane.pane_id)
                            .filter(|ts| !ts.preview_text.is_empty())
                            .map(|ts| ts.preview_text.clone())
                    };

                    if let Some(preview) = transcript_preview {
                        content = preview.clone();
                        content_ansi = preview;
                    } else if let Some(ref hs) = hook_state {
                        // Fallback to activity log
                        if !hs.activity_log.is_empty() {
                            let log_text =
                                crate::hooks::handler::format_activity_log(&hs.activity_log);
                            if !log_text.is_empty() {
                                content = log_text.clone();
                                content_ansi = log_text;
                            }
                        }
                    }
                }

                // Start transcript watching if hook_state has transcript_path
                if let Some(ref hs) = hook_state {
                    if let Some(ref path) = hs.transcript_path {
                        // Start watching if not already watched
                        self.transcript_watcher
                            .start_watching(&pane.pane_id, path, &hs.session_id);
                    }
                }

                let title = self
                    .runtime
                    .get_pane_title(&pane.target)
                    .unwrap_or(pane.title.clone());

                // Determine status using 3-tier priority:
                // 1. HTTP Hook (fresh) — highest fidelity
                // 2. IPC Socket — high fidelity
                // 3. capture-pane — fallback
                let mut screen_override = false;
                let (status, context_warning, detection_reason) = if has_fresh_hook {
                    // Tier 1: Hook-based detection
                    let hs = hook_state.as_ref().unwrap();
                    let mut status = hook_state_to_agent_status(hs);

                    // Processing timeout guard: if Processing for too long without
                    // any new hook event, the Stop event was likely missed.
                    // Check process liveness and demote to Idle if stale.
                    if matches!(status, AgentStatus::Processing { .. })
                        && !hs.is_fresh(PROCESSING_TIMEOUT_MS)
                    {
                        // Verify process is still alive before demoting
                        let process_alive = hs
                            .pid
                            .map(|pid| std::path::Path::new(&format!("/proc/{}", pid)).exists())
                            .unwrap_or(true); // assume alive if PID unknown

                        if !process_alive {
                            tracing::debug!(
                                pane_id = %pane.pane_id,
                                pid = ?hs.pid,
                                last_event_age_ms = hs.last_event_at,
                                "Hook Processing timeout: process dead, demoting to Idle"
                            );
                            status = AgentStatus::Idle;
                            // Also update the hook registry to prevent repeated timeout checks
                            let mut reg = self.hook_registry.write();
                            if let Some(state) = reg.get_mut(&pane.pane_id) {
                                state.status = HookStatus::Idle;
                                state.last_tool = None;
                                state.touch();
                            }
                        } else {
                            tracing::debug!(
                                pane_id = %pane.pane_id,
                                elapsed_ms = %crate::hooks::types::current_time_millis()
                                    .saturating_sub(hs.last_event_at),
                                "Hook Processing stale but process alive, keeping Processing"
                            );
                        }
                    }

                    let matched_text = hs.last_tool.as_ref().map(|t| format!("tool: {}", t));
                    let reason = DetectionReason {
                        rule: "http_hook".to_string(),
                        confidence: DetectionConfidence::High,
                        matched_text,
                    };

                    // Validation: compare IPC/capture-pane against hook ground truth
                    if audit_enabled {
                        let hook_status_str = status_name(&status).to_string();
                        let hook_event = hs.last_context.event_name.clone();

                        // IPC validation
                        let ipc_status_str = wrap_state
                            .as_ref()
                            .map(|ws| status_name(&wrap_state_to_agent_status(ws)).to_string());
                        let ipc_agrees = ipc_status_str.as_ref().map(|s| *s == hook_status_str);

                        // capture-pane validation
                        let (capture_status_str, capture_reason) = if !content.is_empty() {
                            let detection_context = DetectionContext {
                                cwd: Some(pane.cwd.as_str()),
                                settings_cache: Some(&self.claude_settings_cache),
                            };
                            let detector = get_detector(&agent_type);
                            let result = detector.detect_status_with_reason(
                                &title,
                                &content,
                                &detection_context,
                            );
                            (status_name(&result.status).to_string(), result.reason)
                        } else {
                            (
                                "unknown".to_string(),
                                DetectionReason {
                                    rule: "no_capture".to_string(),
                                    confidence: DetectionConfidence::Low,
                                    matched_text: None,
                                },
                            )
                        };
                        let capture_agrees = capture_status_str == hook_status_str;

                        // Log only on disagreement
                        if !capture_agrees || ipc_agrees == Some(false) {
                            let screen_context = if !content.is_empty() {
                                let lines: Vec<&str> = content.lines().collect();
                                let start = lines.len().saturating_sub(10);
                                let tail = lines[start..].join("\n");
                                let truncated = if tail.len() > 1000 {
                                    tail[..tail.floor_char_boundary(1000)].to_string()
                                } else {
                                    tail
                                };
                                Some(truncated)
                            } else {
                                None
                            };

                            // Truncate tool_input to max 500 chars
                            let hook_tool_input = hs.last_context.tool_input.as_ref().map(|v| {
                                let s = v.to_string();
                                if s.len() > 500 {
                                    serde_json::Value::String(
                                        s[..s.floor_char_boundary(500)].to_string(),
                                    )
                                } else {
                                    v.clone()
                                }
                            });

                            let ts = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;

                            self.audit_logger.log(&AuditEvent::DetectionValidation {
                                ts,
                                pane_id: pane.pane_id.clone(),
                                agent_type: agent_type.short_name().to_string(),
                                hook_status: hook_status_str,
                                hook_event,
                                ipc_status: ipc_status_str,
                                capture_status: capture_status_str,
                                capture_reason,
                                ipc_agrees,
                                capture_agrees,
                                hook_tool_input,
                                hook_permission_mode: hs.last_context.permission_mode.clone(),
                                screen_context,
                            });
                        }
                    }

                    (status, None, Some(reason))
                } else if let Some(ref ws) = wrap_state {
                    // Tier 2: IPC-based detection (existing logic)
                    let status = wrap_state_to_agent_status(ws);

                    // P1: IPC Approval lag correction — when IPC reports non-Approval,
                    // check screen content for High-confidence Approval patterns
                    if !matches!(status, AgentStatus::AwaitingApproval { .. }) {
                        // Reuse existing content if available (selected agent already has
                        // plain text from ANSI capture), otherwise capture for non-selected agents
                        let plain = if !content.is_empty() {
                            content.clone()
                        } else {
                            self.runtime
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
                    // Tier 3: capture-pane fallback
                    let detection_context = DetectionContext {
                        cwd: Some(pane.cwd.as_str()),
                        settings_cache: Some(&self.claude_settings_cache),
                    };

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
                // Track all available connection channels independently
                let is_real_tmux_pane = !pane.session.starts_with("hook")
                    && !pane.session.starts_with("discovered")
                    && !pane.session.starts_with("pty");
                let is_ws_source = hook_state
                    .as_ref()
                    .map(|hs| hs.session_id.starts_with("codex-ws-"))
                    .unwrap_or(false);
                // connection_channels: whether channel *exists* (not just fresh)
                let hook_registered = hook_state.is_some();
                agent.connection_channels = crate::agents::ConnectionChannels {
                    has_tmux: is_real_tmux_pane,
                    has_ipc: wrap_state.is_some(),
                    has_hook: hook_registered && !is_ws_source,
                    has_websocket: hook_registered && is_ws_source,
                };

                // detection_source: which method was actually used for this poll cycle
                agent.detection_source = if has_fresh_hook {
                    if is_ws_source {
                        DetectionSource::WebSocket
                    } else {
                        DetectionSource::HttpHook
                    }
                } else if screen_override {
                    DetectionSource::CapturePane
                } else if wrap_state.is_some() {
                    DetectionSource::IpcSocket
                } else {
                    DetectionSource::CapturePane
                };

                // Detect permission mode and effort level from title/content
                match agent.agent_type {
                    AgentType::ClaudeCode => {
                        agent.mode = ClaudeCodeDetector::detect_mode(&agent.title);
                        agent.effort_level = ClaudeCodeDetector::detect_effort_level(&agent.title);
                    }
                    AgentType::GeminiCli => {
                        agent.mode = GeminiDetector::detect_mode(&agent.last_content);
                    }
                    _ => {}
                }

                // Propagate hook-tracked metrics (subagent count, compaction count)
                // and structured tool data for auto-approve slow path
                if let Some(hs) = hook_state.as_ref() {
                    agent.active_subagents = hs.active_subagents;
                    agent.compaction_count = hs.compaction_count;
                    agent.model_id = hs.model_id.clone();
                    // Propagate tool_name/tool_input for AwaitingApproval slow path
                    if hs.status == crate::hooks::types::HookStatus::AwaitingApproval {
                        agent.hook_tool_name = hs.last_tool.clone();
                        agent.hook_tool_input = hs.last_context.tool_input.clone();
                    }
                    // Propagate statusline data (cost, context, version, session_name)
                    if let Some(ref sl) = hs.statusline {
                        if let Some(ref cost) = sl.cost {
                            agent.cost_usd = cost.total_cost_usd;
                            agent.duration_ms = cost.total_duration_ms;
                            agent.lines_added = cost.total_lines_added;
                            agent.lines_removed = cost.total_lines_removed;
                        }
                        if let Some(ref cw) = sl.context_window {
                            agent.context_used_pct = cw.used_percentage;
                            agent.context_window_size = cw.context_window_size;
                        }
                        agent.claude_version = sl.version.clone();
                        agent.session_name = sl.session_name.clone();
                    }
                }

                // Propagate cursor position from IPC (VT100 parser in PTY wrapper).
                // cursor_row is screen-relative (VT100 parser uses scrollback=0),
                // which matches the visible content returned by capture_pane for
                // wrapped agents. No history_size offset is needed here (unlike tmux mode).
                if let Some(ref ws) = wrap_state {
                    agent.cursor_x = Some(ws.cursor_col.into());
                    agent.cursor_y = Some(ws.cursor_row.into());
                }

                // Determine send capability (best available tier)
                agent.send_capability = if wrap_state.is_some() {
                    // Tier 1: IPC — tmai wrap holds PTY master
                    crate::agents::SendCapability::Ipc
                } else if !pane.session.starts_with("hook")
                    && !pane.session.starts_with("discovered")
                {
                    // Tier 2: tmux send-keys — real tmux pane
                    crate::agents::SendCapability::Tmux
                } else if pane.pid > 0 && crate::pty_inject::is_tiocsti_available() {
                    // Tier 3: PTY inject — PID known AND TIOCSTI enabled
                    crate::agents::SendCapability::PtyInject
                } else {
                    // No send path available (PID unknown or TIOCSTI disabled)
                    crate::agents::SendCapability::None
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
                let member_cfg = team_config.members.iter().find(|m| &m.name == member_name);
                let is_lead = team_config
                    .members
                    .first()
                    .map(|m| &m.name == member_name)
                    .unwrap_or(false);

                let team_info = build_member_team_info(
                    &team_config.team_name,
                    member_name,
                    member_cfg.and_then(|m| m.agent_type.as_deref()),
                    is_lead,
                    &tasks,
                );

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
                        member.agent_type.as_deref(),
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
            for pane_target in final_mapping.values() {
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
            }

            // Also include worktree names from team config (including unmapped members)
            for member in &team_config.members {
                if let Some(wt_name) = member.worktree_name() {
                    if !worktree_names.contains(&wt_name) {
                        worktree_names.push(wt_name);
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
                let member_cfg = snapshot
                    .config
                    .members
                    .iter()
                    .find(|m| &m.name == member_name);
                let is_lead = snapshot
                    .config
                    .members
                    .first()
                    .map(|m| &m.name == member_name)
                    .unwrap_or(false);

                let team_info = build_member_team_info(
                    &snapshot.config.team_name,
                    member_name,
                    member_cfg.and_then(|m| m.agent_type.as_deref()),
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
                        member.agent_type.as_deref(),
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
                    self.drain_prompt_queue(&agent.target);
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
                            self.drain_prompt_queue(&agent.target);
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
                            tracing::trace!(
                                target = %agent.target,
                                detected = %current_status_name,
                                shown = %committed.status,
                                "Debounce: suppressing status flicker"
                            );
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

    /// Drain one prompt from the queue for an agent that just became Idle.
    ///
    /// Pops the front prompt from `AppState::prompt_queue` and emits a
    /// `CoreEvent::PromptReady` event so that the main loop can deliver it.
    fn drain_prompt_queue(&self, target: &str) {
        let prompt = {
            let mut state = self.state.write();
            state
                .prompt_queue
                .get_mut(target)
                .and_then(|q| q.pop_front())
        };
        if let Some(prompt) = prompt {
            // Clean up empty queues
            {
                let mut state = self.state.write();
                if let Some(q) = state.prompt_queue.get(target) {
                    if q.is_empty() {
                        state.prompt_queue.remove(target);
                    }
                }
            }
            if let Some(ref tx) = self.event_tx {
                let _ = tx.send(CoreEvent::PromptReady {
                    target: target.to_string(),
                    prompt,
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

                // Detect base branch for worktrees that don't have one set
                if info.is_worktree && agent.worktree_base_branch.is_none() {
                    if let Some(ref common_dir) = info.common_dir {
                        let repo_dir = crate::git::strip_git_suffix(common_dir);
                        if let Some(branch_info) = crate::git::list_branches(repo_dir).await {
                            agent.worktree_base_branch = Some(branch_info.default_branch);
                        }
                    }
                }
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

    /// Scan all known git repositories for worktrees and update AppState
    /// Discover Claude Code sessions from filesystem and register them in HookRegistry
    fn discover_sessions(&mut self) {
        // First, clean up discovered entries that now have a hook entry
        // (hook event arrived after discovery for same cwd)
        {
            let reg = self.hook_registry.read();
            let discovered_keys: Vec<String> = reg
                .keys()
                .filter(|k| k.starts_with("discovered:"))
                .cloned()
                .collect();
            let mut to_remove = Vec::new();
            for key in &discovered_keys {
                if let Some(discovered_state) = reg.get(key) {
                    let discovered_sid = &discovered_state.session_id;
                    let discovered_pid = discovered_state.pid;
                    // Check if another (non-discovered) entry matches by
                    // session_id or PID. Do NOT match by cwd alone — multiple
                    // sessions can share the same working directory.
                    let has_hook_entry = reg.iter().any(|(k, hs)| {
                        if k.starts_with("discovered:") {
                            return false;
                        }
                        hs.session_id == *discovered_sid
                            || (discovered_pid.is_some() && hs.pid == discovered_pid)
                    });
                    if has_hook_entry {
                        // Transfer PID to the hook entry before removing
                        if let Some(pid) = discovered_pid {
                            let hook_key = reg
                                .iter()
                                .find(|(k, hs)| {
                                    !k.starts_with("discovered:")
                                        && (hs.session_id == *discovered_sid || hs.pid == Some(pid))
                                })
                                .map(|(k, _)| k.clone());
                            if let Some(hk) = hook_key {
                                to_remove.push((key.clone(), Some((hk, pid))));
                                continue;
                            }
                        }
                        to_remove.push((key.clone(), None));
                    }
                }
            }
            drop(reg);
            if !to_remove.is_empty() {
                let mut reg = self.hook_registry.write();
                for (key, pid_transfer) in &to_remove {
                    reg.remove(key);
                    // Transfer PID from discovered entry to the hook entry
                    if let Some((hook_key, pid)) = pid_transfer {
                        if let Some(hook_state) = reg.get_mut(hook_key) {
                            if hook_state.pid.is_none() {
                                hook_state.pid = Some(*pid);
                            }
                        }
                    }
                    tracing::debug!(
                        pane_id = %key,
                        "Removed discovered entry superseded by hook registration"
                    );
                }
            }
        }

        let (new_sessions, disappeared_pids) = self.session_scanner.scan();

        // Keep discovered entries fresh so they don't expire from the
        // 30-second hook freshness window. Without this, discovered
        // sessions with no hook events would fall through to capture-pane
        // fallback (which returns empty for synthesized panes) → Processing.
        {
            let mut reg = self.hook_registry.write();
            for (key, state) in reg.iter_mut() {
                if key.starts_with("discovered:") {
                    state.last_event_at = crate::hooks::types::current_time_millis();
                }
            }
        }

        for session in new_sessions {
            let pane_id = format!("discovered:{}", session.pid);

            // Skip if this PID or session_id is already known via hooks
            // or as a tmux pane (prevents double-counting in webui+tmux mode).
            let already_known = {
                let reg = self.hook_registry.read();
                let known_via_hooks = reg.iter().any(|(k, hs)| {
                    !k.starts_with("discovered:")
                        && (hs.session_id == session.session_id || hs.pid == Some(session.pid))
                });
                let known_via_pane = {
                    let state = self.state.read();
                    state
                        .agents
                        .values()
                        .any(|a| a.pid == session.pid && !a.target.starts_with("discovered:"))
                };
                known_via_hooks || known_via_pane
            };
            if already_known {
                tracing::debug!(
                    pid = session.pid,
                    session_id = %session.session_id,
                    "Session already known via hooks, skipping discovery"
                );
                continue;
            }

            // In standalone/webui mode, check if a hook entry with pid=None
            // exists that could be the same process. This handles the case
            // where hook events arrived before session_discovery but without
            // PID info. Only one pid=None entry should exist per cwd in this
            // mode, so cwd-based matching is safe.
            // In tmux mode, multiple agents can share the same cwd, so this
            // merge is skipped to avoid misattributing PIDs.
            let mut merged = false;
            if self.settings.webui {
                let proc_cwd = std::fs::read_link(format!("/proc/{}/cwd", session.pid))
                    .ok()
                    .map(|p| p.to_string_lossy().to_string());

                let mut reg = self.hook_registry.write();
                let matching_key = reg
                    .iter()
                    .find(|(k, hs)| {
                        if k.starts_with("discovered:") || hs.pid.is_some() {
                            return false;
                        }
                        // Match by cwd if hook entry has one
                        if let Some(hook_cwd) = &hs.cwd {
                            return hook_cwd == &session.cwd;
                        }
                        // Match by /proc/{pid}/cwd if hook entry has no cwd
                        if let Some(ref pc) = proc_cwd {
                            return pc == &session.cwd;
                        }
                        false
                    })
                    .map(|(k, _)| k.clone());
                if let Some(key) = matching_key {
                    if let Some(state) = reg.get_mut(&key) {
                        state.pid = Some(session.pid);
                        if state.cwd.is_none() {
                            state.cwd = Some(session.cwd.clone());
                        }
                        // Extract model_id if not yet known
                        if state.model_id.is_none() {
                            if let Some(ref path) = state.transcript_path {
                                state.model_id = crate::transcript::parser::extract_model_id(path);
                            }
                        }
                        tracing::debug!(
                            pid = session.pid,
                            pane_id = %key,
                            "Merged discovered PID into existing hook entry"
                        );
                        merged = true;
                    }
                }
            }
            if merged {
                self.session_scanner.known_pids_mut().insert(session.pid);
                continue;
            }

            // Register in HookRegistry so the synthesize logic picks it up
            let mut state = HookState::new(session.session_id.clone(), Some(session.cwd.clone()));
            state.transcript_path = session.transcript_path;
            // Extract model_id from transcript if available
            if let Some(ref path) = state.transcript_path {
                state.model_id = crate::transcript::parser::extract_model_id(path);
            }
            state.pid = Some(session.pid);
            let mut reg = self.hook_registry.write();
            reg.insert(pane_id.clone(), state);
            tracing::info!(
                pid = session.pid,
                session_id = %session.session_id,
                cwd = %session.cwd,
                pane_id = %pane_id,
                "Auto-discovered Claude Code session"
            );
        }

        // Remove disappeared sessions
        for pid in disappeared_pids {
            let pane_id = format!("discovered:{}", pid);
            let mut reg = self.hook_registry.write();
            if reg.remove(&pane_id).is_some() {
                tracing::info!(pid, pane_id = %pane_id, "Removed disappeared discovered session");
            }
        }
    }

    async fn scan_worktrees(&self, agents: &[MonitoredAgent]) {
        use crate::git;
        use crate::state::{RepoWorktreeInfo, WorktreeDetail};
        use std::collections::HashMap;

        // Collect unique git common dirs → list of agents in that repo
        let mut repo_agents: HashMap<String, Vec<&MonitoredAgent>> = HashMap::new();
        for agent in agents {
            if agent.is_virtual {
                continue;
            }
            if let Some(ref common_dir) = agent.git_common_dir {
                repo_agents
                    .entry(common_dir.clone())
                    .or_default()
                    .push(agent);
            }
        }

        // Also include registered projects (even without agents)
        {
            let state = self.state.read();
            for project_path in &state.registered_projects {
                let git_dir = format!("{}/.git", project_path);
                repo_agents.entry(git_dir).or_default();
            }
        }

        if repo_agents.is_empty() {
            let mut state = self.state.write();
            state.worktree_info.clear();
            return;
        }

        let mut result: Vec<RepoWorktreeInfo> = Vec::new();

        for (common_dir, repo_agents_list) in &repo_agents {
            // Derive the repo root from the common_dir (strip /.git suffix)
            let repo_root = common_dir
                .strip_suffix("/.git")
                .unwrap_or(common_dir)
                .to_string();
            let repo_name = git::repo_name_from_common_dir(common_dir);

            let entries = git::list_worktrees(&repo_root).await;
            if entries.is_empty() {
                continue;
            }

            let mut worktrees: Vec<WorktreeDetail> = entries
                .into_iter()
                .map(|entry| {
                    // Determine worktree name
                    let name = if entry.is_main {
                        "main".to_string()
                    } else {
                        git::extract_claude_worktree_name(&entry.path).unwrap_or_else(|| {
                            // Fallback: use last path component
                            entry
                                .path
                                .rsplit('/')
                                .next()
                                .unwrap_or("unknown")
                                .to_string()
                        })
                    };

                    // Find agent working in this worktree path
                    // Use Path::starts_with for component-level matching
                    // (avoids false positives like "/app-v2" matching "/app")
                    let linked_agent = repo_agents_list
                        .iter()
                        .find(|a| std::path::Path::new(&a.cwd).starts_with(&entry.path));

                    // Check if this worktree has a pending agent spawn
                    let is_pending = {
                        let state = self.state.read();
                        const PENDING_AGENT_GRACE_SECS: u64 = 60;
                        state
                            .pending_agent_worktrees
                            .get(&entry.path)
                            .is_some_and(|t| t.elapsed().as_secs() < PENDING_AGENT_GRACE_SECS)
                    };

                    WorktreeDetail {
                        name,
                        path: entry.path,
                        branch: entry.branch,
                        is_main: entry.is_main,
                        agent_target: linked_agent.map(|a| a.target.clone()),
                        agent_status: linked_agent.map(|a| a.status.clone()),
                        is_dirty: linked_agent.and_then(|a| a.git_dirty),
                        diff_summary: None, // populated below for non-main worktrees
                        agent_pending: linked_agent.is_none() && is_pending,
                    }
                })
                .collect();

            // Determine default branch from main worktree entry
            let default_branch = worktrees
                .iter()
                .find(|wt| wt.is_main)
                .and_then(|wt| wt.branch.clone())
                .unwrap_or_else(|| "main".to_string());

            // Fetch diff stats for non-main worktrees (lightweight, parallel)
            // Use agent's worktree_base_branch if available, otherwise default branch
            let diff_futures: Vec<_> = worktrees
                .iter()
                .enumerate()
                .filter(|(_, wt)| !wt.is_main)
                .map(|(idx, wt)| {
                    let path = wt.path.clone();
                    // Find linked agent's base branch setting
                    let base = repo_agents_list
                        .iter()
                        .find(|a| std::path::Path::new(&a.cwd).starts_with(&path))
                        .and_then(|a| a.worktree_base_branch.clone())
                        .unwrap_or_else(|| default_branch.clone());
                    async move { (idx, git::fetch_diff_stat(&path, &base).await) }
                })
                .collect();

            let diff_results = futures_util::future::join_all(diff_futures).await;
            for (idx, summary) in diff_results {
                if let Some(s) = summary {
                    worktrees[idx].diff_summary = Some(s);
                }
            }

            result.push(RepoWorktreeInfo {
                repo_name,
                repo_path: common_dir.clone(),
                worktrees,
            });
        }

        // Sort by repo name for consistent display
        result.sort_by(|a, b| a.repo_name.cmp(&b.repo_name));

        let mut state = self.state.write();

        // Clear pending agent entries: agent detected, or grace period expired
        const PENDING_AGENT_GRACE_SECS: u64 = 60;
        let detected_paths: Vec<String> = result
            .iter()
            .flat_map(|repo| &repo.worktrees)
            .filter(|wt| wt.agent_target.is_some())
            .map(|wt| wt.path.clone())
            .collect();
        for path in &detected_paths {
            state.pending_agent_worktrees.remove(path);
        }
        // Expire stale entries
        state
            .pending_agent_worktrees
            .retain(|_, spawned_at| spawned_at.elapsed().as_secs() < PENDING_AGENT_GRACE_SECS);

        state.worktree_info = result;
    }

    /// Cleanup the process cache
    pub fn cleanup_cache(&self) {
        self.process_cache.cleanup();
    }
}

/// Helper to detect agent from pane info
#[allow(dead_code)]
pub fn detect_agent_from_pane(
    pane: &PaneInfo,
    runtime: &dyn crate::runtime::RuntimeAdapter,
) -> Option<MonitoredAgent> {
    let agent_type = pane.detect_agent_type()?;

    let content_ansi = runtime.capture_pane(&pane.target).unwrap_or_default();
    let content = strip_ansi(&content_ansi);
    let title = runtime
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

/// Re-export from utils for local use
fn strip_ansi(input: &str) -> String {
    crate::utils::strip_ansi(input)
}

/// Build `AgentTeamInfo` for a team member, finding their current in-progress task.
fn build_member_team_info(
    team_name: &str,
    member_name: &str,
    agent_type: Option<&str>,
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
        agent_type: agent_type.map(|s| s.to_string()),
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

/// Convert HookState to AgentStatus (delegates to handler module)
fn hook_state_to_agent_status(hs: &crate::hooks::types::HookState) -> AgentStatus {
    crate::hooks::handler::hook_status_to_agent_status(hs)
}

/// Convert WrapState to AgentStatus
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
        let hook_registry = crate::hooks::new_hook_registry();
        let runtime: Arc<dyn crate::runtime::RuntimeAdapter> =
            Arc::new(crate::runtime::StandaloneAdapter::new());
        let _poller = Poller::new(settings, state, runtime, ipc_registry, hook_registry, None);
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

    /// hook_state_to_agent_status with a tool name shows "Tool: <name>"
    #[test]
    fn test_hook_state_to_agent_status_with_tool() {
        use crate::hooks::types::{HookState, HookStatus};
        let mut hs = HookState::new("s1".into(), None);
        hs.status = HookStatus::Processing;
        hs.last_tool = Some("Bash".to_string());

        let status = hook_state_to_agent_status(&hs);
        assert!(
            matches!(status, AgentStatus::Processing { ref activity } if activity == "Tool: Bash")
        );
    }

    /// hook_state_to_agent_status with None last_tool shows empty activity
    #[test]
    fn test_hook_state_to_agent_status_no_tool() {
        use crate::hooks::types::{HookState, HookStatus};
        let mut hs = HookState::new("s1".into(), None);
        hs.status = HookStatus::Processing;
        hs.last_tool = None;

        let status = hook_state_to_agent_status(&hs);
        assert!(matches!(status, AgentStatus::Processing { ref activity } if activity.is_empty()));
    }

    /// hook_state_to_agent_status filters empty string tool name
    #[test]
    fn test_hook_state_to_agent_status_empty_tool_name_filtered() {
        use crate::hooks::types::{HookState, HookStatus};
        let mut hs = HookState::new("s1".into(), None);
        hs.status = HookStatus::Processing;
        hs.last_tool = Some(String::new()); // empty string

        let status = hook_state_to_agent_status(&hs);
        // Should NOT produce "Tool: ", should be empty activity
        assert!(
            matches!(status, AgentStatus::Processing { ref activity } if activity.is_empty()),
            "Empty tool name should be filtered, not displayed as 'Tool: '"
        );
    }

    /// hook_state_to_agent_status for Idle status
    #[test]
    fn test_hook_state_to_agent_status_idle() {
        use crate::hooks::types::{HookState, HookStatus};
        let hs = HookState::new("s1".into(), None);
        assert_eq!(hs.status, HookStatus::Idle);

        let status = hook_state_to_agent_status(&hs);
        assert!(matches!(status, AgentStatus::Idle));
    }

    /// hook_state_to_agent_status for AwaitingApproval status
    #[test]
    fn test_hook_state_to_agent_status_awaiting_approval() {
        use crate::hooks::types::{HookState, HookStatus};
        let mut hs = HookState::new("s1".into(), None);
        hs.status = HookStatus::AwaitingApproval;
        hs.last_tool = Some("Bash".to_string());

        let status = hook_state_to_agent_status(&hs);
        assert!(matches!(
            status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::Other(_),
                details,
            } if details == "Bash"
        ));
    }

    #[test]
    fn test_hook_state_to_agent_status_awaiting_approval_ask_user_question() {
        use crate::hooks::types::{HookState, HookStatus};
        let mut hs = HookState::new("s1".into(), None);
        hs.status = HookStatus::AwaitingApproval;
        hs.last_tool = Some("AskUserQuestion".to_string());

        let status = hook_state_to_agent_status(&hs);
        assert!(matches!(
            status,
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::UserQuestion {
                    ref choices,
                    multi_select: false,
                    cursor_position: 0,
                },
                ref details,
            } if choices.is_empty() && details.is_empty()
        ));
    }

    /// hook_state_to_agent_status maps Compacting to Processing with activity
    #[test]
    fn test_hook_state_to_agent_status_compacting() {
        use crate::hooks::types::{HookState, HookStatus};
        let mut hs = HookState::new("s1".into(), None);
        hs.status = HookStatus::Compacting;

        let status = hook_state_to_agent_status(&hs);
        match status {
            AgentStatus::Processing { ref activity } => {
                assert!(
                    activity.contains("Compacting"),
                    "Compacting status should produce 'Compacting' activity, got: {}",
                    activity
                );
            }
            _ => panic!("Expected Processing status, got {:?}", status),
        }
    }
}
