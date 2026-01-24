use std::fmt;

use serde::{Deserialize, Serialize};

/// Type of subagent (Task tool agent types in Claude Code)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SubagentType {
    Explore,
    Plan,
    Bash,
    GeneralPurpose,
    Custom(String),
}

impl SubagentType {
    /// Parse subagent type from string
    pub fn parse(s: &str) -> Self {
        let lower = s.to_lowercase();
        match lower.as_str() {
            "explore" => SubagentType::Explore,
            "plan" => SubagentType::Plan,
            "bash" => SubagentType::Bash,
            "general-purpose" | "generalpurpose" => SubagentType::GeneralPurpose,
            _ => SubagentType::Custom(s.to_string()),
        }
    }

    /// Get display name
    pub fn display_name(&self) -> &str {
        match self {
            SubagentType::Explore => "Explore",
            SubagentType::Plan => "Plan",
            SubagentType::Bash => "Bash",
            SubagentType::GeneralPurpose => "General",
            SubagentType::Custom(name) => name,
        }
    }
}

impl fmt::Display for SubagentType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Status of a subagent
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubagentStatus {
    Running,
    Completed,
    Failed,
}

impl Default for SubagentStatus {
    fn default() -> Self {
        SubagentStatus::Running
    }
}

/// A subagent spawned by the main agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subagent {
    /// Unique identifier
    pub id: String,
    /// Type of subagent
    pub subagent_type: SubagentType,
    /// Description/task
    pub description: String,
    /// Current status
    pub status: SubagentStatus,
}

impl Subagent {
    /// Create a new subagent
    pub fn new(id: String, subagent_type: SubagentType, description: String) -> Self {
        Self {
            id,
            subagent_type,
            description,
            status: SubagentStatus::Running,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subagent_type_parse() {
        assert_eq!(SubagentType::parse("Explore"), SubagentType::Explore);
        assert_eq!(SubagentType::parse("EXPLORE"), SubagentType::Explore);
        assert_eq!(SubagentType::parse("plan"), SubagentType::Plan);
        assert_eq!(
            SubagentType::parse("general-purpose"),
            SubagentType::GeneralPurpose
        );
        assert_eq!(
            SubagentType::parse("custom-type"),
            SubagentType::Custom("custom-type".to_string())
        );
    }
}
