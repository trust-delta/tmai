//! Key handler logic extracted from App::handle_normal_mode_key()
//!
//! Functions here read AppState to decide what action to take, returning a KeyAction
//! that the App executes after releasing the state lock. This separates "decide" from "execute"
//! and minimizes lock hold duration.

use crate::agents::{AgentStatus, ApprovalType};
use crate::detectors::get_detector;
use crate::state::AppState;

/// Action to execute after releasing the state lock
pub enum KeyAction {
    /// No action needed
    None,
    /// Send keys via IPC/tmux (non-literal)
    SendKeys { target: String, keys: String },
    /// Send literal keys via IPC/tmux
    #[allow(dead_code)]
    SendKeysLiteral { target: String, keys: String },
    /// Send multiple Down keys followed by Enter (for multi-select submit)
    MultiSelectSubmit { target: String, downs_needed: usize },
    /// Navigate selection with arrow keys, optionally confirming with Enter
    NavigateSelection {
        target: String,
        /// Positive = Down, negative = Up
        steps: i32,
        /// Whether to press Enter after navigating
        confirm: bool,
    },
    /// Focus a tmux pane
    FocusPane { target: String },
    /// Emit audit event for normal-mode interaction
    EmitAudit { target: String, action: String },
}

/// Result of number key selection (may also trigger input mode)
pub struct NumberSelectionResult {
    /// Primary action to execute
    pub action: KeyAction,
    /// Whether to enter input mode after executing the action
    pub enter_input_mode: bool,
}

/// Convert a character to a digit (supports half-width 1-9 and full-width １-９)
pub fn char_to_digit(c: char) -> usize {
    if c.is_ascii_digit() {
        c.to_digit(10).unwrap_or(0) as usize
    } else {
        // Full-width digit: convert '１'-'９' to 1-9
        (c as u32 - '０' as u32) as usize
    }
}

/// Resolve number key selection for AskUserQuestion
///
/// Returns the action to take and whether to enter input mode.
/// Reads state to determine if the selected agent has an active UserQuestion.
pub fn resolve_number_selection(state: &AppState, num: usize) -> NumberSelectionResult {
    let noop = NumberSelectionResult {
        action: KeyAction::None,
        enter_input_mode: false,
    };

    let Some(target) = state.selected_target() else {
        return noop;
    };
    let target = target.to_string();

    // Check if it's a UserQuestion and get choices + multi_select + cursor (skip virtual)
    let question_info = state.agents.get(&target).and_then(|agent| {
        if agent.is_virtual {
            return None;
        }
        if let AgentStatus::AwaitingApproval {
            approval_type:
                ApprovalType::UserQuestion {
                    choices,
                    multi_select,
                    cursor_position,
                },
            ..
        } = &agent.status
        {
            Some((choices.clone(), *multi_select, *cursor_position))
        } else {
            None
        }
    });

    let Some((choices, multi_select, cursor_position)) = question_info else {
        // Not a UserQuestion — emit audit for potential false negative
        return NumberSelectionResult {
            action: KeyAction::EmitAudit {
                target,
                action: "number_selection".to_string(),
            },
            enter_input_mode: false,
        };
    };

    let count = choices.len();
    // count+1 for "Other" option
    let total_options = count + 1;
    if num > total_options {
        return noop;
    }

    // Check if this is the "Other" option or "Type something" choice
    let is_other = num == total_options
        || choices
            .get(num - 1)
            .map(|c| c.to_lowercase().contains("type something"))
            .unwrap_or(false);

    // Calculate arrow steps from current cursor position to target option
    let cursor = if cursor_position == 0 {
        1
    } else {
        cursor_position
    };
    let steps = num as i32 - cursor as i32;

    if is_other {
        // "Other" or "Type something" — navigate, confirm, then enter input mode
        NumberSelectionResult {
            action: KeyAction::NavigateSelection {
                target,
                steps,
                confirm: true,
            },
            enter_input_mode: true,
        }
    } else if multi_select {
        // Multi-select: navigate only (Space toggle handled separately)
        NumberSelectionResult {
            action: KeyAction::NavigateSelection {
                target,
                steps,
                confirm: false,
            },
            enter_input_mode: false,
        }
    } else {
        // Single select: navigate + Enter
        NumberSelectionResult {
            action: KeyAction::NavigateSelection {
                target,
                steps,
                confirm: true,
            },
            enter_input_mode: false,
        }
    }
}

/// Resolve space key for multi-select toggle
pub fn resolve_space_toggle(state: &AppState) -> KeyAction {
    let Some(target) = state.selected_target() else {
        return KeyAction::None;
    };
    let target = target.to_string();

    let is_multi_select = state.agents.get(&target).is_some_and(|agent| {
        !agent.is_virtual
            && matches!(
                &agent.status,
                AgentStatus::AwaitingApproval {
                    approval_type: ApprovalType::UserQuestion {
                        multi_select: true,
                        ..
                    },
                    ..
                }
            )
    });

    if is_multi_select {
        KeyAction::SendKeys {
            target,
            keys: "Space".to_string(),
        }
    } else {
        KeyAction::None
    }
}

/// Resolve approval key ('y')
///
/// Returns the action and optionally a target for audit if not awaiting approval.
pub fn resolve_approval(state: &AppState) -> KeyAction {
    let Some(target) = state.selected_target() else {
        return KeyAction::None;
    };
    let target = target.to_string();

    let agent_info = state.agents.get(&target).and_then(|a| {
        if a.is_virtual {
            None
        } else {
            Some((
                matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                a.agent_type.clone(),
            ))
        }
    });

    match agent_info {
        Some((true, agent_type)) => {
            let detector = get_detector(&agent_type);
            KeyAction::SendKeys {
                target,
                keys: detector.approval_keys().to_string(),
            }
        }
        Some((false, _)) => KeyAction::EmitAudit {
            target,
            action: "approval_key".to_string(),
        },
        None => KeyAction::None,
    }
}

/// Resolve Enter key for multi-select submit (navigates to Submit button and presses Enter)
///
/// Returns None action if the agent is not in multi-select state.
pub fn resolve_enter_submit(state: &AppState) -> KeyAction {
    let Some(target) = state.selected_target() else {
        return KeyAction::None;
    };
    let target = target.to_string();

    let multi_info = state.agents.get(&target).and_then(|agent| {
        if agent.is_virtual {
            return None;
        }
        if let AgentStatus::AwaitingApproval {
            approval_type:
                ApprovalType::UserQuestion {
                    choices,
                    multi_select: true,
                    cursor_position,
                },
            ..
        } = &agent.status
        {
            Some((choices.len(), *cursor_position))
        } else {
            None
        }
    });

    match multi_info {
        Some((choice_count, cursor_pos)) => {
            let downs_needed = choice_count.saturating_sub(cursor_pos.saturating_sub(1));
            KeyAction::MultiSelectSubmit {
                target,
                downs_needed,
            }
        }
        None => {
            // Not a multi-select — emit audit
            KeyAction::EmitAudit {
                target,
                action: "enter_key".to_string(),
            }
        }
    }
}

/// Resolve focus pane action
pub fn resolve_focus_pane(state: &AppState) -> KeyAction {
    if let Some(agent) = state.selected_agent() {
        if !agent.is_virtual {
            return KeyAction::FocusPane {
                target: agent.target.clone(),
            };
        }
    }
    KeyAction::None
}
