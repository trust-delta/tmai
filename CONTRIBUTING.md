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
└── tmai-app/     # Tauri desktop app (in development)
    └── web/      # Tauri app React frontend (React 19 + TypeScript + Tailwind v4)
src/              # CLI binary (TUI + Web server)
web/              # Web Remote frontend (React 19 + TypeScript + Tailwind)
doc/              # Documentation (English + Japanese)
```

## WebUI Development

The WebUI frontend is in `web/`:

```bash
cd web
npm install
npm run dev       # Vite dev server
npm run build     # Production build
```

The Tauri desktop app frontend is in `crates/tmai-app/web/`:

```bash
cd crates/tmai-app/web
pnpm install
pnpm dev          # Vite dev server
pnpm build        # Production build
```

## Making Changes

- Create a branch from `main`: `feat/xxx` for features, `fix/xxx` for bug fixes
- Keep commits focused and atomic
- Run `cargo test`, `cargo clippy -- -D warnings`, and `cargo fmt` before pushing

## Pull Requests

- PRs are squash-merged into `main`
- All CI checks must pass (test, clippy, fmt)
- Use a descriptive PR title with a conventional prefix (e.g., `feat:`, `fix:`, `chore:`)

## Communication

Issues and Discussions are open in both English and Japanese.
