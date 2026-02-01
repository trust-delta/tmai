//! Token-based authentication for web API

use axum::{
    body::Body,
    extract::{Query, State},
    http::{Request, StatusCode},
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

/// Authentication middleware
pub async fn auth_middleware(
    State(auth): State<Arc<AuthState>>,
    Query(query): Query<TokenQuery>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Check token from query parameter
    match query.token {
        Some(token) if token == auth.token => Ok(next.run(request).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
