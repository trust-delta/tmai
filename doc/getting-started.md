# Getting Started

Installation and first steps with tmai.

## Requirements

- Rust toolchain (1.70+)
- tmux
- AI agents to monitor (Claude Code, Codex CLI, Gemini CLI, etc.)

## Installation

### From crates.io

```bash
cargo install tmai
```

### From source

```bash
git clone https://github.com/trust-delta/tmai
cd tmai
cargo build --release

# Copy to a directory in your PATH
cp target/release/tmai ~/.local/bin/
```

## Basic Usage

### 1. Start an AI agent

First, start an AI agent in tmux.

```bash
# Create a tmux session
tmux new-session -s dev

# Start Claude Code
claude
```

### 2. Start tmai

Open another pane or window and start tmai.

```bash
# Split pane
# Ctrl+b % (horizontal) or Ctrl+b " (vertical)

# Start tmai
tmai
```

tmai automatically detects AI agents running in tmux and starts monitoring.

### 3. Monitor and operate

| Key | Action |
|-----|--------|
| `j/k` | Select agent |
| `y` | Approve (send Enter) |
| `1-9` | Select AskUserQuestion option |
| `p` | Passthrough mode (direct input) |
| `?` | Show help |
| `q` | Quit |

> **Note**: For rejection or other options, use number keys, input mode (`i`), or passthrough mode (`p`).

## Claude Code Hooks (Recommended)

For 100% accurate state detection, set up Claude Code Hooks:

```bash
# One-time setup: configure hooks in Claude Code
tmai init
```

This registers tmai as an HTTP hook receiver in `~/.claude/settings.json`. After setup, all Claude Code sessions automatically send state events to tmai — no special agent startup required.

Benefits:
- 100% accurate state detection
- Works with normal `claude` command (no wrapper needed)
- Zero-latency event delivery
- Works with existing sessions

## PTY Wrapping Mode (Optional)

For additional features like exfil detection and full AskUserQuestion parsing, start agents with PTY wrapping:

```bash
# Start Claude with PTY wrapping
tmai wrap claude
```

Additional benefits over hooks:
- Exfil detection enabled
- Full AskUserQuestion option parsing
- Direct I/O monitoring

> **Note**: Hooks and PTY wrapping can be used together. When both are active, hooks take priority for state detection.

## Next Steps

- [Claude Code Hooks](./features/hooks.md) - Detailed hooks documentation
- [Multi-Agent Monitoring](./workflows/multi-agent.md) - Monitor multiple agents
- [Agent Teams](./features/agent-teams.md) - Claude Code team monitoring
- [Parallel Development with Worktrees](./workflows/worktree-parallel.md) - Parallel development workflow
- [tmai's Strengths](./guides/strengths.md) - What makes tmai unique
