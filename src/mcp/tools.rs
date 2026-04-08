//! MCP tool definitions for tmai.
//!
//! Each tool wraps a call to the tmai HTTP API and returns the result
//! as formatted text for the LLM consumer.

use rmcp::handler::server::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::{schemars, tool, tool_router};

use super::client::{format_json, TmaiHttpClient};

/// tmai MCP Server — exposes agent management, GitHub, and worktree tools
#[derive(Debug)]
pub struct TmaiMcpServer {
    pub tool_router: ToolRouter<Self>,
    client: TmaiHttpClient,
}

impl TmaiMcpServer {
    /// Create a new server connected to the running tmai instance
    pub fn new(client: TmaiHttpClient) -> Self {
        Self {
            tool_router: Self::tool_router(),
            client,
        }
    }

    /// Validate that the target agent belongs to the MCP client's project.
    ///
    /// Delegates to the backend's `validate-project` endpoint which uses
    /// `normalize_git_dir()` for consistent comparison. Returns an error message
    /// if the agent belongs to a different project. Returns None if validation
    /// passes or cannot be determined (fail-open).
    fn validate_project_scope(&self, agent_id: &str) -> Option<String> {
        use super::client::ValidateError;

        let project_git_dir = match self.client.resolve_git_common_dir() {
            Ok(dir) => dir,
            Err(_) => return None, // Cannot determine project context — allow
        };
        let path = format!("/agents/{}/validate-project", agent_id);
        let body = serde_json::json!({ "project": project_git_dir });
        match self.client.post_with_error_body(&path, &body) {
            Ok(_) => None, // 200 OK — validation passed
            Err(ValidateError::HttpError { status: 403 }) => Some(format!(
                "Error: agent {} belongs to a different project. \
                 Cross-project operations are not allowed.",
                agent_id
            )),
            Err(ValidateError::HttpError { status: 404 }) => {
                None // Agent not found — let the action endpoint handle it
            }
            Err(_) => None, // Other errors — fail-open
        }
    }
}

