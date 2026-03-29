//! Translates Codex CLI app-server WebSocket events into HookRegistry updates.
//!
//! Reuses the existing HookRegistry/HookState infrastructure so the Poller's
//! 3-tier detection (Hook > IPC > capture-pane) works without changes.

use tracing::debug;

use crate::api::CoreEvent;
use crate::hooks::handler::{push_activity, truncate_string};
use crate::hooks::registry::HookRegistry;
use crate::hooks::types::{HookContext, HookState, HookStatus, ToolActivity};

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
            // Clear activity log for new turn (matches Claude Code UserPromptSubmit behavior)
            {
                let mut reg = hook_registry.write();
                if let Some(state) = reg.get_mut(pane_id) {
                    state.activity_log.clear();
                }
            }
            update_hook_state(hook_registry, pane_id, HookStatus::Processing, None, None);
            debug!(pane_id, "Codex WS: turn started → Processing");
            None
        }

        CodexEvent::ItemStarted {
            item_type,
            command,
            file_path,
            name,
        } => {
            // Map Codex item types to human-readable tool names and store input
            let (tool, tool_input) = match item_type.as_str() {
                "commandExecution" => {
                    let cmd = command.clone().or_else(|| name.clone());
                    let input = cmd.as_ref().map(|c| serde_json::json!({"command": c}));
                    (Some("Shell".to_string()), input)
                }
                "fileChange" => {
                    let fp = file_path.clone().or_else(|| name.clone());
                    let input = fp.as_ref().map(|f| serde_json::json!({"file_path": f}));
                    (Some("FileChange".to_string()), input)
                }
                _ => (None, None),
            };
            update_hook_state(
                hook_registry,
                pane_id,
                HookStatus::Processing,
                tool,
                tool_input,
            );
            debug!(
                pane_id,
                item_type,
                ?command,
                ?file_path,
                ?name,
                "Codex WS: item started"
            );
            None
        }

        CodexEvent::CommandApprovalRequested { command } => {
            update_hook_state_with_event_name(
                hook_registry,
                pane_id,
                HookStatus::AwaitingApproval,
                Some(command.clone()),
                "codex_ws_command_approval",
            );
            debug!(
                pane_id,
                command, "Codex WS: command approval → AwaitingApproval"
            );
            None
        }

        CodexEvent::FileChangeApprovalRequested { file_path } => {
            update_hook_state_with_event_name(
                hook_registry,
                pane_id,
                HookStatus::AwaitingApproval,
                Some(file_path.clone()),
                "codex_ws_file_approval",
            );
            debug!(
                pane_id,
                file_path, "Codex WS: file change approval → AwaitingApproval"
            );
            None
        }

        CodexEvent::ItemCompleted { item_type, output } => {
            // Push activity log entry for tool items
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                if item_type == "commandExecution" || item_type == "fileChange" {
                    let tool_name = if item_type == "commandExecution" {
                        "Shell"
                    } else {
                        "FileChange"
                    };
                    // Extract input summary from last_context.tool_input
                    let input_summary = state
                        .last_context
                        .tool_input
                        .as_ref()
                        .and_then(|v| {
                            v.get("command")
                                .or_else(|| v.get("file_path"))
                                .and_then(|s| s.as_str())
                        })
                        .map(|s| truncate_string(s, 120))
                        .unwrap_or_default();
                    let response_summary = output
                        .as_ref()
                        .map(|s| truncate_string(s, 200))
                        .unwrap_or_default();
                    push_activity(
                        state,
                        ToolActivity {
                            tool_name: tool_name.to_string(),
                            input_summary,
                            response_summary,
                            timestamp: crate::hooks::types::current_time_millis(),
                        },
                    );
                }
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

        CodexEvent::TokenUsageUpdated {
            input_tokens,
            output_tokens,
        } => {
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.token_usage = Some((*input_tokens, *output_tokens));
                state.touch();
            }
            None
        }

        CodexEvent::StreamingDelta { .. } => {
            // Touch to keep state fresh during streaming
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

/// Update hook state for a pane, creating entry if needed.
/// Optionally stores tool_input in HookContext for activity log extraction.
fn update_hook_state(
    registry: &HookRegistry,
    pane_id: &str,
    status: HookStatus,
    tool: Option<String>,
    tool_input: Option<serde_json::Value>,
) {
    update_hook_state_with_event_name(registry, pane_id, status, tool, "codex_ws");
    // Store tool_input if provided (separate write to avoid borrow issues)
    if let Some(input) = tool_input {
        let mut reg = registry.write();
        if let Some(state) = reg.get_mut(pane_id) {
            state.last_context.tool_input = Some(input);
        }
    }
}

/// Update hook state with a specific event_name (for approval type differentiation)
fn update_hook_state_with_event_name(
    registry: &HookRegistry,
    pane_id: &str,
    status: HookStatus,
    tool: Option<String>,
    event_name: &str,
) {
    let mut reg = registry.write();
    if let Some(state) = reg.get_mut(pane_id) {
        state.status = status;
        if tool.is_some() {
            state.last_tool = tool;
        }
        state.last_context = HookContext {
            event_name: event_name.to_string(),
            tool_input: None,
            permission_mode: None,
        };
        state.touch();
    } else {
        let mut state = HookState::new(format!("codex-ws-{}", pane_id), None);
        state.status = status;
        state.last_tool = tool;
        state.last_context = HookContext {
            event_name: event_name.to_string(),
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
    fn test_item_started_command_execution_sets_tool() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "commandExecution".to_string(),
                command: Some("git status".to_string()),
                file_path: None,
                name: None,
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert_eq!(state.last_tool.as_deref(), Some("Shell"));
        // Verify tool_input stored for activity log
        let input = state.last_context.tool_input.as_ref().unwrap();
        assert_eq!(input["command"], "git status");
    }

    #[test]
    fn test_item_started_file_change_sets_tool() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "fileChange".to_string(),
                command: None,
                file_path: Some("src/main.rs".to_string()),
                name: None,
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert_eq!(state.last_tool.as_deref(), Some("FileChange"));
    }

    #[test]
    fn test_item_started_agent_message_no_tool() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "agentMessage".to_string(),
                command: None,
                file_path: None,
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
        assert_eq!(state.last_context.event_name, "codex_ws_command_approval");
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
        assert_eq!(state.last_context.event_name, "codex_ws_file_approval");
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
                item_type: "commandExecution".to_string(),
                output: Some("ok".to_string()),
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Processing);
    }

    #[test]
    fn test_item_completed_pushes_activity_log() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);
        translate_event(&CodexEvent::TurnStarted, "5", &registry);

        // Start a command execution item
        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "commandExecution".to_string(),
                command: Some("cargo test".to_string()),
                file_path: None,
                name: None,
            },
            "5",
            &registry,
        );

        // Complete the item
        translate_event(
            &CodexEvent::ItemCompleted {
                item_type: "commandExecution".to_string(),
                output: Some("test result: ok".to_string()),
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.activity_log.len(), 1);
        assert_eq!(state.activity_log[0].tool_name, "Shell");
        assert_eq!(state.activity_log[0].input_summary, "cargo test");
        assert_eq!(state.activity_log[0].response_summary, "test result: ok");
    }

    #[test]
    fn test_turn_started_clears_activity_log() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);
        translate_event(&CodexEvent::TurnStarted, "5", &registry);

        // Add some activity
        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "commandExecution".to_string(),
                command: Some("ls".to_string()),
                file_path: None,
                name: None,
            },
            "5",
            &registry,
        );
        translate_event(
            &CodexEvent::ItemCompleted {
                item_type: "commandExecution".to_string(),
                output: None,
            },
            "5",
            &registry,
        );

        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().activity_log.len(), 1);
        }

        // New turn clears activity log
        translate_event(&CodexEvent::TurnStarted, "5", &registry);

        let reg = registry.read();
        assert!(reg.get("5").unwrap().activity_log.is_empty());
    }

    #[test]
    fn test_token_usage_stored() {
        let registry = new_hook_registry();

        translate_event(&CodexEvent::ThreadStarted { cwd: None }, "5", &registry);

        translate_event(
            &CodexEvent::TokenUsageUpdated {
                input_tokens: 1500,
                output_tokens: 300,
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.token_usage, Some((1500, 300)));
        assert!(state.is_fresh(1000));
    }

    #[test]
    fn test_streaming_delta_touches_state() {
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
            &CodexEvent::StreamingDelta {
                method: "item/agentMessage/delta".to_string(),
            },
            "5",
            &registry,
        );

        let reg = registry.read();
        assert!(reg.get("5").unwrap().is_fresh(1000));
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

        // Command execution item
        translate_event(
            &CodexEvent::ItemStarted {
                item_type: "commandExecution".to_string(),
                command: Some("npm install".to_string()),
                file_path: None,
                name: None,
            },
            "5",
            &registry,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().last_tool.as_deref(), Some("Shell"));
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
                item_type: "commandExecution".to_string(),
                output: Some("added 123 packages".to_string()),
            },
            "5",
            &registry,
        );
        {
            let reg = registry.read();
            let state = reg.get("5").unwrap();
            assert_eq!(state.status, HookStatus::Processing);
            assert_eq!(state.activity_log.len(), 1);
            assert_eq!(state.activity_log[0].tool_name, "Shell");
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
