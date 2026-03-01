//! Hook event handler — processes incoming Claude Code hook events
//! and updates the HookRegistry accordingly.

use tracing::{debug, warn};

use crate::api::CoreEvent;
use crate::state::SharedState;

use super::registry::{HookRegistry, SessionPaneMap};
use super::types::{event_names, HookEventPayload, HookState, HookStatus};

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
    debug!(event, pane_id, session_id = %payload.session_id, "Processing hook event");

    match event {
        event_names::SESSION_START => {
            let state = HookState::new(payload.session_id.clone(), payload.cwd.clone());
            let mut reg = hook_registry.write();
            reg.insert(pane_id.to_string(), state);
            None
        }

        event_names::USER_PROMPT_SUBMIT => {
            // Clear last_tool on new prompt (fresh processing cycle)
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.last_tool = None;
                if payload.cwd.is_some() {
                    state.cwd = payload.cwd.clone();
                }
                state.touch();
            } else {
                let mut state = HookState::new(payload.session_id.clone(), payload.cwd.clone());
                state.status = HookStatus::Processing;
                reg.insert(pane_id.to_string(), state);
            }
            None
        }

        event_names::PRE_TOOL_USE => {
            let tool_name = payload.tool_name.clone();
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
            // Clear last_tool since the tool has finished
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.last_tool = None;
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
                payload.tool_name.clone(),
            );
            None
        }

        event_names::STOP => {
            // Clear last_tool on stop (session returns to idle)
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Idle;
                state.last_tool = None;
                state.touch();
            }
            None
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
        state.touch();
    } else {
        // Auto-create entry if not registered via SessionStart
        let mut state = HookState::new(payload.session_id.clone(), payload.cwd.clone());
        state.status = status;
        state.last_tool = tool_name;
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
    fn test_stop_sets_idle() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);
        handle_hook_event(&make_payload("Stop"), "5", &registry, &map);

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Idle);
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
}
