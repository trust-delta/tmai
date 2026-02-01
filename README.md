# tmai

**Tmux Multi Agent Interface** - Monitor and control multiple AI agents running in tmux.

![Rust](https://img.shields.io/badge/rust-1.70%2B-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Multi-agent monitoring** - Track multiple AI coding agents (Claude Code, OpenCode, etc.) across tmux panes
- **Real-time preview** - See agent output without switching panes
- **Quick approval** - Approve/reject tool calls with single keystrokes
- **AskUserQuestion support** - Respond to agent questions with number selection
- **Passthrough mode** - Send keys directly to the agent pane
- **Status detection** - Automatic detection of idle, processing, and awaiting approval states
- **PTY wrapping** - High-precision state detection via PTY proxy for real-time I/O monitoring
- **Web Remote Control** - Control agents from your smartphone via QR code

## Installation

```bash
cargo install --git https://github.com/trust-delta/tmai
```

Or build from source:

```bash
git clone https://github.com/trust-delta/tmai
cd tmai
cargo build --release
```

## Usage

Run `tmai` in a tmux session:

```bash
tmai
```

### Configuration

Create a config file in one of these locations (first found wins):

- `~/.config/tmai/config.toml`
- `~/.tmai.toml`

Example:

```toml
poll_interval_ms = 500
passthrough_poll_interval_ms = 10
capture_lines = 100
attached_only = true

[ui]
show_preview = true
preview_height = 40
color = true
```

### Keybindings

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate agents |
| `1-9` / `１-９` | Select option (AskUserQuestion) |
| `i` | Enter input mode |
| `→` | Enter passthrough mode |
| `Esc` | Exit mode / Quit |
| `?` | Help |

### Modes

- **Normal mode** - Navigate and quick actions
- **Input mode** (`i`) - Type text to send to agent
- **Passthrough mode** (`→`) - Keys sent directly to pane

## PTY Wrapping

For more accurate state detection, you can wrap AI agents with a PTY proxy:

```bash
# Start Claude Code with PTY wrapping
tmai wrap claude

# With arguments
tmai wrap claude --dangerously-skip-permissions

# Other agents
tmai wrap codex
tmai wrap gemini
```

Benefits:
- **Real-time I/O monitoring** - Detects state changes immediately
- **No polling delay** - Faster than tmux capture-pane
- **Accurate approval detection** - Reliable Yes/No and AskUserQuestion detection

When creating new AI processes from tmai UI, they are automatically wrapped.

## Web Remote Control

Control your AI agents from your smartphone:

1. Press `r` to display QR code
2. Scan with your phone
3. Approve/reject or select options from the web interface

```toml
# config.toml
[web]
enabled = true
port = 9876
```

## Supported Agents

| Agent | Detection | PTY Wrap |
|-------|-----------|----------|
| Claude Code | ✅ Supported | ✅ |
| OpenCode | ✅ Supported | ✅ |
| Codex CLI | ✅ Supported | ✅ |
| Gemini CLI | ✅ Supported | ✅ |

## Screenshots

```
┌─────────────────┬─────────────────────────────────┐
│ Sessions        │ Preview                         │
│                 │                                 │
│ ● main:0.0      │ Do you want to make this edit?  │
│   Claude Code   │                                 │
│   ⠋ Processing  │ ❯ 1. Yes                        │
│                 │   2. Yes, allow all...          │
│ ○ main:0.1      │   3. No                         │
│   Claude Code   │                                 │
│   ✳ Idle        │                                 │
└─────────────────┴─────────────────────────────────┘
 j/k:Nav 1-9:Select i:Input →:Direct ?:Help q:Quit
```

## License

MIT
