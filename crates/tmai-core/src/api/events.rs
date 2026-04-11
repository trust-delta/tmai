//! Core event system for push-based change notification.
//!
//! The event system supports two modes:
//! - **Bridge mode**: `start_monitoring()` spawns a Poller internally and
//!   bridges `PollMessage` → `CoreEvent` automatically (for headless/webui).
//! - **External mode**: The consumer (TUI) runs its own Poller and calls
//!   `notify_agents_updated()` / `notify_teams_updated()` to emit events.

use std::fmt;

use tokio::sync::broadcast;

use crate::hooks::WorktreeInfo;
use crate::review::ReviewRequest;

use super::core::TmaiCore;

/// The type of guardrail that was exceeded
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GuardrailKind {
    /// CI fix attempts exceeded max_ci_retries
    CiRetries,
    /// Review→fix cycles exceeded max_review_loops
    ReviewLoops,
    /// Consecutive failures exceeded escalate_to_human_after
    ConsecutiveFailures,
}

impl fmt::Display for GuardrailKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GuardrailKind::CiRetries => write!(f, "CI retries"),
            GuardrailKind::ReviewLoops => write!(f, "review loops"),
            GuardrailKind::ConsecutiveFailures => write!(f, "consecutive failures"),
        }
    }
}

/// Events emitted by the core when state changes occur.
///
/// Consumers call [`TmaiCore::subscribe()`] to receive these events
/// via a `broadcast::Receiver`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum CoreEvent {
    /// The full agent list was refreshed (after a poll cycle)
    AgentsUpdated,

    /// A single agent changed status
    AgentStatusChanged {
        /// Agent target ID
        target: String,
        /// Previous status description
        old_status: String,
        /// New status description
        new_status: String,
    },

    /// A new agent appeared
    AgentAppeared {
        /// Agent target ID
        target: String,
    },

    /// An agent disappeared
    AgentDisappeared {
        /// Agent target ID
        target: String,
    },

    /// Team data was refreshed
    TeamsUpdated,

    /// A team member became idle (waiting for next task)
    TeammateIdle {
        /// Agent target ID
        target: String,
        /// Team name
        team_name: String,
        /// Member name
        member_name: String,
    },

    /// A new task was created
    TaskCreated {
        /// Team name
        team_name: String,
        /// Task ID
        task_id: String,
        /// Task subject
        task_subject: String,
    },

    /// A task was completed
    TaskCompleted {
        /// Team name
        team_name: String,
        /// Task ID
        task_id: String,
        /// Task subject
        task_subject: String,
    },

    /// Claude Code configuration file was changed
    ConfigChanged {
        /// Agent target ID
        target: String,
        /// Config source (e.g., "user_settings", "project_settings")
        source: String,
        /// Changed file path
        file_path: String,
    },

    /// A git worktree was created
    WorktreeCreated {
        /// Agent target ID
        target: String,
        /// Worktree details (name, path, branch, original_repo)
        worktree: Option<WorktreeInfo>,
    },

    /// A git worktree was removed
    WorktreeRemoved {
        /// Agent target ID
        target: String,
        /// Worktree details (name, path, branch, original_repo)
        worktree: Option<WorktreeInfo>,
    },

    /// CLAUDE.md or `.claude/rules/*.md` files were loaded into context
    ///
    /// Added in Claude Code v2.1.69. Fires when instruction files are loaded.
    InstructionsLoaded {
        /// Agent target ID
        target: String,
    },

    /// An agent stopped (completed or paused), emitted by hook handler
    AgentStopped {
        /// Agent target ID
        target: String,
        /// Working directory
        cwd: String,
        /// Last assistant message (if available)
        last_assistant_message: Option<String>,
    },

    /// Context compaction started (PreCompact hook event)
    ContextCompacting {
        /// Agent target ID
        target: String,
        /// How many compactions have occurred in this session
        compaction_count: u32,
    },

    /// An agent completed work and is ready for fresh-session review
    ReviewReady {
        /// Review request with context for launching a review session
        request: ReviewRequest,
    },

    /// A review session was successfully launched
    ReviewLaunched {
        /// Original agent target that was reviewed
        source_target: String,
        /// tmux target of the review pane
        review_target: String,
    },

    /// A review session completed and produced results
    ReviewCompleted {
        /// Original agent target that was reviewed
        source_target: String,
        /// One-line summary (first line of review output)
        summary: String,
    },

    /// Worktree setup commands completed successfully
    WorktreeSetupCompleted {
        /// Absolute path to the worktree
        worktree_path: String,
        /// Branch name
        branch: String,
    },

    /// Worktree setup commands failed
    WorktreeSetupFailed {
        /// Absolute path to the worktree
        worktree_path: String,
        /// Branch name
        branch: String,
        /// Error message
        error: String,
    },

    /// A queued prompt is ready to be delivered (agent transitioned to Idle)
    PromptReady {
        /// Agent target ID
        target: String,
        /// The prompt text to send
        prompt: String,
    },

    /// Usage data was updated (after a fetch cycle)
    UsageUpdated,

    /// A tool call was deferred for external resolution
    ToolCallDeferred {
        /// Unique deferred call ID
        defer_id: u64,
        /// Agent target/pane ID
        target: String,
        /// Tool name
        tool_name: String,
    },

    /// A worktree branch was successfully rebased onto the default branch
    RebaseSucceeded {
        /// Branch that was rebased
        branch: String,
        /// Worktree path
        worktree_path: String,
    },

    /// A worktree branch rebase failed due to conflicts
    RebaseConflict {
        /// Branch that had conflicts
        branch: String,
        /// Worktree path
        worktree_path: String,
        /// Error details
        error: String,
    },

    /// A deferred tool call was resolved (approved/denied)
    ToolCallResolved {
        /// Unique deferred call ID
        defer_id: u64,
        /// Agent target/pane ID
        target: String,
        /// Resolution: "allow" or "deny"
        decision: String,
        /// Who resolved it (e.g., "human", "ai:haiku", "timeout")
        resolved_by: String,
    },

    /// A new PR was detected by the PR monitor
    PrCreated {
        /// PR number
        pr_number: u64,
        /// PR title
        title: String,
        /// Head branch name
        branch: String,
    },

    /// CI checks passed for a PR
    PrCiPassed {
        /// PR number
        pr_number: u64,
        /// PR title
        title: String,
        /// Summary of passed checks
        checks_summary: String,
    },

    /// CI checks failed for a PR
    PrCiFailed {
        /// PR number
        pr_number: u64,
        /// PR title
        title: String,
        /// Details of failed checks
        failed_details: String,
    },

    /// A PR received review feedback (changes requested)
    PrReviewFeedback {
        /// PR number
        pr_number: u64,
        /// PR title
        title: String,
        /// Summary of review comments
        comments_summary: String,
    },

    /// A PR was closed (merged or closed without merging)
    PrClosed {
        /// PR number
        pr_number: u64,
        /// PR title
        title: String,
        /// Head branch name
        branch: String,
    },

    /// A guardrail limit was exceeded (CI retries, review loops, or consecutive failures)
    GuardrailExceeded {
        /// The type of guardrail that was exceeded
        guardrail: GuardrailKind,
        /// Associated branch
        branch: String,
        /// Associated PR number (if any)
        pr_number: Option<u64>,
        /// Current count that exceeded the limit
        count: u64,
        /// The configured limit
        limit: u64,
    },

    /// A side-effect API action was performed (for orchestrator notification)
    ActionPerformed {
        /// Who initiated the action
        origin: super::types::ActionOrigin,
        /// API action name (e.g., "dispatch_issue", "kill_agent", "merge_pr")
        action: String,
        /// Human-readable summary of the action
        summary: String,
    },
}

