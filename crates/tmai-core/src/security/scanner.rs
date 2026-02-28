//! SecurityScanner — reads Claude Code config files and runs security rules.

use std::path::{Path, PathBuf};

use super::rules;
use super::types::{ScanResult, SecurityRisk, SettingsSource};

/// Scans Claude Code configuration files for security risks
pub struct SecurityScanner;

impl SecurityScanner {
    /// Run a full security scan across user-level and project-level configs.
    ///
    /// `project_dirs` should contain the working directories of monitored agents.
    /// The scanner will look for `.claude/` directories within each.
    pub fn scan(project_dirs: &[PathBuf]) -> ScanResult {
        let mut risks = Vec::new();
        let mut files_scanned = 0;

        // 1) User-level settings
        let claude_home = Self::claude_home();

        files_scanned += Self::scan_settings_file(
            &claude_home.join("settings.json"),
            &SettingsSource::UserGlobal,
            &mut risks,
        );
        files_scanned += Self::scan_settings_file(
            &claude_home.join("settings.local.json"),
            &SettingsSource::UserLocal,
            &mut risks,
        );

        // 2) User-level MCP config
        files_scanned += Self::scan_mcp_file(
            &claude_home.join("mcp.json"),
            &SettingsSource::UserMcp,
            &mut risks,
        );

        // 3) User-level hook scripts
        let hooks_dir = claude_home.join("hooks");
        files_scanned += Self::scan_hooks_dir(&hooks_dir, &mut risks);

        // 4) Deduplicate project directories
        let unique_projects: Vec<PathBuf> = Self::deduplicate_dirs(project_dirs);

        // 5) Per-project scans
        for project_dir in &unique_projects {
            let claude_dir = project_dir.join(".claude");
            if !claude_dir.is_dir() {
                continue;
            }

            files_scanned += Self::scan_settings_file(
                &claude_dir.join("settings.json"),
                &SettingsSource::ProjectShared(project_dir.clone()),
                &mut risks,
            );
            files_scanned += Self::scan_settings_file(
                &claude_dir.join("settings.local.json"),
                &SettingsSource::ProjectLocal(project_dir.clone()),
                &mut risks,
            );
            files_scanned += Self::scan_mcp_file(
                &claude_dir.join("mcp.json"),
                &SettingsSource::ProjectMcp(project_dir.clone()),
                &mut risks,
            );

            // Project-level hooks
            let project_hooks = claude_dir.join("hooks");
            files_scanned += Self::scan_hooks_dir(&project_hooks, &mut risks);
        }

        // Sort by severity descending (Critical first)
        risks.sort_by(|a, b| b.severity.cmp(&a.severity));

        ScanResult {
            risks,
            scanned_at: chrono::Utc::now(),
            scanned_projects: unique_projects,
            files_scanned,
        }
    }

    /// Get the Claude home directory (~/.claude)
    fn claude_home() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".claude")
    }

    /// Scan a settings.json file. Returns 1 if file was scanned, 0 otherwise.
    fn scan_settings_file(
        path: &Path,
        source: &SettingsSource,
        risks: &mut Vec<SecurityRisk>,
    ) -> usize {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return 0,
        };

        let value: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => return 0,
        };

        rules::check_all_settings_rules(&value, source, risks);
        rules::check_file_permissions(path, source, risks);

        1
    }

    /// Scan an mcp.json file. Returns 1 if file was scanned, 0 otherwise.
    fn scan_mcp_file(path: &Path, source: &SettingsSource, risks: &mut Vec<SecurityRisk>) -> usize {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return 0,
        };

        let value: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => return 0,
        };

        rules::check_all_mcp_rules(&value, source, risks);
        rules::check_file_permissions(path, source, risks);

        1
    }

    /// Scan hook scripts in a directory. Returns number of files scanned.
    fn scan_hooks_dir(dir: &Path, risks: &mut Vec<SecurityRisk>) -> usize {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return 0,
        };

        let mut count = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            // Only scan shell scripts and common script extensions
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let is_script = matches!(ext, "sh" | "bash" | "zsh" | "")
                || path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| !n.contains('.'));

            if !is_script {
                continue;
            }

            if let Ok(content) = std::fs::read_to_string(&path) {
                let source = SettingsSource::HookScript(path);
                rules::check_hook_background_processes(&content, &source, risks);
                count += 1;
            }
        }
        count
    }

    /// Deduplicate directory paths (canonicalize + dedup)
    fn deduplicate_dirs(dirs: &[PathBuf]) -> Vec<PathBuf> {
        let mut seen = std::collections::HashSet::new();
        let mut result = Vec::new();

        for dir in dirs {
            let canonical = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.clone());
            if seen.insert(canonical) {
                result.push(dir.clone());
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Create a project with a .claude/ directory and settings files
    fn setup_project(dir: &Path, settings_json: &str) {
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(claude_dir.join("settings.json"), settings_json).unwrap();
    }

    #[test]
    fn test_scan_empty_project() {
        let tmp = TempDir::new().unwrap();
        let result = SecurityScanner::scan(&[tmp.path().to_path_buf()]);
        // Should not panic, just return whatever it finds
        assert!(result.scanned_at <= chrono::Utc::now());
    }

    #[test]
    fn test_scan_project_with_risks() {
        let tmp = TempDir::new().unwrap();
        setup_project(
            tmp.path(),
            r#"{
                "enableAllProjectMcpServers": true,
                "permissions": {
                    "allow": ["Bash(rm -rf /)"]
                }
            }"#,
        );

        let result = SecurityScanner::scan(&[tmp.path().to_path_buf()]);
        // Should find PERM-001 and PERM-002 at minimum
        assert!(result.total_risks() >= 2);
        assert!(result.risks.iter().any(|r| r.rule_id == "PERM-001"));
        assert!(result.risks.iter().any(|r| r.rule_id == "PERM-002"));
    }

    #[test]
    fn test_scan_project_with_mcp() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("mcp.json"),
            r#"{
                "mcpServers": {
                    "test-server": {
                        "command": "npx",
                        "args": ["-y", "some-package"]
                    }
                }
            }"#,
        )
        .unwrap();

        let result = SecurityScanner::scan(&[tmp.path().to_path_buf()]);
        assert!(result.risks.iter().any(|r| r.rule_id == "MCP-001"));
    }

    #[test]
    fn test_scan_hooks() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join(".claude");
        let hooks_dir = claude_dir.join("hooks");
        fs::create_dir_all(&hooks_dir).unwrap();
        fs::write(
            hooks_dir.join("pre-commit.sh"),
            "#!/bin/bash\ncurl http://example.com &\n",
        )
        .unwrap();

        let result = SecurityScanner::scan(&[tmp.path().to_path_buf()]);
        assert!(result.risks.iter().any(|r| r.rule_id == "HOOK-001"));
    }

    #[test]
    fn test_scan_results_sorted_by_severity() {
        let tmp = TempDir::new().unwrap();
        setup_project(
            tmp.path(),
            r#"{
                "enableAllProjectMcpServers": true,
                "permissions": {
                    "allow": ["Bash(rm -rf /)"]
                }
            }"#,
        );

        let result = SecurityScanner::scan(&[tmp.path().to_path_buf()]);
        // Verify descending severity order
        for window in result.risks.windows(2) {
            assert!(window[0].severity >= window[1].severity);
        }
    }

    #[test]
    fn test_deduplicate_dirs() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().to_path_buf();
        let dirs = vec![path.clone(), path.clone(), path];
        let unique = SecurityScanner::deduplicate_dirs(&dirs);
        assert_eq!(unique.len(), 1);
    }
}
