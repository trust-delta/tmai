# tmai

**Tactful Multi Agent Interface** — monitor, control, and orchestrate multiple AI coding agents (Claude Code, Codex CLI, OpenCode, Gemini CLI) through a unified engine and pluggable UIs.

![License](https://img.shields.io/badge/license-MIT-blue)
![Status](https://img.shields.io/badge/status-active-brightgreen)

<p align="center">
  <img src="assets/tmai-demo.gif" alt="tmai demo" width="720">
</p>

> **This is the tmai monorepo and release hub.** UI layer (`clients/react/`, `clients/ratatui/`), wire contract (`api-spec/`), installer, and release pipeline live here; only the engine source stays private in [`tmai-core`](https://github.com/trust-delta/tmai-core).

## Structure

| Repo | Visibility | Role |
|------|-----------|------|
| `trust-delta/tmai` (this repo) | public | Release hub + monorepo. Holds the React WebUI (`clients/react/`), ratatui TUI (`clients/ratatui/`), wire contract (`api-spec/`), installer, and docs. Publishes the bundled tarball. |
| [`tmai-core`](https://github.com/trust-delta/tmai-core) | private | Core engine — orchestration, agent detection, policy, MCP host, HTTP/SSE server. Ships per-target binaries via `core-v*` Releases; generated spec + types flow here via bot PRs. |
| `tmai-api-spec` / `tmai-react` / `tmai-ratatui` | archive | History-only. Content merged into this repo on 2026-04-23. |

## Install

Prebuilt bundle tarballs are attached to this repo's [Releases](https://github.com/trust-delta/tmai/releases). Pick the installer that fits your workflow — all three land the same bundle:

### Curl (portable)

```bash
# Latest release into $HOME/.local (default prefix):
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash

# Pinned version + custom prefix:
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh \
  | bash -s -- --version 2.0.0 --prefix /usr/local
```

### Homebrew (macOS + Linux)

```bash
brew tap trust-delta/tmai
brew install tmai
```

### `cargo binstall` (Rust users)

```bash
cargo binstall tmai
```

Reads the `[package.metadata.binstall]` stanza on the [`tmai`](https://crates.io/crates/tmai) crate and pulls the matching platform tarball from Releases.

### What lands on disk

```
$PREFIX/bin/tmai
$PREFIX/bin/tmai-ratatui
$PREFIX/share/tmai/webui/       # served automatically by tmai (binary-relative fallback)
$PREFIX/share/tmai/api-spec/    # OpenAPI + CoreEvent JSON Schema reference
```

Supported platforms: Linux x86_64, Linux aarch64, macOS arm64. For other platforms, build from source in [`tmai-core`](https://github.com/trust-delta/tmai-core) (requires repository access).

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

UIs integrate via three standard surfaces, all specified in [`api-spec/`](./api-spec/):

1. **HTTP REST** at `/api/*`
2. **SSE event stream** at `/api/events`
3. **MCP** (stdio JSON-RPC 2.0) via `tmai mcp`

The spec follows SemVer independently of the engine (`core`) version. Forward-compatible: unknown event variants and optional fields must be tolerated by UIs.

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

UI / contract / docs / packaging changes happen right here — file issues and PRs against this repo:

- **React WebUI behaviour** → `clients/react/`
- **Ratatui client behaviour** → `clients/ratatui/`
- **Wire contract** (REST endpoints, CoreEvent variants, error taxonomy) → `api-spec/` (generated — edits flow from [`tmai-core`](https://github.com/trust-delta/tmai-core) via bot PRs)
- **Installer / release workflow / docs** → root

Engine-only changes (orchestration, MCP host, HTTP/SSE implementation) happen in the private [`tmai-core`](https://github.com/trust-delta/tmai-core). If you need an engine change, open an issue here and we'll triage it through.

The previous sub-repos — `tmai-api-spec`, `tmai-react`, `tmai-ratatui` — are archived as of 2026-04-23. Please don't file issues or PRs there.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and PR conventions.

## History

tmai started as a single monorepo (through 2026-04-18), then briefly split into four repositories ([`tmai-core`](https://github.com/trust-delta/tmai-core) + `tmai-api-spec` / `tmai-react` / `tmai-ratatui`). On 2026-04-21 the UI layer and wire contract were consolidated back here under `clients/` and `api-spec/`; the three sub-repos were archived on 2026-04-23. The last pre-split commit is [88bab7d](https://github.com/trust-delta/tmai/commit/88bab7d); the re-consolidation shipped as [`v2.0.0`](https://github.com/trust-delta/tmai/releases/tag/v2.0.0).

The `tmai` crate on crates.io now exists as a thin installer-metadata stub: `1.7.0` is the last "real" crate-packaged release (not yanked), `1.7.1` was a deprecation marker, and `2.0.0` carries the `cargo binstall` metadata + stub binaries that print a pointer at the real installer if invoked via `cargo install tmai`. Use any of the install paths above instead.

## License

MIT — see [LICENSE](LICENSE).
