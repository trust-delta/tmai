//! Core event system for push-based change notification.
//!
//! The event system supports two modes:
//! - **Bridge mode**: `start_monitoring()` spawns a Poller internally and
//!   bridges `PollMessage` → `CoreEvent` automatically (for headless/webui).
//! - **External mode**: The consumer (TUI) runs its own Poller and calls
//!   `notify_agents_updated()` / `notify_teams_updated()` to emit events.

use std::fmt;

use tokio::sync::broadcast;

use crate::agents::DetectionSource;
use crate::error::{ErrorCode, TmaiError};
use crate::hooks::WorktreeInfo;

use super::core::TmaiCore;
use super::types::ActionOrigin;

/// The type of guardrail that was exceeded
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(
        export,
        export_to = "../../tmai-app/web/src/types/generated/",
        rename_all = "snake_case"
    )
)]
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

/// Stable identifier for a dispatch bundle (a logical grouping of
/// sub-dispatches — e.g. "apply the same change across 4 repos").
///
/// Serialized transparently as a plain string so that existing log and
/// event consumers can treat the field as an opaque identifier without
/// needing to know the wrapper type.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(
        export,
        export_to = "../../tmai-app/web/src/types/generated/",
        type = "string"
    )
)]
pub struct BundleId(pub String);

impl BundleId {
    /// Construct a new bundle id.
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Borrow the underlying string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for BundleId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for BundleId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for BundleId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

/// Redacted summary of a dispatch intent attached to
/// [`CoreEvent::DispatchRejected`] and other contract-layer events.
///
/// The full prompt and any credentials **must never** appear here — callers
/// that need the raw intent go through an out-of-band audit channel
/// (issue #463, open question 2). Consumers seeing `prompt_hash` can
/// correlate back to the original dispatch request without learning its
/// contents.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(export, export_to = "../../tmai-app/web/src/types/generated/")
)]
pub struct DispatchIntentSummary {
    /// Absolute path to the target project / worktree root.
    pub project_path: String,
    /// Agent role requested (e.g. "implementer", "reviewer").
    pub role: String,
    /// Bundle id when this dispatch is part of a multi-project bundle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<BundleId>,
    /// Hex digest (implementation-chosen hash, e.g. SHA-256) of the
    /// dispatched prompt. Lets auditors correlate this event with the
    /// recorded intent without exposing the prompt text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_hash: Option<String>,
    /// Associated GitHub issue number, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_number: Option<u64>,
    /// Associated pull request number, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_number: Option<u64>,
}

/// Vendor availability rollup reported by
/// [`CoreEvent::VendorAvailabilityChanged`].
///
/// `Available` → normal operation.
/// `RateLimited` → vendor returned 429 / Max-plan limit; `resume_at` is the
/// advertised reset time when known.
/// `Unavailable` → outage or auth failure; retry left to policy.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(
        export,
        export_to = "../../tmai-app/web/src/types/generated/",
        rename_all = "snake_case"
    )
)]
pub enum VendorAvailabilityState {
    /// Vendor is accepting dispatches.
    Available,
    /// Rate-limited; retry after `resume_at` if present.
    RateLimited {
        /// Wall-clock time when dispatches may resume (if known).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resume_at: Option<chrono::DateTime<chrono::Utc>>,
    },
    /// Vendor is fully unavailable (outage, auth failure).
    Unavailable {
        /// Free-text reason for the outage (no secrets).
        reason: String,
    },
}

/// What caused a [`CoreEvent::CapacityChanged`] emission.
///
/// Subscribers use this to attribute the capacity delta without needing
/// a separate query. `delta == 0` is valid (e.g. `LimitChanged` when a
/// config reload moved the ceiling but no slots moved).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(
        export,
        export_to = "../../tmai-app/web/src/types/generated/",
        rename_all = "snake_case"
    )
)]
pub enum CapacityCauseSummary {
    /// An agent was spawned; consumed a slot.
    AgentSpawned {
        /// Target of the newly spawned agent.
        target: String,
    },
    /// An agent reached a terminal state (exit/kill); freed a slot.
    AgentTerminal {
        /// Target of the agent that ended.
        target: String,
    },
    /// The configured capacity limit changed (reload / admin action).
    LimitChanged,
    /// Capacity snapshot was reconciled against live state (drift fix).
    Reconciled,
}

