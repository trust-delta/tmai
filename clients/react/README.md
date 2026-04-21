# tmai-react

> 🏠 **Project hub**: [`trust-delta/tmai`](https://github.com/trust-delta/tmai) — start there for binary installs, overview, and a map of all sub-repos.

Public reference WebUI for [tmai-core](https://github.com/trust-delta/tmai-core) — a React/TypeScript client that speaks the HTTP + SSE contract defined by [tmai-api-spec](https://github.com/trust-delta/tmai-api-spec).

## Repository layout

tmai was split into three repositories in April 2026:

| Repo            | Visibility | Role                                                                           |
| --------------- | ---------- | ------------------------------------------------------------------------------ |
| `tmai-core`     | private    | Rust backend + agent runtime. Closed for IP protection.                        |
| `tmai-api-spec` | public     | OpenAPI document + generated TypeScript types. The wire contract.              |
| `tmai-react`    | public     | This repo. A reference UI built against `tmai-api-spec`.                       |

The UI never imports from `tmai-core` directly — all coupling goes through `tmai-api-spec`.

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

The dev server expects a running `tmai-core` instance on localhost. `tmai-core` is private, so you need access to the repo to self-host it; there is no public managed endpoint. Point the UI at your local core via environment variables (see `vite.config.ts`).

## Contract

This frontend consumes:

- **HTTP REST API** — endpoints defined in [tmai-api-spec/openapi.json](https://github.com/trust-delta/tmai-api-spec/blob/main/openapi.json)
- **SSE event stream** at `/api/events` — `CoreEvent` payloads typed by `src/types/generated/`

TypeScript types under `src/types/generated/` are **sourced from `tmai-api-spec`** — do not hand-edit. See [src/types/README.md](src/types/README.md) for how to sync them.

Forward-compatibility rule: **unknown `CoreEvent` variants MUST be ignored** so newer `tmai-core` versions don't break older UI builds.

## Building alternative UIs

`tmai-react` is one of several possible UIs. The contract is intentionally UI-agnostic — use Vue, Svelte, Solid, or anything else that speaks HTTP + SSE. Fork this repo as a starting point, or begin from scratch against `tmai-api-spec`.

## Changelog

`CHANGELOG.md` is generated automatically by [git-cliff](https://git-cliff.org/) from
[Conventional Commit](https://www.conventionalcommits.org/) messages — do not hand-edit it.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the release workflow and commit conventions.

## Status

Extracted from the original [tmai](https://github.com/trust-delta/tmai) monorepo on 2026-04-18 as part of the hybrid private-core reorganization.

## License

MIT — see [LICENSE](LICENSE).
