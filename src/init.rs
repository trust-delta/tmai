//! `tmai init` command — sets up Claude Code hooks integration.
//!
//! Generates a hook authentication token and configures Claude Code's
//! `~/.claude/settings.json` to send HTTP hook events to tmai's web server.

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde_json::{json, Value};

/// Marker used to identify tmai-generated hook entries
const TMAI_STATUS_PREFIX: &str = "tmai: ";

/// Default web server port
const DEFAULT_PORT: u16 = 9876;

/// Get the hooks token file path
fn hooks_token_path() -> Result<PathBuf> {
    let config_dir = dirs::config_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))
        .context("Cannot determine config directory")?
        .join("tmai");
    Ok(config_dir.join("hooks_token"))
}

/// Get or generate a hook token
fn ensure_hook_token(force: bool) -> Result<String> {
    let path = hooks_token_path()?;

    if !force {
        if let Ok(existing) = fs::read_to_string(&path) {
            let token = existing.trim().to_string();
            if !token.is_empty() {
                return Ok(token);
            }
        }
    }

    let token = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, &token)
        .with_context(|| format!("Failed to write hooks token to {}", path.display()))?;

    // Restrict token file permissions to owner-only (0600)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, perms)
            .with_context(|| format!("Failed to set permissions on {}", path.display()))?;
    }

    println!("Generated hook token: {}", path.display());
    Ok(token)
}

/// Load the existing hook token (if any) from the config directory
pub fn load_hook_token() -> Option<String> {
    let path = hooks_token_path().ok()?;
    fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Get the Claude Code settings.json path
fn claude_settings_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Cannot determine home directory")?;
    Ok(home.join(".claude").join("settings.json"))
}

/// Build a tmai hook entry for a given event
fn build_hook_entry(event: &str, token: &str, port: u16) -> Value {
    json!({
        "type": "http",
        "url": format!("http://localhost:{}/hooks/event", port),
        "headers": {
            "Authorization": format!("Bearer {}", token),
            "X-Tmai-Pane-Id": "$TMUX_PANE"
        },
        "allowedEnvVars": ["TMUX_PANE"],
        "statusMessage": format!("{}{}", TMAI_STATUS_PREFIX, event)
    })
}

/// Hook events that tmai subscribes to
fn target_events() -> &'static [&'static str] {
    &[
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Notification",
        "PermissionRequest",
        "Stop",
        "SubagentStart",
        "SubagentStop",
        "TeammateIdle",
        "TaskCompleted",
        "SessionEnd",
    ]
}

/// Merge tmai hooks into existing settings
///
/// For each target event, adds a tmai hook entry to the event's array.
/// Existing non-tmai entries are preserved. Existing tmai entries are
/// replaced (identified by statusMessage prefix).
fn merge_hooks(settings: &mut Value, token: &str, port: u16) -> usize {
    // Ensure settings is an object
    if !settings.is_object() {
        *settings = json!({});
    }

    let hooks_entry = settings
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));

    // If hooks is not an object, replace it
    if !hooks_entry.is_object() {
        *hooks_entry = json!({});
    }
    let hooks = hooks_entry.as_object_mut().unwrap();

    let mut count = 0;

    for event in target_events() {
        let event_entry = hooks.entry(event.to_string()).or_insert_with(|| json!([]));

        // If event entry is not an array, replace it
        if !event_entry.is_array() {
            *event_entry = json!([]);
        }
        let event_hooks = event_entry.as_array_mut().unwrap();

        // Remove existing tmai entries (identified by statusMessage prefix)
        event_hooks.retain(|entry| {
            let is_tmai = entry
                .get("statusMessage")
                .and_then(|v| v.as_str())
                .map(|s| s.starts_with(TMAI_STATUS_PREFIX))
                .unwrap_or(false);
            !is_tmai
        });

        // Add new tmai entry
        event_hooks.push(build_hook_entry(event, token, port));
        count += 1;
    }

    count
}

/// Remove tmai hooks from settings
fn remove_tmai_hooks(settings: &mut Value) -> usize {
    let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return 0;
    };

    let mut removed = 0;

    for (_event, entries) in hooks.iter_mut() {
        if let Some(arr) = entries.as_array_mut() {
            let before = arr.len();
            arr.retain(|entry| {
                let is_tmai = entry
                    .get("statusMessage")
                    .and_then(|v| v.as_str())
                    .map(|s| s.starts_with(TMAI_STATUS_PREFIX))
                    .unwrap_or(false);
                !is_tmai
            });
            removed += before - arr.len();
        }
    }

    removed
}

