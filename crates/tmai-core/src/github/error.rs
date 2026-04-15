//! `GhError` — unified error type for all GitHub operations.
//!
//! Variants are derived by classifying `gh` CLI stderr patterns so callers
//! can react (retry, prompt the user to reauth, surface a clear install
//! message) without re-parsing free-form text at every site.

use std::io;

/// Error returned by [`crate::github::GhClient`] methods.
#[derive(Debug, thiserror::Error)]
pub enum GhError {
    /// `gh` binary missing from PATH or not executable.
    ///
    /// Surfaced as a single "install gh" guidance path instead of each call
    /// site re-wording the `No such file or directory` message.
    #[error("gh CLI not installed or not on PATH; see https://cli.github.com/")]
    GhNotInstalled,

    /// User is not authenticated or their session expired.
    ///
    /// `gh` reports this as "authentication required" or
    /// "HTTP 401: Bad credentials" on stderr. Callers should prompt the user
    /// to run `gh auth login` / `gh auth refresh`.
    #[error("gh authentication expired or missing; run `gh auth login` or `gh auth refresh`")]
    AuthExpired,

    /// GitHub REST / GraphQL rate limit hit. Mapped from "API rate limit
    /// exceeded" / "secondary rate limit" patterns in stderr.
    #[error("GitHub API rate limit exceeded; wait and retry")]
    RateLimited,

    /// TCP/DNS/TLS failure reaching api.github.com.
    #[error("network error contacting GitHub: {0}")]
    Network(String),

    /// `gh` exited 0 but its JSON output did not match the expected schema.
    /// Typically signals a `gh` version skew we did not account for.
    #[error("failed to parse gh output: {0}")]
    ParseError(String),

    /// Fallback for `gh` failures that don't fit any other variant. Keeps the
    /// raw stderr for diagnostics.
    #[error("{0}")]
    Other(String),
}

impl GhError {
    /// Classify a raw stderr string (trimmed) produced by a failed `gh`
    /// invocation into the most specific variant. Falls back to
    /// [`GhError::Other`] preserving the stderr content.
    ///
    /// Pattern-matching is intentionally permissive: `gh` wording has drifted
    /// across releases, so we key off stable substrings rather than exact
    /// phrases.
    pub fn classify_stderr(stderr: &str) -> Self {
        let lower = stderr.to_ascii_lowercase();
        if lower.contains("authentication required")
            || lower.contains("gh auth login")
            || lower.contains("http 401")
            || lower.contains("bad credentials")
        {
            return GhError::AuthExpired;
        }
        if lower.contains("rate limit") {
            return GhError::RateLimited;
        }
        if lower.contains("could not resolve host")
            || lower.contains("network is unreachable")
            || lower.contains("connection refused")
            || lower.contains("dial tcp")
            || lower.contains("context deadline exceeded")
        {
            return GhError::Network(stderr.to_string());
        }
        GhError::Other(stderr.to_string())
    }

    /// Classify a spawn/io failure when launching `gh` itself. `NotFound`
    /// means the binary is absent from PATH; anything else is bucketed as
    /// network/IO until we see a case that warrants its own variant.
    pub fn from_spawn_error(err: io::Error) -> Self {
        if err.kind() == io::ErrorKind::NotFound {
            GhError::GhNotInstalled
        } else {
            GhError::Other(format!("failed to run gh: {err}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_auth_expired() {
        let err = GhError::classify_stderr("gh auth login required");
        assert!(matches!(err, GhError::AuthExpired));
        let err = GhError::classify_stderr("HTTP 401: Bad credentials");
        assert!(matches!(err, GhError::AuthExpired));
    }

    #[test]
    fn classify_rate_limited() {
        let err = GhError::classify_stderr("API rate limit exceeded for user");
        assert!(matches!(err, GhError::RateLimited));
    }

    #[test]
    fn classify_network() {
        let err = GhError::classify_stderr("could not resolve host: api.github.com");
        assert!(matches!(err, GhError::Network(_)));
    }

    #[test]
    fn classify_other_preserves_stderr() {
        let err = GhError::classify_stderr("weird gh message");
        match err {
            GhError::Other(s) => assert_eq!(s, "weird gh message"),
            _ => panic!("expected Other"),
        }
    }

    #[test]
    fn from_spawn_error_notfound_maps_to_gh_not_installed() {
        let io = io::Error::from(io::ErrorKind::NotFound);
        assert!(matches!(
            GhError::from_spawn_error(io),
            GhError::GhNotInstalled
        ));
    }

    #[test]
    fn from_spawn_error_other_kinds_map_to_other() {
        let io = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(matches!(GhError::from_spawn_error(io), GhError::Other(_)));
    }
}
