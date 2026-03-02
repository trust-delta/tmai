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
