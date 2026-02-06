# Single Agent Monitoring

Basic usage for monitoring a single AI agent.

## Basic Flow

```bash
# 1. Create a tmux session
tmux new-session -s dev

# 2. Start Claude Code
claude

# 3. Start tmai in another pane
# Ctrl+b % to split horizontally
tmai
```

## Screen Layout

```
┌─────────────────────────────────────────────────────────────┐
│ tmux                                                        │
│                                                             │
│  ┌─────────────────────────┬───────────────────────────────┐│
│  │                         │                               ││
│  │   claude                │   tmai                        ││
│  │   (working)             │   (monitoring)                ││
│  │                         │                               ││
│  └─────────────────────────┴───────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Operations

### Approval

When claude requests approval, in the tmai pane:

| Key | Action |
|-----|--------|
| `y` | Approve (send Enter to confirm) |

### AskUserQuestion

When options are displayed:

| Key | Action |
|-----|--------|
| `1-9` | Select option |
| `Space` | Toggle for multi-select |

### Direct Input

When text input is needed:

```
p key → Passthrough mode → Type → Esc to return
```

### Preview Scrolling

| Key | Action |
|-----|--------|
| `Ctrl+d` | Scroll down |
| `Ctrl+u` | Scroll up |

## PTY Wrapping Mode (Recommended)

For more accurate state detection:

```bash
# Instead of claude
tmai wrap claude
```

Benefits:
- Real-time state detection
- Accurate AskUserQuestion recognition
- Exfil detection enabled

## Next Steps

- [Multi-Agent Monitoring](./multi-agent.md) - Multiple agents
- [Remote Approval](./remote-approval.md) - Approve from smartphone