// =========================================================
// Parameter types
// =========================================================

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct EmptyParams {}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListAgentsParams {
    /// Filter by project path (git_common_dir). Defaults to the MCP client's own project context.
    /// Set to "*" to list agents from all projects.
    #[serde(default)]
    pub project: Option<String>,
    /// Filter by phase: "working", "blocked", "idle", "offline" (optional, returns all if omitted)
    #[serde(default)]
    pub phase: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AgentIdParams {
    /// Agent ID — accepts stable ID (e.g., "a1b2c3d4"), pane target (e.g., "main:0.0"), or PTY session UUID
    pub id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SendTextParams {
    /// Agent ID — accepts stable ID, pane target, or PTY session UUID
    pub id: String,
    /// Text to send to the agent
    pub text: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SendPromptParams {
    /// Agent ID — accepts stable ID, pane target, or PTY session UUID
    pub id: String,
    /// Prompt text to send to the agent
    pub prompt: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SendKeyParams {
    /// Agent ID — accepts stable ID, pane target, or PTY session UUID
    pub id: String,
    /// Key name (Enter, Escape, Space, Up, Down, Left, Right, Tab, BTab, BSpace)
    pub key: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SelectChoiceParams {
    /// Agent ID — accepts stable ID, pane target, or PTY session UUID
    pub id: String,
    /// Choice index (1-based)
    pub index: u32,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RepoParams {
    /// Repository path (optional, defaults to first registered project)
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct BranchParams {
    /// Branch name
    pub branch: String,
    /// Repository path (optional, defaults to first registered project)
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct PrNumberParams {
    /// Pull request number
    pub pr_number: u32,
    /// Repository path (optional, defaults to first registered project)
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SpawnAgentParams {
    /// Working directory for the agent
    pub directory: String,
    /// Initial prompt to send after the agent starts (optional)
    #[serde(default)]
    pub prompt: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SpawnWorktreeParams {
    /// Worktree name (optional if issue_number is provided — auto-generated from issue title)
    #[serde(default)]
    pub name: Option<String>,
    /// GitHub issue number. When provided: auto-generates worktree name from issue title
    /// (if name is omitted) and composes a resolve prompt with the issue context.
    #[serde(default)]
    pub issue_number: Option<u64>,
    /// Repository path (optional, defaults to cwd or first registered project)
    #[serde(default)]
    pub repo: Option<String>,
    /// Base branch to fork from (defaults to main)
    #[serde(default)]
    pub base_branch: Option<String>,
    /// Initial prompt to send after the agent starts (optional)
    #[serde(default)]
    pub prompt: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct WorktreeDeleteParams {
    /// Worktree name (e.g., "174-feat-integrate-permissiondenied-hook")
    pub worktree_name: String,
    /// Repository path (optional, defaults to cwd or first registered project)
    #[serde(default)]
    pub repo: Option<String>,
    /// Force delete even if worktree has uncommitted changes
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DispatchIssueParams {
    /// GitHub issue number to dispatch
    pub issue_number: u64,
    /// Repository path (optional, defaults to cwd or first registered project)
    #[serde(default)]
    pub repo: Option<String>,
    /// Base branch to fork from (defaults to main)
    #[serde(default)]
    pub base_branch: Option<String>,
    /// Extra instructions appended after the auto-generated issue prompt
    #[serde(default)]
    pub additional_instructions: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SetOrchestratorParams {
    /// Agent ID — accepts stable ID, pane target, or PTY session UUID
    pub id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SpawnOrchestratorParams {
    /// Working directory (optional, defaults to first registered project or cwd)
    #[serde(default)]
    pub cwd: Option<String>,
    /// Additional instructions appended to the composed orchestrator prompt
    #[serde(default)]
    pub additional_instructions: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct MergePrParams {
    /// Pull request number to merge
    pub pr_number: u32,
    /// Merge method: "squash" (default), "merge", or "rebase"
    #[serde(default = "default_merge_method")]
    pub method: String,
    /// Delete remote branch after merge (default: true)
    #[serde(default = "default_true")]
    pub delete_branch: bool,
    /// Clean up associated worktree after merge (default: false)
    #[serde(default)]
    pub delete_worktree: bool,
    /// Worktree name to clean up (auto-detected from branch if omitted)
    #[serde(default)]
    pub worktree_name: Option<String>,
    /// Repository path (optional, defaults to first registered project)
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ReviewPrParams {
    /// Pull request number to review
    pub pr_number: u32,
    /// Review action: "approve", "request_changes", or "comment"
    pub action: String,
    /// Review body text / summary (optional)
    #[serde(default)]
    pub body: Option<String>,
    /// Repository path (optional, defaults to first registered project)
    #[serde(default)]
    pub repo: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RunFlowParams {
    /// Flow name (e.g., "feature", "hotfix")
    pub flow: String,
    /// Entry parameters as JSON key-value pairs (e.g., {"issue_number": 42})
    #[serde(default)]
    pub params: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListFlowsParams {}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListFlowRunsParams {
    /// Filter by status: "running", "completed", "error" (optional, returns all if omitted)
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CancelFlowParams {
    /// Flow run ID to cancel
    pub run_id: String,
}

fn default_merge_method() -> String {
    "squash".to_string()
}

fn default_true() -> bool {
    true
}

// =========================================================
// Tool implementations
// =========================================================

#[tool_router]
impl TmaiMcpServer {
    // ----- Agent Queries -----

    /// List monitored AI agents scoped to the current project. By default, only agents belonging
    /// to the same git repository as the MCP client are shown. Pass project="*" to list all agents.
    /// Optionally filter by phase (working, blocked, idle, offline) for orchestrator decision-making.
    #[tool(
        description = "List monitored AI agents (scoped to current project by default). Filter by phase: working, blocked, idle, offline."
    )]
    fn list_agents(&self, Parameters(p): Parameters<ListAgentsParams>) -> String {
        let project = match &p.project {
            Some(proj) if proj == "*" => None,
            Some(proj) => Some(proj.clone()),
            None => self.client.resolve_git_common_dir().ok(),
        };
        let path = match &project {
            Some(proj) => format!("/agents?project={}", encode(proj)),
            None => "/agents".to_string(),
        };
        // Phase filtering needs access to the parsed JSON, so we can't use get_json_or_error
        if p.phase.is_none() {
            return self.client.get_json_or_error(&path);
        }
        match self.client.get::<serde_json::Value>(&path) {
            Ok(agents) => {
                let lower = p.phase.as_ref().unwrap().to_ascii_lowercase();
                if let Some(arr) = agents.as_array() {
                    let filtered: Vec<&serde_json::Value> = arr
                        .iter()
                        .filter(|a| {
                            a.get("phase")
                                .and_then(|v| v.as_str())
                                .is_some_and(|p| p.to_ascii_lowercase() == lower)
                        })
                        .collect();
                    return format_json(&serde_json::Value::Array(
                        filtered.into_iter().cloned().collect(),
                    ));
                }
                format_json(&agents)
            }
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get detailed information about a specific agent including its status, working directory, git branch, and connection channels.
    /// Only agents within the same project scope are accessible.
    #[tool(description = "Get detailed info about a specific agent")]
    fn get_agent(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        match self.client.get::<serde_json::Value>("/agents") {
            Ok(data) => {
                if let Some(agents) = data.as_array() {
                    // Search by stable id (primary), pane_id, target, or pty_session_id
                    if let Some(agent) = agents.iter().find(|a| {
                        a.get("id").and_then(|v| v.as_str()) == Some(&p.id)
                            || a.get("pane_id").and_then(|v| v.as_str()) == Some(&p.id)
                            || a.get("target").and_then(|v| v.as_str()) == Some(&p.id)
                            || a.get("pty_session_id").and_then(|v| v.as_str()) == Some(&p.id)
                    }) {
                        return format_json(agent);
                    }
                }
                format!("Agent not found: {}", p.id)
            }
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get the plain-text terminal output of an agent. Only agents within the same project scope are accessible.
    #[tool(description = "Get the terminal output of an agent")]
    fn get_agent_output(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        self.client
            .get_text_or_error(&format!("/agents/{}/output", p.id))
    }

    /// Get the conversation transcript of an agent (parsed from JSONL session log).
    /// Only agents within the same project scope are accessible.
    #[tool(description = "Get the conversation transcript of an agent")]
    fn get_transcript(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        self.client
            .get_json_or_error(&format!("/agents/{}/transcript", p.id))
    }

    // ----- Agent Actions -----

    /// Approve a pending permission request for an agent (equivalent to pressing 'y').
    /// Only agents within the same project scope can be approved.
    #[tool(description = "Approve a pending permission request for an agent")]
    fn approve(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        self.client.post_ok_or_error(
            &format!("/agents/{}/approve", p.id),
            &serde_json::json!({}),
            format!("Approved agent {}", p.id),
        )
    }

    /// Send text input to an agent (like typing in the terminal). Use this to send prompts or commands.
    /// Only agents within the same project scope can receive text.
    #[tool(description = "Send text input to an agent")]
    fn send_text(&self, Parameters(p): Parameters<SendTextParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        self.client.post_ok_or_error(
            &format!("/agents/{}/input", p.id),
            &serde_json::json!({"text": p.text}),
            format!("Sent text to agent {}", p.id),
        )
    }

    /// Send a prompt to an agent with status-aware delivery. If the agent is idle, the prompt is
    /// sent immediately. If the agent is processing, the prompt is queued (max 5) and delivered
    /// automatically when the agent becomes idle. If the agent is stopped/offline, the prompt is
    /// sent to restart it. Only agents within the same project scope can receive prompts.
    #[tool(description = "Send a prompt to an agent (queues if busy, delivers when idle)")]
    fn send_prompt(&self, Parameters(p): Parameters<SendPromptParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        match self.client.post::<serde_json::Value>(
            &format!("/agents/{}/prompt", p.id),
            &serde_json::json!({"prompt": p.prompt}),
        ) {
            Ok(data) => {
                let action = data
                    .get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let queue_size = data.get("queue_size").and_then(|v| v.as_u64()).unwrap_or(0);
                match action {
                    "sent" => format!("Prompt sent to agent {} (idle)", p.id),
                    "sent_restart" => {
                        format!("Prompt sent to agent {} (restarting from stopped)", p.id)
                    }
                    "queued" => format!(
                        "Prompt queued for agent {} (queue position: {})",
                        p.id, queue_size
                    ),
                    _ => format!("Prompt action '{}' for agent {}", action, p.id),
                }
            }
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Send a special key to an agent (Enter, Escape, Space, Up, Down, Left, Right, Tab).
    /// Only agents within the same project scope can receive keys.
    #[tool(description = "Send a special key to an agent")]
    fn send_key(&self, Parameters(p): Parameters<SendKeyParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        self.client.post_ok_or_error(
            &format!("/agents/{}/key", p.id),
            &serde_json::json!({"key": p.key}),
            format!("Sent key '{}' to agent {}", p.key, p.id),
        )
    }

    /// Select a numbered choice for an agent's AskUserQuestion prompt (1-based index).
    /// Only agents within the same project scope can be interacted with.
    #[tool(description = "Select a choice for an agent's question")]
    fn select_choice(&self, Parameters(p): Parameters<SelectChoiceParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        self.client.post_ok_or_error(
            &format!("/agents/{}/select", p.id),
            &serde_json::json!({"index": p.index}),
            format!("Selected choice {} for agent {}", p.index, p.id),
        )
    }

    /// Kill (terminate) an agent. Works for both PTY-spawned and tmux-managed agents.
    /// Only agents within the same project scope can be killed.
    #[tool(description = "Kill (terminate) an agent by ID")]
    fn kill_agent(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        if let Some(err) = self.validate_project_scope(&p.id) {
            return err;
        }
        self.client.delete_ok_or_error(
            &format!("/agents/{}", p.id),
            format!("Killed agent {}", p.id),
        )
    }

    // ----- Team Queries -----

    /// List all Claude Code Agent Teams with their member count and task progress.
    #[tool(description = "List all agent teams")]
    fn list_teams(&self, Parameters(_): Parameters<EmptyParams>) -> String {
        self.client.get_json_or_error("/teams")
    }

    // ----- Worktree Management -----

    /// List all git worktrees with their linked agents, branch names, and diff statistics.
    #[tool(description = "List all git worktrees")]
    fn list_worktrees(&self, Parameters(_): Parameters<EmptyParams>) -> String {
        self.client.get_json_or_error("/worktrees")
    }

    /// Spawn a new AI agent (Claude Code) in a specified directory.
    #[tool(description = "Spawn a new AI agent in a directory")]
    fn spawn_agent(&self, Parameters(p): Parameters<SpawnAgentParams>) -> String {
        let mut body = serde_json::json!({"directory": p.directory});
        if let Some(prompt) = &p.prompt {
            body["initial_prompt"] = serde_json::json!(prompt);
        }
        self.client.post_json_or_error("/spawn", &body)
    }

    /// Create a new git worktree and spawn an AI agent in it. Ideal for isolated feature work.
    /// When issue_number is provided, the worktree name is auto-generated from the issue title
    /// and a resolve prompt with issue context is composed automatically.
    #[tool(description = "Create a worktree and spawn an agent in it")]
    fn spawn_worktree(&self, Parameters(p): Parameters<SpawnWorktreeParams>) -> String {
        if p.name.is_none() && p.issue_number.is_none() {
            return "Error: either 'name' or 'issue_number' must be provided".to_string();
        }
        let cwd = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        let mut body = serde_json::json!({"cwd": cwd});
        if let Some(name) = &p.name {
            body["name"] = serde_json::json!(name);
        }
        if let Some(issue_number) = p.issue_number {
            body["issue_number"] = serde_json::json!(issue_number);
        }
        if let Some(base) = &p.base_branch {
            body["base_branch"] = serde_json::json!(base);
        }
        if let Some(prompt) = &p.prompt {
            body["initial_prompt"] = serde_json::json!(prompt);
        }
        self.client.post_json_or_error("/spawn/worktree", &body)
    }

    /// Spawn an orchestrator agent with a composed prompt from the [orchestrator] config settings.
    /// The orchestrator coordinates work across sub-agents using tmai MCP tools.
    #[tool(description = "Spawn an orchestrator agent with workflow settings from config")]
    fn spawn_orchestrator(&self, Parameters(p): Parameters<SpawnOrchestratorParams>) -> String {
        let mut body = serde_json::json!({});
        if let Some(ref cwd) = p.cwd {
            body["cwd"] = serde_json::json!(cwd);
        }
        if let Some(ref extra) = p.additional_instructions {
            body["additional_instructions"] = serde_json::json!(extra);
        }
        self.client.post_json_or_error("/orchestrator/spawn", &body)
    }

    /// Mark an existing running agent as the orchestrator for its project.
    /// Any previous orchestrator for the same project is automatically demoted.
    /// Use this to re-register yourself as orchestrator after /resume.
    #[tool(description = "Mark an existing agent as orchestrator (e.g. after /resume recovery)")]
    fn set_orchestrator(&self, Parameters(p): Parameters<SetOrchestratorParams>) -> String {
        self.client.post_ok_or_error(
            &format!("/agents/{}/set-orchestrator", p.id),
            &serde_json::json!({}),
            format!("Agent {} is now the orchestrator", p.id),
        )
    }

    /// One-shot issue dispatch: fetch a GitHub issue, create a worktree, and spawn an agent
    /// with the issue context as its prompt — all in a single call.
    #[tool(
        description = "Dispatch a GitHub issue: fetch issue, create worktree, spawn agent with issue context"
    )]
    fn dispatch_issue(&self, Parameters(p): Parameters<DispatchIssueParams>) -> String {
        let cwd = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        let mut body = serde_json::json!({
            "cwd": cwd,
            "issue_number": p.issue_number,
        });
        if let Some(base) = &p.base_branch {
            body["base_branch"] = serde_json::json!(base);
        }
        if let Some(extra) = &p.additional_instructions {
            body["additional_instructions"] = serde_json::json!(extra);
        }
        self.client.post_json_or_error("/spawn/worktree", &body)
    }

    /// Delete a git worktree by name.
    #[tool(description = "Delete a git worktree")]
    fn delete_worktree(&self, Parameters(p): Parameters<WorktreeDeleteParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        // The API expects repo_path pointing to the .git directory
        let repo_path = if repo.ends_with(".git") {
            repo.clone()
        } else {
            format!("{}/.git", repo)
        };
        self.client.post_ok_or_error(
            "/worktrees/delete",
            &serde_json::json!({
                "repo_path": repo_path,
                "worktree_name": p.worktree_name,
                "force": p.force
            }),
            format!("Deleted worktree: {}", p.worktree_name),
        )
    }

    // ----- GitHub -----

    /// List open pull requests for the current repository with CI status and review state.
    #[tool(description = "List open pull requests")]
    fn list_prs(&self, Parameters(p): Parameters<RepoParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client
            .get_json_or_error(&format!("/github/prs?repo={}", encode(&repo)))
    }

    /// List open issues for the current repository.
    #[tool(description = "List open issues")]
    fn list_issues(&self, Parameters(p): Parameters<RepoParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client
            .get_json_or_error(&format!("/github/issues?repo={}", encode(&repo)))
    }

    /// Get CI check results for a branch.
    #[tool(description = "Get CI check results for a branch")]
    fn get_ci_status(&self, Parameters(p): Parameters<BranchParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client.get_json_or_error(&format!(
            "/github/checks?branch={}&repo={}",
            encode(&p.branch),
            encode(&repo)
        ))
    }

    /// Get comments and reviews on a pull request.
    #[tool(description = "Get PR comments and reviews")]
    fn get_pr_comments(&self, Parameters(p): Parameters<PrNumberParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client.get_json_or_error(&format!(
            "/github/pr/comments?pr={}&repo={}",
            p.pr_number,
            encode(&repo)
        ))
    }

    /// Get the merge status of a pull request (mergeable, CI status, review decision).
    #[tool(description = "Get PR merge status")]
    fn get_pr_merge_status(&self, Parameters(p): Parameters<PrNumberParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client.get_json_or_error(&format!(
            "/github/pr/merge-status?pr={}&repo={}",
            p.pr_number,
            encode(&repo)
        ))
    }

    /// Get the CI failure log for debugging a failed check.
    #[tool(description = "Get CI failure log for a branch")]
    fn get_ci_failure_log(&self, Parameters(p): Parameters<BranchParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client.get_text_or_error(&format!(
            "/github/ci/failure-log?branch={}&repo={}",
            encode(&p.branch),
            encode(&repo)
        ))
    }

    /// Rerun failed CI checks for a branch.
    #[tool(description = "Rerun failed CI checks")]
    fn rerun_ci(&self, Parameters(p): Parameters<BranchParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client.post_ok_or_error(
            "/github/ci/rerun",
            &serde_json::json!({"branch": p.branch, "repo": repo}),
            format!("Rerunning failed checks for branch: {}", p.branch),
        )
    }

    /// Submit a review on a pull request (approve, request changes, or comment).
    #[tool(description = "Review a pull request — approve, request changes, or post a comment")]
    fn review_pr(&self, Parameters(p): Parameters<ReviewPrParams>) -> String {
        if !["approve", "request_changes", "comment"].contains(&p.action.as_str()) {
            return format!(
                "Error: invalid action '{}' — must be approve, request_changes, or comment",
                p.action
            );
        }
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        let body = serde_json::json!({
            "repo": repo,
            "pr_number": p.pr_number,
            "action": p.action,
            "body": p.body,
        });
        self.client.post_json_or_error("/github/pr/review", &body)
    }

    /// Merge a pull request. Checks CI status and mergeability before merging.
    /// Optionally cleans up the remote branch and associated worktree after merge.
    #[tool(
        description = "Merge a pull request (checks CI first, then squash/merge/rebase with optional branch and worktree cleanup)"
    )]
    fn merge_pr(&self, Parameters(p): Parameters<MergePrParams>) -> String {
        if !["squash", "merge", "rebase"].contains(&p.method.as_str()) {
            return format!(
                "Error: invalid merge method '{}' — must be squash, merge, or rebase",
                p.method
            );
        }
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        let body = serde_json::json!({
            "repo": repo,
            "pr_number": p.pr_number,
            "method": p.method,
            "delete_branch": p.delete_branch,
            "delete_worktree": p.delete_worktree,
            "worktree_name": p.worktree_name,
        });
        self.client.post_json_or_error("/github/pr/merge", &body)
    }

    // ----- Git -----

    /// List git branches in the repository.
    #[tool(description = "List git branches")]
    fn list_branches(&self, Parameters(p): Parameters<RepoParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client
            .get_json_or_error(&format!("/git/branches?repo={}", encode(&repo)))
    }

    /// Get the diff statistics for a branch compared to its base.
    #[tool(description = "Get diff stats for a branch")]
    fn git_diff_stat(&self, Parameters(p): Parameters<BranchParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        self.client.get_json_or_error(&format!(
            "/git/diff-stat?branch={}&repo={}",
            encode(&p.branch),
            encode(&repo)
        ))
    }

    // ----- Flow Orchestration -----

    /// Start a named flow (e.g., "feature", "hotfix"). The flow engine handles
    /// the node chain automatically — spawning agents, routing on stop events,
    /// and merging PRs based on the flow definition in config.toml.
    #[tool(
        description = "Start a named flow (e.g., run_flow(flow='feature', params={issue_number: 42}))"
    )]
    fn run_flow(&self, Parameters(p): Parameters<RunFlowParams>) -> String {
        let body = serde_json::json!({
            "flow": p.flow,
            "params": p.params,
        });
        self.client.post_json_or_error("/flow/run", &body)
    }

    /// List all available flow definitions configured in config.toml.
    /// Shows flow name, description, entry parameters, and node chain.
    #[tool(description = "List available flow definitions")]
    fn list_flows(&self, Parameters(_p): Parameters<ListFlowsParams>) -> String {
        self.client.get_json_or_error("/flow/list")
    }

    /// List active and completed flow runs. Optionally filter by status.
    #[tool(description = "List flow runs (active and completed)")]
    fn list_flow_runs(&self, Parameters(p): Parameters<ListFlowRunsParams>) -> String {
        let query = p
            .status
            .as_ref()
            .map(|s| format!("?status={s}"))
            .unwrap_or_default();
        self.client.get_json_or_error(&format!("/flow/runs{query}"))
    }

    /// Cancel an active flow run. The current agent is not killed but the flow
    /// stops advancing to subsequent nodes.
    #[tool(description = "Cancel an active flow run")]
    fn cancel_flow(&self, Parameters(p): Parameters<CancelFlowParams>) -> String {
        let body = serde_json::json!({"run_id": p.run_id});
        self.client.post_ok_or_error(
            "/flow/cancel",
            &body,
            format!("Flow run {} cancelled", p.run_id),
        )
    }
}

/// URL-encode a string for query parameters
fn encode(s: &str) -> String {
    s.replace('%', "%25")
        .replace(' ', "%20")
        .replace('#', "%23")
        .replace('&', "%26")
        .replace('=', "%3D")
        .replace('+', "%2B")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_agents_params_empty() {
        let json = serde_json::json!({});
        let p: ListAgentsParams = serde_json::from_value(json).unwrap();
        assert!(p.project.is_none());
    }

    #[test]
    fn list_agents_params_with_project() {
        let json = serde_json::json!({"project": "/home/user/project-a/.git"});
        let p: ListAgentsParams = serde_json::from_value(json).unwrap();
        assert_eq!(p.project.as_deref(), Some("/home/user/project-a/.git"));
    }

    #[test]
    fn list_agents_params_wildcard() {
        let json = serde_json::json!({"project": "*"});
        let p: ListAgentsParams = serde_json::from_value(json).unwrap();
        assert_eq!(p.project.as_deref(), Some("*"));
    }

    #[test]
    fn spawn_orchestrator_params_empty() {
        let json = serde_json::json!({});
        let p: SpawnOrchestratorParams = serde_json::from_value(json).unwrap();
        assert!(p.cwd.is_none());
        assert!(p.additional_instructions.is_none());
    }

    #[test]
    fn spawn_orchestrator_params_all_fields() {
        let json = serde_json::json!({
            "cwd": "/tmp/project",
            "additional_instructions": "Focus on issue #42"
        });
        let p: SpawnOrchestratorParams = serde_json::from_value(json).unwrap();
        assert_eq!(p.cwd.as_deref(), Some("/tmp/project"));
        assert_eq!(
            p.additional_instructions.as_deref(),
            Some("Focus on issue #42")
        );
    }

    #[test]
    fn dispatch_issue_params_required_only() {
        let json = serde_json::json!({"issue_number": 42});
        let p: DispatchIssueParams = serde_json::from_value(json).unwrap();
        assert_eq!(p.issue_number, 42);
        assert!(p.repo.is_none());
        assert!(p.base_branch.is_none());
        assert!(p.additional_instructions.is_none());
    }

    #[test]
    fn dispatch_issue_params_all_fields() {
        let json = serde_json::json!({
            "issue_number": 99,
            "repo": "/tmp/repo",
            "base_branch": "develop",
            "additional_instructions": "Use TDD"
        });
        let p: DispatchIssueParams = serde_json::from_value(json).unwrap();
        assert_eq!(p.issue_number, 99);
        assert_eq!(p.repo.as_deref(), Some("/tmp/repo"));
        assert_eq!(p.base_branch.as_deref(), Some("develop"));
        assert_eq!(p.additional_instructions.as_deref(), Some("Use TDD"));
    }

    #[test]
    fn dispatch_issue_params_missing_issue_number_fails() {
        let json = serde_json::json!({"repo": "/tmp/repo"});
        assert!(serde_json::from_value::<DispatchIssueParams>(json).is_err());
    }

    #[test]
    fn merge_pr_params_defaults() {
        let json = serde_json::json!({"pr_number": 42});
        let p: MergePrParams = serde_json::from_value(json).unwrap();
        assert_eq!(p.pr_number, 42);
        assert_eq!(p.method, "squash");
        assert!(p.delete_branch);
        assert!(!p.delete_worktree);
        assert!(p.worktree_name.is_none());
        assert!(p.repo.is_none());
    }

    #[test]
    fn merge_pr_params_all_fields() {
        let json = serde_json::json!({
            "pr_number": 99,
            "method": "rebase",
            "delete_branch": false,
            "delete_worktree": false,
            "worktree_name": "99-feat-something",
            "repo": "/tmp/repo"
        });
        let p: MergePrParams = serde_json::from_value(json).unwrap();
        assert_eq!(p.pr_number, 99);
        assert_eq!(p.method, "rebase");
        assert!(!p.delete_branch);
        assert!(!p.delete_worktree);
        assert_eq!(p.worktree_name.as_deref(), Some("99-feat-something"));
        assert_eq!(p.repo.as_deref(), Some("/tmp/repo"));
    }

    #[test]
    fn merge_pr_params_missing_pr_number_fails() {
        let json = serde_json::json!({"method": "squash"});
        assert!(serde_json::from_value::<MergePrParams>(json).is_err());
    }
}
