//! Owned snapshot types for the Facade API.
//!
//! These types are returned by query methods and do not hold any lock.
//! They are safe to pass across async boundaries and serialize for Web API.

use serde::Serialize;
use thiserror::Error;

use crate::agents::{AgentMode, AgentStatus, AgentTeamInfo, AgentType, DetectionSource};
use crate::auto_approve::AutoApprovePhase;
use crate::detectors::DetectionReason;
use crate::teams::AgentDefinition;

/// Error type for Facade API operations
#[derive(Debug, Error)]
pub enum ApiError {
    /// The requested agent was not found
    #[error("agent not found: {target}")]
    AgentNotFound { target: String },

    /// The requested team was not found
    #[error("team not found: {name}")]
    TeamNotFound { name: String },

    /// No agent is currently selected
    #[error("no agent selected")]
    NoSelection,

    /// The command sender is not configured
    #[error("command sender not available")]
    NoCommandSender,

    /// The target is a virtual agent (cannot send keys)
    #[error("cannot interact with virtual agent: {target}")]
    VirtualAgent { target: String },

    /// Invalid input (e.g. text too long, invalid key)
    #[error("invalid input: {message}")]
    InvalidInput { message: String },

    /// A tmux or IPC operation failed
    #[error("command failed: {0}")]
    CommandError(#[from] anyhow::Error),
}

/// Owned snapshot of a `MonitoredAgent`, returned by query methods.
///
/// All string fields are cloned out of the locked state so that callers
/// never need to hold a read lock beyond the query call.
#[derive(Debug, Clone, Serialize)]
pub struct AgentSnapshot {
    /// Unique identifier (session:window.pane)
    pub id: String,
    /// tmux target identifier
    pub target: String,
    /// Type of agent
    pub agent_type: AgentType,
    /// Current status
    pub status: AgentStatus,
    /// Pane title
    pub title: String,
    /// Last captured content (plain text)
    pub last_content: String,
    /// Last captured content with ANSI codes (for preview rendering)
    pub last_content_ansi: String,
    /// Working directory
    pub cwd: String,
    /// Working directory with ~ abbreviation
    pub display_cwd: String,
    /// Process ID
    pub pid: u32,
    /// Session name
    pub session: String,
    /// Window name
    pub window_name: String,
    /// Window index
    pub window_index: u32,
    /// Pane index
    pub pane_index: u32,
    /// Last update timestamp
    pub last_update: chrono::DateTime<chrono::Utc>,
    /// Context warning percentage
    pub context_warning: Option<u8>,
    /// How the agent state was detected
    pub detection_source: DetectionSource,
    /// Team information
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_info: Option<AgentTeamInfo>,
    /// Whether this is a virtual agent (team member without detected pane)
    pub is_virtual: bool,
    /// Detection reason from the last status detection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detection_reason: Option<DetectionReason>,
    /// Permission mode
    pub mode: AgentMode,
    /// Git branch name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    /// Whether the git working tree has uncommitted changes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_dirty: Option<bool>,
    /// Whether this directory is a git worktree
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_worktree: Option<bool>,
    /// Auto-approve judgment phase
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve_phase: Option<AutoApprovePhase>,
    /// Absolute path to the shared git common directory (for repository grouping)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_common_dir: Option<String>,
    /// Worktree name extracted from `.claude/worktrees/{name}` in cwd
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_name: Option<String>,
    /// Display name (e.g., "main:0.1")
    pub display_name: String,
    /// Agent definition info from `.claude/agents/*.md`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_definition: Option<AgentDefinitionInfo>,
}

/// Summary of an agent definition for API consumers
#[derive(Debug, Clone, Serialize)]
pub struct AgentDefinitionInfo {
    /// Agent name
    pub name: String,
    /// Human-readable description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Model (e.g., "sonnet", "opus")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Isolation mode (e.g., "worktree")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isolation: Option<String>,
}

impl AgentDefinitionInfo {
    /// Create from an AgentDefinition
    pub fn from_definition(def: &AgentDefinition) -> Self {
        Self {
            name: def.name.clone(),
            description: def.description.clone(),
            model: def.model.clone(),
            isolation: def.isolation.clone(),
        }
    }
}

impl AgentSnapshot {
    /// Convert a `MonitoredAgent` reference into an owned snapshot
    pub fn from_agent(agent: &crate::agents::MonitoredAgent) -> Self {
        Self {
            id: agent.id.clone(),
            target: agent.target.clone(),
            agent_type: agent.agent_type.clone(),
            status: agent.status.clone(),
            title: agent.title.clone(),
            last_content: agent.last_content.clone(),
            last_content_ansi: agent.last_content_ansi.clone(),
            cwd: agent.cwd.clone(),
            display_cwd: agent.display_cwd(),
            pid: agent.pid,
            session: agent.session.clone(),
            window_name: agent.window_name.clone(),
            window_index: agent.window_index,
            pane_index: agent.pane_index,
            last_update: agent.last_update,
            context_warning: agent.context_warning,
            detection_source: agent.detection_source,
            team_info: agent.team_info.clone(),
            is_virtual: agent.is_virtual,
            detection_reason: agent.detection_reason.clone(),
            mode: agent.mode.clone(),
            git_branch: agent.git_branch.clone(),
            git_dirty: agent.git_dirty,
            is_worktree: agent.is_worktree,
            auto_approve_phase: agent.auto_approve_phase.clone(),
            git_common_dir: agent.git_common_dir.clone(),
            worktree_name: agent.worktree_name.clone(),
            display_name: agent.display_name(),
            agent_definition: None,
        }
    }

