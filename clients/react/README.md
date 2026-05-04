# tmai-react

> 🏠 **Project hub**: [`trust-delta/tmai`](https://github.com/trust-delta/tmai) — start there for binary installs, the bundled tarball, and the cross-client overview.

The reference React WebUI for [tmai](https://github.com/trust-delta/tmai) — a TypeScript client that speaks the HTTP + SSE contract published in [`api-spec/`](../../api-spec/) at the root of this monorepo.

## Where this lives

`tmai` is a single public monorepo. UI clients (this React app and the [ratatui TUI](../ratatui/)), the wire contract (`api-spec/`), and the release pipeline ship together. Only the engine source remains private:

| Path / repo                                                                | Role                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `clients/react/` (this directory)                                          | React reference WebUI — what this README describes.                                  |
| `clients/ratatui/`                                                         | Ratatui TUI client — alternate UI speaking the same contract.                       |
| `api-spec/`                                                                | OpenAPI 3.1 + JSON Schema for SSE / MCP. The wire contract.                         |
| [`trust-delta/tmai-core`](https://github.com/trust-delta/tmai-core)        | Private engine (orchestration, MCP host, HTTP/SSE server). Closed for IP protection.|

The 2026-04 era three-repo split (`tmai-core` / `tmai-api-spec` / `tmai-react` as separate repos) was reversed in the [monorepo reconsolidation](https://github.com/trust-delta/tmai/releases/tag/v2.0.0). The two pre-split sub-repos that held UI and contract code (`tmai-react`, `tmai-api-spec`) are archived; their content lives here.

The UI never imports from `tmai-core` directly — all coupling goes through the local `api-spec/` contract.

## Stack

- React 19 + TypeScript
- Vite (build) + Biome (lint/format)
- Tailwind CSS v4 (no shadcn/ui)
- xterm.js (terminal emulation)
- @xyflow/react (graph views)

## Development

```bash
pnpm install        # or: npm install
pnpm dev            # vite dev server on :1420
pnpm build          # production bundle → dist/
pnpm lint           # biome check
pnpm test           # vitest
```

### Running against tmai-core locally

The dev server expects a running `tmai-core` instance on localhost. `tmai-core` is private, so you need access to that repo to self-host it; there is no public managed endpoint. Point the UI at your local core via the env var `VITE_TMAI_API` (see `vite.config.ts`).

For end-users, the production build is bundled and served by `tmai-core` itself — install via the [project hub README](../../README.md#install) and the WebUI is reachable at the URL printed by `tmai`.

## Contract

This frontend consumes:

- **HTTP REST** at `/api/*` — endpoints defined in [`api-spec/openapi.json`](../../api-spec/openapi.json).
- **SSE event stream** at `/api/events` — `CoreEvent` payloads typed by `src/types/generated/`.

TypeScript types under `src/types/generated/` are **sourced from `api-spec/`** — do not hand-edit. See [src/types/README.md](src/types/README.md) for how the sync works (bot PRs from `tmai-core`'s `gen-spec-pr` workflow drive both `api-spec/` and the regenerated TS types in lockstep).

Forward-compatibility rule: **unknown `CoreEvent` variants MUST be ignored** so newer `tmai-core` versions don't break older UI builds.

## Building alternative UIs

`tmai-react` is one of several possible UIs. The contract is intentionally UI-agnostic — use Vue, Svelte, Solid, or anything else that speaks HTTP + SSE. Fork from this directory as a starting point, or begin from scratch against `api-spec/`.

## Versioning

This package's version is independent from the bundle release. Each `v<X.Y.Z>` tag on the monorepo (release artifacts under [Releases](https://github.com/trust-delta/tmai/releases)) pins a specific `tmai-react` version via [`versions.toml`](../../versions.toml). [`CHANGELOG.md`](CHANGELOG.md) maps react versions to bundle tags.

## Contributing

UI changes happen here. See the [project root `CONTRIBUTING.md`](../../CONTRIBUTING.md) for the local dev setup (Vite HMR + `tmai` backend), bot PR recovery flow for generated artifacts, and PR conventions.

## License

MIT — see [`LICENSE`](../../LICENSE) at the repo root.
