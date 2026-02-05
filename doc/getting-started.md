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

## PTY Wrapping Mode (Recommended)

For more accurate state detection, start agents with PTY wrapping.

```bash
# Start Claude with PTY wrapping
tmai wrap claude
```

Benefits:
- Real-time state transition detection
- Accurate AskUserQuestion recognition
- Exfil detection enabled

## Next Steps

- [Multi-Agent Monitoring](./workflows/multi-agent.md) - Monitor multiple agents
- [Parallel Development with Worktrees](./workflows/worktree-parallel.md) - Parallel development workflow
- [tmai's Strengths](./guides/strengths.md) - What makes tmai unique