/// Rollup status of a dispatch bundle, emitted by
/// [`CoreEvent::BundleStatusChanged`].
///
/// Derived from its sub-dispatches; transitions here are coarser-grained
/// than the per-agent `AgentStatusChanged` stream (issue #463, open
/// question 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(
        export,
        export_to = "../../tmai-app/web/src/types/generated/",
        rename_all = "snake_case"
    )
)]
pub enum BundleStatus {
    /// Bundle registered; no sub-dispatch has started.
    Pending,
    /// At least one sub-dispatch is running.
    Running,
    /// Some sub-dispatches succeeded, others failed; bundle is not
    /// fully recoverable without a re-dispatch.
    PartiallyCompleted,
    /// All sub-dispatches completed successfully.
    Completed,
    /// All sub-dispatches that ran failed terminally.
    Failed,
    /// Bundle was cancelled before completion.
    Cancelled,
}

/// Events emitted by the core when state changes occur.
///
/// Consumers call [`TmaiCore::subscribe()`] to receive these events
/// via a `broadcast::Receiver`.
///
/// This enum is the single source of truth for SSE event shapes —
/// the TypeScript discriminated union in
/// `crates/tmai-app/web/src/types/generated/CoreEvent.ts` is generated
/// from this definition by ts-rs (#446). Do not edit that file by hand.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(export, export_to = "../../tmai-app/web/src/types/generated/")
)]
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
        /// Monotonic review count from PR state — distinguishes
        /// back-to-back ChangesRequested transitions so the notifier
        /// can dedupe on `(pr_number, review_count)` instead of
        /// collapsing distinct rounds into one entry.
        #[serde(default)]
        review_count: u64,
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

    /// Git state changed for a repository (branches, HEAD, commit graph).
    ///
    /// Emitted by [`crate::git::monitor::GitMonitor`] when its poll detects
    /// a transition. WebUI subscribers refetch `/api/git/*` in response so
    /// the UI and the monitor snapshot observe the same tick (#423 — sibling
    /// of the PR Monitor SoT pattern).
    GitStateChanged {
        /// Repository directory path
        repo: String,
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

    /// An agent's tmux target changed due to pane renumbering (PID-based reconciliation)
    AgentTargetChanged {
        /// Previous target ID (e.g., "main:0.2")
        old_target: String,
        /// New target ID (e.g., "main:0.1")
        new_target: String,
        /// Process ID that links the two targets
        pid: u32,
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

    /// A dispatch request was rejected by the contract-layer gatekeeper
    /// before an agent was spawned. Subscribers never saw this intent as an
    /// `AgentAppeared` / `AgentStatusChanged` — they learn about it only via
    /// this event. Payload is redacted: see [`DispatchIntentSummary`].
    DispatchRejected {
        /// Redacted description of what was dispatched.
        intent_summary: DispatchIntentSummary,
        /// Who issued the rejected dispatch.
        origin: ActionOrigin,
        /// Structured reason for the rejection.
        error: TmaiError,
    },

    /// Vendor availability transitioned (rate-limit hit or cleared, outage
    /// started or resolved). Subscribers can refresh capacity badges or
    /// resume queued dispatches without polling the vendor directly.
    VendorAvailabilityChanged {
        /// Vendor identifier (e.g. "anthropic", "openai", "google").
        vendor: String,
        /// Account label, if the deployment distinguishes accounts.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        account: Option<String>,
        /// Previous availability state.
        old: VendorAvailabilityState,
        /// New availability state.
        new: VendorAvailabilityState,
        /// How the transition was detected (hook, polling, explicit signal).
        detected_via: DetectionSource,
    },

    /// The global capacity counter moved (a slot was consumed or freed)
    /// or the configured limit was adjusted. `delta` is the change applied
    /// to `current`; `cause` attributes the change without requiring a
    /// follow-up query.
    CapacityChanged {
        /// New value of the in-use slot counter.
        current: usize,
        /// Configured ceiling at the time of emission.
        limit: usize,
        /// Signed change applied to `current` by this event
        /// (+1 on spawn, -1 on terminal, 0 on `LimitChanged`/`Reconciled`).
        delta: i32,
        /// What triggered the change.
        cause: CapacityCauseSummary,
    },

    /// A contract-layer invariant was violated (auth failure, schema
    /// mismatch, unauthorized operation, etc.). Distinct from
    /// `DispatchRejected` which is gatekeeper-specific (#463, open q. 4).
    ContractViolation {
        /// Origin of the violating call.
        origin: ActionOrigin,
        /// Machine-readable classification of the violation.
        code: ErrorCode,
        /// Code-specific structured context (never includes secrets or
        /// raw prompts). Defaults to `null` when the emitter has nothing
        /// to attach.
        #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
        #[cfg_attr(feature = "ts-export", ts(type = "unknown"))]
        context: serde_json::Value,
    },

    /// A bypass flag was used for a dispatch (skipped one or more
    /// contract-layer checks). Always audit-logged; subscribers can
    /// use this to surface a banner or alert.
    DispatchBypassUsed {
        /// Origin of the bypassing call.
        origin: ActionOrigin,
        /// Names of the bypassed checks / stages (e.g.
        /// "capacity_check", "vendor_availability").
        bypassed: Vec<String>,
        /// Free-text justification supplied by the caller.
        reason: String,
    },

    /// Bundle rollup status transitioned. Emits only on bundle-level
    /// changes — sub-dispatch transitions still surface as
    /// `AgentStatusChanged` (#463, open q. 3).
    BundleStatusChanged {
        /// Identifier of the bundle whose status changed.
        bundle_id: BundleId,
        /// Previous rollup status.
        old: BundleStatus,
        /// New rollup status.
        new: BundleStatus,
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
    ///
    /// Emits `CoreEvent::AgentsUpdated` only when the post-debounce agent
    /// snapshot actually changed since the previous emission. Because the
    /// poller already collapses sub-threshold phase flips via
    /// `debounce_threshold()`, this fingerprint check means sub-threshold
    /// Idle↔Processing blips never become `AgentsUpdated` events — the UI
    /// sees a single stable signal per real transition.
    pub fn notify_agents_updated(&self) {
        let fingerprint = self.compute_agents_fingerprint();
        let changed = {
            let mut last = self.last_agents_fingerprint.write();
            if *last == fingerprint {
                false
            } else {
                *last = fingerprint;
                true
            }
        };
        if changed {
            let _ = self.event_sender().send(CoreEvent::AgentsUpdated);
        }
    }

    /// Force-emit `CoreEvent::AgentsUpdated` and refresh the fingerprint,
    /// bypassing the dedup check. Used by tests and in rare cases where a
    /// subscriber needs an unconditional refresh signal.
    pub fn notify_agents_updated_force(&self) {
        let fingerprint = self.compute_agents_fingerprint();
        *self.last_agents_fingerprint.write() = fingerprint;
        let _ = self.event_sender().send(CoreEvent::AgentsUpdated);
    }

    /// Build a fingerprint over the current agent list, excluding volatile
    /// fields that change on every poll regardless of real state transitions.
    /// Keeping any of these in the fingerprint makes `AgentsUpdated` fire at
    /// sub-threshold cadence (sometimes several Hz) and drives WebUI
    /// consumers — BranchGraph, PreviewPanel — into a self-DoS re-render
    /// loop that marks the Chrome tab Unresponsive within seconds.
    ///
    /// Excluded fields and why:
    ///   - `last_update`: wall-clock poll timestamp, not state.
    ///   - `title`: Claude Code prefixes the session title with an animated
    ///     spinner glyph (⠂/⠐/✳/…) that ticks several times per second.
    ///   - `cost_usd`, `duration_ms`, `lines_added`, `lines_removed`,
    ///     `context_used_pct`, `context_window_size`: statusline-hook
    ///     counters that monotonically progress every tool call. They
    ///     reflect activity but never a state transition the UI needs to
    ///     re-layout for.
    ///   - `cursor_x`, `cursor_y`: terminal cursor position, changes on
    ///     every keystroke / redraw.
    ///
    /// Matches the prior SSE-side dedup in `src/web/events.rs`; moving it
    /// here means all subscribers (TUI, Tauri, MCP, SSE) share one consistent
    /// debounced signal.
    fn compute_agents_fingerprint(&self) -> String {
        const VOLATILE_FIELDS: &[&str] = &[
            "last_update",
            "title",
            "cost_usd",
            "duration_ms",
            "lines_added",
            "lines_removed",
            "context_used_pct",
            "context_window_size",
            "cursor_x",
            "cursor_y",
        ];
        let agents = self.list_agents();
        let stripped: Vec<serde_json::Value> = agents
            .iter()
            .filter_map(|a| {
                let mut v = serde_json::to_value(a).ok()?;
                if let Some(obj) = v.as_object_mut() {
                    for f in VOLATILE_FIELDS {
                        obj.remove(*f);
                    }
                }
                Some(v)
            })
            .collect();
        serde_json::to_string(&stripped).unwrap_or_default()
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

    #[tokio::test]
    async fn test_notify_agents_updated_dedups_same_fingerprint() {
        // With no state change between calls the fingerprint is identical,
        // so the second notify_agents_updated() must NOT emit an event.
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        core.notify_agents_updated();
        let first = rx.recv().await.unwrap();
        assert!(matches!(first, CoreEvent::AgentsUpdated));

        // Second call with no state change: no event expected.
        core.notify_agents_updated();
        let pending = tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await;
        assert!(
            pending.is_err(),
            "duplicate AgentsUpdated should be suppressed when fingerprint is unchanged"
        );
    }

    #[tokio::test]
    async fn test_notify_agents_updated_force_bypasses_dedup() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        core.notify_agents_updated();
        let _ = rx.recv().await.unwrap();

        // force-variant must emit even when fingerprint is unchanged.
        core.notify_agents_updated_force();
        let forced = tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await;
        assert!(
            matches!(forced, Ok(Ok(CoreEvent::AgentsUpdated))),
            "force-variant should bypass fingerprint dedup"
        );
    }

    #[test]
    fn test_notify_no_subscribers() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        // Should not panic even with no subscribers
        core.notify_agents_updated();
        core.notify_teams_updated();
    }

    // ---------------------------------------------------------------------
    // Contract-layer event variants (#463)
    //
    // These tests pin the on-the-wire JSON shape so that SSE / TS consumers
    // do not silently break when the enum is touched. They also double as
    // executable documentation for subscriber implementers (the shape is
    // the contract).
    // ---------------------------------------------------------------------

    fn parse(e: &CoreEvent) -> serde_json::Value {
        serde_json::to_value(e).expect("CoreEvent must always serialize")
    }

    #[test]
    fn dispatch_rejected_json_shape() {
        let event = CoreEvent::DispatchRejected {
            intent_summary: DispatchIntentSummary {
                project_path: "/repos/foo".to_string(),
                role: "implementer".to_string(),
                bundle_id: Some(BundleId::new("bundle-42")),
                prompt_hash: Some("abc123".to_string()),
                issue_number: Some(463),
                pr_number: None,
            },
            origin: ActionOrigin::webui(),
            error: TmaiError::new(ErrorCode::CapacityExceeded, "too many agents"),
        };

        let v = parse(&event);
        assert_eq!(v["type"], "DispatchRejected");
        assert_eq!(v["intent_summary"]["project_path"], "/repos/foo");
        assert_eq!(v["intent_summary"]["role"], "implementer");
        assert_eq!(v["intent_summary"]["bundle_id"], "bundle-42");
        assert_eq!(v["intent_summary"]["prompt_hash"], "abc123");
        assert_eq!(v["intent_summary"]["issue_number"], 463);
        assert!(v["intent_summary"].get("pr_number").is_none());
        assert_eq!(v["origin"]["kind"], "Human");
        assert_eq!(v["error"]["code"], "CapacityExceeded");
    }

    #[test]
    fn vendor_availability_changed_json_shape() {
        let event = CoreEvent::VendorAvailabilityChanged {
            vendor: "anthropic".to_string(),
            account: Some("team-main".to_string()),
            old: VendorAvailabilityState::Available,
            new: VendorAvailabilityState::RateLimited {
                resume_at: Some(
                    chrono::DateTime::parse_from_rfc3339("2026-04-18T12:34:56Z")
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                ),
            },
            detected_via: DetectionSource::HttpHook,
        };

        let v = parse(&event);
        assert_eq!(v["type"], "VendorAvailabilityChanged");
        assert_eq!(v["vendor"], "anthropic");
        assert_eq!(v["account"], "team-main");
        assert_eq!(v["old"]["state"], "available");
        assert_eq!(v["new"]["state"], "rate_limited");
        assert_eq!(v["new"]["resume_at"], "2026-04-18T12:34:56Z");
        assert_eq!(v["detected_via"], "HttpHook");

        // Account is omitted when absent.
        let event = CoreEvent::VendorAvailabilityChanged {
            vendor: "openai".to_string(),
            account: None,
            old: VendorAvailabilityState::Unavailable {
                reason: "auth failed".to_string(),
            },
            new: VendorAvailabilityState::Available,
            detected_via: DetectionSource::CapturePane,
        };
        let v = parse(&event);
        assert!(v.get("account").is_none() || v["account"].is_null());
        assert_eq!(v["old"]["state"], "unavailable");
        assert_eq!(v["old"]["reason"], "auth failed");
    }

    #[test]
    fn capacity_changed_json_shape() {
        let event = CoreEvent::CapacityChanged {
            current: 4,
            limit: 8,
            delta: 1,
            cause: CapacityCauseSummary::AgentSpawned {
                target: "main:0.3".to_string(),
            },
        };
        let v = parse(&event);
        assert_eq!(v["type"], "CapacityChanged");
        assert_eq!(v["current"], 4);
        assert_eq!(v["limit"], 8);
        assert_eq!(v["delta"], 1);
        assert_eq!(v["cause"]["kind"], "agent_spawned");
        assert_eq!(v["cause"]["target"], "main:0.3");

        // A unit cause carries only the discriminator.
        let event = CoreEvent::CapacityChanged {
            current: 8,
            limit: 8,
            delta: 0,
            cause: CapacityCauseSummary::LimitChanged,
        };
        let v = parse(&event);
        assert_eq!(v["cause"]["kind"], "limit_changed");
    }

    #[test]
    fn contract_violation_json_shape_with_and_without_context() {
        // With structured context.
        let event = CoreEvent::ContractViolation {
            origin: ActionOrigin::agent("main:0.0", true),
            code: ErrorCode::SchemaMismatch,
            context: serde_json::json!({ "field": "role", "expected": "implementer" }),
        };
        let v = parse(&event);
        assert_eq!(v["type"], "ContractViolation");
        assert_eq!(v["origin"]["kind"], "Agent");
        assert_eq!(v["code"], "SchemaMismatch");
        assert_eq!(v["context"]["field"], "role");

        // With null context, the field is omitted entirely.
        let event = CoreEvent::ContractViolation {
            origin: ActionOrigin::system("gatekeeper"),
            code: ErrorCode::PermissionDenied,
            context: serde_json::Value::Null,
        };
        let v = parse(&event);
        assert!(v.get("context").is_none());
    }

    #[test]
    fn dispatch_bypass_used_json_shape() {
        let event = CoreEvent::DispatchBypassUsed {
            origin: ActionOrigin::webui(),
            bypassed: vec![
                "capacity_check".to_string(),
                "vendor_availability".to_string(),
            ],
            reason: "manual override during incident".to_string(),
        };
        let v = parse(&event);
        assert_eq!(v["type"], "DispatchBypassUsed");
        assert_eq!(v["origin"]["kind"], "Human");
        assert_eq!(v["bypassed"][0], "capacity_check");
        assert_eq!(v["bypassed"][1], "vendor_availability");
        assert_eq!(v["reason"], "manual override during incident");
    }

    #[test]
    fn bundle_status_changed_json_shape() {
        let event = CoreEvent::BundleStatusChanged {
            bundle_id: BundleId::new("bundle-multirepo-7"),
            old: BundleStatus::Running,
            new: BundleStatus::PartiallyCompleted,
        };
        let v = parse(&event);
        assert_eq!(v["type"], "BundleStatusChanged");
        assert_eq!(v["bundle_id"], "bundle-multirepo-7");
        assert_eq!(v["old"], "running");
        assert_eq!(v["new"], "partially_completed");
    }

    #[test]
    fn dispatch_intent_summary_roundtrip_with_defaults() {
        // Forward compatibility: a payload with only the required fields
        // must deserialize, with optional fields defaulting to None.
        let json = serde_json::json!({
            "project_path": "/repos/bar",
            "role": "reviewer",
        });
        let summary: DispatchIntentSummary = serde_json::from_value(json).unwrap();
        assert_eq!(summary.project_path, "/repos/bar");
        assert_eq!(summary.role, "reviewer");
        assert_eq!(summary.bundle_id, None);
        assert_eq!(summary.prompt_hash, None);
        assert_eq!(summary.issue_number, None);
        assert_eq!(summary.pr_number, None);

        // Round-trip with every field populated.
        let full = DispatchIntentSummary {
            project_path: "/repos/bar".to_string(),
            role: "reviewer".to_string(),
            bundle_id: Some(BundleId::from("b-1")),
            prompt_hash: Some("deadbeef".to_string()),
            issue_number: Some(1),
            pr_number: Some(2),
        };
        let json = serde_json::to_value(&full).unwrap();
        let back: DispatchIntentSummary = serde_json::from_value(json).unwrap();
        assert_eq!(full, back);
    }

    #[test]
    fn bundle_id_serializes_transparently() {
        let id = BundleId::new("abc");
        assert_eq!(serde_json::to_value(&id).unwrap(), serde_json::json!("abc"));
        let back: BundleId = serde_json::from_str("\"abc\"").unwrap();
        assert_eq!(back.as_str(), "abc");
        assert_eq!(format!("{id}"), "abc");
    }

    #[test]
    fn bundle_status_snake_case() {
        // The wire format is snake_case across every variant; this test
        // keeps JS consumers from silently losing events on rename.
        let cases = [
            (BundleStatus::Pending, "pending"),
            (BundleStatus::Running, "running"),
            (BundleStatus::PartiallyCompleted, "partially_completed"),
            (BundleStatus::Completed, "completed"),
            (BundleStatus::Failed, "failed"),
            (BundleStatus::Cancelled, "cancelled"),
        ];
        for (status, expected) in cases {
            assert_eq!(serde_json::to_value(status).unwrap(), expected);
        }
    }

    #[test]
    fn vendor_availability_state_adjacently_tagged() {
        // Ensures the discriminator key is `state` and values are
        // snake_case — the contract surface external consumers depend on.
        let s = VendorAvailabilityState::RateLimited { resume_at: None };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["state"], "rate_limited");
        assert!(v.get("resume_at").is_none());

        let s = VendorAvailabilityState::Available;
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["state"], "available");
    }

    #[tokio::test]
    async fn contract_events_broadcast_roundtrip() {
        // Sanity check that the new variants survive the broadcast channel.
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        let tx = core.event_sender();
        tx.send(CoreEvent::CapacityChanged {
            current: 1,
            limit: 4,
            delta: 1,
            cause: CapacityCauseSummary::AgentSpawned {
                target: "main:0.0".to_string(),
            },
        })
        .unwrap();

        let received = rx.recv().await.unwrap();
        match received {
            CoreEvent::CapacityChanged { current, delta, .. } => {
                assert_eq!(current, 1);
                assert_eq!(delta, 1);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }
}
