# Multi-Agent Monitoring

Workflow for monitoring and operating multiple AI agents simultaneously.

## Key Benefit: Unified Dashboard

tmai allows you to operate multiple agents from a single view — no switching between terminals.

## WebUI Mode (Default)

### Setup

```bash
# 1. Set up hooks (one-time)
tmai init

# 2. Start tmai
tmai

# 3. Start multiple agents in separate terminals
claude              # Terminal 1: feature work
cd ~/other && claude  # Terminal 2: different project
```

tmai auto-detects all agents and displays them in the sidebar grouped by project.

### Operations

- **Click agent** — Select it in the sidebar
- **Approve** — Click the approve button
- **Select options** — Click numbered choices for AskUserQuestion
- **Send text** — Type in the input bar
- **Terminal** — Open interactive terminal for any agent
- **Kill** — Terminate an agent

### Inter-Agent Messaging

Send text from one agent to another:

1. Select the source agent
2. Use the "Send To" panel to choose the target agent
3. Type the message and send

This enables coordination between agents working on related tasks.

### Spawn New Agents

Launch additional agents from the WebUI without leaving the browser:

1. Use the spawn dialog or worktree action buttons
2. Choose the command (claude, codex, gemini, etc.)
3. The new agent appears in the sidebar automatically

See [Agent Spawn](../features/agent-spawn.md) for details.

## TUI Mode (`--tmux`)

### Setup

```bash
# Set up hooks first
tmai init

# Start agents in tmux windows
tmux new-window -n agent1 && claude
tmux new-window -n agent2 && cd ~/project-b && claude

# Start tmai in another window
tmux new-window -n monitor
tmai --tmux
```

### Navigate and Operate

| Key | Action |
|-----|--------|
| `j` / `↓` | Next agent |
| `k` / `↑` | Previous agent |
| `y` | Approve |
| `1-9` | Select AskUserQuestion option |
| `Space` | Toggle for multi-select |
| `p` | Passthrough mode |

## Orchestrator Agent Pattern (Recommended)

The most powerful multi-agent pattern is the **orchestrator + sub-agents** model, where one Claude Code agent uses tmai MCP tools to manage the others programmatically.

```
┌──────────────────────────────────────┐
│ Orchestrator (main agent)  ⚙        │  ← Uses MCP tools
│  ├── Sub-agent 1 (worktree)         │  ← dispatch_issue
│  ├── Sub-agent 2 (worktree)         │  ← dispatch_issue
│  └── Sub-agent 3 (worktree)         │  ← dispatch_issue
└──────────────────────────────────────┘
```

The orchestrator:
- Dispatches issues to sub-agents via `dispatch_issue`
- Monitors progress via `list_agents` and `get_ci_status`
- Sends fix instructions via `send_prompt`
- Merges PRs and cleans up worktrees

In the WebUI, the orchestrator is visually distinguished with a badge and pinned to the top of the agent list.

See [Issue-Driven Orchestration](./issue-driven-orchestration.md) for the full workflow and [MCP Server](../features/mcp-server.md) for all available tools.

## Agent Teams Integration

When using Claude Code's Agent Teams feature (multiple agents collaborating on a project), tmai visualizes the team structure and task progress.

### WebUI

Team data appears in the sidebar with real-time SSE updates for:
- Team member status changes
- Task completion notifications

### TUI Keybindings

| Key | Action |
|-----|--------|
| `t` | Show task overlay for selected team member |
| `T` | Show team overview (all teams and members) |

See [Agent Teams](../features/agent-teams.md) for details.

## Benefits

1. **No context switching** — Operate while seeing everything
2. **Rapid response** — Notice and respond to approval requests immediately
3. **Easy situational awareness** — See what each agent is doing at a glance
4. **Inter-agent messaging** — Coordinate between agents (WebUI)

## Next Steps

- [Issue-Driven Orchestration](./issue-driven-orchestration.md) - MCP-driven orchestrator workflow (recommended)
- [Parallel Development with Worktrees](./worktree-parallel.md) - Safe parallel development with branches
- [Remote Approval](./remote-approval.md) - Approve from anywhere
