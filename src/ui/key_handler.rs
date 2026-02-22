//! Key handler logic extracted from App::handle_normal_mode_key()
//!
//! Functions here read AppState to decide what action to take, returning a KeyAction
//! that the App executes after releasing the state lock. This separates "decide" from "execute"
//! and minimizes lock hold duration.

use crossterm::event::KeyCode;

use tmai_core::agents::{AgentStatus, ApprovalType};
use tmai_core::detectors::get_detector;
use tmai_core::state::AppState;

/// Normalize full-width ASCII characters in KeyCode to half-width equivalents.
///
/// Converts Ａ-Ｚ, ａ-ｚ, ０-９, and full-width space (　) to ASCII equivalents.
/// Use this for keyboard shortcut modes; skip for passthrough and text input modes.
pub fn normalize_keycode(code: KeyCode) -> KeyCode {
    match code {
        KeyCode::Char(c) => KeyCode::Char(normalize_fullwidth_char(c)),
        other => other,
    }
}

/// Convert a full-width ASCII character to its half-width equivalent.
fn normalize_fullwidth_char(c: char) -> char {
    match c {
        '０'..='９' => ((c as u32 - '０' as u32) + '0' as u32) as u8 as char,
        'Ａ'..='Ｚ' => ((c as u32 - 'Ａ' as u32) + 'A' as u32) as u8 as char,
        'ａ'..='ｚ' => ((c as u32 - 'ａ' as u32) + 'a' as u32) as u8 as char,
        '\u{3000}' => ' ', // full-width space → half-width space
        _ => c,
    }
}

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
    /// Tab-based submit for checkbox format (Right + Enter)
    MultiSelectSubmitTab { target: String },
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
        // Multi-select: navigate only (toggle is done via Space key)
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
///
/// Returns action + whether to enter input mode (for "Type something" / Other).
pub fn resolve_space_toggle(state: &AppState) -> NumberSelectionResult {
    let noop = NumberSelectionResult {
        action: KeyAction::None,
        enter_input_mode: false,
    };

    let Some(target) = state.selected_target() else {
        return noop;
    };
    let target = target.to_string();

    let question_info = state.agents.get(&target).and_then(|agent| {
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
            Some((choices.clone(), *cursor_position))
        } else {
            None
        }
    });

    let Some((choices, cursor_position)) = question_info else {
        return noop;
    };

    let cursor = if cursor_position == 0 {
        1
    } else {
        cursor_position
    };

    // Cursor beyond choices = "Other" option, or on "Type something"
    let is_text_input = cursor > choices.len()
        || choices
            .get(cursor - 1)
            .is_some_and(|c| c.to_lowercase().contains("type something"));

    if is_text_input {
        // Select the text-input option (Enter) and switch to input mode
        return NumberSelectionResult {
            action: KeyAction::SendKeys {
                target,
                keys: "Enter".to_string(),
            },
            enter_input_mode: true,
        };
    }

    // Checkbox format uses Enter to toggle, legacy uses Space
    let key = if has_checkbox_format(&choices) {
        "Enter"
    } else {
        "Space"
    };
    NumberSelectionResult {
        action: KeyAction::SendKeys {
            target,
            keys: key.to_string(),
        },
        enter_input_mode: false,
    }
}

