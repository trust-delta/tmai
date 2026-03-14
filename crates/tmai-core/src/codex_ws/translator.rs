//! Translates Codex CLI app-server WebSocket events into HookRegistry updates.
//!
//! Reuses the existing HookRegistry/HookState infrastructure so the Poller's
//! 3-tier detection (Hook > IPC > capture-pane) works without changes.

use tracing::debug;

use crate::api::CoreEvent;
use crate::hooks::registry::HookRegistry;
use crate::hooks::types::{HookContext, HookState, HookStatus};

use super::types::{CodexEvent, TurnStatus};

/// Translate a CodexEvent and update the HookRegistry for the given pane_id.
///
/// Returns an optional CoreEvent to emit (e.g., AgentStopped on turn completion).
pub fn translate_event(
    event: &CodexEvent,
    pane_id: &str,
    hook_registry: &HookRegistry,
) -> Option<CoreEvent> {
    match event {
        CodexEvent::ThreadStarted { cwd } => {
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                if cwd.is_some() {
                    state.cwd = cwd.clone();
                }
                state.touch();
            } else {
                let state = HookState::new(format!("codex-ws-{}", pane_id), cwd.clone());
                reg.insert(pane_id.to_string(), state);
            }
            debug!(pane_id, ?cwd, "Codex WS: thread started");
            None
        }

        CodexEvent::TurnStarted => {
            update_hook_state(hook_registry, pane_id, HookStatus::Processing, None);
            debug!(pane_id, "Codex WS: turn started → Processing");
            None
        }

        CodexEvent::ItemStarted { item_type, name } => {
            // Set last_tool for function_call items
            let tool = if item_type == "function_call" {
                name.clone()
            } else {
                None
            };
            update_hook_state(hook_registry, pane_id, HookStatus::Processing, tool);
            debug!(pane_id, item_type, ?name, "Codex WS: item started");
            None
        }

        CodexEvent::CommandApprovalRequested { command } => {
            update_hook_state(
                hook_registry,
                pane_id,
                HookStatus::AwaitingApproval,
                Some(command.clone()),
            );
            debug!(
                pane_id,
                command, "Codex WS: command approval → AwaitingApproval"
            );
            None
        }

        CodexEvent::FileChangeApprovalRequested { file_path } => {
            update_hook_state(
                hook_registry,
                pane_id,
                HookStatus::AwaitingApproval,
                Some(file_path.clone()),
            );
            debug!(
                pane_id,
                file_path, "Codex WS: file change approval → AwaitingApproval"
            );
            None
        }

        CodexEvent::ItemCompleted { .. } => {
            // Item done, still processing (more items may follow within the turn)
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.touch();
            }
            None
        }

        CodexEvent::TurnCompleted { status } => {
            let cwd = {
                let mut reg = hook_registry.write();
                if let Some(state) = reg.get_mut(pane_id) {
                    state.status = HookStatus::Idle;
                    state.last_tool = None;
                    state.touch();
                    state.cwd.clone()
                } else {
                    None
                }
            };
            let status_label = match status {
                TurnStatus::Completed => "completed",
                TurnStatus::Failed => "failed",
                TurnStatus::Other(s) => s.as_str(),
            };
            debug!(
                pane_id,
                status = status_label,
                "Codex WS: turn completed → Idle"
            );

            Some(CoreEvent::AgentStopped {
                target: pane_id.to_string(),
                cwd: cwd.unwrap_or_default(),
                last_assistant_message: None,
            })
        }

        CodexEvent::TokenUsageUpdated { .. } => {
            // Touch to keep fresh, but no status change
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.touch();
            }
            None
        }

        CodexEvent::Unknown { method } => {
            debug!(pane_id, method, "Codex WS: unknown event, ignoring");
            None
        }
    }
}

