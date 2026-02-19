use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tokio::sync::Semaphore;

use crate::agents::{AgentMode, AgentStatus, ApprovalType};
use crate::audit::AuditEventSender;
use crate::command_sender::CommandSender;
use crate::config::AutoApproveSettings;
use crate::detectors;
use crate::state::SharedState;

use super::judge::{ClaudeHaikuJudge, JudgmentProvider};
use super::types::{AutoApprovePhase, JudgmentDecision, JudgmentRequest, JudgmentResult};

/// Number of screen context lines to capture for judgment
const SCREEN_CONTEXT_LINES: usize = 30;

/// Tracks whether a target is being judged or in cooldown after judgment
enum FlightStatus {
    /// Judgment is currently in progress
    InFlight,
    /// Judgment completed; cooldown started at this instant
    Cooldown(Instant),
}

/// Auto-approve service that monitors agents and auto-approves safe actions
pub struct AutoApproveService {
    settings: AutoApproveSettings,
    app_state: SharedState,
    command_sender: Arc<CommandSender>,
    audit_tx: Option<AuditEventSender>,
}

impl AutoApproveService {
    /// Create a new AutoApproveService
    pub fn new(
        settings: AutoApproveSettings,
        app_state: SharedState,
        command_sender: CommandSender,
        audit_tx: Option<AuditEventSender>,
    ) -> Self {
        Self {
            settings,
            app_state,
            command_sender: Arc::new(command_sender),
            audit_tx,
        }
    }

    /// Start the service as a background tokio task
    pub fn start(self) -> tokio::task::JoinHandle<()> {
        // Validate custom_command path at startup
        if let Some(ref cmd) = self.settings.custom_command {
            let path = std::path::Path::new(cmd);
            if path.is_absolute() {
                if !path.exists() {
                    tracing::warn!(
                        custom_command = %cmd,
                        "Auto-approve custom_command not found at absolute path"
                    );
                }
            } else {
                // For relative command names, check via `which`
                match std::process::Command::new("which").arg(cmd).output() {
                    Ok(output) if output.status.success() => {}
                    _ => {
                        tracing::warn!(
                            custom_command = %cmd,
                            "Auto-approve custom_command not found in PATH"
                        );
                    }
                }
            }
        }

        tokio::spawn(async move {
            self.run().await;
        })
    }

