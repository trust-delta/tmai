//! MCP tool definitions for tmai.
//!
//! Each tool wraps a call to the tmai HTTP API and returns the result
//! as formatted text for the LLM consumer.

use rmcp::handler::server::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::{schemars, tool, tool_router};

use super::client::TmaiHttpClient;

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
}

// =========================================================
// Parameter types
// =========================================================

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct EmptyParams {}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AgentIdParams {
    /// Agent ID (e.g., "main:0.0" or a PTY session ID)
    pub id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SendTextParams {
    /// Agent ID
    pub id: String,
    /// Text to send to the agent
    pub text: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SendPromptParams {
    /// Agent ID
    pub id: String,
    /// Prompt text to send to the agent
    pub prompt: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SendKeyParams {
    /// Agent ID
    pub id: String,
    /// Key name (Enter, Escape, Space, Up, Down, Left, Right, Tab, BTab, BSpace)
    pub key: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SelectChoiceParams {
    /// Agent ID
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
    /// Worktree name
    pub name: String,
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

// =========================================================
// Tool implementations
// =========================================================

#[tool_router]
impl TmaiMcpServer {
    // ----- Agent Queries -----

    /// List all monitored AI agents with their current status, type, working directory, and detection source.
    #[tool(description = "List all monitored AI agents with their status")]
    fn list_agents(&self, Parameters(_): Parameters<EmptyParams>) -> String {
        match self.client.get::<serde_json::Value>("/agents") {
            Ok(agents) => format_json(&agents),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get detailed information about a specific agent including its status, working directory, git branch, and connection channels.
    #[tool(description = "Get detailed info about a specific agent")]
    fn get_agent(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        match self.client.get::<serde_json::Value>("/agents") {
            Ok(data) => {
                if let Some(agents) = data.as_array() {
                    if let Some(agent) = agents.iter().find(|a| {
                        a.get("id").and_then(|v| v.as_str()) == Some(&p.id)
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

    /// Get the plain-text terminal output of an agent. Useful for seeing what the agent is currently displaying.
    #[tool(description = "Get the terminal output of an agent")]
    fn get_agent_output(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        match self.client.get_text(&format!("/agents/{}/output", p.id)) {
            Ok(text) => text,
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get the conversation transcript of an agent (parsed from JSONL session log).
    #[tool(description = "Get the conversation transcript of an agent")]
    fn get_transcript(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        match self
            .client
            .get::<serde_json::Value>(&format!("/agents/{}/transcript", p.id))
        {
            Ok(data) => format_json(&data),
            Err(e) => format!("Error: {e}"),
        }
    }

    // ----- Agent Actions -----

    /// Approve a pending permission request for an agent (equivalent to pressing 'y').
    #[tool(description = "Approve a pending permission request for an agent")]
    fn approve(&self, Parameters(p): Parameters<AgentIdParams>) -> String {
        match self
            .client
            .post_ok(&format!("/agents/{}/approve", p.id), &serde_json::json!({}))
        {
            Ok(()) => format!("Approved agent {}", p.id),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Send text input to an agent (like typing in the terminal). Use this to send prompts or commands.
    #[tool(description = "Send text input to an agent")]
    fn send_text(&self, Parameters(p): Parameters<SendTextParams>) -> String {
        match self.client.post_ok(
            &format!("/agents/{}/input", p.id),
            &serde_json::json!({"text": p.text}),
        ) {
            Ok(()) => format!("Sent text to agent {}", p.id),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Send a prompt to an agent with status-aware delivery. If the agent is idle, the prompt is
    /// sent immediately. If the agent is processing, the prompt is queued (max 5) and delivered
    /// automatically when the agent becomes idle. If the agent is stopped/offline, the prompt is
    /// sent to restart it.
    #[tool(description = "Send a prompt to an agent (queues if busy, delivers when idle)")]
    fn send_prompt(&self, Parameters(p): Parameters<SendPromptParams>) -> String {
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
    #[tool(description = "Send a special key to an agent")]
    fn send_key(&self, Parameters(p): Parameters<SendKeyParams>) -> String {
        match self.client.post_ok(
            &format!("/agents/{}/key", p.id),
            &serde_json::json!({"key": p.key}),
        ) {
            Ok(()) => format!("Sent key '{}' to agent {}", p.key, p.id),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Select a numbered choice for an agent's AskUserQuestion prompt (1-based index).
    #[tool(description = "Select a choice for an agent's question")]
    fn select_choice(&self, Parameters(p): Parameters<SelectChoiceParams>) -> String {
        match self.client.post_ok(
            &format!("/agents/{}/select", p.id),
            &serde_json::json!({"index": p.index}),
        ) {
            Ok(()) => format!("Selected choice {} for agent {}", p.index, p.id),
            Err(e) => format!("Error: {e}"),
        }
    }

    // ----- Team Queries -----

    /// List all Claude Code Agent Teams with their member count and task progress.
    #[tool(description = "List all agent teams")]
    fn list_teams(&self, Parameters(_): Parameters<EmptyParams>) -> String {
        match self.client.get::<serde_json::Value>("/teams") {
            Ok(teams) => format_json(&teams),
            Err(e) => format!("Error: {e}"),
        }
    }

    // ----- Worktree Management -----

    /// List all git worktrees with their linked agents, branch names, and diff statistics.
    #[tool(description = "List all git worktrees")]
    fn list_worktrees(&self, Parameters(_): Parameters<EmptyParams>) -> String {
        match self.client.get::<serde_json::Value>("/worktrees") {
            Ok(wt) => format_json(&wt),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Spawn a new AI agent (Claude Code) in a specified directory.
    #[tool(description = "Spawn a new AI agent in a directory")]
    fn spawn_agent(&self, Parameters(p): Parameters<SpawnAgentParams>) -> String {
        let mut body = serde_json::json!({"directory": p.directory});
        if let Some(prompt) = &p.prompt {
            body["initial_prompt"] = serde_json::json!(prompt);
        }
        match self.client.post::<serde_json::Value>("/spawn", &body) {
            Ok(data) => format_json(&data),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Create a new git worktree and spawn an AI agent in it. Ideal for isolated feature work.
    #[tool(description = "Create a worktree and spawn an agent in it")]
    fn spawn_worktree(&self, Parameters(p): Parameters<SpawnWorktreeParams>) -> String {
        let cwd = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        let mut body = serde_json::json!({"name": p.name, "cwd": cwd});
        if let Some(base) = &p.base_branch {
            body["base_branch"] = serde_json::json!(base);
        }
        if let Some(prompt) = &p.prompt {
            body["initial_prompt"] = serde_json::json!(prompt);
        }
        match self
            .client
            .post::<serde_json::Value>("/spawn/worktree", &body)
        {
            Ok(data) => format_json(&data),
            Err(e) => format!("Error: {e}"),
        }
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
        match self.client.post_ok(
            "/worktrees/delete",
            &serde_json::json!({
                "repo_path": repo_path,
                "worktree_name": p.worktree_name,
                "force": p.force
            }),
        ) {
            Ok(()) => format!("Deleted worktree: {}", p.worktree_name),
            Err(e) => format!("Error: {e}"),
        }
    }

    // ----- GitHub -----

    /// List open pull requests for the current repository with CI status and review state.
    #[tool(description = "List open pull requests")]
    fn list_prs(&self, Parameters(p): Parameters<RepoParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self
            .client
            .get::<serde_json::Value>(&format!("/github/prs?repo={}", encode(&repo)))
        {
            Ok(prs) => format_json(&prs),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// List open issues for the current repository.
    #[tool(description = "List open issues")]
    fn list_issues(&self, Parameters(p): Parameters<RepoParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self
            .client
            .get::<serde_json::Value>(&format!("/github/issues?repo={}", encode(&repo)))
        {
            Ok(issues) => format_json(&issues),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get CI check results for a branch.
    #[tool(description = "Get CI check results for a branch")]
    fn get_ci_status(&self, Parameters(p): Parameters<BranchParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self.client.get::<serde_json::Value>(&format!(
            "/github/checks?branch={}&repo={}",
            encode(&p.branch),
            encode(&repo)
        )) {
            Ok(checks) => format_json(&checks),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get comments and reviews on a pull request.
    #[tool(description = "Get PR comments and reviews")]
    fn get_pr_comments(&self, Parameters(p): Parameters<PrNumberParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self.client.get::<serde_json::Value>(&format!(
            "/github/pr/comments?pr={}&repo={}",
            p.pr_number,
            encode(&repo)
        )) {
            Ok(data) => format_json(&data),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get the merge status of a pull request (mergeable, CI status, review decision).
    #[tool(description = "Get PR merge status")]
    fn get_pr_merge_status(&self, Parameters(p): Parameters<PrNumberParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self.client.get::<serde_json::Value>(&format!(
            "/github/pr/merge-status?pr={}&repo={}",
            p.pr_number,
            encode(&repo)
        )) {
            Ok(data) => format_json(&data),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get the CI failure log for debugging a failed check.
    #[tool(description = "Get CI failure log for a branch")]
    fn get_ci_failure_log(&self, Parameters(p): Parameters<BranchParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self.client.get_text(&format!(
            "/github/ci/failure-log?branch={}&repo={}",
            encode(&p.branch),
            encode(&repo)
        )) {
            Ok(log) => log,
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Rerun failed CI checks for a branch.
    #[tool(description = "Rerun failed CI checks")]
    fn rerun_ci(&self, Parameters(p): Parameters<BranchParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self.client.post_ok(
            "/github/ci/rerun",
            &serde_json::json!({"branch": p.branch, "repo": repo}),
        ) {
            Ok(()) => format!("Rerunning failed checks for branch: {}", p.branch),
            Err(e) => format!("Error: {e}"),
        }
    }

    // ----- Git -----

    /// List git branches in the repository.
    #[tool(description = "List git branches")]
    fn list_branches(&self, Parameters(p): Parameters<RepoParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self
            .client
            .get::<serde_json::Value>(&format!("/git/branches?repo={}", encode(&repo)))
        {
            Ok(branches) => format_json(&branches),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Get the diff statistics for a branch compared to its base.
    #[tool(description = "Get diff stats for a branch")]
    fn git_diff_stat(&self, Parameters(p): Parameters<BranchParams>) -> String {
        let repo = match self.client.resolve_repo(&p.repo) {
            Ok(r) => r,
            Err(e) => return format!("Error: {e}"),
        };
        match self.client.get::<serde_json::Value>(&format!(
            "/git/diff-stat?branch={}&repo={}",
            encode(&p.branch),
            encode(&repo)
        )) {
            Ok(data) => format_json(&data),
            Err(e) => format!("Error: {e}"),
        }
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

/// Format JSON value as pretty-printed string
fn format_json(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}
