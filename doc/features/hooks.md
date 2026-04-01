# Claude Code Hooks Integration

High-precision state detection via Claude Code's HTTP hooks. Works in both WebUI (default) and TUI (`--tmux`) modes.

## Overview

Claude Code Hooks deliver real-time event notifications directly from Claude Code to tmai's web server over HTTP. This eliminates screen-scraping and provides event-driven state detection with the highest precision.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Claude Code                                │
│                                                              │
│  SessionStart → UserPromptSubmit → PreToolUse → ...          │
│       │                │                │                    │
│       └────────────────┴────────────────┘                    │
│                        │                                     │
│              HTTP POST /hooks/event                          │
│            + Bearer token auth                               │
│            + X-Tmai-Pane-Id: $TMUX_PANE                      │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      tmai (web server)                       │
│                                                              │
│  POST /hooks/event → HookRegistry → Poller → AgentStatus    │
└─────────────────────────────────────────────────────────────┘
```

## Setup

Run `tmai init` to configure hooks automatically:

```bash
tmai init
```

This command:
1. Generates an authentication token (`~/.config/tmai/hooks_token`)
2. Merges tmai hook entries into `~/.claude/settings.json`
3. Preserves any existing hooks in your settings

To force-regenerate the token and re-add hooks:

```bash
tmai init --force
```

To remove all tmai hooks and delete the token:

```bash
tmai uninit
```

## How It Works

### 3-Tier Detection Priority

tmai uses a 3-tier fallback strategy for state detection:

| Priority | Method | Precision | Latency | Requirements |
|----------|--------|-----------|---------|--------------|
| 1 (highest) | **HTTP Hooks** | Event-driven | Real-time | `tmai init` + web server |
| 2 | IPC Socket | High | Real-time | `tmai wrap` |
| 3 (fallback) | capture-pane | Moderate | Polling interval | None |

When hooks are active, tmai uses the hook state if it's fresh (within 30 seconds). If not, it falls back to IPC, then capture-pane.

### Hook Events

tmai subscribes to 14 Claude Code events:

| Event | tmai Action |
|-------|-------------|
| `SessionStart` | Register new agent session |
| `UserPromptSubmit` | Set status → Processing |
| `PreToolUse` | Set status → Processing (track tool name) |
| `PostToolUse` | Set status → Processing |
| `Notification` | Set status → AwaitingApproval (permission_prompt) |
| `PermissionRequest` | Set status → AwaitingApproval |
| `PermissionDenied` | Log permission denial to audit (v2.1.89+) |
| `Stop` | Set status → Idle |
| `SubagentStart` | Set status → Processing |
| `SubagentStop` | Set status → Processing |
| `TeammateIdle` | Emit team event |
| `TaskCompleted` | Emit team event |
| `TaskCreated` | Emit team event, track new background task (v2.1.86+) |
| `SessionEnd` | Remove session from registry |

### Pane ID Resolution

Hooks identify which tmux pane the event belongs to using a 3-tier fallback:

1. **X-Tmai-Pane-Id header** — Injected via `$TMUX_PANE` environment variable
2. **Session ID lookup** — Maps Claude Code session ID to pane ID
3. **cwd matching** — Matches working directory against known agents

### Authentication

Hook events are authenticated with a dedicated Bearer token, separate from the Web Remote Control token.

- Token stored at: `~/.config/tmai/hooks_token`
- Permissions: `0600` (owner-only read/write)
- Validated with constant-time comparison (timing attack resistant)

## Comparison

| Feature | Hooks | PTY Wrapping | capture-pane |
|---------|-------|-------------|--------------|
| Setup | `tmai init` | `tmai wrap claude` | None |
| Detection accuracy | Event-driven (highest) | High | Moderate |
| Latency | Real-time | Real-time | Polling interval |
| Agent startup | Normal `claude` | Via `tmai wrap` | Normal `claude` |
| Exfil detection | No | Yes | No |
| AskUserQuestion parsing | No (status only) | Yes (full) | Partial |
| Works with existing sessions | Yes | Restart required | Yes |

**Recommendation**: Use hooks as the primary detection method. Add PTY wrapping when you need exfil detection or full AskUserQuestion parsing.

## Detection Source Display

tmai shows which detection method is being used in the status bar:

- `◈ Hook` (Cyan) — HTTP Hooks (highest precision)
- `⊙ IPC` — PTY wrapping via IPC socket (high precision)
- `● capture` — capture-pane (traditional)

## Performance Optimization

When hook state is available for an agent, tmai skips `capture-pane` for non-selected panes. This reduces tmux command overhead when monitoring many agents.

Stale hook entries (no events for 5+ minutes) are automatically cleaned up.

## Troubleshooting

### Hooks Not Working

1. Verify `tmai init` was run successfully:
   ```bash
   # Check the token file exists and has correct permissions
   test -s ~/.config/tmai/hooks_token && echo "Token file OK" || echo "Token file missing"
   ls -l ~/.config/tmai/hooks_token
   ```
2. Check `~/.claude/settings.json` contains tmai hook entries
3. Ensure tmai's web server is running (default port 9876)
4. Check logs for authentication errors

### Token Mismatch

If hooks were initialized with a different token:

```bash
tmai init --force
```

This regenerates the token and updates settings.json.

### Hook Events Not Reaching tmai

1. Verify the web server port matches the hook URL port
2. Check if a firewall blocks localhost connections
3. Look for errors in tmai's debug log: `tmai --debug`

## Next Steps

- [PTY Wrapping](./pty-wrapping.md) - Additional precision with I/O monitoring
- [WebUI Overview](./webui-overview.md) - Dashboard features
- [Mobile Remote Control](./web-remote.md) - Control from smartphone
- [Configuration](../reference/config.md) - Config options
