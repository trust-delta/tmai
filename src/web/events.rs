//! Server-Sent Events for real-time agent updates
//!
//! Uses `TmaiCore::subscribe()` for push-based notifications and falls back
//! to polling the latest state when the receiver lags.

use axum::{
    extract::State,
    response::{
        sse::{Event, Sse},
        IntoResponse,
    },
};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;

use tmai_core::api::{CoreEvent, TmaiCore};

use super::api::{build_team_info, TeamInfoResponse};

/// Build agents JSON from TmaiCore snapshots
fn build_agents_json(core: &TmaiCore) -> String {
    let agents = core.list_agents();
    serde_json::to_string(&agents).unwrap_or_else(|_| "[]".to_string())
}

/// Build teams JSON from TmaiCore raw state
#[allow(deprecated)]
fn build_teams_json(core: &TmaiCore) -> String {
    let app_state = core.raw_state().read();
    let teams: Vec<TeamInfoResponse> = app_state
        .teams
        .values()
        .map(|snapshot| build_team_info(snapshot, &app_state))
        .collect();
    serde_json::to_string(&teams).unwrap_or_else(|_| "[]".to_string())
}

/// SSE stream for agent and team updates
///
/// Uses `core.subscribe()` to receive push notifications from the core event
/// system. Falls back to full state re-send on lag. Maintains a keep-alive
/// every 15 seconds.
pub async fn events(State(core): State<Arc<TmaiCore>>) -> impl IntoResponse {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(16);

    tokio::spawn(async move {
        let mut event_rx = core.subscribe();
        let mut last_teams_json = String::new();

        // Send initial state immediately. Per-subscriber dedup for agents
        // is no longer needed here — `TmaiCore::notify_agents_updated()`
        // now gates `CoreEvent::AgentsUpdated` on a post-debounce
        // fingerprint change (see `api/events.rs`), so every arriving
        // broadcast represents a real state delta. We only need to send
        // the initial snapshot on connect and re-sync on Lagged.
        let agents_json = build_agents_json(&core);
        let teams_json = build_teams_json(&core);

        if !agents_json.is_empty() && agents_json != "[]" {
            let event = Event::default().event("agents").data(&agents_json);
            if tx.send(Ok(event)).await.is_err() {
                return;
            }
        }
        if !teams_json.is_empty() && teams_json != "[]" {
            let event = Event::default().event("teams").data(&teams_json);
            if tx.send(Ok(event)).await.is_err() {
                return;
            }
            last_teams_json = teams_json;
        }

        // Fallback interval for when no events arrive (e.g. teams not yet emitting events)
        let mut fallback_interval = tokio::time::interval(Duration::from_millis(500));
        // Skip the first tick (already sent initial state)
        fallback_interval.tick().await;

        loop {
            tokio::select! {
                result = event_rx.recv() => {
                    match result {
                        Ok(CoreEvent::AgentsUpdated) | Ok(CoreEvent::AgentStatusChanged { .. })
                        | Ok(CoreEvent::AgentAppeared { .. }) | Ok(CoreEvent::AgentDisappeared { .. }) => {
                            // Core-side dedup means every arriving event is a
                            // real delta; forward the current snapshot directly.
                            let agents_json = build_agents_json(&core);
                            let event = Event::default().event("agents").data(&agents_json);
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::TeamsUpdated) => {
                            let teams_json = build_teams_json(&core);
                            if teams_json != last_teams_json {
                                let event = Event::default().event("teams").data(&teams_json);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                                last_teams_json = teams_json;
                            }
                        }
                        Ok(CoreEvent::TeammateIdle { team_name, member_name, .. }) => {
                            let data = serde_json::json!({
                                "team_name": team_name,
                                "member_name": member_name,
                            });
                            let event = Event::default()
                                .event("teammate_idle")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::TaskCreated { team_name, task_id, task_subject }) => {
                            let data = serde_json::json!({
                                "team_name": team_name,
                                "task_id": task_id,
                                "task_subject": task_subject,
                            });
                            let event = Event::default()
                                .event("task_created")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::TaskCompleted { team_name, task_id, task_subject }) => {
                            let data = serde_json::json!({
                                "team_name": team_name,
                                "task_id": task_id,
                                "task_subject": task_subject,
                            });
                            let event = Event::default()
                                .event("task_completed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ContextCompacting { target, compaction_count }) => {
                            let data = serde_json::json!({
                                "target": target,
                                "compaction_count": compaction_count,
                            });
                            let event = Event::default()
                                .event("context_compacting")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::UsageUpdated) => {
                            let usage = core.get_usage();
                            if let Ok(data) = serde_json::to_string(&usage) {
                                let event = Event::default().event("usage").data(data);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                            }
                        }
                        Ok(CoreEvent::WorktreeCreated { target, worktree }) => {
                            let data = serde_json::json!({
                                "target": target,
                                "worktree": worktree,
                            });
                            let event = Event::default()
                                .event("worktree_created")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::WorktreeRemoved { target, worktree }) => {
                            let data = serde_json::json!({
                                "target": target,
                                "worktree": worktree,
                            });
                            let event = Event::default()
                                .event("worktree_removed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ToolCallDeferred { defer_id, target, tool_name }) => {
                            let data = serde_json::json!({
                                "defer_id": defer_id,
                                "target": target,
                                "tool_name": tool_name,
                            });
                            let event = Event::default()
                                .event("tool_call_deferred")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ToolCallResolved { defer_id, target, decision, resolved_by }) => {
                            let data = serde_json::json!({
                                "defer_id": defer_id,
                                "target": target,
                                "decision": decision,
                                "resolved_by": resolved_by,
                            });
                            let event = Event::default()
                                .event("tool_call_resolved")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::AgentStopped { target, cwd, last_assistant_message }) => {
                            let data = serde_json::json!({
                                "target": target,
                                "cwd": cwd,
                                "last_assistant_message": last_assistant_message,
                            });
                            let event = Event::default()
                                .event("agent_stopped")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::RebaseSucceeded { branch, worktree_path }) => {
                            let data = serde_json::json!({
                                "branch": branch,
                                "worktree_path": worktree_path,
                            });
                            let event = Event::default()
                                .event("rebase_succeeded")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::RebaseConflict { branch, worktree_path, error }) => {
                            let data = serde_json::json!({
                                "branch": branch,
                                "worktree_path": worktree_path,
                                "error": error,
                            });
                            let event = Event::default()
                                .event("rebase_conflict")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::PrCreated { pr_number, title, branch }) => {
                            let data = serde_json::json!({
                                "pr_number": pr_number,
                                "title": title,
                                "branch": branch,
                            });
                            let event = Event::default()
                                .event("pr_created")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::PrCiPassed { pr_number, title, checks_summary }) => {
                            let data = serde_json::json!({
                                "pr_number": pr_number,
                                "title": title,
                                "checks_summary": checks_summary,
                            });
                            let event = Event::default()
                                .event("pr_ci_passed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::PrCiFailed { pr_number, title, failed_details }) => {
                            let data = serde_json::json!({
                                "pr_number": pr_number,
                                "title": title,
                                "failed_details": failed_details,
                            });
                            let event = Event::default()
                                .event("pr_ci_failed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::PrReviewFeedback { pr_number, title, comments_summary, review_count }) => {
                            let data = serde_json::json!({
                                "pr_number": pr_number,
                                "title": title,
                                "comments_summary": comments_summary,
                                "review_count": review_count,
                            });
                            let event = Event::default()
                                .event("pr_review_feedback")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::PrClosed { pr_number, ref title, ref branch }) => {
                            let data = serde_json::json!({
                                "pr_number": pr_number,
                                "title": title,
                                "branch": branch,
                            });
                            let event = Event::default()
                                .event("pr_closed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::GitStateChanged { ref repo }) => {
                            let data = serde_json::json!({ "repo": repo });
                            let event = Event::default()
                                .event("git_state_changed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::GuardrailExceeded { ref guardrail, ref branch, pr_number, count, limit }) => {
                            let data = serde_json::json!({
                                "guardrail": guardrail,
                                "branch": branch,
                                "pr_number": pr_number,
                                "count": count,
                                "limit": limit,
                            });
                            let event = Event::default()
                                .event("guardrail_exceeded")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::AgentTargetChanged { old_target, new_target, pid }) => {
                            let data = serde_json::json!({
                                "old_target": old_target,
                                "new_target": new_target,
                                "pid": pid,
                            });
                            let event = Event::default()
                                .event("agent_target_changed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                            // Also refresh agent list since targets changed
                            let agents_json = build_agents_json(&core);
                            let event = Event::default().event("agents").data(&agents_json);
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ActionPerformed { ref origin, ref action, ref summary }) => {
                            let data = serde_json::json!({
                                "origin": origin,
                                "action": action,
                                "summary": summary,
                            });
                            let event = Event::default()
                                .event("action_performed")
                                .data(data.to_string());
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                        }
                        Ok(CoreEvent::ConfigChanged { .. })
                        | Ok(CoreEvent::InstructionsLoaded { .. })
                        | Ok(CoreEvent::WorktreeSetupCompleted { .. })
                        | Ok(CoreEvent::WorktreeSetupFailed { .. })
                        | Ok(CoreEvent::PromptReady { .. }) => {
                            // PromptReady is handled by the background prompt delivery task.
                            // Other events: forward to SSE subscribers in the future if needed.
                        }
                        Err(RecvError::Lagged(skipped)) => {
                            tracing::debug!(skipped, "SSE subscriber lagged, re-sending full state");
                            // Re-send full state on lag unconditionally —
                            // we can't tell which events were dropped, so
                            // push a fresh snapshot to resync the client.
                            let agents_json = build_agents_json(&core);
                            let event = Event::default().event("agents").data(&agents_json);
                            if tx.send(Ok(event)).await.is_err() {
                                return;
                            }
                            let teams_json = build_teams_json(&core);
                            if teams_json != last_teams_json {
                                let event = Event::default().event("teams").data(&teams_json);
                                if tx.send(Ok(event)).await.is_err() {
                                    return;
                                }
                                last_teams_json = teams_json;
                            }
                        }
                        Err(RecvError::Closed) => {
                            return;
                        }
                    }
                }
                _ = fallback_interval.tick() => {
                    // Fallback polling for data not yet covered by events (e.g. teams)
                    let teams_json = build_teams_json(&core);
                    if teams_json != last_teams_json {
                        let event = Event::default().event("teams").data(&teams_json);
                        if tx.send(Ok(event)).await.is_err() {
                            return;
                        }
                        last_teams_json = teams_json;
                    }
                }
            }
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
