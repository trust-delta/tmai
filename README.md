# tmai

**Tmux Multi Agent Interface** - Monitor and control multiple AI agents running in tmux.

![Rust](https://img.shields.io/badge/rust-1.91%2B-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

![tmai demo](assets/tmai-demo.gif)

## Features

- **Multi-agent monitoring** - Track Claude Code, OpenCode, Codex CLI, Gemini CLI across tmux panes
- **Single-pane operation** - Approve, respond, and interact without switching panes
- **Real-time preview** - See agent output with ANSI color support
- **3-tier state detection** - Hooks (HTTP) > IPC (PTY wrap) > capture-pane, automatic fallback
- **Web remote control** - Control agents from your smartphone via QR code
- **Agent Teams** - Visualize Claude Code Agent Teams and task progress
- **Auto-approve** - Automatic approval with 4 modes: Rules / AI / Hybrid / Off
- **Fresh Session Review** - Automatic context-free code review on agent completion
- **Security monitoring** - Exfil detection for external data transmission

## Installation

```bash
cargo install tmai
```

## Quick Start

```bash
# Set up hooks for high-precision detection (one-time)
tmai init

# Run tmai in a tmux session
tmai
```

## Keybindings

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate agents |
| `y` | Approve / Yes |
| `n` | No |
| `1-9` | Select option |
| `i` | Input mode |
| `->` | Passthrough mode |
| `R` | Launch code review |
| `U` | Subscription usage |
| `?` | Help |

## Documentation

Detailed guides, configuration reference, and workflows are available in [doc/](./doc/README.md).

| Category | Links |
|----------|-------|
| **Getting Started** | [Installation & First Steps](./doc/getting-started.md) |
| **Features** | [Hooks](./doc/features/hooks.md) - [Auto-Approve](./doc/features/auto-approve.md) - [Agent Teams](./doc/features/agent-teams.md) - [Web Remote](./doc/features/web-remote.md) - [PTY Wrapping](./doc/features/pty-wrapping.md) - [Fresh Session Review](./doc/features/fresh-session-review.md) |
| **Workflows** | [Multi-agent](./doc/workflows/multi-agent.md) - [Worktree Parallel](./doc/workflows/worktree-parallel.md) - [Remote Approval](./doc/workflows/remote-approval.md) |
| **Reference** | [Config](./doc/reference/config.md) - [Keybindings](./doc/reference/keybindings.md) - [Web API](./doc/reference/web-api.md) |

## Supported Agents

| Agent | Detection | Hooks | PTY Wrap |
|-------|-----------|-------|----------|
| Claude Code | Yes | Yes | Yes |
| OpenCode | Yes | - | Yes |
| Codex CLI | Yes | - | Yes |
| Gemini CLI | Yes | - | Yes |

## Web Remote

<p align="center">
  <img src="assets/mobile-screenshot.jpg" alt="Web Remote - Agent List" width="280">
  &nbsp;&nbsp;
  <img src="assets/mobile-ask-user-question.jpg" alt="Web Remote - AskUserQuestion" width="280">
</p>

## Acknowledgments

Inspired by [tmuxcc](https://github.com/nyanko3141592/tmuxcc).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT
