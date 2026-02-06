# Agent Teams

Monitor Claude Code Agent Teams structure and task progress from tmai.

## Overview

Claude Code's Agent Teams feature allows multiple AI agents to collaborate on a project, with a team lead coordinating teammates. tmai can detect these teams and display their structure, members, and task progress in real time.

> **Note**: Agent Teams is an experimental feature. Some functionality (sort, monitor scope) is temporarily fixed while this integration is active.

## How It Works

tmai scans `~/.claude/teams/` and `~/.claude/tasks/` directories to detect active Agent Teams. It maps team members to tmux panes by matching:

1. **Environment variable** (`CLAUDE_CODE_TASK_LIST_ID`) - Primary detection method
2. **Command-line arguments** (`--agent-id`) - Heuristic fallback

Team data is refreshed periodically based on the configured `scan_interval`.

## Team Overview Screen

Press `T` to open the team overview screen, which shows:

- All detected teams
- Team members and their roles
- Task summary (total, completed, in progress, pending)

```
┌─────────────────────────────────────────────────────────────┐
│ Agent Teams                                                  │
│                                                             │
│ ▸ my-project (3 members, 5 tasks)                           │
│   ├── team-lead (general-purpose)     3/5 tasks done        │
│   ├── researcher (Explore)            Processing             │
│   └── implementer (general-purpose)   Idle                   │
│                                                             │
│ ▸ refactoring (2 members, 3 tasks)                          │
│   ├── lead (general-purpose)          1/3 tasks done        │
│   └── worker (general-purpose)        Approval               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Press `Esc` or `T` again to close.

## Task Overlay

Select a team member in the agent list and press `t` to view their team's task list:

```
┌─────────────────────────────────────────────────────────────┐
│ Tasks: my-project                                            │
│                                                             │
│ ✓ 1. Set up project structure          (team-lead)          │
│ ✓ 2. Research API design               (researcher)         │
│ ● 3. Implement auth module             (implementer)        │
│ ○ 4. Write tests                       (unassigned)         │
│ ○ 5. Update documentation              (unassigned)         │
│                                                             │
│ ✓ completed  ● in_progress  ○ pending                       │
└─────────────────────────────────────────────────────────────┘
```

Press `Esc` or `t` again to close.

## Keybindings

| Key | Action |
|-----|--------|
| `T` | Toggle team overview screen |
| `t` | Toggle task overlay (when team member selected) |

## Configuration

```toml
[teams]
enabled = true       # Enable/disable team scanning (default: true)
scan_interval = 5    # Scan interval in polling cycles (default: 5, ~2.5 seconds)
```

## Web API

Teams data is also available via the Web API:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/teams` | List teams with task summaries |
| GET | `/api/teams/:name/tasks` | List tasks for a team |
| GET | `/api/events` | SSE stream (includes `teams` events) |

See [Web API Reference](../reference/web-api.md) for details.

## Limitations

- **Experimental feature**: The API and behavior may change in future versions
- **Sort and scope disabled**: Sort (`s`) is fixed to Directory and monitor scope (`m`) is fixed to AllSessions while teams integration is active. These will be restored in a future update.
- **Detection method**: Team member mapping relies on command-line argument matching (`--agent-id`). If agents are started without this flag, the heuristic fallback may not always match correctly.
- **File-based scanning**: Team data is read from filesystem (`~/.claude/teams/`, `~/.claude/tasks/`). Changes are detected on the next scan interval.

## Next Steps

- [Multi-Agent Monitoring](../workflows/multi-agent.md) - General multi-agent workflow
- [Web API Reference](../reference/web-api.md) - Teams API documentation
- [Configuration Reference](../reference/config.md) - Teams configuration options
