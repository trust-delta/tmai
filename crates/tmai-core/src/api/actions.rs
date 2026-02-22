//! Action methods on [`TmaiCore`].
//!
//! These methods perform side-effects (send keys, focus panes, etc.) and
//! centralise logic that was previously duplicated across TUI and Web.

use crate::agents::{AgentStatus, ApprovalType};
use crate::detectors::get_detector;

use super::core::TmaiCore;
use super::types::ApiError;

/// Maximum text length for send_text
const MAX_TEXT_LENGTH: usize = 1024;

/// Allowed special key names for send_key
const ALLOWED_KEYS: &[&str] = &[
    "Enter", "Escape", "Space", "Up", "Down", "Left", "Right", "Tab", "BSpace",
];

/// Check if choices use checkbox format ([ ], [x], [X], [×], [✔])
pub fn has_checkbox_format(choices: &[String]) -> bool {
    choices.iter().any(|c| {
        let t = c.trim();
        t.starts_with("[ ]")
            || t.starts_with("[x]")
            || t.starts_with("[X]")
            || t.starts_with("[×]")
            || t.starts_with("[✔]")
    })
}

impl TmaiCore {
    // =========================================================
    // Helper: get command sender or error
    // =========================================================

    /// Return the command sender, or `ApiError::NoCommandSender`
    fn require_command_sender(
        &self,
    ) -> Result<&std::sync::Arc<crate::command_sender::CommandSender>, ApiError> {
        self.command_sender_ref().ok_or(ApiError::NoCommandSender)
    }

    // =========================================================
    // Agent actions
    // =========================================================

