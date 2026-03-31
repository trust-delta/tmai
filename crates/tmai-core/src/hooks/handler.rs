//! Hook event handler — processes incoming Claude Code hook events
//! and updates the HookRegistry accordingly.

use tracing::{debug, warn};

use crate::api::CoreEvent;
use crate::state::SharedState;

use super::registry::{HookRegistry, SessionPaneMap};
use super::types::{
    event_names, HookContext, HookEventPayload, HookState, HookStatus, ToolActivity,
    MAX_ACTIVITY_LOG,
};

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
            save_transcript_path(&mut state, payload);
            // Resolve PID from session files for PTY injection
            state.pid = crate::session_discovery::resolve_pid_for_session(&payload.session_id);
            if let Some(pid) = state.pid {
                debug!(pid, session_id = %payload.session_id, "Resolved PID for session");
            }
            let mut reg = hook_registry.write();
            reg.insert(pane_id.to_string(), state);
            None
        }

        event_names::USER_PROMPT_SUBMIT => {
            // Clear last_tool and activity_log on new prompt (fresh processing cycle)
            let ctx = build_context(payload);
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.last_tool = None;
                state.activity_log.clear();
                if payload.cwd.is_some() {
                    state.cwd = payload.cwd.clone();
                }
                // Resolve PID if not yet known
                if state.pid.is_none() && !payload.session_id.is_empty() {
                    state.pid =
                        crate::session_discovery::resolve_pid_for_session(&payload.session_id);
                }
                state.last_context = ctx;
                save_transcript_path(state, payload);
                state.touch();
            } else {
                let mut state = HookState::new(payload.session_id.clone(), payload.cwd.clone());
                state.status = HookStatus::Processing;
                state.last_context = ctx;
                state.pid = crate::session_discovery::resolve_pid_for_session(&payload.session_id);
                save_transcript_path(&mut state, payload);
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
            let tool_name = payload
                .tool_name
                .clone()
                .unwrap_or_else(|| "Unknown".to_string());
            let input_summary = summarize_tool_input(&tool_name, payload.tool_input.as_ref());
            let response_summary = payload
                .tool_response
                .as_ref()
                .map(|v| {
                    let s = v
                        .as_str()
                        .map(String::from)
                        .unwrap_or_else(|| v.to_string());
                    truncate_string(&s, 200)
                })
                .unwrap_or_default();
            let activity = ToolActivity {
                tool_name,
                input_summary,
                response_summary,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            };
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.status = HookStatus::Processing;
                state.last_context = ctx;
                save_transcript_path(state, payload);
                push_activity(state, activity);
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
                    save_transcript_path(state, payload);
                    // Add last assistant message to activity log
                    if let Some(ref msg) = payload.last_assistant_message {
                        if !msg.is_empty() {
                            push_activity(
                                state,
                                ToolActivity {
                                    tool_name: "Assistant".to_string(),
                                    input_summary: String::new(),
                                    response_summary: truncate_string(msg, 300),
                                    timestamp: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis()
                                        as u64,
                                },
                            );
                        }
                    }
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

        event_names::SUBAGENT_START => {
            // Increment active subagent count, agent is processing
            update_status(
                hook_registry,
                pane_id,
                payload,
                HookStatus::Processing,
                None,
            );
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.active_subagents = state.active_subagents.saturating_add(1);
            }
            None
        }

        event_names::SUBAGENT_STOP => {
            // Decrement active subagent count, agent is still processing
            update_status(
                hook_registry,
                pane_id,
                payload,
                HookStatus::Processing,
                None,
            );
            let mut reg = hook_registry.write();
            if let Some(state) = reg.get_mut(pane_id) {
                state.active_subagents = state.active_subagents.saturating_sub(1);
            }
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
            // Context compaction starting — set Compacting status, increment counter
            let ctx = build_context(payload);
            let count = {
                let mut reg = hook_registry.write();
                if let Some(state) = reg.get_mut(pane_id) {
                    state.status = HookStatus::Compacting;
                    state.compaction_count = state.compaction_count.saturating_add(1);
                    state.last_context = ctx;
                    state.touch();
                    state.compaction_count
                } else {
                    1
                }
            };
            Some(CoreEvent::ContextCompacting {
                target: pane_id.to_string(),
                compaction_count: count,
            })
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

    // Strategy 3: cwd-based matching (prefer PTY-spawned agents for direct linking)
    if let Some(cwd) = cwd {
        if !cwd.is_empty() {
            let app_state = state.read();
            // First, check for PTY-spawned agents with matching cwd — these should
            // receive hook events directly since they are tmai-managed processes.
            // If multiple PTY agents share the same cwd, prefer the first one
            // (stable: agent_order is deterministic).
            for id in &app_state.agent_order {
                if let Some(agent) = app_state.agents.get(id) {
                    if agent.cwd == cwd && agent.pty_session_id.is_some() {
                        let resolved = agent.id.clone();
                        drop(app_state);
                        // Persist mapping for future lookups (avoids re-matching)
                        if !session_id.is_empty() {
                            let mut map = session_pane_map.write();
                            map.insert(session_id.to_string(), resolved.clone());
                        }
                        return Some(resolved);
                    }
                }
            }
            // Then fall back to tmux pane_id mapping
            for agent in app_state.agents.values() {
                if agent.cwd == cwd {
                    if let Some(pane_id) = app_state.target_to_pane_id.get(&agent.target) {
                        return Some(pane_id.clone());
                    }
                }
            }
        }
    }

    // Strategy 4: use session_id as synthetic pane_id (standalone mode)
    // When no tmux is available, session_id serves as the unique identifier.
    // Persist this mapping so subsequent events for the same session_id
    // are resolved via Strategy 2 (deterministic).
    if !session_id.is_empty() {
        let synthetic = format!("hook-{}", session_id);
        let mut map = session_pane_map.write();
        map.insert(session_id.to_string(), synthetic.clone());
        return Some(synthetic);
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

/// Convert HookState to AgentStatus.
///
/// Used by both the Poller (for hook-detected agents) and the PTY sync
/// logic (for PTY-spawned agents that receive hook events).
pub fn hook_status_to_agent_status(hs: &super::types::HookState) -> crate::agents::AgentStatus {
    use super::types::HookStatus;
    use crate::agents::{AgentStatus, ApprovalType};

    match hs.status {
        HookStatus::Processing => {
            let activity = hs
                .last_tool
                .as_ref()
                .filter(|t| !t.is_empty())
                .map(|t| format!("Tool: {}", t))
                .unwrap_or_default();
            AgentStatus::Processing { activity }
        }
        HookStatus::Idle => AgentStatus::Idle,
        HookStatus::AwaitingApproval => {
            let tool_info = hs.last_tool.clone().unwrap_or_default();
            if tool_info == "AskUserQuestion" {
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::UserQuestion {
                        choices: vec![],
                        multi_select: false,
                        cursor_position: 0,
                    },
                    details: String::new(),
                }
            } else if hs.last_context.event_name == "codex_ws_command_approval" {
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::ShellCommand,
                    details: tool_info,
                }
            } else if hs.last_context.event_name == "codex_ws_file_approval" {
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::FileEdit,
                    details: tool_info,
                }
            } else {
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::Other("Approval".to_string()),
                    details: tool_info,
                }
            }
        }
        HookStatus::Compacting => AgentStatus::Processing {
            activity: "Compacting context…".to_string(),
        },
    }
}