    /// Main loop
    async fn run(self) {
        let judge = Arc::new(ClaudeHaikuJudge::new(
            self.settings.model.clone(),
            self.settings.timeout_secs,
            self.settings.custom_command.clone(),
        ));

        let flight_tracker: Arc<Mutex<HashMap<String, FlightStatus>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let semaphore = Arc::new(Semaphore::new(self.settings.max_concurrent));
        let interval = Duration::from_millis(self.settings.check_interval_ms);
        let cooldown_duration = Duration::from_secs(self.settings.cooldown_secs);

        tracing::info!(
            "Auto-approve service started (model={}, interval={}ms, max_concurrent={})",
            self.settings.model,
            self.settings.check_interval_ms,
            self.settings.max_concurrent,
        );

        loop {
            tokio::time::sleep(interval).await;

            // Collect candidates from shared state, marking skip reasons
            let candidates = {
                let mut state = self.app_state.write();
                if !state.running {
                    tracing::info!("Auto-approve service shutting down (app stopped)");
                    break;
                }

                let mut candidates = Vec::new();
                let targets: Vec<String> = state.agents.keys().cloned().collect();
                for target in &targets {
                    let agent = match state.agents.get(target) {
                        Some(a) => a,
                        None => continue,
                    };

                    // Skip non-approval agents
                    let (approval_type, details) = match &agent.status {
                        AgentStatus::AwaitingApproval {
                            approval_type,
                            details,
                        } => (approval_type.clone(), details.clone()),
                        _ => continue,
                    };

                    // Skip genuine UserQuestion (requires human judgment),
                    // but allow standard yes/no permission prompts through
                    if is_genuine_user_question(&approval_type) {
                        if let Some(a) = state.agents.get_mut(target) {
                            if a.auto_approve_phase.is_none() {
                                a.auto_approve_phase = Some(AutoApprovePhase::ManualRequired(
                                    "genuine user question".to_string(),
                                ));
                            }
                        }
                        continue;
                    }

                    // Skip agents already in AutoApprove mode
                    if agent.mode == AgentMode::AutoApprove {
                        if let Some(a) = state.agents.get_mut(target) {
                            if a.auto_approve_phase.is_none() {
                                a.auto_approve_phase = Some(AutoApprovePhase::ManualRequired(
                                    "agent in auto-approve mode".to_string(),
                                ));
                            }
                        }
                        continue;
                    }

                    // Skip virtual agents (no pane to send keys to)
                    if agent.is_virtual {
                        continue;
                    }

                    // Check allowed_types filter
                    if !self.settings.allowed_types.is_empty() {
                        let type_str = approval_type_to_string(&approval_type);
                        if !self.settings.allowed_types.contains(&type_str) {
                            if let Some(a) = state.agents.get_mut(target) {
                                if a.auto_approve_phase.is_none() {
                                    a.auto_approve_phase = Some(AutoApprovePhase::ManualRequired(
                                        format!("not in allowed_types ({})", type_str),
                                    ));
                                }
                            }
                            continue;
                        }
                    }

                    // Skip if in flight or in cooldown (single lock check)
                    {
                        let tracker = flight_tracker.lock();
                        match tracker.get(target) {
                            Some(FlightStatus::InFlight) => continue,
                            Some(FlightStatus::Cooldown(since)) => {
                                if since.elapsed() < cooldown_duration {
                                    continue;
                                }
                            }
                            None => {}
                        }
                    }

                    candidates.push((
                        target.clone(),
                        approval_type,
                        details,
                        agent.cwd.clone(),
                        agent.agent_type.clone(),
                        agent.last_content.clone(),
                    ));
                }
                candidates
            };

            // Spawn judgment tasks for each candidate
            for (target, approval_type, details, cwd, agent_type, last_content) in candidates {
                // Check semaphore availability (non-blocking)
                let permit = match semaphore.clone().try_acquire_owned() {
                    Ok(permit) => permit,
                    Err(_) => continue, // Max concurrent reached
                };

                flight_tracker
                    .lock()
                    .insert(target.clone(), FlightStatus::InFlight);

                // Mark agent as being judged
                {
                    let mut state = self.app_state.write();
                    if let Some(agent) = state.agents.get_mut(&target) {
                        agent.auto_approve_phase = Some(AutoApprovePhase::Judging);
                    }
                }

                let request = JudgmentRequest {
                    target: target.clone(),
                    approval_type: approval_type_to_string(&approval_type),
                    details: details.clone(),
                    screen_context: extract_screen_context(&last_content, SCREEN_CONTEXT_LINES),
                    cwd: cwd.clone(),
                    agent_type: agent_type.short_name().to_string(),
                };

                let judge_ref = judge.clone();
                let flight_tracker = flight_tracker.clone();
                let app_state = self.app_state.clone();
                let command_sender = self.command_sender.clone();
                let audit_tx = self.audit_tx.clone();
                let agent_type_clone = agent_type.clone();

                tokio::spawn(async move {
                    let result = judge_ref.judge(&request).await;
                    let _permit = permit; // Keep permit alive until task completes

                    match result {
                        Ok(result) => {
                            let approval_sent = handle_judgment_result(
                                &request,
                                &result,
                                &app_state,
                                &command_sender,
                                &agent_type_clone,
                            );

                            // Update phase based on judgment result
                            {
                                let mut state = app_state.write();
                                if let Some(agent) = state.agents.get_mut(&request.target) {
                                    agent.auto_approve_phase = if approval_sent {
                                        Some(AutoApprovePhase::Approved)
                                    } else {
                                        Some(AutoApprovePhase::ManualRequired(format!(
                                            "{}: {}",
                                            result.decision, result.reasoning
                                        )))
                                    };
                                }
                            }

                            // Emit audit event
                            emit_audit_event(&audit_tx, &request, &result, approval_sent);

                            tracing::info!(
                                target = %request.target,
                                decision = %result.decision,
                                elapsed_ms = result.elapsed_ms,
                                approval_sent = approval_sent,
                                "Auto-approve judgment: {}",
                                result.reasoning,
                            );
                        }
                        Err(e) => {
                            // Update phase to manual required on error
                            {
                                let mut state = app_state.write();
                                if let Some(agent) = state.agents.get_mut(&request.target) {
                                    agent.auto_approve_phase = Some(
                                        AutoApprovePhase::ManualRequired(format!("error: {}", e)),
                                    );
                                }
                            }

                            tracing::warn!(
                                target = %request.target,
                                "Auto-approve judgment error: {}",
                                e,
                            );

                            emit_audit_event(
                                &audit_tx,
                                &request,
                                &JudgmentResult {
                                    decision: JudgmentDecision::Uncertain,
                                    reasoning: format!("Error: {}", e),
                                    model: "unknown".to_string(),
                                    elapsed_ms: 0,
                                    usage: None,
                                },
                                false,
                            );
                        }
                    }

                    // Atomically transition from InFlight to Cooldown (single lock)
                    flight_tracker
                        .lock()
                        .insert(request.target, FlightStatus::Cooldown(Instant::now()));
                });
            }
        }
    }
}

