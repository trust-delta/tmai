//! Hook event handler — processes incoming Claude Code hook events
//! and updates the HookRegistry accordingly.

use tracing::{debug, warn};

use crate::api::CoreEvent;
use crate::state::SharedState;

use super::registry::{HookRegistry, SessionPaneMap};
use super::types::{event_names, HookContext, HookEventPayload, HookState, HookStatus};

/// Process an incoming hook event and update the registry
///
/// Returns an optional CoreEvent to emit (e.g., for team-related events).
pub fn handle_hook_event(
    payload: &HookEventPayload,
    pane_id: &str,
    hook_registry: &HookRegistry,
    session_pane_map: &SessionPaneMap,
) -> Option<CoreEvent> {
    // Register session_id → pane_id mapping
    if !payload.session_id.is_empty() {
        let mut map = session_pane_map.write();
        map.insert(payload.session_id.clone(), pane_id.to_string());
    }

    let event = payload.hook_event_name.as_str();
    debug!(
        event,
        pane_id,
        session_id = %payload.session_id,
        tool_name = ?payload.tool_name,
        "Processing hook event"
    );

    match event {
        event_names::SESSION_START => {
            let mut state = HookState::new(payload.session_id.clone(), payload.cwd.clone());
            state.last_context = build_context(payload);
            state.worktree = payload.worktree.clone();
            let mut reg = hook_registry.write();
            reg.insert(pane_id.to_string(), state);
            None
        }

        event_names::USER_PROMPT_SUBMIT => {
            // Clear last_tool on new prompt (fresh processing cycle)
            let ctx = build_context(payload);
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.last_tool = None;
                if payload.cwd.is_some() {
                    state.cwd = payload.cwd.clone();
                }
                state.last_context = ctx;
                state.touch();
            } else {
                let mut state = HookState::new(payload.session_id.clone(), payload.cwd.clone());
                state.status = HookStatus::Processing;
                state.last_context = ctx;
                reg.insert(pane_id.to_string(), state);
            }
            None
        }

        event_names::PRE_TOOL_USE => {
            // Filter empty tool names to prevent "Tool: " display
            let tool_name = payload.tool_name.clone().filter(|t| !t.is_empty());
            update_status(
                hook_registry,
                pane_id,
                payload,
                HookStatus::Processing,
                tool_name,
            );
            None
        }

        event_names::POST_TOOL_USE => {
            // Tool completed, still processing (more tools may follow)
            // Keep last_tool so the display shows which tool was last used.
            // It will be overwritten by the next PreToolUse or cleared by
            // UserPromptSubmit / Stop.
            let ctx = build_context(payload);
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.last_context = ctx;
                state.touch();
            }
            None
        }

        event_names::NOTIFICATION => {
            // Check for permission_prompt notification type
            let is_permission = payload
                .notification_type
                .as_deref()
                .map(|t| t == "permission_prompt")
                .unwrap_or(false);
            if is_permission {
                update_status(
                    hook_registry,
                    pane_id,
                    payload,
                    HookStatus::AwaitingApproval,
                    None,
                );
            }
            // Other notification types don't change state
            None
        }

        event_names::PERMISSION_REQUEST => {
            update_status(
                hook_registry,
                pane_id,
                payload,
                HookStatus::AwaitingApproval,
                payload.tool_name.clone().filter(|t| !t.is_empty()),
            );
            None
        }

        event_names::STOP => {
            // Clear last_tool on stop (session returns to idle)
            let ctx = build_context(payload);
            let cwd = {
                let mut reg = hook_registry.write();
                let cwd = if let Some(state) = reg.get_mut(pane_id) {
                    state.status = HookStatus::Idle;
                    state.last_tool = None;
                    state.last_context = ctx;
                    state.touch();
                    state.cwd.clone()
                } else {
                    None
                };
                cwd
            };

            // Emit AgentStopped event for review service and other listeners
            Some(CoreEvent::AgentStopped {
                target: pane_id.to_string(),
                cwd: cwd.unwrap_or_default(),
                last_assistant_message: payload.last_assistant_message.clone(),
            })
        }

        event_names::SESSION_END => {
            // Drop each lock before acquiring the next to avoid holding
            // multiple write locks simultaneously
            {
                let mut reg = hook_registry.write();
                reg.remove(pane_id);
            }
            {
                let mut map = session_pane_map.write();
                map.remove(&payload.session_id);
            }
            debug!(pane_id, "Hook session ended, removed from registry");
            None
        }

        event_names::SUBAGENT_START | event_names::SUBAGENT_STOP => {
            // Touch the hook state to keep it fresh, agent is processing
            update_status(
                hook_registry,
                pane_id,
                payload,
                HookStatus::Processing,
                None,
            );
            None
        }

        event_names::TEAMMATE_IDLE => {
            let team_name = payload.team_name.clone().unwrap_or_default();
            let member_name = payload.teammate_name.clone().unwrap_or_default();
            if !team_name.is_empty() && !member_name.is_empty() {
                Some(CoreEvent::TeammateIdle {
                    target: pane_id.to_string(),
                    team_name,
                    member_name,
                })
            } else {
                None
            }
        }

        event_names::TASK_COMPLETED => {
            let team_name = payload.team_name.clone().unwrap_or_default();
            let task_id = payload.task_id.clone().unwrap_or_default();
            let task_subject = payload.task_subject.clone().unwrap_or_default();
            if !team_name.is_empty() && !task_id.is_empty() {
                Some(CoreEvent::TaskCompleted {
                    team_name,
                    task_id,
                    task_subject,
                })
            } else {
                None
            }
        }

        event_names::CONFIG_CHANGE => {
            // Config file changed — emit event for security/audit, touch timestamp only
            let ctx = build_context(payload);
            let source = payload.source.clone().unwrap_or_default();
            let file_path = payload.file_path.clone().unwrap_or_default();
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.last_context = ctx;
                state.touch();
            }
            Some(CoreEvent::ConfigChanged {
                target: pane_id.to_string(),
                source,
                file_path,
            })
        }

        event_names::WORKTREE_CREATE => {
            // Worktree created — set Processing, store worktree info, emit event
            let worktree_info = payload.worktree.clone();
            update_status(
                hook_registry,
                pane_id,
                payload,
                HookStatus::Processing,
                None,
            );
            // Store worktree info in HookState
            if worktree_info.is_some() {
                let mut reg = hook_registry.write();
                if let Some(state) = reg.get_mut(pane_id) {
                    state.worktree = worktree_info.clone();
                }
            }
            Some(CoreEvent::WorktreeCreated {
                target: pane_id.to_string(),
                worktree: worktree_info,
            })
        }

        event_names::WORKTREE_REMOVE => {
            // Worktree removed — touch timestamp, emit event with worktree info
            let worktree_info = payload.worktree.clone();
            let ctx = build_context(payload);
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.last_context = ctx;
                state.touch();
                // Clear worktree info on removal
                state.worktree = None;
            }
            Some(CoreEvent::WorktreeRemoved {
                target: pane_id.to_string(),
                worktree: worktree_info,
            })
        }

        event_names::PRE_COMPACT => {
            // Context compaction starting — maintain Processing, touch timestamp
            let ctx = build_context(payload);
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.last_context = ctx;
                state.touch();
            }
            None
        }

        event_names::INSTRUCTIONS_LOADED => {
            // CLAUDE.md or rules files loaded — touch timestamp, emit event
            let ctx = build_context(payload);
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.last_context = ctx;
                state.touch();
            }
            Some(CoreEvent::InstructionsLoaded {
                target: pane_id.to_string(),
            })
        }

        event_names::POST_TOOL_USE_FAILURE => {
            // Tool failed — same as PostToolUse (Processing continues, keep last_tool)
            let ctx = build_context(payload);
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.last_context = ctx;
                state.touch();
            }
            None
        }

        _ => {
            warn!(event, "Unknown hook event type, ignoring");
            None
        }
    }
}