/// Save transcript_path from payload to HookState if present,
/// and extract model_id from the transcript on first set.
fn save_transcript_path(state: &mut HookState, payload: &HookEventPayload) {
    if let Some(ref path) = payload.transcript_path {
        if !path.is_empty() && state.transcript_path.is_none() {
            state.transcript_path = Some(path.clone());
            // Extract model_id from the transcript file (first assistant message)
            if state.model_id.is_none() {
                state.model_id = crate::transcript::parser::extract_model_id(path);
            }
        }
    }
    // Retry model extraction if transcript exists but model wasn't found yet
    // (assistant message may not have been written at SessionStart time)
    if state.model_id.is_none() {
        if let Some(ref path) = state.transcript_path {
            state.model_id = crate::transcript::parser::extract_model_id(path);
        }
    }
}

/// Summarize tool input for activity log display
fn summarize_tool_input(tool_name: &str, tool_input: Option<&serde_json::Value>) -> String {
    let input = match tool_input {
        Some(v) => v,
        None => return String::new(),
    };

    match tool_name {
        "Bash" => input
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| truncate_string(s, 120))
            .unwrap_or_default(),
        "Edit" | "Read" | "Write" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default(),
        "Grep" => input
            .get("pattern")
            .and_then(|v| v.as_str())
            .map(|s| truncate_string(s, 80))
            .unwrap_or_default(),
        "Glob" => input
            .get("pattern")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default(),
        "Agent" => input
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| truncate_string(s, 80))
            .unwrap_or_default(),
        "WebFetch" | "WebSearch" => input
            .get("url")
            .or_else(|| input.get("query"))
            .and_then(|v| v.as_str())
            .map(|s| truncate_string(s, 120))
            .unwrap_or_default(),
        _ => {
            // For unknown tools, try common field names
            for key in &["command", "file_path", "path", "query", "description"] {
                if let Some(v) = input.get(key).and_then(|v| v.as_str()) {
                    return truncate_string(v, 80);
                }
            }
            String::new()
        }
    }
}