impl TmaiCore {
    /// Subscribe to core events.
    ///
    /// Returns a broadcast receiver that will receive [`CoreEvent`]s.
    /// If the receiver falls behind, older events are dropped (lagged).
    pub fn subscribe(&self) -> broadcast::Receiver<CoreEvent> {
        self.event_sender().subscribe()
    }

    /// Notify subscribers that the agent list was updated.
    ///
    /// Called by external consumers (e.g. TUI main loop) after processing
    /// `PollMessage::AgentsUpdated`. Ignored if no subscribers are listening.
    pub fn notify_agents_updated(&self) {
        let _ = self.event_sender().send(CoreEvent::AgentsUpdated);
    }

    /// Notify subscribers that team data was updated.
    ///
    /// Called by external consumers after team scan completes.
    pub fn notify_teams_updated(&self) {
        let _ = self.event_sender().send(CoreEvent::TeamsUpdated);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::builder::TmaiCoreBuilder;
    use crate::config::Settings;

    #[tokio::test]
    async fn test_subscribe_receives_events() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        // Send an event via the internal sender
        let tx = core.event_sender();
        tx.send(CoreEvent::AgentsUpdated).unwrap();

        let event = rx.recv().await.unwrap();
        assert!(matches!(event, CoreEvent::AgentsUpdated));
    }

    #[tokio::test]
    async fn test_subscribe_multiple_receivers() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx1 = core.subscribe();
        let mut rx2 = core.subscribe();

        let tx = core.event_sender();
        tx.send(CoreEvent::TeamsUpdated).unwrap();

        let e1 = rx1.recv().await.unwrap();
        let e2 = rx2.recv().await.unwrap();
        assert!(matches!(e1, CoreEvent::TeamsUpdated));
        assert!(matches!(e2, CoreEvent::TeamsUpdated));
    }

    #[tokio::test]
    async fn test_notify_agents_updated() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        core.notify_agents_updated();

        let event = rx.recv().await.unwrap();
        assert!(matches!(event, CoreEvent::AgentsUpdated));
    }

    #[tokio::test]
    async fn test_notify_teams_updated() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        core.notify_teams_updated();

        let event = rx.recv().await.unwrap();
        assert!(matches!(event, CoreEvent::TeamsUpdated));
    }

    #[test]
    fn test_notify_no_subscribers() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        // Should not panic even with no subscribers
        core.notify_agents_updated();
        core.notify_teams_updated();
    }
}
