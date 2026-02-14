use std::time::{Duration, Instant};
use tokio::sync::mpsc;

use crate::agents::{AgentMode, AgentStatus, AgentType, DetectionSource, MonitoredAgent};
use crate::monitor::PollMessage;
use crate::state::SharedState;

use super::content;
use super::scenario::{self, DemoScenario};

/// Action sent from UI to DemoPoller when user interacts
#[derive(Debug)]
pub enum DemoAction {
    /// User pressed 'y' to approve
    Approve { target: String },
    /// User selected a numbered choice (1-indexed)
    SelectChoice { target: String, choice_num: usize },
    /// User pressed 'n' to reject
    Reject { target: String },
}

/// Demo poller that replaces the real Poller in demo mode
pub struct DemoPoller {
    state: SharedState,
    action_rx: mpsc::Receiver<DemoAction>,
}

/// Per-agent runtime state during demo
struct AgentRuntime {
    /// Whether this agent is waiting for user action before resuming
    wait_for_action: bool,
    /// The elapsed time when wait_for_action was set (to compute offset)
    paused_at: Option<Duration>,
    /// Accumulated pause duration (subtracted from elapsed for timeline)
    pause_offset: Duration,
    /// Index of the next timeline event for this agent
    next_event_idx: Option<usize>,
    /// Current content key
    content_key: &'static str,
    /// Current status
    status: AgentStatus,
}

impl DemoPoller {
    /// Create a new DemoPoller
    ///
    /// Returns (DemoPoller, Sender for DemoActions)
    pub fn new(state: SharedState) -> (Self, mpsc::Sender<DemoAction>) {
        let (action_tx, action_rx) = mpsc::channel(32);
        (Self { state, action_rx }, action_tx)
    }

    /// Start the demo poller, returning a receiver for poll messages (same interface as Poller)
    pub fn start(self) -> mpsc::Receiver<PollMessage> {
        let (tx, rx) = mpsc::channel(32);

        tokio::spawn(async move {
            self.run(tx).await;
        });

        rx
    }

    /// Main demo loop
    async fn run(mut self, tx: mpsc::Sender<PollMessage>) {
        let scenario = scenario::default_scenario();
        let start = Instant::now();

        // Build per-agent runtime state
        let mut runtimes: Vec<AgentRuntime> = scenario
            .agents
            .iter()
            .enumerate()
            .map(|(idx, _)| {
                // Find first event for this agent
                let first = scenario.timeline.iter().position(|e| e.agent_idx == idx);
                AgentRuntime {
                    wait_for_action: false,
                    paused_at: None,
                    pause_offset: Duration::ZERO,
                    next_event_idx: first,
                    content_key: "idle",
                    status: AgentStatus::Idle,
                }
            })
            .collect();

        // Build index: for each agent, the ordered list of timeline event indices
        let agent_event_indices: Vec<Vec<usize>> = (0..scenario.agents.len())
            .map(|agent_idx| {
                scenario
                    .timeline
                    .iter()
                    .enumerate()
                    .filter(|(_, e)| e.agent_idx == agent_idx)
                    .map(|(i, _)| i)
                    .collect()
            })
            .collect();

        // Send initial state
        let agents = self.build_agents(&scenario, &runtimes);
        let _ = tx.send(PollMessage::AgentsUpdated(agents)).await;

        let mut interval = tokio::time::interval(Duration::from_millis(100));
        let mut quit_scheduled: Option<Instant> = None;

        loop {
            interval.tick().await;

            // Check for user actions
            while let Ok(action) = self.action_rx.try_recv() {
                self.handle_action(
                    &action,
                    &scenario,
                    &mut runtimes,
                    &agent_event_indices,
                    start,
                );
            }

            // Process timeline events
            let elapsed = start.elapsed();
            let mut changed = false;

            for (agent_idx, runtime) in runtimes.iter_mut().enumerate() {
                if runtime.wait_for_action {
                    continue; // Paused, waiting for user
                }

                // Effective elapsed for this agent (subtracting pause time)
                let effective = elapsed.saturating_sub(runtime.pause_offset);

                if let Some(event_idx) = runtime.next_event_idx {
                    let event = &scenario.timeline[event_idx];
                    if effective >= event.at {
                        // Check for quit sentinel
                        if event.content_key == "quit" {
                            quit_scheduled = Some(Instant::now());
                            runtime.next_event_idx =
                                Self::next_agent_event(event_idx, agent_idx, &agent_event_indices);
                            continue;
                        }

                        // Apply event
                        runtime.status = event.status.clone();
                        runtime.content_key = event.content_key;

                        if event.wait_for_action {
                            runtime.wait_for_action = true;
                            runtime.paused_at = Some(elapsed);
                        }

                        // Advance to next event for this agent
                        runtime.next_event_idx =
                            Self::next_agent_event(event_idx, agent_idx, &agent_event_indices);
                        changed = true;
                    }
                }
            }

            // Auto-quit after sentinel + delay
            if let Some(quit_at) = quit_scheduled {
                if quit_at.elapsed() >= Duration::from_secs(2) {
                    let mut state = self.state.write();
                    state.running = false;
                    break;
                }
            }

            if changed {
                let agents = self.build_agents(&scenario, &runtimes);
                let _ = tx.send(PollMessage::AgentsUpdated(agents)).await;
            }
        }
    }

