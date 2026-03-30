# Getting Started

Installation and first steps with tmai.

## Requirements

- Rust toolchain (1.70+)
- Chrome or Chromium (for WebUI App Mode — auto-detected)
- AI agents to monitor (Claude Code, Codex CLI, Gemini CLI, etc.)
- tmux (optional, only needed for `--tmux` TUI mode)

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

## Quick Start (WebUI Mode)

### 1. Set up hooks (recommended, one-time)

```bash
tmai init
```

This registers tmai as an HTTP hook receiver in `~/.claude/settings.json`. All Claude Code sessions automatically send state events to tmai.

### 2. Start tmai

```bash
tmai
```

tmai starts a web server and opens Chrome in App Mode automatically. The dashboard shows all detected AI agents.

<!-- screenshot: webui-first-launch.png -->

### 3. Start an AI agent

Open a terminal and start an AI agent:

```bash
claude
```

tmai detects the agent automatically via hooks and displays it in the dashboard. You can approve, send input, and interact without leaving the WebUI.

### 4. Monitor and operate

In the WebUI dashboard:

- **Sidebar** — Lists all detected agents grouped by project
- **Agent view** — Shows agent status, approval buttons, and text input
- **Terminal** — Full interactive terminal via xterm.js
- **Branch graph** — Git commit history with branch visualization
- **GitHub** — PR status, CI checks, and issues

## TUI Mode (Optional)

For tmux power users, tmai also supports a terminal UI:

```bash
# Requires tmux — start tmai in a tmux pane
tmai --tmux
```

| Key | Action |
|-----|--------|
| `j/k` | Select agent |
| `y` | Approve (send Enter) |
| `1-9` | Select AskUserQuestion option |
| `i` | Input mode |
| `->` | Passthrough mode |
| `?` | Show help |

## Claude Code Hooks (Recommended)

For the highest precision state detection, set up Claude Code Hooks:

```bash
# One-time setup: configure hooks in Claude Code
tmai init
```

Benefits:
- Event-driven state detection (highest precision)
- Works with normal `claude` command (no wrapper needed)
- Zero-latency event delivery
- Works in both WebUI and TUI modes

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

## Demo Mode

Try tmai without tmux or agents:

```bash
tmai demo
```

## Next Steps

- [WebUI Overview](./features/webui-overview.md) - Dashboard layout and features
- [Branch Graph](./features/branch-graph.md) - Git visualization
- [GitHub Integration](./features/github-integration.md) - PR and CI monitoring
- [Issue-Driven Orchestration](./workflows/issue-driven-orchestration.md) - Dispatch issues to parallel agents **(recommended workflow)**
- [Claude Code Hooks](./features/hooks.md) - Detailed hooks documentation
- [Multi-Agent Monitoring](./workflows/multi-agent.md) - Monitor multiple agents
- [Agent Teams](./features/agent-teams.md) - Claude Code team monitoring
- [tmai's Strengths](./guides/strengths.md) - What makes tmai unique
