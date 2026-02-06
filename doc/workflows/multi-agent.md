# Multi-Agent Monitoring

Workflow for monitoring and operating multiple AI agents simultaneously.

## tmai's Key Feature: Single-Pane Operation

tmai allows you to operate multiple agents **without attaching** to each pane.

```
┌─────────────────────────────────────────────────────────────┐
│ Typical tools                                               │
│                                                             │
│  Monitor → Attach → Operate → Detach → Monitor              │
│                                                             │
│  Problem: Can't see other agents while operating            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ tmai                                                        │
│                                                             │
│  Operate directly from monitor screen                       │
│  - y key to approve                                          │
│  - 1-9 keys to select options                               │
│  - All agents visible while operating                       │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### Method 1: Monitor existing agents

If multiple agents are already running in tmux, tmai auto-detects them.

```bash
# Window 1: Claude
tmux new-window -n agent1
claude

# Window 2: Claude (different project)
tmux new-window -n agent2
cd ~/project-b && claude

# Window 3: tmai
tmux new-window -n monitor
tmai
```

### Method 2: Create from tmai

You can also create new agent sessions from within tmai's TUI.

1. Start tmai
2. Create new process (TUI operation)
3. Automatically starts with PTY wrapping and monitoring

## Operations

### Navigate between agents

| Key | Action |
|-----|--------|
| `j` / `↓` | Next agent |
| `k` / `↑` | Previous agent |

### Approve (no attach needed)

Operate directly on the selected agent:

| Key | Action |
|-----|--------|
| `y` | Approve (send Yes) |
| `1-9` | Select AskUserQuestion option |
| `Space` | Toggle for multi-select |

### When direct input is needed

```
p key → Passthrough mode → Type directly → Esc to return
```

## Practical Example: 3 Agents Simultaneously

```
┌─────────────────────────────────────────────────────────────┐
│ tmux                                                        │
│                                                             │
│  Window 1: claude (feature-a)   ← Implementing auth         │
│  Window 2: claude (feature-b)   ← Designing API             │
│  Window 3: claude (bugfix)      ← Fixing bugs               │
│  Window 4: tmai                 ← Monitoring all            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

tmai screen:

```
┌─ Agents ─────────────────┬─ Preview ────────────────────────┐
│                          │                                  │
│ ● feature-a [Approval]   │  Do you want to create           │
│   feature-b [Processing] │  src/auth/login.rs?              │
│   bugfix    [Idle]       │                                  │
│                          │  [Yes]  [No]                     │
│                          │                                  │
└──────────────────────────┴──────────────────────────────────┘
  → Press y to approve immediately, other agents still visible
```

## Agent Teams Integration

When using Claude Code's Agent Teams feature (multiple agents collaborating on a project), tmai can visualize the team structure and task progress.

| Key | Action |
|-----|--------|
| `t` | Show task overlay for selected team member |
| `T` | Show team overview (all teams and members) |

This is especially useful when running large teams with many agents—tmai gives you a single dashboard to monitor all team members and their task progress.

See [Agent Teams](../features/agent-teams.md) for details.

## Benefits

1. **No context switching** - Operate while seeing everything
2. **Rapid response** - Notice and respond to approval requests immediately
3. **Easy situational awareness** - See what each agent is doing at a glance

## Next Steps

- [Parallel Development with Worktrees](./worktree-parallel.md) - Safe parallel development with branches
- [Remote Approval](./remote-approval.md) - Approve from anywhere