    /// Approve an agent action (send approval keys based on agent type).
    ///
    /// Returns `Ok(())` if approval was sent or the agent was already not awaiting.
    pub fn approve(&self, target: &str) -> Result<(), ApiError> {
        let (is_awaiting, agent_type, is_virtual) = {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) => (
                    matches!(&a.status, AgentStatus::AwaitingApproval { .. }),
                    a.agent_type.clone(),
                    a.is_virtual,
                ),
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    })
                }
            }
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent {
                target: target.to_string(),
            });
        }

        if !is_awaiting {
            // Already handled — idempotent success
            return Ok(());
        }

        let cmd = self.require_command_sender()?;
        let detector = get_detector(&agent_type);
        cmd.send_keys(target, detector.approval_keys())?;
        Ok(())
    }

    /// Select a choice for a UserQuestion prompt.
    ///
    /// `choice` is 1-indexed (1 = first option, N+1 = "Other").
    pub fn select_choice(&self, target: &str, choice: usize) -> Result<(), ApiError> {
        let question_info = {
            let state = self.state().read();
            state.agents.get(target).and_then(|agent| {
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
            })
        };

        match question_info {
            Some((choices, multi_select, cursor_pos))
                if choice >= 1 && choice <= choices.len() + 1 =>
            {
                let cmd = self.require_command_sender()?;
                let cursor = if cursor_pos == 0 { 1 } else { cursor_pos };
                let steps = choice as i32 - cursor as i32;
                let key = if steps > 0 { "Down" } else { "Up" };
                for _ in 0..steps.unsigned_abs() {
                    cmd.send_keys(target, key)?;
                }

                // Confirm: single-select always, multi-select only for checkbox toggle
                if !multi_select || has_checkbox_format(&choices) {
                    cmd.send_keys(target, "Enter")?;
                }

                Ok(())
            }
            Some(_) => Err(ApiError::InvalidInput {
                message: "Invalid choice number".to_string(),
            }),
            None => Err(ApiError::AgentNotFound {
                target: target.to_string(),
            }),
        }
    }

    /// Submit multi-select choices (checkbox or legacy format).
    ///
    /// `selected_choices` is a list of 1-indexed choice numbers.
    pub fn submit_selection(
        &self,
        target: &str,
        selected_choices: &[usize],
    ) -> Result<(), ApiError> {
        let multi_info = {
            let state = self.state().read();
            state.agents.get(target).and_then(|agent| {
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
            })
        };

        match multi_info {
            Some((choices, cursor_pos)) => {
                let cmd = self.require_command_sender()?;
                let is_checkbox = has_checkbox_format(&choices);

                if is_checkbox && !selected_choices.is_empty() {
                    // Checkbox format: navigate to each selected choice and toggle
                    let mut sorted: Vec<usize> = selected_choices
                        .iter()
                        .copied()
                        .filter(|&c| c >= 1 && c <= choices.len())
                        .collect();
                    if sorted.is_empty() {
                        return Err(ApiError::InvalidInput {
                            message: "No valid choices".to_string(),
                        });
                    }
                    sorted.sort();
                    let mut current_pos = if cursor_pos == 0 { 1 } else { cursor_pos };

                    for &choice in &sorted {
                        let steps = choice as i32 - current_pos as i32;
                        let key = if steps > 0 { "Down" } else { "Up" };
                        for _ in 0..steps.unsigned_abs() {
                            cmd.send_keys(target, key)?;
                        }
                        // Enter to toggle checkbox
                        cmd.send_keys(target, "Enter")?;
                        current_pos = choice;
                    }
                    // Right + Enter to submit
                    cmd.send_keys(target, "Right")?;
                    cmd.send_keys(target, "Enter")?;
                } else {
                    // Legacy format: navigate past all choices then Enter
                    let downs_needed = choices.len().saturating_sub(cursor_pos.saturating_sub(1));
                    for _ in 0..downs_needed {
                        cmd.send_keys(target, "Down")?;
                    }
                    cmd.send_keys(target, "Enter")?;
                }
                Ok(())
            }
            None => Err(ApiError::AgentNotFound {
                target: target.to_string(),
            }),
        }
    }

    /// Send text input to an agent followed by Enter.
    ///
    /// Includes a 50ms delay between text and Enter to prevent paste-burst issues.
    pub async fn send_text(&self, target: &str, text: &str) -> Result<(), ApiError> {
        if text.len() > MAX_TEXT_LENGTH {
            return Err(ApiError::InvalidInput {
                message: format!(
                    "Text exceeds maximum length of {} characters",
                    MAX_TEXT_LENGTH
                ),
            });
        }

        let is_virtual = {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) => a.is_virtual,
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    })
                }
            }
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent {
                target: target.to_string(),
            });
        }

        let cmd = self.require_command_sender()?;
        cmd.send_keys_literal(target, text)?;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        cmd.send_keys(target, "Enter")?;

        self.audit_helper()
            .maybe_emit_input(target, "input_text", "api_input", None);

        Ok(())
    }

    /// Send a special key to an agent (whitelist-validated).
    pub fn send_key(&self, target: &str, key: &str) -> Result<(), ApiError> {
        if !ALLOWED_KEYS.contains(&key) {
            return Err(ApiError::InvalidInput {
                message: "Invalid key name".to_string(),
            });
        }

        let is_virtual = {
            let state = self.state().read();
            match state.agents.get(target) {
                Some(a) => a.is_virtual,
                None => {
                    return Err(ApiError::AgentNotFound {
                        target: target.to_string(),
                    })
                }
            }
        };

        if is_virtual {
            return Err(ApiError::VirtualAgent {
                target: target.to_string(),
            });
        }

        let cmd = self.require_command_sender()?;
        cmd.send_keys(target, key)?;

        self.audit_helper()
            .maybe_emit_input(target, "special_key", "api_input", None);

        Ok(())
    }

    /// Focus on a specific pane in tmux
    pub fn focus_pane(&self, target: &str) -> Result<(), ApiError> {
        let cmd = self.require_command_sender()?;
        cmd.tmux_client().focus_pane(target)?;
        Ok(())
    }

    /// Kill a specific pane in tmux
    pub fn kill_pane(&self, target: &str) -> Result<(), ApiError> {
        let cmd = self.require_command_sender()?;
        cmd.tmux_client().kill_pane(target)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentType, MonitoredAgent};
    use crate::api::builder::TmaiCoreBuilder;
    use crate::config::Settings;
    use crate::state::AppState;

    fn make_core_with_agents(agents: Vec<MonitoredAgent>) -> TmaiCore {
        let state = AppState::shared();
        {
            let mut s = state.write();
            s.update_agents(agents);
        }
        TmaiCoreBuilder::new(Settings::default())
            .with_state(state)
            .build()
    }

    fn test_agent(id: &str, status: AgentStatus) -> MonitoredAgent {
        let mut agent = MonitoredAgent::new(
            id.to_string(),
            AgentType::ClaudeCode,
            "Title".to_string(),
            "/home/user".to_string(),
            100,
            "main".to_string(),
            "win".to_string(),
            0,
            0,
        );
        agent.status = status;
        agent
    }

    #[test]
    fn test_has_checkbox_format() {
        assert!(has_checkbox_format(&[
            "[ ] Option A".to_string(),
            "[ ] Option B".to_string(),
        ]));
        assert!(has_checkbox_format(&[
            "[x] Option A".to_string(),
            "[ ] Option B".to_string(),
        ]));
        assert!(has_checkbox_format(&[
            "[✔] Done".to_string(),
            "[ ] Not done".to_string(),
        ]));
        assert!(!has_checkbox_format(&[
            "Option A".to_string(),
            "Option B".to_string(),
        ]));
        assert!(!has_checkbox_format(&[]));
    }

    #[test]
    fn test_approve_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.approve("nonexistent");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_approve_virtual_agent() {
        let mut agent = test_agent(
            "main:0.0",
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::FileEdit,
                details: "edit foo.rs".to_string(),
            },
        );
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.approve("main:0.0");
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[test]
    fn test_approve_not_awaiting_is_ok() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        // No command sender, but should return Ok since not awaiting
        let result = core.approve("main:0.0");
        assert!(result.is_ok());
    }

    #[test]
    fn test_approve_awaiting_no_command_sender() {
        let agent = test_agent(
            "main:0.0",
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::ShellCommand,
                details: "rm -rf".to_string(),
            },
        );
        let core = make_core_with_agents(vec![agent]);
        let result = core.approve("main:0.0");
        assert!(matches!(result, Err(ApiError::NoCommandSender)));
    }

    #[test]
    fn test_send_key_invalid() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        let result = core.send_key("main:0.0", "Delete");
        assert!(matches!(result, Err(ApiError::InvalidInput { .. })));
    }

    #[test]
    fn test_send_key_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.send_key("nonexistent", "Enter");
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_send_key_virtual_agent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.send_key("main:0.0", "Enter");
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }

    #[test]
    fn test_select_choice_not_in_question() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        let result = core.select_choice("main:0.0", 1);
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[test]
    fn test_select_choice_invalid_number() {
        let agent = test_agent(
            "main:0.0",
            AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::UserQuestion {
                    choices: vec!["A".to_string(), "B".to_string()],
                    multi_select: false,
                    cursor_position: 1,
                },
                details: "Pick one".to_string(),
            },
        );
        let core = make_core_with_agents(vec![agent]);
        // choice 0 is invalid (1-indexed)
        let result = core.select_choice("main:0.0", 0);
        assert!(matches!(result, Err(ApiError::InvalidInput { .. })));
        // choice 4 is invalid (only 2 choices + 1 Other = max 3)
        let result = core.select_choice("main:0.0", 4);
        assert!(matches!(result, Err(ApiError::InvalidInput { .. })));
    }

    #[tokio::test]
    async fn test_send_text_too_long() {
        let agent = test_agent("main:0.0", AgentStatus::Idle);
        let core = make_core_with_agents(vec![agent]);
        let long_text = "x".repeat(1025);
        let result = core.send_text("main:0.0", &long_text).await;
        assert!(matches!(result, Err(ApiError::InvalidInput { .. })));
    }

    #[tokio::test]
    async fn test_send_text_not_found() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let result = core.send_text("nonexistent", "hello").await;
        assert!(matches!(result, Err(ApiError::AgentNotFound { .. })));
    }

    #[tokio::test]
    async fn test_send_text_virtual_agent() {
        let mut agent = test_agent("main:0.0", AgentStatus::Idle);
        agent.is_virtual = true;
        let core = make_core_with_agents(vec![agent]);
        let result = core.send_text("main:0.0", "hello").await;
        assert!(matches!(result, Err(ApiError::VirtualAgent { .. })));
    }
}
