# tmai (deprecated crate)

> ⚠️ **This crates.io entry is deprecated.** See <https://github.com/trust-delta/tmai/releases> for installers.

tmai moved from `cargo install tmai` to binary releases at **v2.0.0** (2026-04-22, monorepo re-consolidation).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash
```

Pinned version or custom prefix:

```bash
curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh \
  | bash -s -- --version 2.0.0 --prefix /usr/local
```

Or grab the tarball directly from <https://github.com/trust-delta/tmai/releases>.

Supported platforms: Linux x86_64, Linux aarch64, macOS arm64.

## Why this change

The 2026-04-21 re-consolidation moved the engine source behind a private repo and made the public surface a bundled tarball (`bin/tmai` + `bin/tmai-ratatui` + `share/tmai/webui/` + `share/tmai/api-spec/`) that a single-file curl installer can unpack. The `cargo install tmai` path cannot ship a multi-artifact bundle, so further updates go through GitHub Releases only.

## About the previous 1.7.0 crate

`tmai 1.7.0` is **not yanked** and remains installable for tooling that pinned that version. It will not receive further updates. Use `1.7.1` or newer via the installer above.

## Repository

<https://github.com/trust-delta/tmai>

## License

MIT — see [LICENSE](LICENSE).