/// Resolve pane_id from request headers and fallback strategies
///
/// Priority:
/// 1. X-Tmai-Pane-Id header (injected via hook's allowedEnvVars + $TMUX_PANE)
/// 2. session_id → pane_id lookup in SessionPaneMap
/// 3. cwd-based matching against AppState agents
pub fn resolve_pane_id(
    header_pane_id: Option<&str>,
    session_id: &str,
    cwd: Option<&str>,
    session_pane_map: &SessionPaneMap,
    state: &SharedState,
) -> Option<String> {
    // Strategy 1: Direct header
    if let Some(pane_id) = header_pane_id {
        let cleaned = pane_id.trim_start_matches('%');
        if !cleaned.is_empty() {
            return Some(cleaned.to_string());
        }
    }

    // Strategy 2: session_id lookup
    if !session_id.is_empty() {
        let map = session_pane_map.read();
        if let Some(pane_id) = map.get(session_id) {
            return Some(pane_id.clone());
        }
    }

    // Strategy 3: cwd-based matching
    if let Some(cwd) = cwd {
        if !cwd.is_empty() {
            let app_state = state.read();
            for agent in app_state.agents.values() {
                if agent.cwd == cwd {
                    // Extract pane_id from target_to_pane_id mapping
                    if let Some(pane_id) = app_state.target_to_pane_id.get(&agent.target) {
                        return Some(pane_id.clone());
                    }
                }
            }
        }
    }

    None
}

