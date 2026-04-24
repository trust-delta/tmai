//! # tmai
//!
//! Thin crates.io entry for [trust-delta/tmai](https://github.com/trust-delta/tmai).
//! The full binary bundle (engine + WebUI + ratatui TUI + api-spec) lives on
//! GitHub Releases; this crate exists so that `cargo binstall tmai`
//! (and, as a fallback, `cargo install tmai` for the stub binaries) keep
//! working.
//!
//! ## Install
//!
//! ```sh
//! cargo binstall tmai
//! # or
//! curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash
//! ```
//!
//! ## Version history
//!
//! - `1.7.0`: last crate-packaged release before the 2026-04-21 monorepo
//!   re-consolidation. Not yanked.
//! - `1.7.1`: deprecation stub published on 2026-04-24 pointing at the new
//!   installer path.
//! - `2.0.0` (this release): installer metadata for `cargo binstall` + stub
//!   binaries that print a pointer for anyone who still runs `cargo install`.

#![deny(missing_docs)]

/// Canonical distribution URL. Kept as a `pub const` so any crate that
/// referenced `tmai::DEPRECATED_NOTICE` from 1.7.1 still compiles.
pub const DISTRIBUTION_URL: &str = "https://github.com/trust-delta/tmai/releases";

/// Back-compat alias for the 1.7.1 stub constant.
#[deprecated(
    since = "2.0.0",
    note = "Use `tmai::DISTRIBUTION_URL` or install via `cargo binstall tmai`."
)]
pub const DEPRECATED_NOTICE: &str = DISTRIBUTION_URL;
