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

## Bot-managed generated files

The following paths are written exclusively by the `tmai-core` sync bot and **must not be hand-edited**:

| Path | Contents |
|------|----------|
| `clients/react/src/types/generated/` | TypeScript types generated from the Rust source in `tmai-core` |
| `clients/ratatui/src/types/generated/` | Rust types mirrored from `tmai-core` |
| `api-spec/` | OpenAPI spec, JSON Schema, MCP snapshot — all generated |

CI rejects any PR where a human author touches these paths.  If you see a
`Hand edits detected in bot-managed paths` failure on your PR, remove those
file changes and open the issue in `tmai-core` instead.

### Bot PR recovery flow

When a sync bot PR fails because consuming code references a renamed or removed
generated symbol, apply a **minimal fix to the consuming code** — never edit the
generated files themselves.

**Steps**

1. Check out the bot branch locally:
   ```sh
   git fetch origin
   git checkout <bot-branch-name>
   ```
2. Open only the consuming files that reference the broken symbol and update
   the references.  Do **not** touch anything under `generated/` or `api-spec/`.
3. Commit and push back to the same bot branch:
   ```sh
   git add <changed files>
   git commit -m "fix: update consuming code for <symbol rename>"
   git push origin <bot-branch-name>
   ```
4. CI re-runs automatically.  Merge once all jobs are green.

**Worked example — PR #520 (`TaskMetaSnapshot` rename)**

`tmai-core` renamed `TaskMetaEntry` → `TaskMetaSnapshot`.  The sync bot PR
updated all generated files correctly, but `src/types/index.ts` still
re-exported the old name and broke the TypeScript build.

Fix applied in commit `0a1443f`:
```diff
// clients/react/src/types/index.ts
-export type { TaskMetaEntry } from "./generated/TaskMetaSnapshot";
+export type { TaskMetaSnapshot } from "./generated/TaskMetaSnapshot";
```

Only `src/types/index.ts` (consuming code) was touched; the generated files
were left untouched.

### Phase 1 transition note

During Phase 1 of the snapshot-contract migration the React client must accept
**both** legacy `diff`-style CoreEvents **and** the new `EntityUpdateEnvelope`
wrapper emitted by tmai-core ≥ the contract boundary.  Phase 3 will retire the
legacy path; until then, keep both branches in SSE event handlers.

## Issues

File issues here for anything in the list above. For engine-side bugs, still open the issue here — we'll reproduce / triage and hand it over to the engine side if needed.

## Language

Issues and Discussions may be filed in English or Japanese.