/// Handle the judgment result: send approval keys if approved and state is still valid
fn handle_judgment_result(
    request: &JudgmentRequest,
    result: &JudgmentResult,
    app_state: &SharedState,
    command_sender: &CommandSender,
    agent_type: &crate::agents::AgentType,
) -> bool {
    if result.decision != JudgmentDecision::Approve {
        return false;
    }

    // Re-check state before sending keys (race condition protection)
    {
        let state = app_state.read();
        let agent = match state.agents.get(&request.target) {
            Some(a) => a,
            None => {
                tracing::debug!(
                    target = %request.target,
                    "Agent disappeared before approval could be sent"
                );
                return false;
            }
        };

        // Only send keys if still awaiting approval (user might have approved manually)
        if !matches!(agent.status, AgentStatus::AwaitingApproval { .. }) {
            tracing::debug!(
                target = %request.target,
                "Agent no longer awaiting approval (likely manually handled)"
            );
            return false;
        }
    }

    // Get the correct approval keys for this agent type
    let detector = detectors::get_detector(agent_type);
    let keys = detector.approval_keys();

    // Send approval keys
    match command_sender.send_keys(&request.target, keys) {
        Ok(()) => {
            tracing::info!(
                target = %request.target,
                keys = keys,
                "Auto-approve: sent approval keys"
            );
            true
        }
        Err(e) => {
            tracing::warn!(
                target = %request.target,
                "Auto-approve: failed to send keys: {}",
                e
            );
            false
        }
    }
}

/// Emit an AutoApproveJudgment audit event
fn emit_audit_event(
    audit_tx: &Option<AuditEventSender>,
    request: &JudgmentRequest,
    result: &JudgmentResult,
    approval_sent: bool,
) {
    if let Some(tx) = audit_tx {
        let event = crate::audit::AuditEvent::AutoApproveJudgment {
            ts: chrono::Utc::now().timestamp_millis() as u64,
            pane_id: request.target.clone(),
            agent_type: request.agent_type.clone(),
            approval_type: request.approval_type.clone(),
            approval_details: request.details.clone(),
            decision: result.decision.to_string(),
            reasoning: result.reasoning.clone(),
            model: result.model.clone(),
            elapsed_ms: result.elapsed_ms,
            approval_sent,
            usage: result.usage.clone(),
            screen_context: Some(request.screen_context.clone()),
        };
        let _ = tx.send(event);
    }
}

/// Check if an ApprovalType is a genuine user question (not a standard permission prompt).
///
/// Claude Code's standard permission prompts (file edit, shell command, etc.) appear as
/// numbered choices like "1. Yes / 2. Yes, and always allow... / 3. No", which the detector
/// classifies as UserQuestion. However, these are standard approval prompts that can be
/// auto-approved, not genuine AskUserQuestion prompts requiring human judgment.
fn is_genuine_user_question(approval_type: &ApprovalType) -> bool {
    match approval_type {
        ApprovalType::UserQuestion {
            choices,
            multi_select,
            ..
        } => {
            // Multi-select questions always require human judgment
            if *multi_select {
                return true;
            }

            // Standard permission prompts have choices that are all variations of Yes/No
            // e.g., ["Yes", "Yes, and always allow...", "No"]
            // Genuine questions have choices like ["Option A", "Option B", "Other"]
            let is_standard_approval = !choices.is_empty()
                && choices.iter().all(|choice| {
                    let lower = choice.to_lowercase();
                    lower.starts_with("yes")
                        || lower.starts_with("no")
                        || lower == "other"
                        || lower == "__other__"
                });

            // If all choices are yes/no variants, this is a standard prompt → NOT genuine
            !is_standard_approval
        }
        _ => false, // Non-UserQuestion types are never genuine user questions
    }
}

/// Convert ApprovalType to a string for filtering and logging
fn approval_type_to_string(approval_type: &ApprovalType) -> String {
    match approval_type {
        ApprovalType::FileEdit => "file_edit".to_string(),
        ApprovalType::FileCreate => "file_create".to_string(),
        ApprovalType::FileDelete => "file_delete".to_string(),
        ApprovalType::ShellCommand => "shell_command".to_string(),
        ApprovalType::McpTool => "mcp_tool".to_string(),
        ApprovalType::UserQuestion { .. } => "user_question".to_string(),
        ApprovalType::Other(s) => s.clone(),
    }
}

