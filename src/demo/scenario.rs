use std::time::Duration;

use crate::agents::{AgentStatus, AgentType, ApprovalType};

/// A demo agent definition
pub struct DemoAgent {
    /// tmux-like target identifier
    pub target: String,
    /// Agent type
    pub agent_type: AgentType,
    /// Session name
    pub session: String,
    /// Window index
    pub window_index: u32,
    /// Pane index
    pub pane_index: u32,
    /// Git branch name
    pub git_branch: Option<String>,
    /// Working directory
    pub cwd: String,
}

/// A single event in the demo timeline
pub struct TimelineEvent {
    /// Time offset from scenario start
    pub at: Duration,
    /// Which agent this event applies to (index into agents vec)
    pub agent_idx: usize,
    /// New status for the agent
    pub status: AgentStatus,
    /// Whether to pause timeline for this agent until user action
    pub wait_for_action: bool,
    /// Content key for preview (see content module)
    pub content_key: &'static str,
}

/// Complete demo scenario
pub struct DemoScenario {
    pub agents: Vec<DemoAgent>,
    pub timeline: Vec<TimelineEvent>,
}

/// Build the default demo scenario (~30 seconds, 3 agents)
pub fn default_scenario() -> DemoScenario {
    let agents = vec![
        DemoAgent {
            target: "main:0.0".to_string(),
            agent_type: AgentType::ClaudeCode,
            session: "main".to_string(),
            window_index: 0,
            pane_index: 0,
            git_branch: Some("feat/auth".to_string()),
            cwd: "/home/user/projects/webapp".to_string(),
        },
        DemoAgent {
            target: "main:0.1".to_string(),
            agent_type: AgentType::ClaudeCode,
            session: "main".to_string(),
            window_index: 0,
            pane_index: 1,
            git_branch: Some("fix/tests".to_string()),
            cwd: "/home/user/projects/webapp".to_string(),
        },
        DemoAgent {
            target: "dev:0.0".to_string(),
            agent_type: AgentType::GeminiCli,
            session: "dev".to_string(),
            window_index: 0,
            pane_index: 0,
            git_branch: None,
            cwd: "/home/user/projects/api-server".to_string(),
        },
    ];

    let timeline = vec![
        // t=0s: Agent 0 Processing, Agent 2 Processing
        TimelineEvent {
            at: Duration::from_secs(0),
            agent_idx: 0,
            status: AgentStatus::Processing {
                activity: String::new(),
            },
            wait_for_action: false,
            content_key: "processing_read",
        },
        TimelineEvent {
            at: Duration::from_secs(0),
            agent_idx: 1,
            status: AgentStatus::Idle,
            wait_for_action: false,
            content_key: "idle",
        },
        TimelineEvent {
            at: Duration::from_secs(0),
            agent_idx: 2,
            status: AgentStatus::Processing {
                activity: String::new(),
            },
            wait_for_action: false,
            content_key: "processing_gemini",
        },
        // t=3s: Agent 0 → Approval (FileEdit), wait for user
        TimelineEvent {
            at: Duration::from_secs(3),
            agent_idx: 0,
            status: AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::FileEdit,
                details: "src/auth/middleware.rs".to_string(),
            },
            wait_for_action: true,
            content_key: "approval_file_edit",
        },
        // t=3s: Agent 1 → Processing
        TimelineEvent {
            at: Duration::from_secs(3),
            agent_idx: 1,
            status: AgentStatus::Processing {
                activity: String::new(),
            },
            wait_for_action: false,
            content_key: "processing_test",
        },
        // After user approves Agent 0: Agent 0 → Processing
        // (handled by DemoPoller on action receipt)

        // t=6s: Agent 1 → Approval (ShellCommand), wait for user
        TimelineEvent {
            at: Duration::from_secs(6),
            agent_idx: 1,
            status: AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::ShellCommand,
                details: "cargo test --lib".to_string(),
            },
            wait_for_action: true,
            content_key: "approval_shell_command",
        },
        // t=6s: Agent 2 → Idle
        TimelineEvent {
            at: Duration::from_secs(6),
            agent_idx: 2,
            status: AgentStatus::Idle,
            wait_for_action: false,
            content_key: "idle_gemini",
        },
        // After user approves Agent 1: Agent 1 → Processing

        // t=10s: Agent 0 → Approval (UserQuestion), wait for user
        TimelineEvent {
            at: Duration::from_secs(10),
            agent_idx: 0,
            status: AgentStatus::AwaitingApproval {
                approval_type: ApprovalType::UserQuestion {
                    choices: vec![
                        "JWT with refresh tokens".to_string(),
                        "Session-based auth".to_string(),
                        "OAuth 2.0 integration".to_string(),
                    ],
                    multi_select: false,
                    cursor_position: 1,
                },
                details: "Which authentication strategy should I use?".to_string(),
            },
            wait_for_action: true,
            content_key: "approval_user_question",
        },
        // t=10s: Agent 2 → Processing
        TimelineEvent {
            at: Duration::from_secs(10),
            agent_idx: 2,
            status: AgentStatus::Processing {
                activity: String::new(),
            },
            wait_for_action: false,
            content_key: "processing_gemini_2",
        },
        // After user selects for Agent 0: Agent 0 → Processing

        // t=14s: Agent 1 → Idle
        TimelineEvent {
            at: Duration::from_secs(14),
            agent_idx: 1,
            status: AgentStatus::Idle,
            wait_for_action: false,
            content_key: "idle_tests_pass",
        },
        // t=16s: Agent 0 → Idle
        TimelineEvent {
            at: Duration::from_secs(16),
            agent_idx: 0,
            status: AgentStatus::Idle,
            wait_for_action: false,
            content_key: "idle_auth_done",
        },
        // t=16s: Agent 2 → Idle
        TimelineEvent {
            at: Duration::from_secs(16),
            agent_idx: 2,
            status: AgentStatus::Idle,
            wait_for_action: false,
            content_key: "idle_gemini",
        },
        // t=20s: auto-quit
        TimelineEvent {
            at: Duration::from_secs(20),
            agent_idx: 0,
            status: AgentStatus::Idle, // dummy, triggers quit
            wait_for_action: false,
            content_key: "quit",
        },
    ];

    DemoScenario { agents, timeline }
}
