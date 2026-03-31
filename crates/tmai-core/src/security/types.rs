//! Config audit types — severity levels, categories, risk findings, and audit results.

use std::fmt;
use std::path::PathBuf;

/// Severity level for a security risk
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize)]
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
    /// Custom command risks (dangerous shell patterns)
    CustomCommand,
    /// Instruction file risks (prompt injection in CLAUDE.md)
    InstructionFile,
}

impl fmt::Display for SecurityCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SecurityCategory::Permissions => write!(f, "Permissions"),
            SecurityCategory::McpServer => write!(f, "MCP Server"),
            SecurityCategory::Environment => write!(f, "Environment"),
            SecurityCategory::Hooks => write!(f, "Hooks"),
            SecurityCategory::FilePermissions => write!(f, "File Permissions"),
            SecurityCategory::CustomCommand => write!(f, "Custom Command"),
            SecurityCategory::InstructionFile => write!(f, "Instruction File"),
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
    /// Custom command file (.claude/commands/)
    CustomCommand(PathBuf),
    /// CLAUDE.md instruction file
    ClaudeMd(PathBuf),
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
            SettingsSource::CustomCommand(p) => write!(f, "{}", p.display()),
            SettingsSource::ClaudeMd(p) => write!(f, "{}", p.display()),
        }
    }
}

/// A single security risk finding
#[derive(Debug, Clone, serde::Serialize)]
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
    #[serde(serialize_with = "serialize_source_as_string")]
    pub source: SettingsSource,
    /// The matched value that triggered the risk (if applicable)
    pub matched_value: Option<String>,
}

/// Serialize SettingsSource as its Display string for clean JSON output
fn serialize_source_as_string<S: serde::Serializer>(
    source: &SettingsSource,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&source.to_string())
}

/// Result of a security scan
#[derive(Debug, Clone, serde::Serialize)]
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

    #[test]
    fn test_scan_result_serialization() {
        let result = ScanResult {
            risks: vec![SecurityRisk {
                rule_id: "PERM-001".to_string(),
                severity: Severity::Critical,
                category: SecurityCategory::Permissions,
                summary: "Test risk".to_string(),
                detail: "Details here".to_string(),
                source: SettingsSource::UserGlobal,
                matched_value: Some("enableAllProjectMcpServers: true".to_string()),
            }],
            scanned_at: chrono::Utc::now(),
            scanned_projects: vec![PathBuf::from("/home/user/project")],
            files_scanned: 5,
        };

        let json = serde_json::to_value(&result).unwrap();
        assert!(json["risks"].is_array());
        assert_eq!(json["risks"][0]["rule_id"], "PERM-001");
        assert_eq!(json["risks"][0]["severity"], "Critical");
        assert_eq!(json["risks"][0]["category"], "Permissions");
        // source is serialized as Display string, not tagged enum
        assert_eq!(json["risks"][0]["source"], "~/.claude/settings.json");
        assert!(json["scanned_at"].is_string());
        assert_eq!(json["files_scanned"], 5);
    }

    #[test]
    fn test_security_risk_serialization_null_matched_value() {
        let risk = SecurityRisk {
            rule_id: "MCP-001".to_string(),
            severity: Severity::Medium,
            category: SecurityCategory::McpServer,
            summary: "No version pin".to_string(),
            detail: "Details".to_string(),
            source: SettingsSource::ProjectMcp(PathBuf::from("/project")),
            matched_value: None,
        };

        let json = serde_json::to_value(&risk).unwrap();
        assert_eq!(json["severity"], "Medium");
        assert_eq!(json["category"], "McpServer");
        assert!(json["matched_value"].is_null());
        // ProjectMcp source serialized with Display
        assert!(json["source"].as_str().unwrap().contains("mcp.json"));
    }
}
