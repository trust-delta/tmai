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

## Local development

Layout of the runtime when running locally:

- **tmai-core** owns an HTTP/SSE server on port **9876** (default, from `web.port` in `~/.config/tmai/config.toml`). It also serves the bundled WebUI from a `share/tmai/webui/` directory when one is found.
- **clients/react** is a Vite app on port **1420** with `/api` proxied to `http://localhost:9876` (see `clients/react/vite.config.ts`).

Pick the workflow that matches what you're changing.

### (A) UI iteration — Vite HMR against an installed `tmai`

Fastest loop for React-only work. Uses whatever `tmai` is on your PATH (release tarball, `cargo install`, etc.) as the backend.

```sh
# Terminal 1 — backend
tmai

# Terminal 2 — frontend (Vite dev, HMR)
cd clients/react
pnpm install   # first time only
pnpm dev       # http://localhost:1420
```

Open `http://localhost:1420`. Vite proxies `/api`, `/api/events` (SSE), and `/api/agents/{id}/terminal` (WS) to the running `tmai`.

### (B) UI + engine HEAD (collaborator-only)

Same as (A) but swap the backend for a `cargo run` build of the private `tmai-core` repo. Requires collaborator access to `trust-delta/tmai-core`.

```sh
# Terminal 1 — engine HEAD
cd path/to/tmai-core
cargo run --release

# Terminal 2 — same as (A)
cd clients/react && pnpm dev
```

### (C) Production-shape check — built UI served by `tmai`

Verify the bundle the release pipeline will ship.

```sh
cd clients/react && pnpm build   # → clients/react/dist
```

Then point `tmai` at the build with one of:

- **`web.webui_path` in `~/.config/tmai/config.toml`** — set it to the absolute path of `clients/react/dist`. `tmai-core` looks for `index.html` directly under that path.
- **`TMAI_SHARE` env** — only useful when the directory layout matches the release tarball (`$TMAI_SHARE/webui/index.html`); for an ad-hoc `dist/` use `web.webui_path` instead.

Resolution order (`tmai-core/src/web/server.rs::resolve_webui_dir`): `TMAI_SHARE` → `web.webui_path` → binary-relative `<exe>/../share/tmai/webui/`.

Open `http://localhost:9876`.

## Issues

File issues here for anything in the list above. For engine-side bugs, still open the issue here — we'll reproduce / triage and hand it over to the engine side if needed.

## Language

Issues and Discussions may be filed in English or Japanese.
