// Event bridge from TmaiCore to Tauri frontend
// Subscribes to CoreEvent stream and emits to all connected Tauri windows

use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tmai_core::api::{CoreEvent, TmaiCore};
use tokio::task::JoinHandle;

/// Start the event bridge
/// Subscribes to CoreEvent and emits to Tauri window
pub fn start_event_bridge(core: Arc<TmaiCore>, app: AppHandle) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = core.subscribe();

        while let Ok(event) = rx.recv().await {
            // Emit to all Tauri windows
            let event_type = match &event {
                CoreEvent::AgentsUpdated => "agents-updated",
                CoreEvent::AgentStatusChanged { .. } => "agent-status-changed",
                CoreEvent::AgentAppeared { .. } => "agent-appeared",
                CoreEvent::AgentDisappeared { .. } => "agent-disappeared",
                CoreEvent::TeamsUpdated => "teams-updated",
                CoreEvent::TeammateIdle { .. } => "teammate-idle",
                CoreEvent::TaskCompleted { .. } => "task-completed",
                CoreEvent::ConfigChanged { .. } => "config-changed",
                CoreEvent::WorktreeCreated { .. } => "worktree-created",
                CoreEvent::WorktreeRemoved { .. } => "worktree-removed",
                CoreEvent::InstructionsLoaded { .. } => "instructions-loaded",
                CoreEvent::AgentStopped { .. } => "agent-stopped",
                CoreEvent::ContextCompacting { .. } => "context-compacting",
                CoreEvent::WorktreeSetupCompleted { .. } => "worktree-setup-completed",
                CoreEvent::WorktreeSetupFailed { .. } => "worktree-setup-failed",
                CoreEvent::UsageUpdated => "usage-updated",
            };

            let _ = app.emit(
                "core-event",
                serde_json::json!({
                    "type": event_type,
                    "data": event,
                }),
            );
        }
    })
}