/// Build a HookContext from a hook event payload
fn build_context(payload: &HookEventPayload) -> HookContext {
    HookContext {
        event_name: payload.hook_event_name.clone(),
        tool_input: payload.tool_input.clone(),
        permission_mode: payload.permission_mode.clone(),
    }
}

/// Update hook state for a pane, creating entry if needed
fn update_status(
    registry: &HookRegistry,
    pane_id: &str,
    payload: &HookEventPayload,
    status: HookStatus,
    tool_name: Option<String>,
) {
    let mut reg = registry.write();
    if let Some(state) = reg.get_mut(pane_id) {
        state.status = status;
        if tool_name.is_some() {
            state.last_tool = tool_name;
        }
        if payload.cwd.is_some() {
            state.cwd = payload.cwd.clone();
        }
        // Update worktree info if provided (first event with worktree in non-SessionStart path)
        if payload.worktree.is_some() && state.worktree.is_none() {
            state.worktree = payload.worktree.clone();
        }
        state.last_context = build_context(payload);
        state.touch();
    } else {
        // Auto-create entry if not registered via SessionStart
        let mut state = HookState::new(payload.session_id.clone(), payload.cwd.clone());
        state.status = status;
        state.last_tool = tool_name;
        state.worktree = payload.worktree.clone();
        state.last_context = build_context(payload);
        reg.insert(pane_id.to_string(), state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hooks::registry::{new_hook_registry, new_session_pane_map};

    fn make_payload(event: &str) -> HookEventPayload {
        serde_json::from_value(serde_json::json!({
            "hook_event_name": event,
            "session_id": "test-session",
            "cwd": "/tmp/test"
        }))
        .unwrap()
    }

    fn make_payload_with_tool(event: &str, tool: &str) -> HookEventPayload {
        serde_json::from_value(serde_json::json!({
            "hook_event_name": event,
            "session_id": "test-session",
            "tool_name": tool
        }))
        .unwrap()
    }

    #[test]
    fn test_session_start_creates_entry() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();
        let payload = make_payload("SessionStart");

        handle_hook_event(&payload, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Idle);
        assert_eq!(state.session_id, "test-session");
    }

    #[test]
    fn test_user_prompt_submit_sets_processing() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        // Start session first
        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Processing);
    }

    #[test]
    fn test_pre_tool_use_tracks_tool_name() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(
            &make_payload_with_tool("PreToolUse", "Bash"),
            "5",
            &registry,
            &map,
        );

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert_eq!(state.last_tool.as_deref(), Some("Bash"));
    }

    #[test]
    fn test_notification_permission_prompt_sets_awaiting() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "Notification",
            "session_id": "test-session",
            "notification_type": "permission_prompt"
        }))
        .unwrap();

        handle_hook_event(&payload, "5", &registry, &map);

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::AwaitingApproval);
    }

    #[test]
    fn test_stop_sets_idle_and_emits_agent_stopped() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);
        let event = handle_hook_event(&make_payload("Stop"), "5", &registry, &map);

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Idle);

        // Stop should emit AgentStopped event
        assert!(matches!(event, Some(CoreEvent::AgentStopped { .. })));
        if let Some(CoreEvent::AgentStopped { target, cwd, .. }) = event {
            assert_eq!(target, "5");
            assert_eq!(cwd, "/tmp/test");
        }
    }

    #[test]
    fn test_session_end_removes_entry() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("SessionEnd"), "5", &registry, &map);

        let reg = registry.read();
        assert!(reg.get("5").is_none());
    }

    #[test]
    fn test_session_pane_map_updated() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let m = map.read();
        assert_eq!(m.get("test-session").map(|s| s.as_str()), Some("5"));
    }

    #[test]
    fn test_teammate_idle_emits_core_event() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "TeammateIdle",
            "session_id": "s1",
            "team_name": "my-team",
            "teammate_name": "researcher"
        }))
        .unwrap();

        let event = handle_hook_event(&payload, "5", &registry, &map);
        assert!(matches!(event, Some(CoreEvent::TeammateIdle { .. })));
    }

    #[test]
    fn test_task_completed_emits_core_event() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "TaskCompleted",
            "session_id": "s1",
            "team_name": "my-team",
            "task_id": "1",
            "task_subject": "Fix the bug"
        }))
        .unwrap();

        let event = handle_hook_event(&payload, "5", &registry, &map);
        assert!(matches!(event, Some(CoreEvent::TaskCompleted { .. })));
    }

    #[test]
    fn test_auto_creates_entry_on_unknown_pane() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        // No SessionStart, directly send PreToolUse
        handle_hook_event(
            &make_payload_with_tool("PreToolUse", "Read"),
            "99",
            &registry,
            &map,
        );

        let reg = registry.read();
        let state = reg.get("99").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert_eq!(state.last_tool.as_deref(), Some("Read"));
    }

    #[test]
    fn test_resolve_pane_id_from_header() {
        let map = new_session_pane_map();
        let state = crate::state::AppState::shared();

        let result = resolve_pane_id(Some("%5"), "", None, &map, &state);
        assert_eq!(result.as_deref(), Some("5"));
    }

    #[test]
    fn test_resolve_pane_id_from_session_map() {
        let map = new_session_pane_map();
        let state = crate::state::AppState::shared();

        {
            let mut m = map.write();
            m.insert("sess-123".to_string(), "7".to_string());
        }

        let result = resolve_pane_id(None, "sess-123", None, &map, &state);
        assert_eq!(result.as_deref(), Some("7"));
    }

    #[test]
    fn test_resolve_pane_id_none_when_no_match() {
        let map = new_session_pane_map();
        let state = crate::state::AppState::shared();

        let result = resolve_pane_id(None, "", None, &map, &state);
        assert!(result.is_none());
    }

    #[test]
    fn test_permission_request_sets_awaiting() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let payload = make_payload_with_tool("PermissionRequest", "Bash");
        handle_hook_event(&payload, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::AwaitingApproval);
        assert_eq!(state.last_tool.as_deref(), Some("Bash"));
    }

    /// UserPromptSubmit clears last_tool from previous cycle
    #[test]
    fn test_user_prompt_submit_clears_last_tool() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        // Set a tool via PreToolUse
        handle_hook_event(
            &make_payload_with_tool("PreToolUse", "Bash"),
            "5",
            &registry,
            &map,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().last_tool.as_deref(), Some("Bash"));
        }

        // New prompt should clear the tool
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);
        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert!(
            state.last_tool.is_none(),
            "UserPromptSubmit should clear last_tool"
        );
    }

    /// PostToolUse preserves last_tool for display continuity
    #[test]
    fn test_post_tool_use_preserves_last_tool() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(
            &make_payload_with_tool("PreToolUse", "Read"),
            "5",
            &registry,
            &map,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().last_tool.as_deref(), Some("Read"));
        }

        // PostToolUse keeps last_tool so display shows "Tool: Read" until next event
        handle_hook_event(&make_payload("PostToolUse"), "5", &registry, &map);
        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert_eq!(
            state.last_tool.as_deref(),
            Some("Read"),
            "PostToolUse should preserve last_tool"
        );
    }

    /// Stop clears last_tool when returning to idle
    #[test]
    fn test_stop_clears_last_tool() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(
            &make_payload_with_tool("PreToolUse", "Write"),
            "5",
            &registry,
            &map,
        );

        handle_hook_event(&make_payload("Stop"), "5", &registry, &map);
        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Idle);
        assert!(state.last_tool.is_none(), "Stop should clear last_tool");
    }

    /// Full lifecycle: PreToolUse sets tool, PostToolUse preserves it, next PreToolUse overwrites
    #[test]
    fn test_tool_lifecycle_pre_post_pre() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        // First tool
        handle_hook_event(
            &make_payload_with_tool("PreToolUse", "Bash"),
            "5",
            &registry,
            &map,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().last_tool.as_deref(), Some("Bash"));
        }

        // Tool finishes — last_tool preserved for display
        handle_hook_event(&make_payload("PostToolUse"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(
                reg.get("5").unwrap().last_tool.as_deref(),
                Some("Bash"),
                "PostToolUse should preserve last_tool"
            );
        }

        // Second tool overwrites
        handle_hook_event(
            &make_payload_with_tool("PreToolUse", "Edit"),
            "5",
            &registry,
            &map,
        );
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().last_tool.as_deref(), Some("Edit"));
        }

        // Stop resets everything
        handle_hook_event(&make_payload("Stop"), "5", &registry, &map);
        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Idle);
        assert!(state.last_tool.is_none());
    }

    #[test]
    fn test_last_context_set_on_pre_tool_use() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "PreToolUse",
            "session_id": "test-session",
            "tool_name": "Bash",
            "tool_input": {"command": "cargo test"},
            "permission_mode": "default"
        }))
        .unwrap();
        handle_hook_event(&payload, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.last_context.event_name, "PreToolUse");
        assert!(state.last_context.tool_input.is_some());
        assert_eq!(
            state.last_context.permission_mode.as_deref(),
            Some("default")
        );
    }

    #[test]
    fn test_last_context_updated_across_events() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(
                reg.get("5").unwrap().last_context.event_name,
                "SessionStart"
            );
        }

        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(
                reg.get("5").unwrap().last_context.event_name,
                "UserPromptSubmit"
            );
        }

        handle_hook_event(&make_payload("Stop"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().last_context.event_name, "Stop");
        }
    }

    #[test]
    fn test_config_change_emits_event_and_touches() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "ConfigChange",
            "session_id": "test-session",
            "source": "user_settings",
            "file_path": "/home/user/.claude/settings.json"
        }))
        .unwrap();

        let event = handle_hook_event(&payload, "5", &registry, &map);
        assert!(matches!(event, Some(CoreEvent::ConfigChanged { .. })));
        if let Some(CoreEvent::ConfigChanged {
            target,
            source,
            file_path,
        }) = event
        {
            assert_eq!(target, "5");
            assert_eq!(source, "user_settings");
            assert_eq!(file_path, "/home/user/.claude/settings.json");
        }

        // Status should remain Idle (no state change)
        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Idle);
    }

    #[test]
    fn test_config_change_missing_fields_defaults_to_empty() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        // ConfigChange without source/file_path fields
        let event = handle_hook_event(&make_payload("ConfigChange"), "5", &registry, &map);
        if let Some(CoreEvent::ConfigChanged {
            source, file_path, ..
        }) = event
        {
            assert_eq!(source, "", "Missing source should default to empty string");
            assert_eq!(
                file_path, "",
                "Missing file_path should default to empty string"
            );
        } else {
            panic!("Expected ConfigChanged event");
        }
    }

    #[test]
    fn test_worktree_create_sets_processing_and_emits() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let event = handle_hook_event(&make_payload("WorktreeCreate"), "5", &registry, &map);
        assert!(matches!(event, Some(CoreEvent::WorktreeCreated { .. })));

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Processing);
    }

    #[test]
    fn test_worktree_remove_emits_event() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let event = handle_hook_event(&make_payload("WorktreeRemove"), "5", &registry, &map);
        assert!(matches!(event, Some(CoreEvent::WorktreeRemoved { .. })));

        // Status should remain Idle (no state change)
        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Idle);
    }

    #[test]
    fn test_pre_compact_maintains_processing() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        let event = handle_hook_event(&make_payload("PreCompact"), "5", &registry, &map);
        assert!(event.is_none());

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Processing);
    }

    #[test]
    fn test_post_tool_use_failure_keeps_processing_and_last_tool() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(
            &make_payload_with_tool("PreToolUse", "Bash"),
            "5",
            &registry,
            &map,
        );

        let event = handle_hook_event(&make_payload("PostToolUseFailure"), "5", &registry, &map);
        assert!(event.is_none());

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.status, HookStatus::Processing);
        assert_eq!(
            state.last_tool.as_deref(),
            Some("Bash"),
            "PostToolUseFailure should preserve last_tool"
        );
    }

    #[test]
    fn test_last_context_set_on_post_tool_use() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "PostToolUse",
            "session_id": "test-session",
            "tool_name": "Bash",
            "tool_input": {"command": "npm test"},
            "permission_mode": "dontAsk"
        }))
        .unwrap();
        handle_hook_event(&payload, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.last_context.event_name, "PostToolUse");
        assert_eq!(
            state.last_context.permission_mode.as_deref(),
            Some("dontAsk")
        );
    }

    #[test]
    fn test_instructions_loaded_emits_event_and_touches() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let event = handle_hook_event(&make_payload("InstructionsLoaded"), "5", &registry, &map);
        assert!(matches!(event, Some(CoreEvent::InstructionsLoaded { .. })));
        if let Some(CoreEvent::InstructionsLoaded { target }) = event {
            assert_eq!(target, "5");
        }

        // Status should remain Idle (no state change)
        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Idle);
    }

    #[test]
    fn test_session_start_stores_worktree_info() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "SessionStart",
            "session_id": "wt-session",
            "cwd": "/home/user/worktrees/feat-auth",
            "worktree": {
                "name": "feat-auth",
                "path": "/home/user/worktrees/feat-auth",
                "branch": "feat/auth",
                "original_repo": "/home/user/project"
            }
        }))
        .unwrap();

        handle_hook_event(&payload, "10", &registry, &map);

        let reg = registry.read();
        let state = reg.get("10").unwrap();
        let wt = state.worktree.as_ref().unwrap();
        assert_eq!(wt.name.as_deref(), Some("feat-auth"));
        assert_eq!(wt.branch.as_deref(), Some("feat/auth"));
        assert_eq!(wt.original_repo.as_deref(), Some("/home/user/project"));
    }

    #[test]
    fn test_worktree_create_includes_worktree_info_in_event() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "WorktreeCreate",
            "session_id": "test-session",
            "cwd": "/home/user/worktrees/fix-bug",
            "worktree": {
                "name": "fix-bug",
                "path": "/home/user/worktrees/fix-bug",
                "branch": "fix/bug-123"
            }
        }))
        .unwrap();

        let event = handle_hook_event(&payload, "5", &registry, &map);
        if let Some(CoreEvent::WorktreeCreated { target, worktree }) = event {
            assert_eq!(target, "5");
            let wt = worktree.unwrap();
            assert_eq!(wt.name.as_deref(), Some("fix-bug"));
            assert_eq!(wt.branch.as_deref(), Some("fix/bug-123"));
        } else {
            panic!("Expected WorktreeCreated event");
        }

        // Verify worktree info stored in HookState
        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert!(state.worktree.is_some());
    }

    #[test]
    fn test_worktree_remove_clears_worktree_info() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        // Start with worktree info
        let start_payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "SessionStart",
            "session_id": "wt-session",
            "cwd": "/home/user/worktrees/feat",
            "worktree": {
                "name": "feat",
                "path": "/home/user/worktrees/feat",
                "branch": "feat/x"
            }
        }))
        .unwrap();
        handle_hook_event(&start_payload, "5", &registry, &map);

        {
            let reg = registry.read();
            assert!(reg.get("5").unwrap().worktree.is_some());
        }

        // Remove worktree
        handle_hook_event(&make_payload("WorktreeRemove"), "5", &registry, &map);

        let reg = registry.read();
        assert!(
            reg.get("5").unwrap().worktree.is_none(),
            "WorktreeRemove should clear worktree info"
        );
    }
}
