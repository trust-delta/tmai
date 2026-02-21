# PTY Wrapping

High-precision state detection through PTY proxy.

## Overview

PTY wrapping starts AI agents through a PTY proxy, enabling direct I/O monitoring for more accurate state detection than traditional tmux capture-pane.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        tmai (parent)                         │
│  ┌─────────────┐   ┌────────────┐   ┌───────────────────┐  │
│  │   Poller    │◄──│ PtyMonitor │◄──│ /tmp/tmai/*.state │  │
│  └─────────────┘   └────────────┘   └───────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                              ▲
                                              │ state write
┌─────────────────────────────────────────────┴───────────────┐
│                    tmai wrap claude                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  User ←→ PTY Proxy ←→ claude                           │ │
│  │              │                                          │ │
│  │         StateAnalyzer → /tmp/tmai/{pane_id}.state      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Usage

```bash
# Start Claude Code with PTY wrapping
tmai wrap claude

# With arguments
tmai wrap "claude --dangerously-skip-permissions"

# Other agents
tmai wrap codex
tmai wrap gemini
```

## Comparison

| Method | Detection | Timing | Features |
|--------|-----------|--------|----------|
| capture-pane | Parse screen text | Polling interval | Basic |
| PTY wrapping | Direct I/O monitoring | Real-time | Full |

### Traditional Method (capture-pane)

```
tmux capture-pane → Parse screen text → Estimate state

Problem: May miss state changes depending on timing
```

### PTY Wrapping

```
Direct I/O monitoring → Real-time state detection

Benefit: Never miss state transitions, more accurate
```

## State Detection Logic

| State | Detection Method |
|-------|------------------|
| Processing | Output flowing (within 200ms of last output) |
| Idle | Output stopped, no prompt detected |
| Approval | Output contains Yes/No pattern + 500ms after output stops |

## State File Format

State files are written to `/tmp/tmai/{pane_id}.state`:

```json
{
  "status": "awaiting_approval",
  "approval_type": "user_question",
  "details": "Which approach do you prefer?",
  "choices": ["async/await", "callbacks", "promises"],
  "multi_select": false,
  "cursor_position": 1,
  "last_output": 1706745600000,
  "last_input": 1706745590000,
  "pid": 12345,
  "pane_id": "0"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| status | string | `processing`, `idle`, `awaiting_approval` |
| approval_type | string? | Approval type (only when status=awaiting_approval) |
| details | string? | Detailed description of approval request |
| choices | string[] | AskUserQuestion options |
| multi_select | bool | Whether multiple selections are allowed |
| cursor_position | number | Current cursor position (1-indexed) |
| last_output | number | Last output timestamp (Unix ms) |
| last_input | number | Last input timestamp (Unix ms) |
| pid | number | Wrapped process PID |
| pane_id | string? | tmux pane ID |

## Benefits

1. **Real-time detection**: State changes detected immediately
2. **Accurate AskUserQuestion**: Options parsed reliably
3. **Exfil detection**: External transmission monitoring enabled
4. **No polling lag**: Instant response to state transitions

## Upgrading Existing Sessions to IPC

Manually started Claude Code agents (non-IPC) can be upgraded to PTY wrapping without losing conversation context:

1. Select the non-IPC agent in tmai
2. Press `W` (Shift+W)
3. tmai identifies the session ID from `.jsonl` files
4. Confirm the restart — the agent is restarted with `claude --resume` via `tmai wrap`

Session ID identification uses a two-phase approach:
- **Phase 1**: Match capture-pane content against JSONL files (non-invasive)
- **Phase 2**: Send a probe marker to identify the session (leaves 1 turn in conversation history)

## Fallback Behavior

- If state file doesn't exist: Falls back to capture-pane
- On PTY error: Immediately falls back to traditional method
- Existing sessions: Continue using capture-pane

## Detection Source Display

tmai shows which detection method is being used in the status bar:

- `PTY` - PTY wrapping (high precision)
- `CAP` - capture-pane (traditional)

## Next Steps

- [Exfil Detection](./exfil-detection.md) - Security monitoring in PTY mode
- [AskUserQuestion Support](./ask-user-question.md) - Option selection
