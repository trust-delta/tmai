//! Owned snapshot types for the Facade API.
//!
//! These types are returned by query methods and do not hold any lock.
//! They are safe to pass across async boundaries and serialize for Web API.

use serde::Serialize;
use thiserror::Error;

use crate::agents::{
    AgentMode, AgentStatus, AgentTeamInfo, AgentType, Detail, DetectionSource, EffortLevel, Phase,
    SendCapability,
};
use crate::auto_approve::AutoApprovePhase;
use crate::detectors::DetectionReason;
use crate::teams::AgentDefinition;

/// Origin of an API action — tracks who initiated the operation.
///
/// Used by the orchestrator notification middleware to provide context
/// about what triggered a side-effect API call.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum ActionOrigin {
    /// A human interacting through a UI surface
    Human {
        /// Which interface: "webui", "tui", "mobile", "cli", etc.
        interface: String,
    },
    /// An AI agent (orchestrator or worker) via MCP tools
    Agent {
        /// Agent target ID (e.g., "main:0.0")
        id: String,
        /// Whether this agent is the orchestrator
        is_orchestrator: bool,
    },
    /// An automated system process (auto_cleanup, pr_monitor, etc.)
    System {
        /// Subsystem name (e.g., "auto_cleanup", "pr_monitor")
        subsystem: String,
    },
}

impl ActionOrigin {
    /// Create a Human origin from a WebUI request
    pub fn webui() -> Self {
        Self::Human {
            interface: "webui".to_string(),
        }
    }

    /// Create a Human origin from a TUI request
    pub fn tui() -> Self {
        Self::Human {
            interface: "tui".to_string(),
        }
    }

    /// Create an Agent origin
    pub fn agent(id: impl Into<String>, is_orchestrator: bool) -> Self {
        Self::Agent {
            id: id.into(),
            is_orchestrator,
        }
    }

    /// Create a System origin
    pub fn system(subsystem: impl Into<String>) -> Self {
        Self::System {
            subsystem: subsystem.into(),
        }
    }

    /// Human-readable label for notification messages
    pub fn label(&self) -> String {
        match self {
            Self::Human { interface } => format!("Human ({interface})"),
            Self::Agent {
                id,
                is_orchestrator,
            } => {
                if *is_orchestrator {
                    format!("Orchestrator ({id})")
                } else {
                    format!("Agent ({id})")
                }
            }
            Self::System { subsystem } => format!("System ({subsystem})"),
        }
    }
}

