use std::future::Future;
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::io::AsyncWriteExt;

use super::types::{JudgmentDecision, JudgmentOutput, JudgmentRequest, JudgmentResult};

/// JSON schema for the claude CLI output
const JUDGMENT_SCHEMA: &str = r#"{"type":"object","properties":{"decision":{"type":"string","enum":["approve","reject","uncertain"]},"reasoning":{"type":"string"}},"required":["decision","reasoning"]}"#;

/// Trait for judgment providers (extensible for future rule-based/hybrid approaches)
pub trait JudgmentProvider: Send + Sync {
    /// Judge whether an approval request should be auto-approved
    fn judge(
        &self,
        request: &JudgmentRequest,
    ) -> impl Future<Output = Result<JudgmentResult>> + Send;
}

/// Claude Haiku-based judgment provider using the claude CLI
pub struct ClaudeHaikuJudge {
    /// Model to use (e.g., "haiku")
    model: String,
    /// Timeout for the judgment
    timeout: Duration,
    /// Custom command override (if set, uses this instead of "claude")
    custom_command: Option<String>,
}

impl ClaudeHaikuJudge {
    /// Create a new ClaudeHaikuJudge with the given model and timeout
    pub fn new(model: String, timeout_secs: u64, custom_command: Option<String>) -> Self {
        Self {
            model,
            timeout: Duration::from_secs(timeout_secs),
            custom_command,
        }
    }

    /// Build the prompt for the AI judgment
    fn build_prompt(&self, request: &JudgmentRequest) -> String {
        format!(
            r#"You are a safety gate for an AI coding agent. Examine the terminal output and decide if the pending action should be auto-approved.

Approval Type: {approval_type}
Details: {details}
Working Directory: {cwd}
Agent Type: {agent_type}

Terminal Output (last 30 lines):
{screen_context}

Rules:
- Return "approve" only when ALL of these apply:
  - The operation is read-only OR explicitly low-risk (e.g., reading files, listing directories, running tests, formatting code)
  - No file modification that could break the build or delete important data
  - No privilege escalation (sudo, chmod 777, etc.)
  - No network/data exfiltration risk (curl to external URLs with sensitive data, etc.)
  - No signs of command injection or untrusted input
  - The action is clearly related to the current development task

- Return "reject" when ANY of these apply:
  - Destructive operations (rm -rf, DROP TABLE, force push, etc.)
  - Writing to system files or configuration outside the project
  - Network requests to unknown external services with sensitive data
  - Privilege escalation attempts
  - The action seems suspicious or unrelated to development

- When unsure, return "uncertain" (safer than wrong approval)"#,
            approval_type = request.approval_type,
            details = request.details,
            cwd = request.cwd,
            agent_type = request.agent_type,
            screen_context = request.screen_context,
        )
    }
}

impl JudgmentProvider for ClaudeHaikuJudge {
    /// Judge using claude CLI subprocess
    async fn judge(&self, request: &JudgmentRequest) -> Result<JudgmentResult> {
        let start = Instant::now();
        let prompt = self.build_prompt(request);

        let command = self.custom_command.as_deref().unwrap_or("claude");

        let mut child = tokio::process::Command::new(command)
            .args([
                "-p",
                "--model",
                &self.model,
                "--output-format",
                "json",
                "--json-schema",
                JUDGMENT_SCHEMA,
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;

        // Write prompt to stdin
        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| anyhow::anyhow!("Failed to open stdin"))?;
            stdin.write_all(prompt.as_bytes()).await?;
            // stdin is dropped here to close it and signal EOF
        }

        // Wait for output with timeout
        let output = match tokio::time::timeout(self.timeout, child.wait_with_output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(e)) => {
                return Ok(JudgmentResult {
                    decision: JudgmentDecision::Uncertain,
                    reasoning: format!("Process error: {}", e),
                    model: self.model.clone(),
                    elapsed_ms: start.elapsed().as_millis() as u64,
                });
            }
            Err(_) => {
                // Timeout - process is already consumed by wait_with_output future,
                // which was cancelled. The child process will be cleaned up on drop.
                return Ok(JudgmentResult {
                    decision: JudgmentDecision::Uncertain,
                    reasoning: "Judgment timed out".to_string(),
                    model: self.model.clone(),
                    elapsed_ms: start.elapsed().as_millis() as u64,
                });
            }
        };

        let elapsed_ms = start.elapsed().as_millis() as u64;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Ok(JudgmentResult {
                decision: JudgmentDecision::Uncertain,
                reasoning: format!("CLI error (exit {}): {}", output.status, stderr),
                model: self.model.clone(),
                elapsed_ms,
            });
        }

        // Parse JSON output
        let stdout = String::from_utf8_lossy(&output.stdout);

        // The claude CLI with --output-format json wraps the response in a JSON structure.
        // Try to extract the result text first, then parse the schema output.
        match Self::parse_claude_output(&stdout) {
            Ok(judgment_output) => Ok(JudgmentResult {
                decision: judgment_output.parse_decision(),
                reasoning: judgment_output.reasoning,
                model: self.model.clone(),
                elapsed_ms,
            }),
            Err(e) => Ok(JudgmentResult {
                decision: JudgmentDecision::Uncertain,
                reasoning: format!("Failed to parse output: {}. Raw: {}", e, stdout),
                model: self.model.clone(),
                elapsed_ms,
            }),
        }
    }
}

impl ClaudeHaikuJudge {
    /// Parse the claude CLI JSON output
    ///
    /// The claude CLI with `--output-format json` returns a JSON array of content blocks.
    /// We need to extract the text content and parse it as our schema.
    fn parse_claude_output(stdout: &str) -> Result<JudgmentOutput> {
        // First, try direct parse (if output matches our schema directly)
        if let Ok(output) = serde_json::from_str::<JudgmentOutput>(stdout) {
            return Ok(output);
        }

        // Try parsing as claude CLI JSON format: {"type":"result","result":[...]}
        // or just the result array
        if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(stdout) {
            // Extract text from result content blocks
            let text = Self::extract_text_from_claude_json(&wrapper);
            if let Some(text) = text {
                if let Ok(output) = serde_json::from_str::<JudgmentOutput>(&text) {
                    return Ok(output);
                }
            }
        }

        anyhow::bail!("Could not parse claude output as JudgmentOutput")
    }

    /// Extract text content from claude CLI JSON response
    fn extract_text_from_claude_json(value: &serde_json::Value) -> Option<String> {
        // Handle {"structured_output": {...}} format (--json-schema output)
        if let Some(structured) = value.get("structured_output") {
            if structured.is_object() {
                return Some(structured.to_string());
            }
        }

        // Handle {"result": "..."} format
        if let Some(result) = value.get("result") {
            if let Some(text) = result.as_str() {
                return Some(text.to_string());
            }
        }

        // Handle array of content blocks format
        if let Some(arr) = value.as_array() {
            for item in arr {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        return Some(text.to_string());
                    }
                }
            }
        }

        // Handle {"result": [...content blocks...]} format
        if let Some(result) = value.get("result") {
            if let Some(arr) = result.as_array() {
                for item in arr {
                    if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            return Some(text.to_string());
                        }
                    }
                }
            }
        }

        None
    }
}
