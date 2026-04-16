//! Structured error taxonomy for tmai contract-layer APIs (#458).
//!
//! Every failure that crosses a contract boundary (MCP, WebUI, CLI, internal
//! facade API) is expressed as a [`TmaiError`] carrying a machine-readable
//! [`ErrorCode`], a human-readable `message`, an optional [`RetryHint`], and
//! structured `context`. Callers then dispatch on `code` instead of parsing
//! free-form strings.
//!
//! # Versioning
//!
//! `ErrorCode` values are **stable forever once added** — deprecations get
//! aliases, never removals. Adding a new code is a minor-version bump. The
//! taxonomy version is exposed as [`TAXONOMY_VERSION`] so callers can
//! detect schema upgrades.
//!
//! # Serialization shape
//!
//! `TmaiError` serializes as a flat JSON object with `code`, `message`,
//! `retry_hint`, `context`, and `trace_id`. `ErrorCode` uses the default
//! serde enum representation (external tagging via the variant name as a
//! string), so new codes added later do not invalidate existing payloads.
//!
//! ```
//! use tmai_core::error::{ErrorCode, RetryHint, TmaiError};
//!
//! let err = TmaiError::new(ErrorCode::AgentNotFound, "agent not found: main:0.0")
//!     .with_context(serde_json::json!({ "target": "main:0.0" }))
//!     .with_retry_hint(RetryHint::NotRetryable);
//! let json = serde_json::to_string(&err).unwrap();
//! assert!(json.contains("\"code\":\"AgentNotFound\""));
//! ```

use serde::{Deserialize, Serialize};

mod from_api_error;

#[cfg(test)]
mod tests;

/// Current version of the error taxonomy.
///
/// Exposed on the MCP server info and WebUI `/api/version` so callers can
/// detect when new codes or fields are added. Bump this whenever a new
/// [`ErrorCode`] variant is introduced or a field on [`TmaiError`] changes
/// semantics.
pub const TAXONOMY_VERSION: &str = "1";

/// Machine-readable error code — stable across releases.
///
/// Added codes **never** get removed: deprecations are handled with serde
/// aliases so old payloads still deserialize. Callers switch on this value
/// instead of `message` text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(export, export_to = "../../tmai-app/web/src/types/generated/")
)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[non_exhaustive]
pub enum ErrorCode {
    // -----------------------------------------------------------------
    // Capacity & availability
    // -----------------------------------------------------------------
    /// Capacity limit reached (e.g. max dispatchable agents, queue depth).
    CapacityExceeded,
    /// A downstream vendor is temporarily unavailable (rate limit, outage).
    VendorUnavailable,
    /// A bounded queue is full and the caller should retry later.
    QueueFull,

    // -----------------------------------------------------------------
    // State / lifecycle
    // -----------------------------------------------------------------
    /// The referenced agent does not exist in the current state.
    AgentNotFound,
    /// The agent exists but is in a terminal state (exited, killed) and
    /// cannot accept the requested operation.
    AgentInTerminalState,
    /// A worktree operation failed due to a conflict (name in use, dirty
    /// working tree, still-running agent).
    WorktreeConflict,

    // -----------------------------------------------------------------
    // Permissions / auth
    // -----------------------------------------------------------------
    /// Caller is authenticated but not authorized for this operation.
    PermissionDenied,
    /// Credential / token was missing, expired, or invalid.
    TokenInvalid,

    // -----------------------------------------------------------------
    // Input / request
    // -----------------------------------------------------------------
    /// A request argument failed validation (out-of-range, malformed).
    InvalidArgument,
    /// Request body or tool-input schema did not match the expected shape.
    SchemaMismatch,

    // -----------------------------------------------------------------
    // Downstream
    // -----------------------------------------------------------------
    /// A vendor-originating failure (non-availability).
    ///
    /// The raw vendor error is preserved in `context.vendor_error`; the
    /// `message` is a tmai-authored summary.
    VendorError,
    /// A tmux command failed (spawn, new-window, send-keys).
    TmuxError,
    /// An IPC channel failed or was disconnected.
    IpcError,

    // -----------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------
    /// Fallback for unexpected internal failures. New call sites should
    /// prefer a more specific code where one exists.
    Internal,
}

