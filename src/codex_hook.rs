//! `tmai codex-hook` command — bridge between Codex CLI hooks and tmai's HTTP endpoint.
//!
//! Codex CLI spawns this command with hook event JSON on stdin.
//! We translate the Codex payload into tmai's `HookEventPayload` format
//! and forward it via HTTP POST to the local tmai web server (loopback).
//!
//! Two payload formats are handled:
//! 1. **New engine** (SessionStart/Stop): Already compatible with `HookEventPayload`
//!    (`hook_event_name`, `session_id`, `cwd`, etc. in snake_case)
//! 2. **HookPayload** (AfterAgent/AfterToolUse): Nested `hook_event` structure that
//!    needs translation to flat `HookEventPayload` format

use std::io::Read;

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

/// Codex HookPayload wrapper (for AfterAgent/AfterToolUse events)
#[derive(Debug, Deserialize)]
struct CodexHookPayload {
    session_id: String,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    triggered_at: Option<String>,
    hook_event: Option<CodexHookEvent>,
}

/// Codex hook_event inner payload
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct CodexHookEvent {
    event_type: String,
    #[serde(default)]
    thread_id: Option<String>,
    #[serde(default)]
    turn_id: Option<String>,
    #[serde(default)]
    last_assistant_message: Option<String>,
    // AfterToolUse fields
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_kind: Option<String>,
    #[serde(default)]
    tool_input: Option<Value>,
    #[serde(default)]
    executed: Option<bool>,
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    duration_ms: Option<u64>,
}

/// Translate a Codex hook event JSON into tmai's HookEventPayload format.
///
/// Returns the translated JSON value ready to POST to /hooks/event.
fn translate_codex_payload(raw: &Value) -> Result<Value> {
    // Check if this is already in new engine format (has hook_event_name at top level)
    if raw.get("hook_event_name").is_some() {
        // New engine format (SessionStart/Stop) — already compatible
        return Ok(raw.clone());
    }

    // Parse as Codex HookPayload (AfterAgent/AfterToolUse)
    let payload: CodexHookPayload =
        serde_json::from_value(raw.clone()).context("Failed to parse Codex HookPayload")?;

    let hook_event = payload
        .hook_event
        .context("Missing hook_event field in Codex payload")?;

    // Map Codex event_type to tmai hook_event_name
    let hook_event_name = match hook_event.event_type.as_str() {
        "after_agent" => "Stop",
        "after_tool_use" => "PostToolUse",
        other => {
            eprintln!("Unknown Codex event_type: {}, passing through", other);
            other
        }
    };

    let mut translated = json!({
        "hook_event_name": hook_event_name,
        "session_id": payload.session_id,
    });

    // Map common fields
    if let Some(cwd) = &payload.cwd {
        translated["cwd"] = json!(cwd);
    }

    // Map event-specific fields
    match hook_event.event_type.as_str() {
        "after_agent" => {
            // AfterAgent → Stop
            if let Some(msg) = &hook_event.last_assistant_message {
                translated["last_assistant_message"] = json!(msg);
            }
            translated["stop_hook_active"] = json!(false);
        }
        "after_tool_use" => {
            // AfterToolUse → PostToolUse
            if let Some(name) = &hook_event.tool_name {
                translated["tool_name"] = json!(name);
            }
            if let Some(input) = &hook_event.tool_input {
                translated["tool_input"] = input.clone();
            }
        }
        _ => {}
    }

    // Preserve Codex-specific metadata in extra fields for audit/debugging
    if let Some(triggered_at) = &payload.triggered_at {
        translated["codex_triggered_at"] = json!(triggered_at);
    }
    if let Some(kind) = &hook_event.tool_kind {
        translated["codex_tool_kind"] = json!(kind);
    }

    Ok(translated)
}