/// Truncate a string to max_len characters, appending "..." if truncated.
/// Uses char-based counting to avoid panicking on multi-byte UTF-8 boundaries.
pub(crate) fn truncate_string(s: &str, max_len: usize) -> String {
    // Take only the first line for multi-line strings
    let first_line = s.lines().next().unwrap_or(s);
    let char_count = first_line.chars().count();
    if char_count > max_len {
        let truncated: String = first_line.chars().take(max_len).collect();
        format!("{}...", truncated)
    } else if first_line.len() < s.len() {
        // Multi-line: show first line with indicator
        format!("{}...", first_line)
    } else {
        first_line.to_string()
    }
}

/// Add a ToolActivity entry to HookState, maintaining MAX_ACTIVITY_LOG limit
pub(crate) fn push_activity(state: &mut HookState, activity: ToolActivity) {
    state.activity_log.push(activity);
    if state.activity_log.len() > MAX_ACTIVITY_LOG {
        state.activity_log.remove(0);
    }
}

/// Format activity log entries into human-readable preview text
pub fn format_activity_log(activities: &[ToolActivity]) -> String {
    if activities.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();
    for activity in activities {
        // Tool header
        let tool_line = if activity.input_summary.is_empty() {
            format!("⚙ {}", activity.tool_name)
        } else {
            format!("⚙ {}: {}", activity.tool_name, activity.input_summary)
        };
        lines.push(tool_line);

        // Response summary (if available)
        if !activity.response_summary.is_empty() {
            for resp_line in activity.response_summary.lines().take(3) {
                lines.push(format!("  {}", resp_line));
            }
        }
    }

    lines.join("\n")
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
        // Resolve PID if not yet known (fallback for late discovery)
        if state.pid.is_none() && !payload.session_id.is_empty() {
            state.pid = crate::session_discovery::resolve_pid_for_session(&payload.session_id);
        }
        save_transcript_path(state, payload);
        state.last_context = build_context(payload);
        state.touch();
    } else {
        // Auto-create entry if not registered via SessionStart
        let mut state = HookState::new(payload.session_id.clone(), payload.cwd.clone());
        state.status = status;
        state.last_tool = tool_name;
        state.worktree = payload.worktree.clone();
        // Resolve PID for new entry
        state.pid = crate::session_discovery::resolve_pid_for_session(&payload.session_id);
        save_transcript_path(&mut state, payload);
        state.last_context = build_context(payload);
        reg.insert(pane_id.to_string(), state);
    }
}

