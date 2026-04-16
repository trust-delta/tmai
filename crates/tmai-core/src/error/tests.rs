use super::*;
use crate::api::ApiError;

#[test]
fn error_code_serializes_as_variant_name() {
    let code = ErrorCode::AgentNotFound;
    let s = serde_json::to_string(&code).unwrap();
    assert_eq!(s, "\"AgentNotFound\"");

    let roundtrip: ErrorCode = serde_json::from_str(&s).unwrap();
    assert_eq!(roundtrip, ErrorCode::AgentNotFound);
}

#[test]
fn error_code_as_str_is_stable_snake_case() {
    assert_eq!(ErrorCode::AgentNotFound.as_str(), "agent_not_found");
    assert_eq!(ErrorCode::IpcError.as_str(), "ipc_error");
    assert_eq!(ErrorCode::TmuxError.as_str(), "tmux_error");
    assert_eq!(ErrorCode::CapacityExceeded.as_str(), "capacity_exceeded");
}

#[test]
fn retry_hint_backoff_roundtrip() {
    let hint = RetryHint::BackoffMs { ms: 1500 };
    let json = serde_json::to_string(&hint).unwrap();
    assert!(json.contains("\"kind\":\"backoff_ms\""));
    assert!(json.contains("\"ms\":1500"));
    let roundtrip: RetryHint = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtrip, hint);
}

#[test]
fn retry_hint_retry_after_roundtrip() {
    let ts = chrono::DateTime::<chrono::Utc>::from_timestamp(1_700_000_000, 0).unwrap();
    let hint = RetryHint::RetryAfter { resume_at: ts };
    let json = serde_json::to_string(&hint).unwrap();
    let roundtrip: RetryHint = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtrip, hint);
}

#[test]
fn retry_hint_not_retryable_roundtrip() {
    let hint = RetryHint::NotRetryable;
    let json = serde_json::to_string(&hint).unwrap();
    assert_eq!(json, r#"{"kind":"not_retryable"}"#);
    let roundtrip: RetryHint = serde_json::from_str(&json).unwrap();
    assert_eq!(roundtrip, hint);
}

#[test]
fn tmai_error_minimal_serializes_without_optional_fields() {
    let err = TmaiError::new(ErrorCode::Internal, "boom");
    let json = serde_json::to_string(&err).unwrap();
    // `context` (null) and `retry_hint`/`trace_id` (None) are omitted.
    assert!(!json.contains("context"));
    assert!(!json.contains("retry_hint"));
    assert!(!json.contains("trace_id"));
    assert!(json.contains("\"code\":\"Internal\""));
    assert!(json.contains("\"message\":\"boom\""));
}

#[test]
fn tmai_error_full_roundtrip() {
    let err = TmaiError::new(ErrorCode::VendorUnavailable, "claude rate-limited")
        .with_context(serde_json::json!({ "vendor": "claude" }))
        .with_retry_hint(RetryHint::BackoffMs { ms: 30_000 })
        .with_trace_id("req-123");

    let json = serde_json::to_string(&err).unwrap();
    let parsed: TmaiError = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed.code, ErrorCode::VendorUnavailable);
    assert_eq!(parsed.message, "claude rate-limited");
    assert_eq!(parsed.trace_id.as_deref(), Some("req-123"));
    assert_eq!(parsed.context["vendor"], "claude");
    match parsed.retry_hint {
        Some(RetryHint::BackoffMs { ms }) => assert_eq!(ms, 30_000),
        other => panic!("unexpected retry hint: {other:?}"),
    }
}

#[test]
fn tmai_error_display_includes_code_and_message() {
    let err = TmaiError::new(ErrorCode::TmuxError, "tmux spawn failed");
    assert_eq!(err.to_string(), "[tmux_error] tmux spawn failed");
}

#[test]
fn agent_not_found_constructor_sets_code_and_context() {
    let err = TmaiError::agent_not_found("main:0.0");
    assert_eq!(err.code, ErrorCode::AgentNotFound);
    assert_eq!(err.message, "agent not found: main:0.0");
    assert_eq!(err.context["target"], "main:0.0");
    assert!(matches!(err.retry_hint, Some(RetryHint::NotRetryable)));
}

#[test]
fn spawn_failed_constructor_preserves_reason() {
    let err = TmaiError::spawn_failed("tmux: session not found");
    assert_eq!(err.code, ErrorCode::TmuxError);
    assert_eq!(err.context["reason"], "tmux: session not found");
    assert_eq!(err.context["operation"], "spawn_agent");
}

#[test]
fn ipc_disconnected_constructor_with_endpoint() {
    let err = TmaiError::ipc_disconnected(Some("/tmp/tmai.sock".to_string()));
    assert_eq!(err.code, ErrorCode::IpcError);
    assert_eq!(err.context["endpoint"], "/tmp/tmai.sock");
    assert!(matches!(
        err.retry_hint,
        Some(RetryHint::BackoffMs { ms: 500 })
    ));
}

#[test]
fn ipc_disconnected_constructor_without_endpoint() {
    let err = TmaiError::ipc_disconnected(None);
    assert_eq!(err.code, ErrorCode::IpcError);
    assert!(err.context.get("endpoint").is_none());
}

#[test]
fn from_api_error_agent_not_found_maps_to_code() {
    let api = ApiError::AgentNotFound {
        target: "main:0.0".to_string(),
    };
    let err: TmaiError = api.into();
    assert_eq!(err.code, ErrorCode::AgentNotFound);
    assert_eq!(err.context["target"], "main:0.0");
}

#[test]
fn from_api_error_spawn_failed_maps_to_tmux_error() {
    let api = ApiError::SpawnFailed {
        reason: "no pane".to_string(),
    };
    let err: TmaiError = api.into();
    assert_eq!(err.code, ErrorCode::TmuxError);
    assert_eq!(err.context["reason"], "no pane");
}

#[test]
fn from_api_error_no_command_sender_maps_to_ipc_error() {
    let api = ApiError::NoCommandSender;
    let err: TmaiError = api.into();
    assert_eq!(err.code, ErrorCode::IpcError);
}

#[test]
fn from_api_error_other_variants_fall_through_to_internal() {
    let api = ApiError::NoSelection;
    let err: TmaiError = api.into();
    assert_eq!(err.code, ErrorCode::Internal);
    assert_eq!(err.message, "no agent selected");
}

#[test]
fn taxonomy_version_is_exposed() {
    assert_eq!(TAXONOMY_VERSION, "1");
}
