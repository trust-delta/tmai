# Single Agent Monitoring

Basic usage for monitoring a single AI agent.

## WebUI Mode (Default)

```bash
# 1. Set up hooks (one-time)
tmai init

# 2. Start tmai (opens Chrome App Mode)
tmai

# 3. Start Claude Code in any terminal
claude
```

tmai auto-detects the agent via hooks and displays it in the dashboard.

### Operations in WebUI

- **Approve** — Click the approve button
- **Select options** — Click numbered choices
- **Send text** — Type in the input bar and press Enter
- **Terminal** — Open the interactive terminal panel
- **Kill** — Terminate the agent

## TUI Mode (`--tmux`)

```bash
# 1. Create a tmux session
tmux new-session -s dev

# 2. Start Claude Code
claude

# 3. Start tmai in another pane (Ctrl+b % to split)
tmai --tmux
```

### Operations in TUI

| Key | Action |
|-----|--------|
| `y` | Approve (send Enter to confirm) |
| `1-9` | Select AskUserQuestion option |
| `Space` | Toggle for multi-select |
| `p` | Passthrough mode (type directly, Esc to return) |
| `Ctrl+d/u` | Scroll preview |

## Claude Code Hooks (Recommended)

For the highest precision state detection, run `tmai init` once to set up hooks:

```bash
# One-time setup
tmai init

# Then just use claude normally
claude
```

No special wrapper needed — hooks deliver events directly to tmai.

## PTY Wrapping Mode (Optional)

For additional features like exfil detection:

```bash
# Instead of claude
tmai wrap claude
```

Additional benefits:
- Exfil detection enabled
- Full AskUserQuestion option parsing
- Direct I/O monitoring

## Next Steps

- [Multi-Agent Monitoring](./multi-agent.md) - Multiple agents
- [Remote Approval](./remote-approval.md) - Approve from smartphone
