use std::fmt;

use serde::{Deserialize, Serialize};

/// Auto-approve operating mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AutoApproveMode {
    /// Auto-approve is disabled (default)
    #[default]
    Off,
    /// Rule-based only (instant, no AI)
    Rules,
    /// AI-based only (Claude Haiku via CLI)
    Ai,
    /// Rules first, AI fallback for abstain cases
    Hybrid,
}

/// Phase of the auto-approve judgment lifecycle.
///
/// Written by `AutoApproveService` into `MonitoredAgent.auto_approve_phase`
/// so the UI can distinguish "wait for auto-approve" from "needs manual action".
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum AutoApprovePhase {
    /// Judgment is in progress (wait and it will resolve automatically)
    Judging,
    /// Approved by rule engine (keys sent, agent will transition soon)
    ApprovedByRule,
    /// Approved by AI judgment (keys sent, agent will transition soon)
    ApprovedByAi,
    /// Manual user action required (reason provided)
    ManualRequired(String),
}

/// AI judgment request containing context for the approval decision
#[derive(Debug, Clone)]
pub struct JudgmentRequest {
    /// tmux target (e.g., "main:0.1")
    pub target: String,
    /// Approval type (e.g., "file_edit", "shell_command")
    pub approval_type: String,
    /// Details of what is being approved
    pub details: String,
    /// Last N lines of pane content for context
    pub screen_context: String,
    /// Working directory of the agent
    pub cwd: String,
    /// Agent type (e.g., "claude_code")
    pub agent_type: String,
}

/// Decision made by the judgment provider
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JudgmentDecision {
    /// Action is safe to approve automatically
    Approve,
    /// Action should be rejected (requires manual review)
    Reject,
    /// Unable to determine safety (falls back to manual)
    Uncertain,
}

impl fmt::Display for JudgmentDecision {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JudgmentDecision::Approve => write!(f, "approve"),
            JudgmentDecision::Reject => write!(f, "reject"),
            JudgmentDecision::Uncertain => write!(f, "uncertain"),
        }
    }
}

/// Token usage from a single judgment call
#[derive(Debug, Clone, Default, Serialize)]
pub struct JudgmentUsage {
    /// Direct input tokens (non-cached)
    pub input_tokens: u64,
    /// Output tokens generated
    pub output_tokens: u64,
    /// Tokens read from cache
    #[serde(skip_serializing_if = "is_zero")]
    pub cache_read_input_tokens: u64,
    /// Tokens written to cache
    #[serde(skip_serializing_if = "is_zero")]
    pub cache_creation_input_tokens: u64,
    /// Cost in USD (as reported by claude CLI)
    #[serde(skip_serializing_if = "is_zero_f64")]
    pub cost_usd: f64,
}

/// Helper for serde skip
fn is_zero(v: &u64) -> bool {
    *v == 0
}

/// Helper for serde skip
fn is_zero_f64(v: &f64) -> bool {
    *v == 0.0
}

/// Result of an AI judgment
#[derive(Debug, Clone)]
pub struct JudgmentResult {
    /// The decision made
    pub decision: JudgmentDecision,
    /// Reasoning provided by the AI
    pub reasoning: String,
    /// Model used for the judgment
    pub model: String,
    /// Time taken for the judgment in milliseconds
    pub elapsed_ms: u64,
    /// Token usage (if available)
    pub usage: Option<JudgmentUsage>,
}

/// JSON output schema expected from claude CLI
#[derive(Debug, Deserialize)]
pub struct JudgmentOutput {
    /// Decision: "approve", "reject", or "uncertain"
    pub decision: String,
    /// Reasoning for the decision
    pub reasoning: String,
}

impl JudgmentOutput {
    /// Parse the decision string into a JudgmentDecision enum
    pub fn parse_decision(&self) -> JudgmentDecision {
        match self.decision.to_lowercase().as_str() {
            "approve" => JudgmentDecision::Approve,
            "reject" => JudgmentDecision::Reject,
            _ => JudgmentDecision::Uncertain,
        }
    }
}
