//! `ApiError` → [`TmaiError`] conversion.
//!
//! First-wave migrations (#458) route three [`ApiError`] cases through the
//! structured taxonomy:
//!
//! - `AgentNotFound`      → [`ErrorCode::AgentNotFound`]
//! - `SpawnFailed`        → [`ErrorCode::TmuxError`]
//! - `NoCommandSender`    → [`ErrorCode::IpcError`]
//!
//! Every other variant falls through to [`ErrorCode::Internal`] while we
//! migrate incrementally.

use super::{ErrorCode, TmaiError};
use crate::api::ApiError;

impl From<ApiError> for TmaiError {
    fn from(err: ApiError) -> Self {
        match &err {
            ApiError::AgentNotFound { target } => TmaiError::agent_not_found(target.clone()),
            ApiError::SpawnFailed { reason } => TmaiError::spawn_failed(reason.clone()),
            ApiError::NoCommandSender => TmaiError::ipc_disconnected(None),
            // Remaining variants are v1 non-goals — bucket them as Internal
            // with the Display text so callers still see the reason.
            _ => TmaiError::new(ErrorCode::Internal, err.to_string()),
        }
    }
}