impl std::fmt::Display for ActionOrigin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

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

    /// A worktree operation failed
    #[error("worktree error: {0}")]
    WorktreeError(#[from] crate::worktree::WorktreeOpsError),

    /// A tmux or IPC operation failed
    #[error("command failed: {0}")]
    CommandError(#[from] anyhow::Error),

    /// Agent belongs to a different project (cross-project operation denied)
    #[error("agent {agent_id} belongs to project {agent_project}, not {expected_project}")]
    ProjectScopeMismatch {
        agent_id: String,
        agent_project: String,
        expected_project: String,
    },
}

/// Owned snapshot of a `MonitoredAgent`, returned by query methods.
///
/// All string fields are cloned out of the locked state so that callers
/// Result of a send_prompt operation
#[derive(Debug, Clone, Serialize)]
pub struct SendPromptResult {
    /// Action taken: "sent", "sent_restart", or "queued"
    pub action: String,
    /// Current queue size for this agent (0 if sent immediately)
    pub queue_size: usize,
}

/// never need to hold a read lock beyond the query call.
#[derive(Debug, Clone, Serialize)]
pub struct AgentSnapshot {
    /// Stable identifier that persists across tmux pane recycling
    pub id: String,
    /// tmux pane target (e.g., "main:0.1") — may be recycled by tmux
    pub pane_id: String,
    /// tmux target identifier
    pub target: String,
    /// Type of agent
    pub agent_type: AgentType,
    /// Current status
    pub status: AgentStatus,
    /// Coarse-grained phase for orchestrator consumption
    pub phase: Phase,
    /// Fine-grained detail for UI display
    pub detail: Detail,
    /// Pane title
    pub title: String,
    /// Last captured content (plain text) — skipped in JSON serialization (use preview API)
    #[serde(skip)]
    pub last_content: String,
    /// Last captured content with ANSI codes (for preview rendering) — skipped in JSON
    #[serde(skip)]
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
    /// Effort level (Low/Medium/High, Claude Code v2.1.72+)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<EffortLevel>,
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
    /// Base branch the worktree was forked from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_base_branch: Option<String>,
    /// Display name (e.g., "main:0.1")
    pub display_name: String,
    /// Agent definition info from `.claude/agents/*.md`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_definition: Option<AgentDefinitionInfo>,
    /// Number of active subagents (from hook SubagentStart/Stop tracking)
    #[serde(skip_serializing_if = "is_zero")]
    pub active_subagents: u32,
    /// Number of context compactions in this session (from hook PreCompact tracking)
    #[serde(skip_serializing_if = "is_zero")]
    pub compaction_count: u32,
    /// PTY session ID if this agent was spawned via the PTY spawn API
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pty_session_id: Option<String>,
    /// Best available method for sending keystrokes to this agent
    pub send_capability: SendCapability,
    /// Per-agent auto-approve override: None = follow global, Some(bool) = override
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve_override: Option<bool>,
    /// Effective auto-approve state (resolved from global setting + per-agent override)
    pub auto_approve_effective: bool,
    /// Which communication channels are currently available
    pub connection_channels: crate::agents::ConnectionChannels,
    /// Model ID (e.g., "claude-opus-4-6")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Model display name (e.g., "Opus 4.6")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_display_name: Option<String>,
    /// Terminal cursor column (0-indexed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_x: Option<u32>,
    /// Terminal cursor row (0-indexed, absolute within full capture output)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_y: Option<u32>,
    /// Session cost in USD (from statusline hook)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    /// Session uptime in milliseconds (from statusline hook)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Total lines added (from statusline hook)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines_added: Option<u64>,
    /// Total lines removed (from statusline hook)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines_removed: Option<u64>,
    /// Context window used percentage (from statusline hook)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_used_pct: Option<u8>,
    /// Context window size (from statusline hook)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_size: Option<u64>,
    /// Claude Code version string (from statusline hook)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_version: Option<String>,
    /// Human-readable session name set via /rename (from statusline hook)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_name: Option<String>,
    /// Whether this agent was spawned as an orchestrator
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_orchestrator: bool,
}

/// Helper for skip_serializing_if on u32
fn is_zero(v: &u32) -> bool {
    *v == 0
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
            id: agent.stable_id.clone(),
            pane_id: agent.id.clone(),
            target: agent.target.clone(),
            agent_type: agent.agent_type.clone(),
            status: agent.status.clone(),
            phase: agent.status.phase(),
            detail: agent.status.detail(),
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
            effort_level: agent.effort_level.clone(),
            git_branch: agent.git_branch.clone(),
            git_dirty: agent.git_dirty,
            is_worktree: agent.is_worktree,
            auto_approve_phase: agent.auto_approve_phase.clone(),
            git_common_dir: agent.git_common_dir.clone(),
            worktree_name: agent.worktree_name.clone(),
            worktree_base_branch: agent.worktree_base_branch.clone(),
            display_name: agent.display_name(),
            agent_definition: None,
            active_subagents: agent.active_subagents,
            compaction_count: agent.compaction_count,
            pty_session_id: agent.pty_session_id.clone(),
            send_capability: agent.send_capability,
            auto_approve_override: agent.auto_approve_override,
            auto_approve_effective: agent.auto_approve_override.unwrap_or(false),
            connection_channels: agent.connection_channels,
            model_display_name: agent
                .model_id
                .as_deref()
                .map(crate::transcript::parser::model_display_name),
            model_id: agent.model_id.clone(),
            cursor_x: agent.cursor_x,
            cursor_y: agent.cursor_y,
            cost_usd: agent.cost_usd,
            duration_ms: agent.duration_ms,
            lines_added: agent.lines_added,
            lines_removed: agent.lines_removed,
            context_used_pct: agent.context_used_pct,
            context_window_size: agent.context_window_size,
            claude_version: agent.claude_version.clone(),
            session_name: agent.session_name.clone(),
            is_orchestrator: agent.is_orchestrator,
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

/// Owned snapshot of a worktree for API consumers
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeSnapshot {
    /// Repository name
    pub repo_name: String,
    /// Absolute path to the git common directory
    pub repo_path: String,
    /// Worktree name
    pub name: String,
    /// Absolute path to the worktree
    pub path: String,
    /// Branch name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// Whether this is the main working tree
    pub is_main: bool,
    /// Linked agent target
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_target: Option<String>,
    /// Status of the linked agent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_status: Option<String>,
    /// Whether this worktree has uncommitted changes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dirty: Option<bool>,
    /// Diff statistics vs base branch
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_summary: Option<DiffSummarySnapshot>,
    /// Whether an agent is pending detection (recently spawned, not yet linked)
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub agent_pending: bool,
}

/// Diff statistics snapshot for API consumers
#[derive(Debug, Clone, Serialize)]
pub struct DiffSummarySnapshot {
    /// Number of files changed
    pub files_changed: usize,
    /// Number of lines inserted
    pub insertions: usize,
    /// Number of lines deleted
    pub deletions: usize,
}

impl WorktreeSnapshot {
    /// Build from state types
    pub fn from_detail(
        repo_name: &str,
        repo_path: &str,
        detail: &crate::state::WorktreeDetail,
    ) -> Self {
        Self {
            repo_name: repo_name.to_string(),
            repo_path: repo_path.to_string(),
            name: detail.name.clone(),
            path: detail.path.clone(),
            branch: detail.branch.clone(),
            is_main: detail.is_main,
            agent_target: detail.agent_target.clone(),
            agent_status: detail.agent_status.as_ref().map(|s| s.phase().to_string()),
            is_dirty: detail.is_dirty,
            diff_summary: detail.diff_summary.as_ref().map(|ds| DiffSummarySnapshot {
                files_changed: ds.files_changed,
                insertions: ds.insertions,
                deletions: ds.deletions,
            }),
            agent_pending: detail.agent_pending,
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

        assert_eq!(snapshot.id.len(), 8); // stable UUID short hash
        assert_eq!(snapshot.pane_id, "main:0.0");
        assert_eq!(snapshot.target, "main:0.0");
        assert!(matches!(snapshot.agent_type, AgentType::ClaudeCode));
        assert!(matches!(snapshot.status, AgentStatus::Idle));
        assert_eq!(snapshot.pid, 1234);
        assert_eq!(snapshot.context_warning, Some(15));
        assert_eq!(snapshot.display_name, "main:0.0");
        assert!(!snapshot.needs_attention());
    }

    #[test]
    fn test_agent_snapshot_phase_and_detail() {
        use crate::agents::{Activity, Detail, Phase};

        let mut agent = test_agent("main:0.0");
        agent.status = AgentStatus::Processing {
            activity: Activity::ToolExecution {
                tool_name: "Bash".to_string(),
            },
        };
        let snapshot = AgentSnapshot::from_agent(&agent);
        assert_eq!(snapshot.phase, Phase::Working);
        assert_eq!(
            snapshot.detail,
            Detail::ToolExecution {
                tool_name: "Bash".to_string()
            }
        );

        agent.status = AgentStatus::Idle;
        let snapshot = AgentSnapshot::from_agent(&agent);
        assert_eq!(snapshot.phase, Phase::Idle);
        assert_eq!(snapshot.detail, Detail::Idle);

        agent.status = AgentStatus::AwaitingApproval {
            approval_type: crate::agents::ApprovalCategory::ShellCommand,
            details: "ls".to_string(),
            interaction: None,
        };
        let snapshot = AgentSnapshot::from_agent(&agent);
        assert_eq!(snapshot.phase, Phase::Blocked);

        // Verify phase is serialized in JSON
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(json.contains("\"phase\":\"Blocked\""));
    }

    #[test]
    fn test_agent_snapshot_needs_attention() {
        let mut agent = test_agent("main:0.1");
        agent.status = AgentStatus::AwaitingApproval {
            approval_type: crate::agents::ApprovalCategory::FileEdit,
            details: "edit foo.rs".to_string(),
            interaction: None,
        };

        let snapshot = AgentSnapshot::from_agent(&agent);
        assert!(snapshot.needs_attention());
    }

    #[test]
    fn test_agent_snapshot_cursor_fields() {
        let mut agent = test_agent("main:0.0");
        agent.cursor_x = Some(42);
        agent.cursor_y = Some(10);

        let snapshot = AgentSnapshot::from_agent(&agent);
        assert_eq!(snapshot.cursor_x, Some(42));
        assert_eq!(snapshot.cursor_y, Some(10));

        // Verify JSON serialization includes cursor when present
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(json.contains("\"cursor_x\":42"));
        assert!(json.contains("\"cursor_y\":10"));

        // Verify cursor is omitted from JSON when None
        let agent_no_cursor = test_agent("main:0.1");
        let snap_no_cursor = AgentSnapshot::from_agent(&agent_no_cursor);
        let json_no_cursor = serde_json::to_string(&snap_no_cursor).unwrap();
        assert!(!json_no_cursor.contains("cursor_x"));
        assert!(!json_no_cursor.contains("cursor_y"));
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

    #[test]
    fn test_action_origin_constructors() {
        let webui = ActionOrigin::webui();
        assert_eq!(
            webui,
            ActionOrigin::Human {
                interface: "webui".to_string()
            }
        );

        let tui = ActionOrigin::tui();
        assert_eq!(
            tui,
            ActionOrigin::Human {
                interface: "tui".to_string()
            }
        );

        let agent = ActionOrigin::agent("main:0.0", false);
        assert_eq!(
            agent,
            ActionOrigin::Agent {
                id: "main:0.0".to_string(),
                is_orchestrator: false,
            }
        );

        let system = ActionOrigin::system("auto_cleanup");
        assert_eq!(
            system,
            ActionOrigin::System {
                subsystem: "auto_cleanup".to_string()
            }
        );
    }

    #[test]
    fn test_action_origin_labels() {
        assert_eq!(ActionOrigin::webui().label(), "Human (webui)");
        assert_eq!(
            ActionOrigin::agent("orch:0.0", true).label(),
            "Orchestrator (orch:0.0)"
        );
        assert_eq!(
            ActionOrigin::agent("worker:0.1", false).label(),
            "Agent (worker:0.1)"
        );
        assert_eq!(
            ActionOrigin::system("pr_monitor").label(),
            "System (pr_monitor)"
        );
    }

    #[test]
    fn test_action_origin_serde_roundtrip() {
        let origins = vec![
            ActionOrigin::webui(),
            ActionOrigin::agent("main:0.0", true),
            ActionOrigin::system("auto_cleanup"),
        ];

        for origin in origins {
            let json = serde_json::to_string(&origin).unwrap();
            let deserialized: ActionOrigin = serde_json::from_str(&json).unwrap();
            assert_eq!(origin, deserialized);
        }
    }

    #[test]
    fn test_action_origin_json_format() {
        let origin = ActionOrigin::webui();
        let json = serde_json::to_value(&origin).unwrap();
        assert_eq!(json["kind"], "Human");
        assert_eq!(json["interface"], "webui");

        let origin = ActionOrigin::agent("main:0.0", true);
        let json = serde_json::to_value(&origin).unwrap();
        assert_eq!(json["kind"], "Agent");
        assert_eq!(json["id"], "main:0.0");
        assert_eq!(json["is_orchestrator"], true);
    }
}
