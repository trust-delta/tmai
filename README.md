# tmai

**Tactful Multi Agent Interface** — monitor, control, and orchestrate multiple AI coding agents (Claude Code, Codex CLI, OpenCode, Gemini CLI) through a unified engine and pluggable UIs.

![License](https://img.shields.io/badge/license-MIT-blue)
![Status](https://img.shields.io/badge/status-active-brightgreen)

<p align="center">
  <img src="assets/tmai-demo.gif" alt="tmai demo" width="720">
</p>

> **This is the project hub.** Implementation lives in a set of focused repositories, linked below. Start here to pick the right one for your question or contribution.

## Repositories

| Repo | Visibility | Role |
|------|-----------|------|
| [`tmai-core`](https://github.com/trust-delta/tmai-core) | private | Core engine — orchestration, agent detection, policy, MCP host, HTTP/SSE server |
| [`tmai-api-spec`](https://github.com/trust-delta/tmai-api-spec) | public | OpenAPI 3.1 + JSON Schema. Wire contract between core and any UI client |
| [`tmai-react`](https://github.com/trust-delta/tmai-react) | public | Reference React WebUI. Forkable, swappable with any client speaking the contract |
| [`tmai-ratatui`](https://github.com/trust-delta/tmai-ratatui) | public | Reference ratatui terminal UI. Peer to `tmai-react` |

## Install

Binary releases for supported platforms are attached to this repo's [Releases page](https://github.com/trust-delta/tmai/releases) (linux x86_64 / linux aarch64 / macOS aarch64 — ETA tracked in [`tmai-core#17`](https://github.com/trust-delta/tmai-core/issues/17) successor tasks).

```bash
# Quick install (planned — once Releases land):
curl -L https://github.com/trust-delta/tmai/releases/latest/download/tmai-$(uname -s | tr A-Z a-z)-$(uname -m).tar.gz | tar xz -C ~/.local/bin
```

Until then, build from source — see [`tmai-core`'s getting started guide](https://github.com/trust-delta/tmai-core/blob/main/doc/getting-started.md) (requires repository access).

## Quick start

```bash
# One-time setup: register HTTP hook receivers in ~/.claude/settings.json
tmai init

# Launch the operational dashboard TUI + API server
tmai
```

The dashboard shows engine health and launches UI clients registered in `~/.config/tmai/config.toml`:

```toml
[[ui]]
name = "tmai-react"
path = "~/src/tmai-react"
launch = "pnpm dev"
port = 1420
default = true
```

## Features

- **Multi-agent monitoring** — Claude Code, Codex CLI, OpenCode, Gemini CLI
- **3-tier state detection** — HTTP Hooks (event-driven) → IPC/PTY wrap → tmux `capture-pane` fallback
- **Auto-approve engine** — rules / AI / hybrid / off
- **Orchestrator agent** — role-based dispatch with workflow-rule composition
- **MCP server** — 22+ tools for agents to orchestrate other agents over stdio JSON-RPC 2.0
- **Dashboard TUI** — engine health, activity, detections, UI registry, logs — all in `tmai` default mode
- **Pluggable UIs** — `tmai-react` (WebUI), `tmai-ratatui` (TUI), or any third-party client speaking the [wire contract](https://github.com/trust-delta/tmai-api-spec)
- **Agent Teams** — Claude Code team discovery and task-progress tracking
- **Git surface** — branch graph, worktree CRUD, PR/CI/issue integration via `gh`

## Contract

UIs integrate via three standard surfaces, all specified in [`tmai-api-spec`](https://github.com/trust-delta/tmai-api-spec):

1. **HTTP REST** at `/api/*`
2. **SSE event stream** at `/api/events`
3. **MCP** (stdio JSON-RPC 2.0) via `tmai mcp`

The spec follows SemVer independently of `tmai-core`. Forward-compatible: unknown event variants and optional fields must be tolerated by UIs.

## Screenshots

<p align="center">
  <img src="assets/usage-view.png" alt="Usage tracking" width="720">
</p>

<p align="center">
  <img src="assets/mobile-screenshot.jpg" alt="Mobile remote — agent list" width="280">
  &nbsp;&nbsp;
  <img src="assets/mobile-ask-user-question.jpg" alt="Mobile remote — AskUserQuestion" width="280">
</p>

## Contributing

Open issues and pull requests on the sub-repo that fits your change:

- **Server logic, orchestration, MCP, HTTP/SSE implementation** → [`tmai-core`](https://github.com/trust-delta/tmai-core/issues) (collaborator access required)
- **React WebUI behaviour** → [`tmai-react`](https://github.com/trust-delta/tmai-react/issues)
- **Ratatui client behaviour** → [`tmai-ratatui`](https://github.com/trust-delta/tmai-ratatui/issues)
- **Wire contract (REST endpoints, CoreEvent variants, error taxonomy)** → [`tmai-api-spec`](https://github.com/trust-delta/tmai-api-spec/issues)

Issues filed here will be triaged and transferred to the appropriate sub-repo.

## History

This repository contains the full git history of tmai from inception through 2026-04-18, when it was split into the four sub-repos above. The last commit before the split is [88bab7d](https://github.com/trust-delta/tmai/commit/88bab7d); everything after is hub / release / landing-page maintenance.

Previous `tmai` crates.io releases (up to `1.7.0`) remain published for backwards compatibility but receive no further updates at that path — new binaries ship via this repo's [Releases](https://github.com/trust-delta/tmai/releases).

## License

MIT — see [LICENSE](LICENSE).