/// Run the `tmai uninit` command — remove tmai hooks from Claude Code settings
pub fn run_uninit() -> Result<()> {
    println!("tmai uninit — Removing Claude Code hooks integration\n");

    // Read existing Claude Code settings
    let settings_path = claude_settings_path()?;
    if !settings_path.exists() {
        println!("No settings file found at {}", settings_path.display());
        println!("Nothing to remove.");
        return Ok(());
    }

    let content = fs::read_to_string(&settings_path)
        .with_context(|| format!("Failed to read {}", settings_path.display()))?;
    let mut settings: Value = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse {}", settings_path.display()))?;

    // Remove tmai hooks
    let removed = remove_tmai_hooks(&mut settings);

    if removed == 0 {
        println!("No tmai hook entries found in {}", settings_path.display());
        return Ok(());
    }

    // Write back settings
    let formatted = serde_json::to_string_pretty(&settings)?;
    fs::write(&settings_path, formatted)
        .with_context(|| format!("Failed to write {}", settings_path.display()))?;

    println!(
        "Removed {} tmai hook entries from {}",
        removed,
        settings_path.display()
    );

    // Optionally remove the token file
    if let Ok(token_path) = hooks_token_path() {
        if token_path.exists() {
            fs::remove_file(&token_path)
                .with_context(|| format!("Failed to remove {}", token_path.display()))?;
            println!("Removed hook token: {}", token_path.display());
        }
    }

    println!("\nDone! tmai hooks have been removed from Claude Code settings.");
    Ok(())
}

/// Run the `tmai init` command
pub fn run(force: bool) -> Result<()> {
    println!("tmai init — Setting up Claude Code hooks integration\n");

    // Step 1: Ensure hook token
    let token = ensure_hook_token(force)?;

    // Step 2: Read existing Claude Code settings
    let settings_path = claude_settings_path()?;
    let mut settings: Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .with_context(|| format!("Failed to read {}", settings_path.display()))?;
        serde_json::from_str(&content)
            .with_context(|| format!("Failed to parse {}", settings_path.display()))?
    } else {
        json!({})
    };

    // Step 3: Merge tmai hooks
    let count = merge_hooks(&mut settings, &token, DEFAULT_PORT);

    // Step 4: Write back settings
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let formatted = serde_json::to_string_pretty(&settings)?;
    fs::write(&settings_path, formatted)
        .with_context(|| format!("Failed to write {}", settings_path.display()))?;

    println!(
        "Added {} hook entries to {}",
        count,
        settings_path.display()
    );
    println!("\nSetup complete! tmai will now receive hook events from Claude Code.");
    println!(
        "Make sure to start tmai with web server enabled (default: port {}).",
        DEFAULT_PORT
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_hook_entry() {
        let entry = build_hook_entry("PreToolUse", "test-token", 9876);
        assert_eq!(entry["type"], "http");
        assert_eq!(entry["url"], "http://localhost:9876/hooks/event");
        assert_eq!(entry["headers"]["Authorization"], "Bearer test-token");
        assert_eq!(entry["headers"]["X-Tmai-Pane-Id"], "$TMUX_PANE");
        assert_eq!(entry["statusMessage"], "tmai: PreToolUse");
    }

    #[test]
    fn test_merge_hooks_empty_settings() {
        let mut settings = json!({});
        let count = merge_hooks(&mut settings, "token-123", 9876);
        assert_eq!(count, target_events().len());

        // Verify hooks structure
        let hooks = settings["hooks"].as_object().unwrap();
        for event in target_events() {
            let entries = hooks[*event].as_array().unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0]["statusMessage"], format!("tmai: {}", event));
        }
    }

    #[test]
    fn test_merge_hooks_preserves_existing() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {
                        "type": "command",
                        "command": "echo pre-tool",
                        "statusMessage": "user: pre-tool"
                    }
                ]
            }
        });

        merge_hooks(&mut settings, "token-123", 9876);

        // Existing entry should be preserved
        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 2);
        assert_eq!(pre_tool[0]["statusMessage"], "user: pre-tool");
        assert!(pre_tool[1]["statusMessage"]
            .as_str()
            .unwrap()
            .starts_with("tmai: "));
    }

    #[test]
    fn test_merge_hooks_replaces_existing_tmai() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {
                        "type": "http",
                        "url": "http://localhost:9876/hooks/event",
                        "statusMessage": "tmai: PreToolUse"
                    },
                    {
                        "type": "command",
                        "command": "echo other",
                        "statusMessage": "other: test"
                    }
                ]
            }
        });

        merge_hooks(&mut settings, "new-token", 9876);

        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        // Should have 2: the "other" one + the new tmai one (old tmai replaced)
        assert_eq!(pre_tool.len(), 2);
        assert_eq!(pre_tool[0]["statusMessage"], "other: test");
        assert_eq!(pre_tool[1]["headers"]["Authorization"], "Bearer new-token");
    }

    #[test]
    fn test_remove_tmai_hooks() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {"statusMessage": "tmai: PreToolUse"},
                    {"statusMessage": "other: test"}
                ],
                "Stop": [
                    {"statusMessage": "tmai: Stop"}
                ]
            }
        });

        let removed = remove_tmai_hooks(&mut settings);
        assert_eq!(removed, 2);

        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 1);
        assert_eq!(pre_tool[0]["statusMessage"], "other: test");

        let stop = settings["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 0);
    }

    #[test]
    fn test_target_events_count() {
        // Should have 12 target events
        assert_eq!(target_events().len(), 12);
    }

    #[test]
    fn test_remove_tmai_hooks_no_hooks_section() {
        let mut settings = json!({ "other": "value" });
        let removed = remove_tmai_hooks(&mut settings);
        assert_eq!(removed, 0);
    }

    #[test]
    fn test_remove_tmai_hooks_empty_hooks() {
        let mut settings = json!({ "hooks": {} });
        let removed = remove_tmai_hooks(&mut settings);
        assert_eq!(removed, 0);
    }
}