/// Mask sensitive data patterns (API keys, tokens, etc.) before sending to AI
fn sanitize_sensitive_data(text: &str) -> String {
    use crate::wrap::exfil_detector::SENSITIVE_PATTERNS;
    let mut result = text.to_string();
    for sp in SENSITIVE_PATTERNS.iter() {
        result = sp
            .pattern
            .replace_all(&result, format!("[REDACTED:{}]", sp.name))
            .to_string();
    }
    result
}

/// Extract the last N lines from screen content, with sensitive data sanitized
fn extract_screen_context(content: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    sanitize_sensitive_data(&lines[start..].join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_screen_context() {
        let content = (1..=50)
            .map(|i| format!("line {}", i))
            .collect::<Vec<_>>()
            .join("\n");
        let context = extract_screen_context(&content, 30);
        let lines: Vec<&str> = context.lines().collect();
        assert_eq!(lines.len(), 30);
        assert_eq!(lines[0], "line 21");
        assert_eq!(lines[29], "line 50");
    }

    #[test]
    fn test_extract_screen_context_short() {
        let content = "line 1\nline 2\nline 3";
        let context = extract_screen_context(content, 30);
        assert_eq!(context, content);
    }

    #[test]
    fn test_approval_type_to_string() {
        assert_eq!(
            approval_type_to_string(&ApprovalType::FileEdit),
            "file_edit"
        );
        assert_eq!(
            approval_type_to_string(&ApprovalType::ShellCommand),
            "shell_command"
        );
        assert_eq!(
            approval_type_to_string(&ApprovalType::Other("custom".to_string())),
            "custom"
        );
    }

    #[test]
    fn test_is_genuine_user_question_standard_yes_no() {
        // Standard permission prompt: "1. Yes / 2. No" → NOT genuine
        let approval = ApprovalType::UserQuestion {
            choices: vec!["Yes".to_string(), "No".to_string()],
            multi_select: false,
            cursor_position: 1,
        };
        assert!(!is_genuine_user_question(&approval));
    }

    #[test]
    fn test_is_genuine_user_question_yes_always_no() {
        // Standard permission prompt with "always allow" → NOT genuine
        let approval = ApprovalType::UserQuestion {
            choices: vec![
                "Yes".to_string(),
                "Yes, and always allow access to tmp/ from this project".to_string(),
                "No".to_string(),
            ],
            multi_select: false,
            cursor_position: 1,
        };
        assert!(!is_genuine_user_question(&approval));
    }

    #[test]
    fn test_is_genuine_user_question_custom_choices() {
        // Actual AskUserQuestion with custom choices → genuine
        let approval = ApprovalType::UserQuestion {
            choices: vec![
                "Use TypeScript".to_string(),
                "Use JavaScript".to_string(),
                "Other".to_string(),
            ],
            multi_select: false,
            cursor_position: 1,
        };
        assert!(is_genuine_user_question(&approval));
    }

    #[test]
    fn test_is_genuine_user_question_multi_select() {
        // Multi-select is always genuine (requires human selection)
        let approval = ApprovalType::UserQuestion {
            choices: vec!["Yes".to_string(), "No".to_string()],
            multi_select: true,
            cursor_position: 1,
        };
        assert!(is_genuine_user_question(&approval));
    }

    #[test]
    fn test_is_genuine_user_question_non_user_question() {
        // Non-UserQuestion types are never genuine user questions
        assert!(!is_genuine_user_question(&ApprovalType::FileEdit));
        assert!(!is_genuine_user_question(&ApprovalType::ShellCommand));
    }

    #[test]
    fn test_sanitize_sensitive_data_openai_key() {
        let text = "export OPENAI_API_KEY=sk-test1234567890abcdefghij";
        let result = sanitize_sensitive_data(text);
        assert!(result.contains("[REDACTED:OpenAI API Key]"));
        assert!(!result.contains("sk-test1234567890abcdefghij"));
    }

    #[test]
    fn test_sanitize_sensitive_data_github_token() {
        let text = "GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz";
        let result = sanitize_sensitive_data(text);
        assert!(result.contains("[REDACTED:GitHub Token]"));
        assert!(!result.contains("ghp_1234567890abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn test_sanitize_sensitive_data_no_sensitive() {
        let text = "Hello world\nnormal output\nno secrets here";
        let result = sanitize_sensitive_data(text);
        assert_eq!(result, text);
    }

    #[test]
    fn test_extract_screen_context_sanitizes() {
        let content = "line 1\nline 2\napi_key=sk-secret1234567890abcdefghij\nline 4";
        let context = extract_screen_context(content, 30);
        assert!(context.contains("[REDACTED:"));
        assert!(!context.contains("sk-secret1234567890abcdefghij"));
    }
}
