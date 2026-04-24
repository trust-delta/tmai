# tmai

> ℹ️ This `tmai` crate is a thin installer-metadata stub. The real binary is distributed from [GitHub Releases](https://github.com/trust-delta/tmai/releases).

## Install

### `cargo binstall` (recommended for Rust users)

```bash
cargo binstall tmai
```

Reads this crate's `[package.metadata.binstall]` and downloads the bundled tarball matching your platform (Linux x86_64 / Linux aarch64 / macOS arm64) from GitHub Releases.

### Curl installer

```bash
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash
```

### Direct tarball

Download from <https://github.com/trust-delta/tmai/releases> and unpack manually.

### `cargo install tmai` (not recommended)

`cargo install tmai` compiles this stub crate; the resulting `tmai` and `tmai-ratatui` binaries just print a pointer at the real installer. Use one of the methods above instead.

## What's in the bundle

- `bin/tmai` — core engine + orchestration + MCP host
- `bin/tmai-ratatui` — reference TUI client
- `share/tmai/webui/` — reference React WebUI (served automatically)
- `share/tmai/api-spec/` — OpenAPI + CoreEvent JSON Schema reference

## Version history

- `1.7.0` — last crate-packaged release before the 2026-04-21 monorepo re-consolidation. Not yanked.
- `1.7.1` — deprecation stub published on 2026-04-24.
- `2.0.0` (this release) — installer metadata for `cargo binstall` + backwards-compatible stub binaries.

## Links

- Source, docs, installer: <https://github.com/trust-delta/tmai>
- Changelog: <https://github.com/trust-delta/tmai/blob/main/CHANGELOG.md>

## License

MIT — see [LICENSE](LICENSE).