/// Process incoming statusline data and update the HookRegistry.
///
/// Statusline data provides reliable model info, cost metrics, context window
/// usage, and session metadata. The data is merged into the existing HookState
/// for the resolved pane_id, or a new entry is created if none exists.
///
/// Returns the resolved pane_id (for logging/debugging).
pub fn handle_statusline(
    data: super::types::StatuslineData,
    pane_id: &str,
    hook_registry: &HookRegistry,
    session_pane_map: &SessionPaneMap,
) -> Option<String> {
    // Register session_id → pane_id mapping
    if let Some(ref sid) = data.session_id {
        if !sid.is_empty() {
            let mut map = session_pane_map.write();
            map.insert(sid.clone(), pane_id.to_string());
        }
    }

    debug!(
        pane_id,
        session_id = ?data.session_id,
        model = ?data.model.as_ref().and_then(|m| m.display_name.as_deref()),
        cost_usd = ?data.cost.as_ref().and_then(|c| c.total_cost_usd),
        context_used = ?data.context_window.as_ref().and_then(|c| c.used_percentage),
        "Processing statusline data"
    );

    let mut reg = hook_registry.write();
    if let Some(state) = reg.get_mut(pane_id) {
        // Update model_id from statusline (more reliable than transcript parsing)
        if let Some(ref model) = data.model {
            if let Some(ref id) = model.id {
                state.model_id = Some(id.clone());
            }
        }
        // Update cwd from statusline
        if let Some(ref cwd) = data.cwd {
            state.cwd = Some(cwd.clone());
        }
        // Update transcript_path from statusline
        if let Some(ref tp) = data.transcript_path {
            state.transcript_path = Some(tp.clone());
        }
        // Store full statusline data
        state.statusline = Some(data);
        state.touch();
    } else {
        // Create new HookState from statusline data
        let session_id = data.session_id.clone().unwrap_or_default();
        let cwd = data.cwd.clone();
        let mut state = super::types::HookState::new(session_id.clone(), cwd);
        if let Some(ref model) = data.model {
            if let Some(ref id) = model.id {
                state.model_id = Some(id.clone());
            }
        }
        if let Some(ref tp) = data.transcript_path {
            state.transcript_path = Some(tp.clone());
        }
        // Resolve PID for PTY injection
        if !session_id.is_empty() {
            state.pid = crate::session_discovery::resolve_pid_for_session(&session_id);
        }
        state.statusline = Some(data);
        reg.insert(pane_id.to_string(), state);
    }

    Some(pane_id.to_string())
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
    fn test_pre_compact_sets_compacting_and_emits_event() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        let event = handle_hook_event(&make_payload("PreCompact"), "5", &registry, &map);
        assert!(matches!(
            event,
            Some(CoreEvent::ContextCompacting {
                compaction_count: 1,
                ..
            })
        ));

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().status, HookStatus::Compacting);
        assert_eq!(reg.get("5").unwrap().compaction_count, 1);
    }

    #[test]
    fn test_pre_compact_increments_compaction_count() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        // First compaction
        handle_hook_event(&make_payload("PreCompact"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().compaction_count, 1);
        }

        // Resume processing
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        // Second compaction
        let event = handle_hook_event(&make_payload("PreCompact"), "5", &registry, &map);
        if let Some(CoreEvent::ContextCompacting {
            compaction_count, ..
        }) = event
        {
            assert_eq!(compaction_count, 2);
        } else {
            panic!("Expected ContextCompacting event");
        }

        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().compaction_count, 2);
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

    #[test]
    fn test_subagent_start_increments_count() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        // Start two subagents
        handle_hook_event(&make_payload("SubagentStart"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().active_subagents, 1);
        }

        handle_hook_event(&make_payload("SubagentStart"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().active_subagents, 2);
        }

        // Stop one subagent
        handle_hook_event(&make_payload("SubagentStop"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().active_subagents, 1);
        }

        // Stop the last subagent
        handle_hook_event(&make_payload("SubagentStop"), "5", &registry, &map);
        let reg = registry.read();
        assert_eq!(reg.get("5").unwrap().active_subagents, 0);
    }

    #[test]
    fn test_subagent_stop_does_not_underflow() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        // Stop without matching start should not underflow
        handle_hook_event(&make_payload("SubagentStop"), "5", &registry, &map);
        let reg = registry.read();
        assert_eq!(
            reg.get("5").unwrap().active_subagents,
            0,
            "SubagentStop should not underflow below 0"
        );
    }

    #[test]
    fn test_post_tool_use_accumulates_activity_log() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        // PostToolUse with tool_name and tool_input
        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "PostToolUse",
            "session_id": "test-session",
            "tool_name": "Bash",
            "tool_input": {"command": "cargo test"},
            "tool_response": "All tests passed"
        }))
        .unwrap();
        handle_hook_event(&payload, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.activity_log.len(), 1);
        assert_eq!(state.activity_log[0].tool_name, "Bash");
        assert_eq!(state.activity_log[0].input_summary, "cargo test");
        assert_eq!(state.activity_log[0].response_summary, "All tests passed");
    }

    #[test]
    fn test_user_prompt_submit_clears_activity_log() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        // Add some activities
        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "PostToolUse",
            "session_id": "test-session",
            "tool_name": "Read",
            "tool_input": {"file_path": "src/main.rs"}
        }))
        .unwrap();
        handle_hook_event(&payload, "5", &registry, &map);

        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().activity_log.len(), 1);
        }

        // New prompt clears activity log
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        let reg = registry.read();
        assert!(
            reg.get("5").unwrap().activity_log.is_empty(),
            "UserPromptSubmit should clear activity_log"
        );
    }

    #[test]
    fn test_stop_adds_last_assistant_message() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "Stop",
            "session_id": "test-session",
            "last_assistant_message": "Done! All changes applied."
        }))
        .unwrap();
        handle_hook_event(&payload, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.activity_log.len(), 1);
        assert_eq!(state.activity_log[0].tool_name, "Assistant");
        assert!(state.activity_log[0]
            .response_summary
            .contains("Done! All changes applied."));
    }

    #[test]
    fn test_activity_log_max_size() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("UserPromptSubmit"), "5", &registry, &map);

        // Add MAX_ACTIVITY_LOG + 5 entries
        for i in 0..(super::MAX_ACTIVITY_LOG + 5) {
            let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
                "hook_event_name": "PostToolUse",
                "session_id": "test-session",
                "tool_name": format!("Tool{}", i),
            }))
            .unwrap();
            handle_hook_event(&payload, "5", &registry, &map);
        }

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(
            state.activity_log.len(),
            super::MAX_ACTIVITY_LOG,
            "Activity log should be capped at MAX_ACTIVITY_LOG"
        );
        // First entry should be Tool5 (oldest 5 were evicted)
        assert_eq!(state.activity_log[0].tool_name, "Tool5");
    }

    #[test]
    fn test_transcript_path_saved() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        let payload: HookEventPayload = serde_json::from_value(serde_json::json!({
            "hook_event_name": "SessionStart",
            "session_id": "test-session",
            "cwd": "/tmp/test",
            "transcript_path": "/home/user/.claude/projects/hash/session.jsonl"
        }))
        .unwrap();
        handle_hook_event(&payload, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(
            state.transcript_path.as_deref(),
            Some("/home/user/.claude/projects/hash/session.jsonl")
        );
    }

    #[test]
    fn test_format_activity_log() {
        let activities = vec![
            super::ToolActivity {
                tool_name: "Bash".to_string(),
                input_summary: "cargo test".to_string(),
                response_summary: "All tests passed".to_string(),
                timestamp: 0,
            },
            super::ToolActivity {
                tool_name: "Edit".to_string(),
                input_summary: "src/main.rs".to_string(),
                response_summary: String::new(),
                timestamp: 0,
            },
        ];

        let result = super::format_activity_log(&activities);
        assert!(result.contains("⚙ Bash: cargo test"));
        assert!(result.contains("All tests passed"));
        assert!(result.contains("⚙ Edit: src/main.rs"));
    }

    #[test]
    fn test_summarize_tool_input() {
        // Bash
        let input = serde_json::json!({"command": "npm test"});
        assert_eq!(
            super::summarize_tool_input("Bash", Some(&input)),
            "npm test"
        );

        // Edit
        let input = serde_json::json!({"file_path": "src/main.rs"});
        assert_eq!(
            super::summarize_tool_input("Edit", Some(&input)),
            "src/main.rs"
        );

        // Grep
        let input = serde_json::json!({"pattern": "TODO"});
        assert_eq!(super::summarize_tool_input("Grep", Some(&input)), "TODO");

        // None input
        assert_eq!(super::summarize_tool_input("Bash", None), "");
    }

    #[test]
    fn test_compaction_count_resets_on_new_session() {
        let registry = new_hook_registry();
        let map = new_session_pane_map();

        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);
        handle_hook_event(&make_payload("PreCompact"), "5", &registry, &map);
        {
            let reg = registry.read();
            assert_eq!(reg.get("5").unwrap().compaction_count, 1);
        }

        // Session end + new session start resets counters
        handle_hook_event(&make_payload("SessionEnd"), "5", &registry, &map);
        handle_hook_event(&make_payload("SessionStart"), "5", &registry, &map);

        let reg = registry.read();
        assert_eq!(
            reg.get("5").unwrap().compaction_count,
            0,
            "New session should reset compaction count"
        );
        assert_eq!(
            reg.get("5").unwrap().active_subagents,
            0,
            "New session should reset subagent count"
        );
    }

    #[test]
    fn test_handle_statusline_new_entry() {
        let registry = crate::hooks::new_hook_registry();
        let map = crate::hooks::new_session_pane_map();

        let data = super::super::types::StatuslineData {
            cwd: Some("/home/user/project".to_string()),
            session_id: Some("sess-abc".to_string()),
            version: Some("2.1.59".to_string()),
            model: Some(super::super::types::StatuslineModel {
                id: Some("claude-opus-4-6".to_string()),
                display_name: Some("Opus".to_string()),
            }),
            cost: Some(super::super::types::StatuslineCost {
                total_cost_usd: Some(0.5),
                total_lines_added: Some(100),
                ..Default::default()
            }),
            context_window: Some(super::super::types::StatuslineContextWindow {
                used_percentage: Some(25),
                context_window_size: Some(200000),
                ..Default::default()
            }),
            ..Default::default()
        };

        handle_statusline(data, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        assert_eq!(state.model_id.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(state.cwd.as_deref(), Some("/home/user/project"));
        assert!(state.statusline.is_some());

        let sl = state.statusline.as_ref().unwrap();
        assert_eq!(sl.version.as_deref(), Some("2.1.59"));
        assert_eq!(sl.cost.as_ref().unwrap().total_cost_usd, Some(0.5));
        assert_eq!(
            sl.context_window.as_ref().unwrap().used_percentage,
            Some(25)
        );

        // Check session_id → pane_id mapping was registered
        let m = map.read();
        assert_eq!(m.get("sess-abc").map(|s| s.as_str()), Some("5"));
    }

    #[test]
    fn test_handle_statusline_updates_existing() {
        let registry = crate::hooks::new_hook_registry();
        let map = crate::hooks::new_session_pane_map();

        // First: create via hook event
        let payload = make_payload("SessionStart");
        handle_hook_event(&payload, "5", &registry, &map);

        // Then: update via statusline
        let data = super::super::types::StatuslineData {
            session_id: Some("test-session".to_string()),
            model: Some(super::super::types::StatuslineModel {
                id: Some("claude-sonnet-4-6".to_string()),
                display_name: Some("Sonnet".to_string()),
            }),
            version: Some("2.1.80".to_string()),
            ..Default::default()
        };

        handle_statusline(data, "5", &registry, &map);

        let reg = registry.read();
        let state = reg.get("5").unwrap();
        // model_id should be updated from statusline
        assert_eq!(state.model_id.as_deref(), Some("claude-sonnet-4-6"));
        assert!(state.statusline.is_some());
        assert_eq!(
            state.statusline.as_ref().unwrap().version.as_deref(),
            Some("2.1.80")
        );
    }
}
