//! # tmai (deprecated)
//!
//! This crate is deprecated as of `1.7.1`. tmai moved to binary-only distribution
//! at `v2.0.0` (2026-04-22, monorepo re-consolidation).
//!
//! Install tmai from GitHub Releases instead:
//! <https://github.com/trust-delta/tmai/releases>
//!
//! ```sh
//! curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash
//! ```
//!
//! The previous `tmai 1.7.0` crate is not yanked and remains available for
//! tooling pinned to that version; no further updates ship via crates.io.

#![deny(missing_docs)]

/// Pointer at the new distribution channel. Present so `cargo install tmai` or
/// `cargo add tmai` users who look inside the crate see where the project lives.
#[deprecated(
    since = "1.7.1",
    note = "Install tmai from https://github.com/trust-delta/tmai/releases — this crates.io entry is frozen."
)]
pub const DEPRECATED_NOTICE: &str =
    "tmai is now distributed as a binary release. See https://github.com/trust-delta/tmai/releases";
