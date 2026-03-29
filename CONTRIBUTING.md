# Contributing to tmai

Thank you for your interest in contributing to tmai! Contributions of all kinds are welcome.

> **日本語版**: [CONTRIBUTING.ja.md](./CONTRIBUTING.ja.md)

## Development Setup

```bash
git clone https://github.com/trust-delta/tmai
cd tmai
cargo test                    # Run all tests
cargo clippy -- -D warnings   # Lint (CI-equivalent, warnings are errors)
cargo fmt --check             # Format check (CI-equivalent)
```

## Project Structure

```
crates/
├── tmai-core/    # Core library (agents, API, detection, config, git, hooks, etc.)
└── tmai-app/     # Desktop app (in development)
    └── web/      # React frontend (React 19 + TypeScript + Vite + Tailwind v4 + Biome)
src/              # CLI binary (WebUI server + TUI)
web/              # Web Remote frontend (React 19 + TypeScript + Tailwind)
doc/              # Documentation (English + Japanese)
```

## Frontend Development

The main WebUI frontend is in `crates/tmai-app/web/`:

```bash
cd crates/tmai-app/web
pnpm install
pnpm dev          # Vite dev server
pnpm build        # Production build (tsc + vite)
pnpm lint         # Biome lint & format check
pnpm lint:fix     # Auto-fix lint issues
```

CI runs these checks on every PR:

- `biome check src/` — lint & format
- `tsc --noEmit` — type check
- `pnpm build` — build verification

The Web Remote frontend (mobile approval UI) is in `web/`:

```bash
cd web
npm install
npm run build     # Production build
```

## Making Changes

- Create a branch from `main`: `feat/xxx` for features, `fix/xxx` for bug fixes
- Keep commits focused and atomic
- Run the following before pushing:
  - `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt`
  - `cd crates/tmai-app/web && pnpm lint` (if frontend files changed)

## Pull Requests

- PRs are squash-merged into `main`
- All CI checks must pass (Rust: test, clippy, fmt; Frontend: biome, tsc, build)
- Use a descriptive PR title with a conventional prefix (e.g., `feat:`, `fix:`, `chore:`)

## Communication

Issues and Discussions are open in both English and Japanese.