/// Resolve approval/rejection key ('y' or 'n')
///
/// For UserQuestion: navigates to the choice matching the key and confirms.
/// - 'y': finds first choice containing "Yes" (case-insensitive)
/// - 'n': finds first choice containing "No" (case-insensitive)
///
/// For non-UserQuestion approval: 'y' sends approval keys, 'n' is ignored.
/// When not awaiting approval: emits audit event.
pub fn resolve_yes_no(state: &AppState, key: char) -> KeyAction {
    let Some(target) = state.selected_target() else {
        return KeyAction::None;
    };
    let target = target.to_string();

    let agent_info = state.agents.get(&target).and_then(|a| {
        if a.is_virtual {
            None
        } else {
            Some((&a.status, a.agent_type.clone()))
        }
    });

    let Some((status, agent_type)) = agent_info else {
        return KeyAction::None;
    };

    match status {
        AgentStatus::AwaitingApproval {
            approval_type:
                ApprovalType::UserQuestion {
                    choices,
                    cursor_position,
                    ..
                },
            ..
        } => {
            // Find choice matching "Yes" or "No" (word-boundary check)
            let needle = if key == 'y' { "yes" } else { "no" };
            let match_pos = choices
                .iter()
                .position(|c| choice_starts_with_word(c, needle));

            let Some(idx) = match_pos else {
                // No matching choice — for 'y' fall back to approval keys
                if key == 'y' {
                    let detector = get_detector(&agent_type);
                    return KeyAction::SendKeys {
                        target,
                        keys: detector.approval_keys().to_string(),
                    };
                }
                return KeyAction::None;
            };

            let target_pos = idx + 1; // 1-indexed
            let cursor = if *cursor_position == 0 {
                1
            } else {
                *cursor_position
            };
            let steps = target_pos as i32 - cursor as i32;

            KeyAction::NavigateSelection {
                target,
                steps,
                confirm: true,
            }
        }
        AgentStatus::AwaitingApproval { .. } => {
            // Non-UserQuestion approval: only 'y' sends approval keys
            if key == 'y' {
                let detector = get_detector(&agent_type);
                KeyAction::SendKeys {
                    target,
                    keys: detector.approval_keys().to_string(),
                }
            } else {
                KeyAction::None
            }
        }
        _ => {
            // Not awaiting approval — emit audit
            KeyAction::EmitAudit {
                target,
                action: format!("{}_key", key),
            }
        }
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
            // Check if checkbox format
            let is_checkbox = state
                .agents
                .get(&target)
                .and_then(|agent| {
                    if let AgentStatus::AwaitingApproval {
                        approval_type: ApprovalType::UserQuestion { choices, .. },
                        ..
                    } = &agent.status
                    {
                        Some(has_checkbox_format(choices))
                    } else {
                        None
                    }
                })
                .unwrap_or(false);

            if is_checkbox {
                // Checkbox format: Right + Enter to submit
                KeyAction::MultiSelectSubmitTab { target }
            } else {
                // Legacy format: Down × N + Enter
                let downs_needed = choice_count.saturating_sub(cursor_pos.saturating_sub(1));
                KeyAction::MultiSelectSubmit {
                    target,
                    downs_needed,
                }
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

// Re-export from core for use in key_handler
use tmai_core::api::has_checkbox_format;

/// Check if a choice starts with the given word (case-insensitive, word-boundary aware).
///
/// Matches "Yes", "Yes (Recommended)", "No, cancel" but NOT "None", "Not now", "Yesterday".
fn choice_starts_with_word(choice: &str, word: &str) -> bool {
    let lower = choice.trim().to_lowercase();
    if lower == word {
        return true;
    }
    if let Some(rest) = lower.strip_prefix(word) {
        // Next char after the word must be non-alphabetic (word boundary)
        return rest.chars().next().is_none_or(|c| !c.is_alphabetic());
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_fullwidth_digits() {
        assert_eq!(normalize_fullwidth_char('０'), '0');
        assert_eq!(normalize_fullwidth_char('１'), '1');
        assert_eq!(normalize_fullwidth_char('９'), '9');
    }

    #[test]
    fn test_normalize_fullwidth_lowercase() {
        assert_eq!(normalize_fullwidth_char('ａ'), 'a');
        assert_eq!(normalize_fullwidth_char('ｙ'), 'y');
        assert_eq!(normalize_fullwidth_char('ｚ'), 'z');
    }

    #[test]
    fn test_normalize_fullwidth_uppercase() {
        assert_eq!(normalize_fullwidth_char('Ａ'), 'A');
        assert_eq!(normalize_fullwidth_char('Ｇ'), 'G');
        assert_eq!(normalize_fullwidth_char('Ｔ'), 'T');
        assert_eq!(normalize_fullwidth_char('Ｚ'), 'Z');
    }

    #[test]
    fn test_normalize_fullwidth_space() {
        assert_eq!(normalize_fullwidth_char('\u{3000}'), ' ');
    }

    #[test]
    fn test_normalize_halfwidth_unchanged() {
        assert_eq!(normalize_fullwidth_char('a'), 'a');
        assert_eq!(normalize_fullwidth_char('Z'), 'Z');
        assert_eq!(normalize_fullwidth_char('5'), '5');
        assert_eq!(normalize_fullwidth_char(' '), ' ');
    }

    #[test]
    fn test_normalize_non_ascii_unchanged() {
        assert_eq!(normalize_fullwidth_char('あ'), 'あ');
        assert_eq!(normalize_fullwidth_char('漢'), '漢');
        assert_eq!(normalize_fullwidth_char('✳'), '✳');
    }

    #[test]
    fn test_normalize_keycode() {
        assert_eq!(normalize_keycode(KeyCode::Char('ｙ')), KeyCode::Char('y'));
        assert_eq!(normalize_keycode(KeyCode::Char('Ｇ')), KeyCode::Char('G'));
        assert_eq!(normalize_keycode(KeyCode::Char('１')), KeyCode::Char('1'));
        assert_eq!(normalize_keycode(KeyCode::Enter), KeyCode::Enter);
        assert_eq!(normalize_keycode(KeyCode::Esc), KeyCode::Esc);
    }
}
