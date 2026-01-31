use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::agents::MonitoredAgent;
use crate::config::{ClaudeSettingsCache, Settings};
use crate::detectors::{get_detector, DetectionContext};
use crate::state::{MonitorScope, SharedState};
use crate::tmux::{PaneInfo, ProcessCache, TmuxClient};

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
            let interval_ms = if is_passthrough {
                fast_interval
            } else {
                normal_interval
            };
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;

            match self.poll_once().await {
                Ok(agents) => {
                    if tx.send(PollMessage::AgentsUpdated(agents)).await.is_err() {
                        break; // Receiver dropped
                    }
                }
                Err(e) => {
                    if tx.send(PollMessage::Error(e.to_string())).await.is_err() {
                        break;
                    }
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

        // Get current monitor scope from state
        let monitor_scope = {
            let state = self.state.read();
            state.monitor_scope
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
                // Capture pane content (plain for detection, ANSI for preview)
                let content = match self.client.capture_pane_plain(&pane.target) {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::debug!("Failed to capture pane {}: {}", pane.target, e);
                        String::new()
                    }
                };
                let content_ansi = match self.client.capture_pane(&pane.target) {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::debug!("Failed to capture pane ANSI {}: {}", pane.target, e);
                        String::new()
                    }
                };
                let title = self
                    .client
                    .get_pane_title(&pane.target)
                    .unwrap_or(pane.title.clone());

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

    let content = client.capture_pane_plain(&pane.target).unwrap_or_default();
    let content_ansi = client.capture_pane(&pane.target).unwrap_or_default();
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