impl ErrorCode {
    /// Short, kebab-cased string used in logs, metrics, and docs.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CapacityExceeded => "capacity_exceeded",
            Self::VendorUnavailable => "vendor_unavailable",
            Self::QueueFull => "queue_full",
            Self::AgentNotFound => "agent_not_found",
            Self::AgentInTerminalState => "agent_in_terminal_state",
            Self::WorktreeConflict => "worktree_conflict",
            Self::PermissionDenied => "permission_denied",
            Self::TokenInvalid => "token_invalid",
            Self::InvalidArgument => "invalid_argument",
            Self::SchemaMismatch => "schema_mismatch",
            Self::VendorError => "vendor_error",
            Self::TmuxError => "tmux_error",
            Self::IpcError => "ipc_error",
            Self::Internal => "internal",
        }
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Advisory retry guidance attached to a [`TmaiError`].
///
/// The hint is informational only — the caller decides whether to act on it.
/// Retry orchestration is explicitly out of scope for v1 of the taxonomy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(export, export_to = "../../tmai-app/web/src/types/generated/")
)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum RetryHint {
    /// Retry after a specific wall-clock instant (RFC3339).
    ///
    /// Used when the underlying resource knows when availability resumes
    /// (e.g. vendor rate-limit reset).
    RetryAfter {
        /// ISO-8601 / RFC3339 timestamp at which the caller may retry.
        resume_at: chrono::DateTime<chrono::Utc>,
    },
    /// Retry after a millisecond backoff (caller-driven clock).
    BackoffMs {
        /// Milliseconds to wait before retrying.
        ms: u64,
    },
    /// The failure is not retryable; the caller should surface it instead.
    NotRetryable,
}

/// Structured error carried across every tmai contract boundary.
///
/// The shape is stable: `code` is the primary dispatch key; `message` is
/// human-readable; `retry_hint` is advisory; `context` is per-code
/// structured detail; `trace_id` ties the error to a `tracing` span for
/// cross-surface correlation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[cfg_attr(
    feature = "ts-export",
    ts(export, export_to = "../../tmai-app/web/src/types/generated/")
)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TmaiError {
    /// Machine-readable, stable error classification.
    pub code: ErrorCode,
    /// Human-readable summary. English-only in v1 (shape supports future i18n).
    pub message: String,
    /// Advisory retry guidance; absent when the caller has no way to retry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_hint: Option<RetryHint>,
    /// Code-specific structured detail. Always an object in practice; defaults
    /// to `null` when the caller did not attach any.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    #[cfg_attr(feature = "ts-export", ts(type = "unknown"))]
    #[cfg_attr(feature = "openapi", schema(value_type = Object))]
    pub context: serde_json::Value,
    /// Request/span identifier for correlating this error across MCP, WebUI,
    /// and internal tracing spans.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
}

impl TmaiError {
    /// Build a new error with just `code` and `message`. Callers layer on
    /// `with_context`, `with_retry_hint`, and `with_trace_id` as needed.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retry_hint: None,
            context: serde_json::Value::Null,
            trace_id: None,
        }
    }

    /// Attach code-specific structured context. Pass a `serde_json::Value`
    /// (typically an object) with fields the caller will surface.
    #[must_use]
    pub fn with_context(mut self, context: serde_json::Value) -> Self {
        self.context = context;
        self
    }

    /// Attach advisory retry guidance.
    #[must_use]
    pub fn with_retry_hint(mut self, hint: RetryHint) -> Self {
        self.retry_hint = Some(hint);
        self
    }

    /// Attach a correlation id (typically generated at the MCP/WebUI ingress).
    #[must_use]
    pub fn with_trace_id(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self
    }

    // -----------------------------------------------------------------
    // Convenience constructors for the top-3 first-wave migrations.
    // These exist so call sites producing the migrated cases do not have
    // to hand-roll a `TmaiError::new(...)` + `with_context(...)` chain.
    // -----------------------------------------------------------------

    /// Construct an [`ErrorCode::AgentNotFound`] error. The `target` is
    /// included in both the human message and `context.target`.
    pub fn agent_not_found(target: impl Into<String>) -> Self {
        let target = target.into();
        Self::new(
            ErrorCode::AgentNotFound,
            format!("agent not found: {target}"),
        )
        .with_context(serde_json::json!({ "target": target }))
        .with_retry_hint(RetryHint::NotRetryable)
    }

    /// Construct an [`ErrorCode::TmuxError`] representing a failed agent
    /// spawn. Callers pass the underlying reason (usually the tmux/shell
    /// stderr) which is preserved verbatim in `context.reason`.
    pub fn spawn_failed(reason: impl Into<String>) -> Self {
        let reason = reason.into();
        Self::new(
            ErrorCode::TmuxError,
            format!("agent spawn failed: {reason}"),
        )
        .with_context(serde_json::json!({
            "operation": "spawn_agent",
            "reason": reason,
        }))
    }

    /// Construct an [`ErrorCode::IpcError`] for an IPC/command-sender
    /// disconnect. Optionally carries the pane/endpoint that went away.
    pub fn ipc_disconnected(endpoint: Option<String>) -> Self {
        let ctx = match endpoint.as_deref() {
            Some(ep) => serde_json::json!({ "endpoint": ep, "reason": "disconnected" }),
            None => serde_json::json!({ "reason": "disconnected" }),
        };
        Self::new(ErrorCode::IpcError, "ipc channel disconnected")
            .with_context(ctx)
            .with_retry_hint(RetryHint::BackoffMs { ms: 500 })
    }
}

impl std::fmt::Display for TmaiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for TmaiError {}
