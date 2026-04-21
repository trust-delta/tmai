# tmai-api-spec

> 🏠 **Project hub**: [`trust-delta/tmai`](https://github.com/trust-delta/tmai) — start there for binary installs, overview, and a map of all sub-repos.

Public API contracts for **tmai**, published as the stable interface between its private core and its public UI clients.

```
                                    (public)
            ┌──────────────────────── tmai-api-spec ─────────────────────────┐
            │  openapi.json · corevents.schema.json · docs/errors.md · docs/ │
            └────▲───────────────────────────────────────────────────▲───────┘
                 │ publishes the public contract                     │ consumes
                 │                                                   │
          ┌──────┴──────┐                              ┌─────────────┴──────────┐
          │  tmai-core  │                              │       tmai-react       │
          │  (private)  │ ◀─── HTTP / SSE / MCP ──────▶│ (public WebUI client)  │
          └─────────────┘                              └────────────────────────┘
```

- **[`tmai-core`](https://github.com/trust-delta/tmai-core)** — private, language-agnostic server that owns the live agent / dispatch state and implements the API.
- **`tmai-api-spec`** (this repo, public) — the only authoritative description of what `tmai-core` exposes. All downstream clients build against this.
- **[`tmai-react`](https://github.com/trust-delta/tmai-react)** — public React WebUI; a reference consumer of the spec. Third-party UIs (TUIs, mobile, other automations) consume the same spec.

## What lives here

| File                           | Purpose |
|--------------------------------|---------|
| `openapi.json`                 | OpenAPI 3.1 document describing the HTTP REST API served by `tmai-core`, including the `TmaiError` / `ErrorCode` / `RetryHint` taxonomy reused across every surface |
| `corevents.schema.json`        | JSON Schema (2020-12) for every `CoreEvent` variant emitted on the `/api/events` SSE stream |
| `docs/errors.md`               | Human-readable error taxonomy — per-code semantics, typical `context`, typical `retry_hint` |
| `docs/index.html`              | Redoc-based documentation viewer with links to the JSON Schema and error taxonomy (published via GitHub Pages) |

Future additions (planned):

- `mcp-tools.json` — snapshot of MCP `tools/list` output from `tmai-core`
- Versioned directories (`v0.1.0/`, `v0.2.0/`, ...) for historical specs

## Versioning

This repository follows [SemVer](https://semver.org/) on the API spec itself, independently of `tmai-core` internal versioning.

- **v0.x**: breaking changes are permitted — the API surface is still stabilizing
- **v1.0**: stability declaration, after the following milestones land in `tmai-core`:
  - Orchestrator v2 (policy + LLM) stable under dogfooding
  - AutoActionExecutor MVP (3 scenarios) established
  - Producer Layer minimum implementation shipped

The served HTTP API uses a URL prefix (`/api/v1/`) to version breaking changes.

## Forward compatibility rules for UI clients

When consuming this spec from a UI client (`tmai-ratatui`, `tmai-react`, or a third-party UI):

- **Unknown CoreEvent variants MUST be ignored** — new event variants will be added as non-breaking changes.
- **Unknown optional fields SHOULD be tolerated** — new optional fields will be added without a version bump.
- **Required field changes, type changes, endpoint removals** trigger a major version bump.

## Building a UI on this spec

`tmai-core` exposes the following contract surfaces:

1. **HTTP REST** (this repository's `openapi.json`)
2. **SSE event stream** at `/api/events` — forthcoming JSON Schema documents each `CoreEvent` variant
3. **MCP** (stdio JSON-RPC 2.0) — `tools/list` snapshot forthcoming

UI clients can choose any subset of these channels. The standard UIs `tmai-ratatui` (Rust TUI) and `tmai-react` (React WebUI) both use HTTP + SSE; MCP is primarily consumed by Claude Code.

## Documentation

Hosted at https://trust-delta.github.io/tmai-api-spec/ (Redoc-rendered).

## Changelog

### v1.8.0 (additive — minor bump)

- **`QueuedPrompt` schema** added to `openapi.json` → `components.schemas`. References existing `ActionOrigin`.
- **`GET /agents/{id}/prompt-queue`** — enumerate the FIFO queue for an agent (oldest-first). Returns `404` only when the agent itself is unknown.
- **`DELETE /agents/{id}/prompt-queue/{prompt_id}`** — cancel a single queued prompt. Returns `200 { status: "cancelled" | "already_drained" }`. Deleting an unknown `prompt_id` under a **known** agent returns `already_drained` (idempotent); `404` is reserved for unknown agents. Servers MUST NOT 500 on unknown prompt IDs.
- **`PromptQueueChanged` SSE variant** added to `corevents.schema.json`. Emitted on enqueue, drain, and cancel; carries the full updated queue. Consumers SHOULD tolerate this variant silently if they do not yet consume it (forward-compatibility rule).

### v0.1.0 — contract-layer bootstrap

## Status

**v1.8.0.** The initial PoC endpoint (`GET /api/task-meta`, migrated from `tmai-core` issue #446) now sits alongside the full `TmaiError` / `ErrorCode` / `RetryHint` taxonomy (issue #2), `corevents.schema.json` covering every `CoreEvent` variant including the contract-layer additions (issue #1), and the prompt-queue contract (`QueuedPrompt`, `GET`/`DELETE /agents/{id}/prompt-queue`, `PromptQueueChanged` SSE — issue #5). The remaining ~79 REST endpoints will be added incrementally; breaking changes are permitted at any time during v0.x.

## License

MIT — see [LICENSE](LICENSE).
