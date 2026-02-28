//! Security scan types — severity levels, categories, risk findings, and scan results.

use std::fmt;
use std::path::PathBuf;

/// Severity level for a security risk
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Severity::Low => write!(f, "LOW"),
            Severity::Medium => write!(f, "MEDIUM"),
            Severity::High => write!(f, "HIGH"),
            Severity::Critical => write!(f, "CRITICAL"),
        }
    }
}

/// Category of a security risk
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SecurityCategory {
    /// Permission-related risks (allowlist, denylist, global enables)
    Permissions,
    /// MCP server configuration risks
    McpServer,
    /// Environment variable risks (leaked secrets)
    Environment,
    /// Hook script risks
    Hooks,
    /// File permission risks (world-readable config)
    FilePermissions,
}

impl fmt::Display for SecurityCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SecurityCategory::Permissions => write!(f, "Permissions"),
            SecurityCategory::McpServer => write!(f, "MCP Server"),
            SecurityCategory::Environment => write!(f, "Environment"),
            SecurityCategory::Hooks => write!(f, "Hooks"),
            SecurityCategory::FilePermissions => write!(f, "File Permissions"),
        }
    }
}

/// Source of a settings file that was scanned
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum SettingsSource {
    /// User-level global settings (~/.claude/settings.json)
    UserGlobal,
    /// User-level local settings (~/.claude/settings.local.json)
    UserLocal,
    /// Project-level shared settings (.claude/settings.json)
    ProjectShared(PathBuf),
    /// Project-level local settings (.claude/settings.local.json)
    ProjectLocal(PathBuf),
    /// User-level MCP config (~/.claude/mcp.json)
    UserMcp,
    /// Project-level MCP config (.claude/mcp.json)
    ProjectMcp(PathBuf),
    /// Hook script file
    HookScript(PathBuf),
}

impl fmt::Display for SettingsSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SettingsSource::UserGlobal => write!(f, "~/.claude/settings.json"),
            SettingsSource::UserLocal => write!(f, "~/.claude/settings.local.json"),
            SettingsSource::ProjectShared(p) => {
                write!(f, "{}", p.join(".claude/settings.json").display())
            }
            SettingsSource::ProjectLocal(p) => {
                write!(f, "{}", p.join(".claude/settings.local.json").display())
            }
            SettingsSource::UserMcp => write!(f, "~/.claude/mcp.json"),
            SettingsSource::ProjectMcp(p) => {
                write!(f, "{}", p.join(".claude/mcp.json").display())
            }
            SettingsSource::HookScript(p) => write!(f, "{}", p.display()),
        }
    }
}

/// A single security risk finding
#[derive(Debug, Clone)]
pub struct SecurityRisk {
    /// Unique rule identifier (e.g., "PERM-001")
    pub rule_id: String,
    /// Severity of the risk
    pub severity: Severity,
    /// Category of the risk
    pub category: SecurityCategory,
    /// One-line summary
    pub summary: String,
    /// Detailed description
    pub detail: String,
    /// Where this risk was found
    pub source: SettingsSource,
    /// The matched value that triggered the risk (if applicable)
    pub matched_value: Option<String>,
}

/// Result of a security scan
#[derive(Debug, Clone)]
pub struct ScanResult {
    /// All discovered risks
    pub risks: Vec<SecurityRisk>,
    /// When the scan was performed
    pub scanned_at: chrono::DateTime<chrono::Utc>,
    /// Project directories that were scanned
    pub scanned_projects: Vec<PathBuf>,
    /// Number of files scanned
    pub files_scanned: usize,
}

impl ScanResult {
    /// Count risks by severity
    pub fn count_by_severity(&self, severity: Severity) -> usize {
        self.risks.iter().filter(|r| r.severity == severity).count()
    }

    /// Get the highest severity found, if any
    pub fn max_severity(&self) -> Option<Severity> {
        self.risks.iter().map(|r| r.severity).max()
    }

    /// Total number of risks
    pub fn total_risks(&self) -> usize {
        self.risks.len()
    }

    /// Check if there are no risks
    pub fn is_clean(&self) -> bool {
        self.risks.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_severity_ordering() {
        assert!(Severity::Low < Severity::Medium);
        assert!(Severity::Medium < Severity::High);
        assert!(Severity::High < Severity::Critical);
    }

    #[test]
    fn test_severity_display() {
        assert_eq!(format!("{}", Severity::Critical), "CRITICAL");
        assert_eq!(format!("{}", Severity::Low), "LOW");
    }

    #[test]
    fn test_settings_source_display() {
        assert_eq!(
            format!("{}", SettingsSource::UserGlobal),
            "~/.claude/settings.json"
        );
        let project = SettingsSource::ProjectShared(PathBuf::from("/home/user/project"));
        assert!(format!("{}", project).contains(".claude/settings.json"));
    }

    #[test]
    fn test_scan_result_helpers() {
        let result = ScanResult {
            risks: vec![
                SecurityRisk {
                    rule_id: "TEST-001".to_string(),
                    severity: Severity::High,
                    category: SecurityCategory::Permissions,
                    summary: "Test".to_string(),
                    detail: "Detail".to_string(),
                    source: SettingsSource::UserGlobal,
                    matched_value: None,
                },
                SecurityRisk {
                    rule_id: "TEST-002".to_string(),
                    severity: Severity::Critical,
                    category: SecurityCategory::Environment,
                    summary: "Test".to_string(),
                    detail: "Detail".to_string(),
                    source: SettingsSource::UserGlobal,
                    matched_value: Some("sk-xxx".to_string()),
                },
                SecurityRisk {
                    rule_id: "TEST-003".to_string(),
                    severity: Severity::High,
                    category: SecurityCategory::Permissions,
                    summary: "Test".to_string(),
                    detail: "Detail".to_string(),
                    source: SettingsSource::UserGlobal,
                    matched_value: None,
                },
            ],
            scanned_at: chrono::Utc::now(),
            scanned_projects: vec![],
            files_scanned: 3,
        };

        assert_eq!(result.total_risks(), 3);
        assert_eq!(result.count_by_severity(Severity::High), 2);
        assert_eq!(result.count_by_severity(Severity::Critical), 1);
        assert_eq!(result.count_by_severity(Severity::Low), 0);
        assert_eq!(result.max_severity(), Some(Severity::Critical));
        assert!(!result.is_clean());
    }

    #[test]
    fn test_scan_result_empty() {
        let result = ScanResult {
            risks: vec![],
            scanned_at: chrono::Utc::now(),
            scanned_projects: vec![],
            files_scanned: 0,
        };

        assert!(result.is_clean());
        assert_eq!(result.max_severity(), None);
    }
}