    /// Find the next timeline event index for a given agent after current_event_idx
    fn next_agent_event(
        current_event_idx: usize,
        agent_idx: usize,
        agent_event_indices: &[Vec<usize>],
    ) -> Option<usize> {
        let indices = &agent_event_indices[agent_idx];
        let pos = indices.iter().position(|&i| i == current_event_idx);
        pos.and_then(|p| indices.get(p + 1).copied())
    }

    /// Handle a user action
    fn handle_action(
        &self,
        action: &DemoAction,
        scenario: &DemoScenario,
        runtimes: &mut [AgentRuntime],
        _agent_event_indices: &[Vec<usize>],
        start: Instant,
    ) {
        let target = match action {
            DemoAction::Approve { target }
            | DemoAction::SelectChoice { target, .. }
            | DemoAction::Reject { target } => target,
        };

        // Find matching agent
        let agent_idx = scenario.agents.iter().position(|a| a.target == *target);

        let Some(agent_idx) = agent_idx else {
            return;
        };

        let runtime = &mut runtimes[agent_idx];
        if !runtime.wait_for_action {
            return; // Not waiting for action
        }

        // Resume: transition to Processing
        runtime.wait_for_action = false;

        // Calculate how long we were paused and add to offset
        if let Some(paused_at) = runtime.paused_at.take() {
            let now = start.elapsed();
            let pause_duration = now.saturating_sub(paused_at);
            runtime.pause_offset += pause_duration;
        }

        // Set to Processing after approval
        runtime.status = AgentStatus::Processing {
            activity: String::new(),
        };
        runtime.content_key = match action {
            DemoAction::Approve { .. } => "processing_read",
            DemoAction::SelectChoice { .. } => "processing_read",
            DemoAction::Reject { .. } => "idle",
        };
    }

    /// Build the initial agent list for pre-populating state before main loop starts.
    ///
    /// This ensures agents are visible on the very first frame.
    pub fn build_initial_agents() -> Vec<MonitoredAgent> {
        let scenario = scenario::default_scenario();
        let runtimes: Vec<AgentRuntime> = scenario
            .agents
            .iter()
            .enumerate()
            .map(|(idx, _)| {
                let first = scenario.timeline.iter().position(|e| e.agent_idx == idx);
                AgentRuntime {
                    wait_for_action: false,
                    paused_at: None,
                    pause_offset: Duration::ZERO,
                    next_event_idx: first,
                    content_key: "idle",
                    status: AgentStatus::Idle,
                }
            })
            .collect();
        Self::build_agents_static(&scenario, &runtimes)
    }

    /// Build the list of MonitoredAgents from current runtime state
    fn build_agents(
        &self,
        scenario: &DemoScenario,
        runtimes: &[AgentRuntime],
    ) -> Vec<MonitoredAgent> {
        Self::build_agents_static(scenario, runtimes)
    }

    /// Shared implementation for building agents list
    fn build_agents_static(
        scenario: &DemoScenario,
        runtimes: &[AgentRuntime],
    ) -> Vec<MonitoredAgent> {
        scenario
            .agents
            .iter()
            .zip(runtimes.iter())
            .map(|(def, rt)| {
                let content = content::get_content(rt.content_key).to_string();
                let mut agent = MonitoredAgent::new(
                    def.target.clone(),
                    def.agent_type.clone(),
                    make_title(&def.agent_type, &rt.status),
                    def.cwd.clone(),
                    0, // pid
                    def.session.clone(),
                    String::new(),
                    def.window_index,
                    def.pane_index,
                );
                agent.status = rt.status.clone();
                agent.last_content = strip_ansi(&content);
                agent.last_content_ansi = content;
                agent.detection_source = DetectionSource::IpcSocket;
                agent.git_branch = def.git_branch.clone();
                agent.mode = AgentMode::Default;
                agent
            })
            .collect()
    }
}

/// Generate a plausible title based on agent type and status
fn make_title(agent_type: &AgentType, status: &AgentStatus) -> String {
    match agent_type {
        AgentType::ClaudeCode => match status {
            AgentStatus::Idle => "\u{2733} Claude Code".to_string(),
            AgentStatus::Processing { .. } => "\u{2810} Claude Code".to_string(),
            AgentStatus::AwaitingApproval { .. } => "\u{2733} Claude Code".to_string(),
            _ => "Claude Code".to_string(),
        },
        AgentType::GeminiCli => "Gemini CLI".to_string(),
        other => other.short_name().to_string(),
    }
}

/// Strip ANSI escape sequences for plain-text content
fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip until 'm' (SGR terminator) or end
            while let Some(&next) = chars.peek() {
                chars.next();
                if next == 'm' {
                    break;
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}
