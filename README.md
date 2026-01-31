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

## Supported Agents

| Agent | Status |
|-------|--------|
| Claude Code | Supported |
| OpenCode | Supported |
| Codex CLI | Planned |
| Gemini CLI | Planned |

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
