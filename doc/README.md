# tmai Documentation

Tactful Multi Agent Interface — a WebUI dashboard for monitoring and controlling multiple AI coding agents (Claude Code, Codex CLI, Gemini CLI). Optional TUI mode available via `--tmux`.

**[日本語版はこちら](./ja/README.md)**

## Getting Started

- [Getting Started](./getting-started.md) - Installation to first monitoring

## WebUI Features

Desktop WebUI features (default mode).

- [WebUI Overview](./features/webui-overview.md) - Architecture, layout, and real-time updates
- [Branch Graph](./features/branch-graph.md) - Interactive Git commit graph with lane-based visualization
- [GitHub Integration](./features/github-integration.md) - PR status, CI checks, and issue tracking
- [Worktree Management](./features/worktree-ui.md) - Create, delete, and manage Git worktrees from the UI
- [Terminal Panel](./features/terminal-panel.md) - Full terminal with xterm.js and WebSocket I/O
- [Agent Spawn](./features/agent-spawn.md) - Launch new agents from the WebUI
- [Markdown Viewer](./features/markdown-viewer.md) - Browse and edit project documentation
- [File Browser](./features/file-browser.md) - Directory browser with file viewing and editing
- [Security Panel](./features/security-panel.md) - Claude Code config audit and risk detection
- [Usage Tracking](./features/usage-tracking.md) - Token usage monitoring for Claude subscriptions

## Core Features

Features available in both WebUI and TUI modes.

- [Claude Code Hooks](./features/hooks.md) - Event-driven state detection via HTTP hooks (recommended)
- [MCP Server](./features/mcp-server.md) - Expose tmai as an MCP server for agent orchestration
- [PTY Wrapping](./features/pty-wrapping.md) - High-precision state detection via PTY proxy
- [Auto-Approve](./features/auto-approve.md) - AI-powered automatic approval
- [Agent Teams](./features/agent-teams.md) - Claude Code team monitoring and visualization
- [AskUserQuestion Support](./features/ask-user-question.md) - Number key selection
- [Exfil Detection](./features/exfil-detection.md) - Security monitoring for data transmission
- [Mobile Remote Control](./features/web-remote.md) - Smartphone control via QR code
- [Fresh Session Review](./features/fresh-session-review.md) - Automatic code review on agent completion

## Workflows

Use-case specific guides.

- [Issue-Driven Orchestration](./workflows/issue-driven-orchestration.md) - Main agent dispatches issues to parallel sub-agents via worktrees **(recommended)**
- [Parallel Development with Worktrees](./workflows/worktree-parallel.md) - Git worktree workflow for parallel branches
- [Multi-Agent Monitoring](./workflows/multi-agent.md) - Monitor multiple agents simultaneously
- [Single Agent Monitoring](./workflows/single-agent.md) - Basic usage
- [Remote Approval](./workflows/remote-approval.md) - Approve from your smartphone

## Guides

- [tmai's Strengths](./guides/strengths.md) - What makes tmai unique
- [Best Practices](./guides/best-practices.md) - Recommended workflows

## Reference

- [Configuration](./reference/config.md) - Config file options and CLI flags
- [TUI Mode](./features/tui-mode.md) - ratatui terminal UI for tmux users
- [Keybindings](./reference/keybindings.md) - TUI keyboard shortcuts
- [Web API](./reference/web-api.md) - REST API, SSE events, and WebSocket endpoints
