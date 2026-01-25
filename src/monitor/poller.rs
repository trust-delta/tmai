use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::interval;

use crate::agents::MonitoredAgent;
use crate::config::Settings;
use crate::detectors::get_detector;
use crate::state::SharedState;
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
    settings: Settings,
    state: SharedState,
}

impl Poller {
    /// Create a new poller
    pub fn new(settings: Settings, state: SharedState) -> Self {
        Self {
            client: TmuxClient::with_capture_lines(settings.capture_lines),
            process_cache: Arc::new(ProcessCache::new()),
            settings,
            state,
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
        let mut poll_interval = interval(Duration::from_millis(self.settings.poll_interval_ms));

        loop {
            poll_interval.tick().await;

            // Check if we should stop
            {
                let state = self.state.read();
                if !state.running {
                    break;
                }
            }

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

        // Filter and convert to monitored agents
        let mut agents = Vec::new();

        for pane in panes {
            if let Some(agent_type) = pane.detect_agent_type() {
                // Capture pane content (plain for detection, ANSI for preview)
                let content = self.client.capture_pane_plain(&pane.target).unwrap_or_default();
                let content_ansi = self.client.capture_pane(&pane.target).unwrap_or_default();
                let title = self.client.get_pane_title(&pane.target).unwrap_or(pane.title.clone());

                // Detect status using appropriate detector
                let detector = get_detector(&agent_type);
                let status = detector.detect_status(&title, &content);

                let mut agent = MonitoredAgent::new(
                    pane.target.clone(),
                    agent_type,
                    title,
                    pane.cwd.clone(),
                    pane.pid,
                    pane.session.clone(),
                    pane.window_index,
                    pane.pane_index,
                );
                agent.status = status;
                agent.last_content = content;
                agent.last_content_ansi = content_ansi;

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

    /// Cleanup the process cache
    pub fn cleanup_cache(&self) {
        self.process_cache.cleanup();
    }
}

/// Helper to detect agent from pane info
#[allow(dead_code)]
pub fn detect_agent_from_pane(
    pane: &PaneInfo,
    client: &TmuxClient,
) -> Option<MonitoredAgent> {
    let agent_type = pane.detect_agent_type()?;

    let content = client.capture_pane_plain(&pane.target).unwrap_or_default();
    let content_ansi = client.capture_pane(&pane.target).unwrap_or_default();
    let title = client.get_pane_title(&pane.target).unwrap_or(pane.title.clone());

    let detector = get_detector(&agent_type);
    let status = detector.detect_status(&title, &content);

    let mut agent = MonitoredAgent::new(
        pane.target.clone(),
        agent_type,
        title,
        pane.cwd.clone(),
        pane.pid,
        pane.session.clone(),
        pane.window_index,
        pane.pane_index,
    );
    agent.status = status;
    agent.last_content = content;
    agent.last_content_ansi = content_ansi;

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