/// Run the `tmai codex-hook` command.
///
/// Reads stdin, translates the Codex payload, and POSTs to the tmai loopback endpoint.
pub fn run(port: u16, token: &str) -> Result<()> {
    // Read all of stdin
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .context("Failed to read stdin")?;

    let input = input.trim();
    if input.is_empty() {
        anyhow::bail!("No input received on stdin");
    }

    // Parse input JSON
    let raw: Value = serde_json::from_str(input).context("Failed to parse input JSON")?;

    // Translate to tmai format
    let payload = translate_codex_payload(&raw)?;

    // POST to loopback endpoint
    let url = format!("http://localhost:{}/hooks/event", port);
    let body_str = payload.to_string();
    let mut req = ureq::post(&url)
        .header("Authorization", &format!("Bearer {}", token))
        .header("Content-Type", "application/json");

    // Forward $TMUX_PANE for direct pane_id resolution (avoids CWD fallback)
    if let Ok(pane_id) = std::env::var("TMUX_PANE") {
        req = req.header("X-Tmai-Pane-Id", &pane_id);
    }

    let response = req.send(body_str.as_bytes());

    match response {
        Ok(resp) => {
            // Forward response to stdout (Codex reads stdout for hook output)
            let body = resp
                .into_body()
                .read_to_string()
                .context("Failed to read response body")?;
            if !body.is_empty() {
                print!("{}", body);
            }
        }
        Err(e) => {
            // Don't fail hard — tmai server might not be running
            eprintln!("tmai codex-hook: failed to reach tmai server: {}", e);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_translate_new_engine_session_start() {
        let raw = json!({
            "hook_event_name": "SessionStart",
            "session_id": "codex-sess-1",
            "cwd": "/home/user/project",
            "model": "o4-mini",
            "permission_mode": "default",
            "source": "startup"
        });
        let result = translate_codex_payload(&raw).unwrap();
        // Should pass through unchanged
        assert_eq!(result["hook_event_name"], "SessionStart");
        assert_eq!(result["session_id"], "codex-sess-1");
        assert_eq!(result["model"], "o4-mini");
    }

    #[test]
    fn test_translate_new_engine_stop() {
        let raw = json!({
            "hook_event_name": "Stop",
            "session_id": "codex-sess-1",
            "cwd": "/home/user/project",
            "stop_hook_active": false,
            "last_assistant_message": "Done with the task."
        });
        let result = translate_codex_payload(&raw).unwrap();
        assert_eq!(result["hook_event_name"], "Stop");
        assert_eq!(result["last_assistant_message"], "Done with the task.");
    }

    #[test]
    fn test_translate_after_agent() {
        let raw = json!({
            "session_id": "codex-sess-2",
            "cwd": "/tmp/project",
            "triggered_at": "2026-03-11T10:00:00Z",
            "hook_event": {
                "event_type": "after_agent",
                "thread_id": "thread-abc",
                "turn_id": "turn-1",
                "last_assistant_message": "Task completed successfully."
            }
        });
        let result = translate_codex_payload(&raw).unwrap();
        assert_eq!(result["hook_event_name"], "Stop");
        assert_eq!(result["session_id"], "codex-sess-2");
        assert_eq!(result["cwd"], "/tmp/project");
        assert_eq!(
            result["last_assistant_message"],
            "Task completed successfully."
        );
        assert_eq!(result["stop_hook_active"], false);
        assert_eq!(result["codex_triggered_at"], "2026-03-11T10:00:00Z");
    }

    #[test]
    fn test_translate_after_tool_use() {
        let raw = json!({
            "session_id": "codex-sess-3",
            "cwd": "/tmp",
            "hook_event": {
                "event_type": "after_tool_use",
                "turn_id": "turn-5",
                "tool_name": "shell",
                "tool_kind": "local_shell",
                "tool_input": {"command": "cargo test"},
                "executed": true,
                "success": true,
                "duration_ms": 1500
            }
        });
        let result = translate_codex_payload(&raw).unwrap();
        assert_eq!(result["hook_event_name"], "PostToolUse");
        assert_eq!(result["session_id"], "codex-sess-3");
        assert_eq!(result["tool_name"], "shell");
        assert_eq!(result["tool_input"]["command"], "cargo test");
        assert_eq!(result["codex_tool_kind"], "local_shell");
    }

    #[test]
    fn test_translate_missing_hook_event() {
        let raw = json!({
            "session_id": "codex-sess-4",
            "cwd": "/tmp"
        });
        let result = translate_codex_payload(&raw);
        assert!(result.is_err());
    }

    #[test]
    fn test_translate_unknown_event_type() {
        let raw = json!({
            "session_id": "codex-sess-5",
            "hook_event": {
                "event_type": "future_event",
                "turn_id": "turn-1"
            }
        });
        let result = translate_codex_payload(&raw).unwrap();
        // Unknown types pass through as-is
        assert_eq!(result["hook_event_name"], "future_event");
    }
}