    /// Whether this agent needs user attention
    pub fn needs_attention(&self) -> bool {
        self.status.needs_attention()
    }
}

/// Owned summary of a team's state
#[derive(Debug, Clone, Serialize)]
pub struct TeamSummary {
    /// Team name
    pub name: String,
    /// Team description
    pub description: Option<String>,
    /// Number of team members
    pub member_count: usize,
    /// Completed task count
    pub task_done: usize,
    /// Total task count
    pub task_total: usize,
    /// In-progress task count
    pub task_in_progress: usize,
    /// Pending task count
    pub task_pending: usize,
    /// When this snapshot was last scanned
    pub last_scan: chrono::DateTime<chrono::Utc>,
    /// Member names
    pub member_names: Vec<String>,
    /// Worktree names used by this team's members
    pub worktree_names: Vec<String>,
}

impl TeamSummary {
    /// Convert a `TeamSnapshot` reference into an owned summary
    pub fn from_snapshot(snapshot: &crate::state::TeamSnapshot) -> Self {
        Self {
            name: snapshot.config.team_name.clone(),
            description: snapshot.config.description.clone(),
            member_count: snapshot.config.members.len(),
            task_done: snapshot.task_done,
            task_total: snapshot.task_total,
            task_in_progress: snapshot.task_in_progress,
            task_pending: snapshot.task_pending,
            last_scan: snapshot.last_scan,
            member_names: snapshot
                .config
                .members
                .iter()
                .map(|m| m.name.clone())
                .collect(),
            worktree_names: snapshot.worktree_names.clone(),
        }
    }
}

/// Summary of team tasks (includes full task data)
#[derive(Debug, Clone, Serialize)]
pub struct TeamTaskInfo {
    /// Task ID
    pub id: String,
    /// Task subject
    pub subject: String,
    /// Task status
    pub status: crate::teams::TaskStatus,
    /// Task owner
    pub owner: Option<String>,
    /// Task description
    pub description: String,
    /// Active form (present continuous verb)
    pub active_form: Option<String>,
}

impl TeamTaskInfo {
    /// Convert from a `TeamTask` reference
    pub fn from_task(task: &crate::teams::TeamTask) -> Self {
        Self {
            id: task.id.clone(),
            subject: task.subject.clone(),
            status: task.status,
            owner: task.owner.clone(),
            description: task.description.clone(),

            active_form: task.active_form.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentStatus, AgentType, MonitoredAgent};

    fn test_agent(id: &str) -> MonitoredAgent {
        MonitoredAgent::new(
            id.to_string(),
            AgentType::ClaudeCode,
            "Test Title".to_string(),
            "/home/user/project".to_string(),
            1234,
            "main".to_string(),
            "window0".to_string(),
            0,
            0,
        )
    }

    #[test]
    fn test_agent_snapshot_from_agent() {
        let mut agent = test_agent("main:0.0");
        agent.status = AgentStatus::Idle;
        agent.context_warning = Some(15);

        let snapshot = AgentSnapshot::from_agent(&agent);

        assert_eq!(snapshot.id, "main:0.0");
        assert_eq!(snapshot.target, "main:0.0");
        assert!(matches!(snapshot.agent_type, AgentType::ClaudeCode));
        assert!(matches!(snapshot.status, AgentStatus::Idle));
        assert_eq!(snapshot.pid, 1234);
        assert_eq!(snapshot.context_warning, Some(15));
        assert_eq!(snapshot.display_name, "main:0.0");
        assert!(!snapshot.needs_attention());
    }

    #[test]
    fn test_agent_snapshot_needs_attention() {
        let mut agent = test_agent("main:0.1");
        agent.status = AgentStatus::AwaitingApproval {
            approval_type: crate::agents::ApprovalType::FileEdit,
            details: "edit foo.rs".to_string(),
        };

        let snapshot = AgentSnapshot::from_agent(&agent);
        assert!(snapshot.needs_attention());
    }

    #[test]
    fn test_api_error_display() {
        let err = ApiError::AgentNotFound {
            target: "main:0.0".to_string(),
        };
        assert_eq!(err.to_string(), "agent not found: main:0.0");

        let err = ApiError::TeamNotFound {
            name: "my-team".to_string(),
        };
        assert_eq!(err.to_string(), "team not found: my-team");

        let err = ApiError::NoSelection;
        assert_eq!(err.to_string(), "no agent selected");

        let err = ApiError::NoCommandSender;
        assert_eq!(err.to_string(), "command sender not available");
    }
}
