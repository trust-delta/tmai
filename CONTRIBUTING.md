# Contributing to tmai

Thanks for your interest in contributing! This repository is the **tmai monorepo and release hub** — UI layer, wire contract, installer, and release pipeline all live here. File issues and pull requests against this repo for those surfaces; engine-only work happens in the private [`tmai-core`](https://github.com/trust-delta/tmai-core).

> **日本語版**: [CONTRIBUTING.ja.md](./CONTRIBUTING.ja.md)

## Where to contribute

| Change area | Where |
|-------------|-------|
| React WebUI behaviour | `clients/react/` (this repo) |
| Ratatui client behaviour | `clients/ratatui/` (this repo) |
| Wire contract — REST endpoints, CoreEvent variants, error taxonomy | `api-spec/` (this repo, generated — edits flow from [`tmai-core`](https://github.com/trust-delta/tmai-core) via bot PRs; hand edits are rejected by CI) |
| Installer, release workflow, bundle version pin | `install.sh` / `.github/workflows/` / `versions.toml` (this repo) |
| Docs, landing page, screenshots | `README.md` / `README.ja.md` / `CHANGELOG.md` / `assets/` (this repo) |
| Server logic, orchestration, MCP, HTTP/SSE implementation | private [`tmai-core`](https://github.com/trust-delta/tmai-core) (collaborator access required) |

The previous sub-repos (`tmai-api-spec`, `tmai-react`, `tmai-ratatui`) were archived on 2026-04-23 — don't file issues or PRs there.

## What belongs here

- `clients/react/` — React WebUI source and tests
- `clients/ratatui/` — ratatui client source and tests
- `api-spec/` — generated OpenAPI + JSON Schema + MCP snapshot (hand edits rejected by CI; the generator lives in `tmai-core`)
- `.github/workflows/` — release / validation / pages workflows
- `install.sh` — curl-pipeable installer
- `versions.toml` — bundle version pin read by `release.yml`
- `README.md` / `README.ja.md` / `CHANGELOG.md` / `LICENSE` / `assets/` — landing / docs / media

## Issues

File issues here for anything in the list above. For engine-side bugs, still open the issue here — we'll reproduce / triage and hand it over to the engine side if needed.

## Language

Issues and Discussions may be filed in English or Japanese.
