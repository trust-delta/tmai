//! Token-based authentication for web API

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, Request, StatusCode},
    middleware::Next,
    response::Response,
};
use serde::Deserialize;
use std::sync::Arc;

/// Query parameters for token authentication
#[derive(Debug, Deserialize)]
pub struct TokenQuery {
    pub token: Option<String>,
}

/// Shared state for authentication
pub struct AuthState {
    pub token: String,
}

/// Generate a new random token
pub fn generate_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Extract Bearer token from Authorization header
fn extract_bearer_token(request: &Request<Body>) -> Option<&str> {
    request
        .headers()
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

/// Authentication middleware
///
/// Checks authentication in the following order:
/// 1. `Authorization: Bearer <token>` header (preferred, used by fetch API)
/// 2. `?token=<token>` query parameter (fallback for SSE EventSource)
pub async fn auth_middleware(
    State(auth): State<Arc<AuthState>>,
    Query(query): Query<TokenQuery>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // First check Authorization header
    if let Some(bearer_token) = extract_bearer_token(&request) {
        return if bearer_token == auth.token {
            Ok(next.run(request).await)
        } else {
            Err(StatusCode::UNAUTHORIZED)
        };
    }

    // Fallback to query parameter (for SSE EventSource which can't set headers)
    match query.token {
        Some(token) if token == auth.token => Ok(next.run(request).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