/// Update hook state for a pane, creating entry if needed
fn update_hook_state(
    registry: &HookRegistry,
    pane_id: &str,
    status: HookStatus,
    tool: Option<String>,
) {
    let mut reg = registry.write();
    if let Some(state) = reg.get_mut(pane_id) {
        state.status = status;
        if tool.is_some() {
            state.last_tool = tool;
        }
        state.last_context = HookContext {
            event_name: "codex_ws".to_string(),
            tool_input: None,
            permission_mode: None,
        };
        state.touch();
    } else {
        let mut state = HookState::new(format!("codex-ws-{}", pane_id), None);
        state.status = status;
        state.last_tool = tool;
        state.last_context = HookContext {
            event_name: "codex_ws".to_string(),
            tool_input: None,
            permission_mode: None,
        };
        reg.insert(pane_id.to_string(), state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hooks::registry::new_hook_registry;

    #[test]
    fn test_thread_started_creates_entry() {
        let registry = new_hook_registry();

        translate_event(
            &CodexEvent::ThreadStarted {
                cwd: Some("/home/user/project".to_string()),
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Idle);
        assert_eq!(state.cwd.as_deref(), Some("/home/user/project"));
    }

    #[test]
    fn test_turn_started_sets_processing() {
        let registry = new_hook_registry();

        // Create initial entry
        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(&CodexEvent::TurnStarted, "5", &registry);

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Processing);
    }

    #[test]
    fn test_item_started_function_call_sets_tool() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "function_call".to_string(),
                name: Some("shell".to_string()),
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert_eq!(state.last_tool.as_deref(), Some("shell"));
    }

    #[test]
    fn test_item_started_message_no_tool() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "message".to_string(),
                name: None,
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert!(state.last_tool.is_none());
    }

    #[test]
    fn test_command_approval_sets_awaiting() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(
            &CodexEvent::CommandApprovalRequested {
                command: "npm test".to_string(),
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::AwaitingApproval);
        assert_eq!(state.last_tool.as_deref(), Some("npm test"));
    }

    #[test]
    fn test_file_change_approval_sets_awaiting() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(
            &CodexEvent::FileChangeApprovalRequested {
                file_path: "src/main.rs".to_string(),
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::AwaitingApproval);
        assert_eq!(state.last_tool.as_deref(), Some("src/main.rs"));
    }

    #[test]
    fn test_turn_completed_sets_idle_and_emits_stopped() {
        let registry = new_hook_registry();

        translate_event(
            &CodexEvent::ThreadStarted {
                cwd: Some("/tmp".to_string()),
            },
            "5",
            &registry,
        );
        translate_event(&CodexEvent::TurnStarted, "5", &registry);

        let event = translate_event(
            &CodexEvent::TurnCompleted {
                status: TurnStatus::Completed,
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Idle);
        assert!(state.last_tool.is_none());

        assert!(matches!(event, Some(CoreEvent::AgentStopped { .. })));
        if let Some(CoreEvent::AgentStopped { target, cwd, .. }) = event {
            assert_eq!(target, "5");
            assert_eq!(cwd, "/tmp");
        }
    }

    #[test]
    fn test_turn_completed_failed_also_sets_idle() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);
        translate_event(&CodexEvent::TurnStarted, "5", &registry);

        let event = translate_event(
            &CodexEvent::TurnCompleted {
                status: TurnStatus::Failed,
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Idle);
        assert!(matches!(event, Some(CoreEvent::AgentStopped { .. })));
    }

    #[test]
    fn test_item_completed_keeps_processing() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);
        translate_event(&CodexEvent::TurnStarted, "5", &registry);

        translate_event(
            &CodexEvent::ItemCompleted {
                item_type: "function_call_output".to_string(),
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Processing);
    }

    #[test]
    fn test_token_usage_touches_state() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        // Set old timestamp
        {
            let mut reg = registry.write();
            if let Some(state) = reg.get_mut("5") {
                state.last_event_at = 0;
            }
        }

        translate_event(
            &CodexEvent::TokenUsageUpdated {
                input_tokens: 100,
                output_tokens: 50,
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert!(state.is_fresh(1000));
    }

    #[test]
    fn test_unknown_event_no_state_change() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        let event = translate_event(
            &CodexEvent::Unknown {
                method: "future/event".to_string(),
            },
            "5",
            &registry,
        );

        assert!(event.is_none());
        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Idle);
    }

    #[test]
    fn test_full_lifecycle() {
        let registry = new_hook_registry();

        // Thread starts
        translate_event(
            &CodexEvent::ThreadStarted {
                cwd: Some("/project".to_string()),
            },
            "5",
            &registry,
        );

        // Turn starts
        translate_event(&CodexEvent::TurnStarted, "5", &registry);
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().status, HookStatus::Processing);
        }

        // Item with function call
        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "function_call".to_string(),
                name: Some("shell".to_string()),
            },
            "5",
            &registry,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().last_tool.as_deref(), Some("shell"));
        }

        // Approval request
        translate_event(
            &CodexEvent::CommandApprovalRequested {
                command: "npm install".to_string(),
            },
            "5",
            &registry,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().status, HookStatus::AwaitingApproval);
        }

        // Item completes (after approval was given)
        translate_event(
            &CodexEvent::ItemCompleted {
                item_type: "function_call_output".to_string(),
            },
            "5",
            &registry,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().status, HookStatus::Processing);
        }

        // Turn completes
        let event = translate_event(
            &CodexEvent::TurnCompleted {
                status: TurnStatus::Completed,
            },
            "5",
            &registry,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().status, HookStatus::Idle);
        }
        assert!(matches!(event, Some(CoreEvent::AgentStopped { .. })));
    }

    #[test]
    fn test_auto_creates_entry_on_turn_started() {
        let registry = new_hook_registry();

        // No ThreadStarted, directly send TurnStarted
        translate_event(&CodexEvent::TurnStarted, "99", &registry);

        let reg = registry.read();
        let state = reg.get("99").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
    }
}
