# tmai

**Tactful Multi Agent Interface** — the exoskeleton a *Producer* agent uses to run multi-project development, and the console you support and observe through.

You talk to one agent per project — the Producer. It remembers your past decisions, tracks what changed (CI, PRs, in-flight work), dispatches a worker when implementation would crowd the conversation, and brings *you* only the decisions that genuinely need a human. tmai is what makes that possible: the continuity layer, the worker spawn/steer surface, the always-on substrate, and the window you watch through.

[![License](https://img.shields.io/github/license/trust-delta/tmai)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/trust-delta/tmai?display_name=tag)](https://github.com/trust-delta/tmai/releases)
[![crates.io](https://img.shields.io/crates/v/tmai)](https://crates.io/crates/tmai)
[![React](https://img.shields.io/github/actions/workflow/status/trust-delta/tmai/build-react.yml?branch=main&label=React)](https://github.com/trust-delta/tmai/actions/workflows/build-react.yml)
[![Ratatui](https://img.shields.io/github/actions/workflow/status/trust-delta/tmai/build-ratatui.yml?branch=main&label=Ratatui)](https://github.com/trust-delta/tmai/actions/workflows/build-ratatui.yml)
[![API spec](https://img.shields.io/github/actions/workflow/status/trust-delta/tmai/validate-spec.yml?branch=main&label=API%20spec)](https://github.com/trust-delta/tmai/actions/workflows/validate-spec.yml)

> **日本語版**: [README.ja.md](./README.ja.md)

<p align="center">
  <img src="assets/tmai-demo.gif" alt="tmai demo" width="720">
</p>

> **This is the tmai monorepo and release hub.** The UI clients (`clients/react/`, `clients/ratatui/`), the wire contract (`api-spec/`), the installer, and the release pipeline live here; only the engine source stays private in [`tmai-core`](https://github.com/trust-delta/tmai-core).

## What tmai is for

Run several coding projects in parallel: one **Producer** per project — a Claude Code session you talk to — and **workers** under it, one bounded-and-report-back agent per repo. The Producer is read-mostly: it holds the project's memory and current decisions, watches what changed, does the mechanical things itself, dispatches a worker when the implementation would crowd the conversation, and routes only the *irreducible* decisions to you — densified, so your scarce review attention goes to the true bottleneck and nothing else.

The bet: a strong model doesn't need a tool to *make its decisions* for it — but a *called* LLM agent is still episodic (it can't run forever), amnesiac (it doesn't learn across sessions), blind inside the workers it spawns, and bounded in context. tmai supplies exactly those structural pieces:

- **continuity** — a fused baseline (cross-project memory ⊕ project decisions ⊕ in-flight handoff) composed and handed to the Producer at session start, so re-entry costs ~0
- **real workers** — spawn a Claude Code session in a repo's worktree with a proper brief, run it, get it back; inspect and steer it
- **an always-on substrate** — a supervisor that outlives episodic sessions, so an event that lands at 3am has somewhere to go
- **observability** — the human's out-of-band window into what a worker is actually doing, which the Producer's summary can't give you

### What tmai is *not*

- **Not an orchestration feature.** tmai does not decide what to launch, when, how to integrate it, or what architecture to use — that's the Producer's reasoning, in an agent's context where it can flex, not calcified into tmai's code. tmai routes; it doesn't build.
- **Not single-project fan-out.** The rate limiter is your review attention, not agent compute — five agents finishing in an hour just queues five hours of review onto your desk. The parallelism that's real lives *across* projects, not inside one.
- **Not a substitute for your judgment.** tmai surfaces the decisions that need you and tracks whether the Producer's confidence was calibrated; it doesn't override the model, and it doesn't pretend a glance-and-approve is a real review. (A thin statement of intent — "this is the contract boundary, push back if it doesn't fit" — is a different thing, and a good one.)

## What tmai requires of you

tmai is opinionated, and the opinion *is* the product. Adopt it and you adopt a discipline it won't let you quietly skip:

- **Purpose and means stay apart.** What you commit to — the outcome you bear — is a *decision*. How you're currently chasing it — the mechanism — is an *approach*, kept cheap to change. They're separate records on purpose: a means dressed up as a commitment is the failure mode, not a shortcut.
- **Only you accept a decision.** The Producer drafts it, argues it, runs the means under it — but it never *accepts* it for you. The one act that binds the project stays a human act, by construction. There is no "the agent decided."
- **Your attention is rationed, not spent.** tmai brings you the decisions that actually need a human, and refuses to pass a glance-and-approve off as a review.

Why force this instead of just going faster? Because the scarce thing is your judgment, not agent compute — and a tool that makes the *wrong* workflow effortless (approve-all, fan out forever, let the agent bless its own work) burns the scarce thing exactly where it should be guarded. The discipline is the floor that keeps *you* bearing the commitments while the agent carries the mechanism.

This is a worldview, and it's the whole point — not a setting to turn off. If what you want is to maximize how much an agent does while you're not looking, tmai is the wrong tool, deliberately. It keeps a seam where you stay in the loop, because that seam *is* the value: remove it and what's left isn't tmai. Better to know that before you install than to discover it by friction.

## The shape

- **You** (episodic) — talk to one Producer per project; decide the irreducible.
- **The Producer** — one per project (a Claude Code session). Holds the baseline, triages what changed, does the mechanical things itself, dispatches workers, writes briefs. Read-mostly: proposes architecture, doesn't decide it; routes, doesn't build.
- **tmai** — the **exoskeleton** the Producer runs on (continuity, worker spawn/steer, always-on substrate) *and* the **console** you support and observe through (WebUI, TUI, mobile remote).
- **Workers** — one per repo: bounded, contract-anchored, report-back Claude Code sessions. A worker never spans repos; tmai does not auto-orchestrate them — coordination across a project's repos is the Producer's reasoning, not tmai's code.

A "project" is a single repo, or the smallest group of repos that share a contract surface toward a common goal (e.g. engine + spec + WebUI). One Producer per project, whatever its repo count.

## Install

Prebuilt bundle tarballs are attached to this repo's [Releases](https://github.com/trust-delta/tmai/releases). Pick the installer that fits your workflow — all three land the same bundle:

### Curl (portable)

```bash
# Latest release into $HOME/.local (default prefix):
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash

# Pinned version + custom prefix:
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh \
  | bash -s -- --version 3.2.0 --prefix /usr/local
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
# One-time setup: register Claude Code hook receivers in ~/.claude/settings.json
tmai init

# Start the engine + operational dashboard TUI (engine health, activity, logs, UI launcher)
tmai

# Open a Producer session for a project (or repo group), with the fused baseline handed in
tmai producer <unit>

# Browse the decision store
tmai decisions
```

`tmai` serves the bundled WebUI automatically — open the URL it prints. For WebUI development (Vite HMR against a `tmai` backend), see [`CONTRIBUTING.md`](CONTRIBUTING.md#local-development).

## What's shipped today

- **Engine** (`tmai-core`, private) — HTTP/SSE API server (`/api/*`, `/api/events`); MCP host (the Producer's tools for dispatching and steering workers, inspecting agents, driving PRs/CI, and acting on prompts — over stdio JSON-RPC 2.0); hook-based agent detection (`attention: started | halted | completed | null`, driven by Claude Code hooks — no polling); and the **workbench**: `tmai producer <unit>` composes the fused baseline and hands it to a Producer session, `tmai decisions` browses the decision store, `tmai handoff` is the in-flight work-state store.
- **React WebUI** (`clients/react/`) — the operator surface today: agent list, live preview via xterm, prompt/approve, multi-pane display modes, mobile remote with `AskUserQuestion` support. On a graduation path toward tmai's own surface — *across multiple projects, check project state while conversing with the Producer* — not an operator dashboard, but a window onto what the Producer sees.
- **Ratatui TUI** (`clients/ratatui/`) — and `tmai`'s default mode is a dashboard TUI: engine health, activity, detections, UI registry, logs, and launching the UI clients. A health viewer + launcher, not an agent-conversation surface.
- **Wire contract** (`api-spec/`) — OpenAPI 3.1 + CoreEvent JSON Schema + MCP tool snapshot. UIs integrate via three standard surfaces: HTTP REST (`/api/*`), the SSE event stream (`/api/events`), and MCP (`tmai mcp`). The spec follows SemVer independently of the engine; UIs must tolerate unknown event variants and optional fields.
- **Git surface** — PR / CI / issue integration via `gh`, worktree CRUD.
- **Install & release** — `install.sh`, the Homebrew tap, the `cargo binstall` metadata stub, and the release workflow that assembles per-target bundle tarballs.

## Direction

The Producer model is being built out, core-first:

- **bottom-up feedback** — a worker that completes a task but noticed *"this works, but a different approach would be better"* writes that down; the Producer periodically synthesizes the accumulated notes and brings tradeoff proposals to you. The channel that keeps the *methodology* from calcifying — distinct from "I'm stuck, decide" (which the Producer catches in real time).
- **idle-gated synthesis** — when you're away, the always-on supervisor wakes the Producer in a retrospective mode; you come back to a dense digest of just the decisions that need you. Preemptible — your session takes priority.
- **the WebUI graduation** above.

The previous "orchestration *as a feature*" model — auto-approve, cron-scheduled launches, automatic CI-event handling — was removed across `v3.0.0`–`v3.x`: a tool that makes the wrong workflow easy is worse than no tool. The design records for all of this live in `tmai-core` (private).

## Structure

| Repo | Visibility | Role |
|------|-----------|------|
| `trust-delta/tmai` (this repo) | public | Release hub + monorepo. Holds the React WebUI (`clients/react/`), ratatui TUI (`clients/ratatui/`), wire contract (`api-spec/`), installer, and docs. Publishes the bundled tarball. |
| [`tmai-core`](https://github.com/trust-delta/tmai-core) | private | Core engine — HTTP/SSE API server, MCP host (the Producer's dispatch/steer tools), hook-based agent detection, the workbench. Ships per-target binaries via `core-v*` Releases; generated spec + types flow here via bot PRs. |
| `tmai-api-spec` / `tmai-react` / `tmai-ratatui` | archive | History-only. Content merged into this repo on 2026-04-23. |

## Contributing

UI / contract / docs / packaging changes happen right here — file issues and PRs against this repo:

- **React WebUI behaviour** → `clients/react/`
- **Ratatui client behaviour** → `clients/ratatui/`
- **Wire contract** (REST endpoints, CoreEvent variants, error taxonomy) → `api-spec/` (generated — edits flow from [`tmai-core`](https://github.com/trust-delta/tmai-core) via bot PRs)
- **Installer / release workflow / docs** → root

Engine-only changes (the MCP host, HTTP/SSE implementation, agent detection, the workbench, the Producer's dispatch tools) happen in the private [`tmai-core`](https://github.com/trust-delta/tmai-core). If you need an engine change, open an issue here and we'll triage it through.

The previous sub-repos — `tmai-api-spec`, `tmai-react`, `tmai-ratatui` — are archived as of 2026-04-23. Please don't file issues or PRs there.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the [local development setup](CONTRIBUTING.md#local-development) (Vite HMR + `tmai` backend), the bot PR recovery flow, and PR conventions. Security reports go through [`SECURITY.md`](SECURITY.md) (GitHub Private Vulnerability Reporting).

## Screenshots

<p align="center">
  <img src="assets/usage-view.png" alt="Usage tracking" width="720">
</p>

<p align="center">
  <img src="assets/mobile-screenshot.jpg" alt="Mobile remote — agent list" width="280">
  &nbsp;&nbsp;
  <img src="assets/mobile-ask-user-question.jpg" alt="Mobile remote — AskUserQuestion" width="280">
</p>

## History

tmai started as a single monorepo (through 2026-04-18), then briefly split into four repositories ([`tmai-core`](https://github.com/trust-delta/tmai-core) + `tmai-api-spec` / `tmai-react` / `tmai-ratatui`). On 2026-04-21 the UI layer and wire contract were consolidated back here under `clients/` and `api-spec/`; the three sub-repos were archived on 2026-04-23. The last pre-split commit is [88bab7d](https://github.com/trust-delta/tmai/commit/88bab7d); the re-consolidation shipped as [`v2.0.0`](https://github.com/trust-delta/tmai/releases/tag/v2.0.0).

From `v3.0.0` (2026-05) tmai inverted: it stopped trying to *be* the orchestration layer ("a smart layer over many agents, supplying what each one lacks") and became the exoskeleton a Producer agent uses — the orchestration *locus* moved from tmai's code to the Producer's reasoning. `v3.0.0`–`v3.x` removed the old-premise subsystems (auto-approve, cron scheduling, automatic CI-event handling) and the Producer workbench landed as the new center.

The `tmai` crate on crates.io now exists as a thin installer-metadata stub: `1.7.0` is the last "real" crate-packaged release (not yanked), `1.7.1` was a deprecation marker, and `2.0.0`+ carry the `cargo binstall` metadata + stub binaries that print a pointer at the real installer if invoked via `cargo install tmai`. Use any of the install paths above instead.

## License

MIT — see [LICENSE](LICENSE).
