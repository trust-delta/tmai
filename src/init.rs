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

    // Write token file with restricted permissions from the start (no race window)
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .with_context(|| format!("Failed to write hooks token to {}", path.display()))?;
        file.write_all(token.as_bytes())
            .with_context(|| format!("Failed to write hooks token to {}", path.display()))?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&path, &token)
            .with_context(|| format!("Failed to write hooks token to {}", path.display()))?;
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

/// Build a tmai hook entry for a given event (new wrapper format)
fn build_hook_entry(event: &str, token: &str, port: u16) -> Value {
    json!({
        "hooks": [{
            "type": "http",
            "url": format!("http://localhost:{}/hooks/event", port),
            "headers": {
                "Authorization": format!("Bearer {}", token),
                "X-Tmai-Pane-Id": "$TMUX_PANE"
            },
            "allowedEnvVars": ["TMUX_PANE"],
            "statusMessage": format!("{}{}", TMAI_STATUS_PREFIX, event)
        }]
    })
}

/// Check if a hook entry belongs to tmai (supports both old and new format)
fn is_tmai_entry(entry: &Value) -> bool {
    // Old format: entry.statusMessage
    if let Some(s) = entry.get("statusMessage").and_then(|v| v.as_str()) {
        if s.starts_with(TMAI_STATUS_PREFIX) {
            return true;
        }
    }
    // New format: entry.hooks[*].statusMessage
    if let Some(hooks) = entry.get("hooks").and_then(|v| v.as_array()) {
        for h in hooks {
            if let Some(s) = h.get("statusMessage").and_then(|v| v.as_str()) {
                if s.starts_with(TMAI_STATUS_PREFIX) {
                    return true;
                }
            }
        }
    }
    false
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
        "ConfigChange",
        "WorktreeCreate",
        "WorktreeRemove",
        "PreCompact",
        "PostToolUseFailure",
        "InstructionsLoaded",
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

        // Remove existing tmai entries (old and new format)
        event_hooks.retain(|entry| !is_tmai_entry(entry));

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
            arr.retain(|entry| !is_tmai_entry(entry));
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

    if removed > 0 {
        // Write back settings only if hooks were removed
        let formatted = serde_json::to_string_pretty(&settings)?;
        fs::write(&settings_path, formatted)
            .with_context(|| format!("Failed to write {}", settings_path.display()))?;

        println!(
            "Removed {} tmai hook entries from {}",
            removed,
            settings_path.display()
        );
    } else {
        println!("No tmai hook entries found in {}", settings_path.display());
    }

    // Always attempt to remove the token file, even if no hook entries were found
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

    // Load tmai settings to get the configured web port
    let tmai_settings = tmai_core::config::Settings::load(None::<&std::path::PathBuf>)
        .context("Failed to load tmai settings for hook setup")?;
    let port = tmai_settings.web.port;

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
    let count = merge_hooks(&mut settings, &token, port);

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
        "Make sure to start tmai with web server enabled (port {}).",
        port
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_hook_entry() {
        let entry = build_hook_entry("PreToolUse", "test-token", 9876);
        // New format: wrapper with hooks array
        let hooks = entry["hooks"].as_array().unwrap();
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0]["type"], "http");
        assert_eq!(hooks[0]["url"], "http://localhost:9876/hooks/event");
        assert_eq!(hooks[0]["headers"]["Authorization"], "Bearer test-token");
        assert_eq!(hooks[0]["headers"]["X-Tmai-Pane-Id"], "$TMUX_PANE");
        assert_eq!(hooks[0]["statusMessage"], "tmai: PreToolUse");
    }

    #[test]
    fn test_merge_hooks_empty_settings() {
        let mut settings = json!({});
        let count = merge_hooks(&mut settings, "token-123", 9876);
        assert_eq!(count, target_events().len());

        // Verify hooks structure (new wrapper format)
        let hooks = settings["hooks"].as_object().unwrap();
        for event in target_events() {
            let entries = hooks[*event].as_array().unwrap();
            assert_eq!(entries.len(), 1);
            assert_eq!(
                entries[0]["hooks"][0]["statusMessage"],
                format!("tmai: {}", event)
            );
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
        // New tmai entry is in wrapper format
        assert!(pre_tool[1]["hooks"][0]["statusMessage"]
            .as_str()
            .unwrap()
            .starts_with("tmai: "));
    }

    #[test]
    fn test_merge_hooks_replaces_existing_tmai_old_format() {
        // Old format tmai entry (statusMessage at top level)
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
        // New entry uses wrapper format
        assert_eq!(
            pre_tool[1]["hooks"][0]["headers"]["Authorization"],
            "Bearer new-token"
        );
    }

    #[test]
    fn test_merge_hooks_replaces_existing_tmai_new_format() {
        // New format tmai entry (statusMessage inside hooks array)
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {
                        "hooks": [{
                            "type": "http",
                            "url": "http://localhost:9876/hooks/event",
                            "statusMessage": "tmai: PreToolUse"
                        }]
                    },
                    {
                        "hooks": [{
                            "type": "command",
                            "command": "echo other",
                            "statusMessage": "other: test"
                        }]
                    }
                ]
            }
        });

        merge_hooks(&mut settings, "new-token", 9876);

        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        // Should have 2: the non-tmai wrapper + the new tmai wrapper
        assert_eq!(pre_tool.len(), 2);
        assert_eq!(pre_tool[0]["hooks"][0]["statusMessage"], "other: test");
        assert_eq!(
            pre_tool[1]["hooks"][0]["headers"]["Authorization"],
            "Bearer new-token"
        );
    }

    #[test]
    fn test_remove_tmai_hooks_old_format() {
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
    fn test_remove_tmai_hooks_new_format() {
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {"hooks": [{"statusMessage": "tmai: PreToolUse"}]},
                    {"hooks": [{"statusMessage": "other: test"}]}
                ],
                "Stop": [
                    {"hooks": [{"statusMessage": "tmai: Stop"}]}
                ]
            }
        });

        let removed = remove_tmai_hooks(&mut settings);
        assert_eq!(removed, 2);

        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 1);
        assert_eq!(pre_tool[0]["hooks"][0]["statusMessage"], "other: test");

        let stop = settings["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 0);
    }

    #[test]
    fn test_remove_tmai_hooks_mixed_formats() {
        // Settings with both old and new format tmai entries
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {"statusMessage": "tmai: PreToolUse"},
                    {"hooks": [{"statusMessage": "tmai: PreToolUse"}]},
                    {"statusMessage": "other: test"}
                ]
            }
        });

        let removed = remove_tmai_hooks(&mut settings);
        assert_eq!(removed, 2);

        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 1);
        assert_eq!(pre_tool[0]["statusMessage"], "other: test");
    }

    #[test]
    fn test_target_events_count() {
        // Should have 18 target events
        assert_eq!(target_events().len(), 18);
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

    #[test]
    fn test_is_tmai_entry_old_format() {
        let entry = json!({"type": "http", "statusMessage": "tmai: PreToolUse"});
        assert!(is_tmai_entry(&entry));
    }

    #[test]
    fn test_is_tmai_entry_new_format() {
        let entry = json!({"hooks": [{"type": "http", "statusMessage": "tmai: PreToolUse"}]});
        assert!(is_tmai_entry(&entry));
    }

    #[test]
    fn test_is_tmai_entry_non_tmai() {
        let entry = json!({"type": "command", "statusMessage": "other: test"});
        assert!(!is_tmai_entry(&entry));

        let entry = json!({"hooks": [{"statusMessage": "other: test"}]});
        assert!(!is_tmai_entry(&entry));

        let entry = json!({"hooks": []});
        assert!(!is_tmai_entry(&entry));
    }

    #[test]
    fn test_migration_old_to_new_format() {
        // Simulate settings with old-format tmai entries
        let mut settings = json!({
            "hooks": {
                "PreToolUse": [
                    {
                        "type": "http",
                        "url": "http://localhost:9876/hooks/event",
                        "headers": {"Authorization": "Bearer old-token"},
                        "statusMessage": "tmai: PreToolUse"
                    }
                ],
                "Stop": [
                    {
                        "type": "http",
                        "url": "http://localhost:9876/hooks/event",
                        "headers": {"Authorization": "Bearer old-token"},
                        "statusMessage": "tmai: Stop"
                    },
                    {
                        "type": "command",
                        "command": "echo user-hook",
                        "statusMessage": "user: stop-hook"
                    }
                ]
            }
        });

        // Merge with new token — should replace old-format entries with new-format
        merge_hooks(&mut settings, "new-token", 9876);

        // PreToolUse: old entry removed, new wrapper entry added
        let pre_tool = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre_tool.len(), 1);
        assert_eq!(
            pre_tool[0]["hooks"][0]["headers"]["Authorization"],
            "Bearer new-token"
        );
        // No top-level statusMessage (that was old format)
        assert!(pre_tool[0].get("statusMessage").is_none());

        // Stop: user entry preserved, old tmai replaced with new format
        let stop = settings["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2);
        assert_eq!(stop[0]["statusMessage"], "user: stop-hook");
        assert_eq!(
            stop[1]["hooks"][0]["headers"]["Authorization"],
            "Bearer new-token"
        );
    }
}
