# WebUI Overview

tmai's default mode launches a WebUI dashboard for monitoring and controlling AI agents.

## Architecture

- **Backend**: Rust (axum) web server with REST API, SSE, and WebSocket endpoints
- **Frontend**: React 19 + TypeScript + Tailwind CSS
- **Real-time**: Server-Sent Events (SSE) for live agent/team/usage updates
- **Terminal**: xterm.js with WebGL rendering, connected via WebSocket
- **Authentication**: Token-based (Bearer header or query parameter)

## Launching

```bash
# Start WebUI (default mode)
tmai

# Opens Chrome/Chromium in App Mode automatically at:
# http://localhost:9876/?token=<generated-token>
```

The port is configurable via `~/.config/tmai/config.toml`:

```toml
[web]
port = 9876
```

## Layout

<!-- screenshot: webui-layout.png -->

The dashboard consists of:

### Sidebar (Left)

- **Status Bar** — Agent count, attention badge, settings/security buttons
- **Agent List** — All detected agents grouped by project, with status indicators
- **Terminal List** — Active terminal sessions
- **Usage Panel** — Collapsible token usage meters at the bottom

### Main Area (Right)

The main area changes based on what you select in the sidebar:

| Selection | View |
|-----------|------|
| Agent | Agent details with approval controls, input bar, and terminal |
| Project | Branch graph with GitHub integration and action panel |
| Worktree | Worktree details with diff viewer and management actions |
| Markdown | File tree with markdown preview and editor |

### Empty State

When nothing is selected, the main area shows a welcome card prompting you to select an agent or project.

## Real-Time Updates

tmai uses Server-Sent Events (SSE) at `GET /api/events` to push updates:

| Event | Description |
|-------|-------------|
| `agents` | Agent status changes (processing, idle, awaiting approval) |
| `teams` | Team and task updates |
| `teammate_idle` | Team member became idle |
| `task_completed` | Team task completed |
| `context_compacting` | Agent context window compaction |
| `usage` | Token usage meter updates |
| `worktree_created` | New worktree created |
| `worktree_removed` | Worktree deleted |
| `review_launched` | Code review started |
| `review_completed` | Code review finished |

Updates are pushed instantly — no polling required for agent status.

## Agent Interaction

From the WebUI, you can:

- **Approve** — Click the approve button or send `y`
- **Select options** — Click numbered choices for AskUserQuestion
- **Send text** — Type in the input bar and press Enter
- **Terminal** — Full interactive terminal via xterm.js
- **Kill** — Terminate an agent
- **Inter-agent messaging** — Send text from one agent to another
- **Auto-approve** — Toggle per-agent auto-approve override

## Projects

Register project directories to enable branch graph and GitHub integration:

1. Click the settings button (⚙) in the status bar
2. Add project paths in the Settings panel
3. Projects appear in the sidebar for selection

## Related Documentation

- [Terminal Panel](./terminal-panel.md) — Terminal features and WebSocket I/O
- [Branch Graph](./branch-graph.md) — Git commit visualization
- [Agent Spawn](./agent-spawn.md) — Launching new agents
- [Web API Reference](../reference/web-api.md) — Complete API documentation
