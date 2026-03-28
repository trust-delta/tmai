# Agent Spawn

Launch new AI agents directly from the WebUI.

## Overview

The Agent Spawn feature lets you start new AI agent sessions from the dashboard without leaving the browser. Agents can be spawned in PTY mode or tmux window mode.

## Spawning an Agent

### From the Spawn Dialog

1. Open the spawn interface from the UI
2. Select the agent command (Claude Code, Codex CLI, Gemini CLI, bash, etc.)
3. Set the working directory
4. Configure terminal dimensions (rows, cols)
5. Click spawn

### From a Worktree

In the Branch Graph or Worktree Panel, click **Launch Agent** to spawn an agent pre-configured for that worktree's directory.

### From the Action Panel

Select a branch with a worktree and click **Launch Agent** to spawn an AI agent in the worktree's directory.

## Spawn Modes

### PTY Mode (Default)

Spawns the agent in a pseudo-terminal managed by tmai:

- Full terminal I/O via WebSocket
- xterm.js rendering in the browser
- IME support for non-ASCII input
- Works without tmux

### tmux Window Mode

Spawns the agent in a new tmux window:

- Agent runs in a tmux session
- Accessible from both WebUI and tmux directly
- Useful when you want to switch between browser and terminal

Configure the default mode:

```toml
# ~/.config/tmai/config.toml
[spawn]
use_tmux_window = false    # true = tmux window, false = PTY (default)
tmux_window_name = "tmai"  # tmux window name (when using tmux mode)
```

## Allowed Commands

For security, only whitelisted commands can be spawned:

| Command | Description |
|---------|-------------|
| `claude` | Claude Code |
| `codex` | Codex CLI |
| `gemini` | Gemini CLI |
| `bash` | Bash shell |
| `sh` | POSIX shell |
| `zsh` | Z shell |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/spawn` | Spawn agent in PTY |
| POST | `/api/spawn/worktree` | Spawn agent in worktree |
| GET | `/api/settings/spawn` | Get spawn settings |
| PUT | `/api/settings/spawn` | Update spawn settings |

### Spawn Request

```json
{
  "command": "claude",
  "args": [],
  "cwd": "/home/user/project",
  "rows": 24,
  "cols": 80
}
```

### Spawn Response

```json
{
  "session_id": "a1b2c3d4-...",
  "pid": 12345,
  "command": "claude"
}
```

## Related Documentation

- [Terminal Panel](./terminal-panel.md) — Terminal features for spawned agents
- [Worktree Management](./worktree-ui.md) — Launching agents in worktrees
- [WebUI Overview](./webui-overview.md) — Dashboard layout
