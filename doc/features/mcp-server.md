# MCP Server

Expose tmai as a Model Context Protocol (MCP) server, enabling AI agents to programmatically orchestrate other agents.

## Overview

tmai's MCP server lets an AI agent (e.g., Claude Code) control tmai through standardized MCP tools — listing agents, approving permissions, spawning worktrees, checking CI, and more. This turns tmai into the backbone for autonomous development cycles:

**Issue → Worktree → Agent → PR → Review → Merge**

The MCP server runs as a subprocess spawned by Claude Code, communicating over stdio (JSON-RPC 2.0). It connects back to the running tmai instance via its HTTP API.

```
Claude Code (consumer)
    ↓ spawns subprocess
tmai mcp (stdio JSON-RPC)
    ↓ HTTP + Bearer token
tmai WebUI (localhost:{port})
    ↓
TmaiCore (agent management, GitHub, Git)
```

## Setup

### 1. Initialize tmai

```bash
# Set up hooks + MCP config (one-time)
tmai init
```

This registers tmai as an MCP server in `~/.claude.json`:

```json
{
  "mcpServers": {
    "tmai": {
      "type": "stdio",
      "command": "tmai",
      "args": ["mcp"]
    }
  }
}
```

### 2. Start tmai

```bash
# Launch the WebUI (MCP server needs a running tmai instance)
tmai
```

### 3. Use from Claude Code

Once configured, Claude Code can use tmai tools directly. The tools appear as `mcp__tmai__*` in Claude Code's tool list.

## Available Tools

### Agent Queries

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_agents` | List all monitored AI agents with status | — |
| `get_agent` | Get detailed info about a specific agent | `id` |
| `get_agent_output` | Get terminal output of an agent | `id` |
| `get_transcript` | Get conversation transcript (from JSONL session log) | `id` |

### Agent Actions

| Tool | Description | Parameters |
|------|-------------|------------|
| `approve` | Approve a pending permission request | `id` |
| `send_text` | Send text input to an agent | `id`, `text` |
| `send_key` | Send a special key (Enter, Escape, Tab, etc.) | `id`, `key` |
| `select_choice` | Select a numbered choice for AskUserQuestion | `id`, `index` |

### Team Queries

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_teams` | List Claude Code Agent Teams with task progress | — |

### Worktree Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_worktrees` | List all worktrees with linked agents and diff stats | — |
| `spawn_agent` | Spawn a new AI agent in a directory | `directory`, `prompt?` |
| `spawn_worktree` | Create a worktree and spawn an agent in it | `name`, `repo?`, `base_branch?`, `prompt?` |
| `delete_worktree` | Delete a git worktree | `worktree_name`, `repo?`, `force?` |

### GitHub

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_prs` | List open pull requests with CI and review state | `repo?` |
| `list_issues` | List open issues | `repo?` |
| `get_ci_status` | Get CI check results for a branch | `branch`, `repo?` |
| `get_pr_comments` | Get comments and reviews on a PR | `pr_number`, `repo?` |
| `get_pr_merge_status` | Get merge status (mergeable, CI, reviews) | `pr_number`, `repo?` |
| `get_ci_failure_log` | Get CI failure log for debugging | `branch`, `repo?` |
| `rerun_ci` | Rerun failed CI checks | `branch`, `repo?` |

### Git

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_branches` | List git branches | `repo?` |
| `git_diff_stat` | Get diff stats for a branch vs base | `branch`, `repo?` |

## Example: Autonomous Issue Resolution

An orchestrating Claude Code agent can use tmai MCP tools to drive a full development cycle:

```
1. list_issues          → Pick an issue to work on
2. spawn_worktree       → Create isolated worktree, launch agent with resolve prompt
3. get_agent            → Monitor agent progress
4. approve              → Approve pending permissions
5. list_prs             → Check if PR was created
6. get_ci_status        → Verify CI passes
7. get_pr_merge_status  → Confirm PR is mergeable
```

## Architecture

- **Transport**: stdio (standard input/output), JSON-RPC 2.0
- **SDK**: [rmcp](https://github.com/modelcontextprotocol/rust-sdk) (Rust MCP SDK by Anthropic)
- **Connection**: Reads `~/.local/share/tmai/api.json` for port and auth token (written by the running tmai instance, 0600 permissions)
- **Design**: Thin wrapper around the existing TmaiCore HTTP API — no separate business logic

## Related Documentation

- [Agent Spawn](./agent-spawn.md) — Launching agents from the WebUI
- [Worktree Management](./worktree-ui.md) — Git worktree operations
- [GitHub Integration](./github-integration.md) — PR and CI features
- [Hooks](./hooks.md) — Claude Code Hooks integration
- [Web API Reference](../reference/web-api.md) — Underlying HTTP API
- [Issue-Driven Orchestration](../workflows/issue-driven-orchestration.md) — Workflow using MCP tools
