//! Static file serving using rust-embed

use axum::{
    body::Body,
    http::{header, Response, StatusCode},
    response::IntoResponse,
};
use rust_embed::RustEmbed;

/// Embedded assets from src/web/assets/
#[derive(RustEmbed)]
#[folder = "src/web/assets/"]
pub struct Assets;

/// Serve static files
pub async fn serve_static(path: &str) -> impl IntoResponse {
    let path = if path.is_empty() || path == "/" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };

    match Assets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap(),
    }
}

/// Handler for root path
pub async fn index() -> impl IntoResponse {
    serve_static("index.html").await
}

/// Handler for static assets
pub async fn asset(axum::extract::Path(path): axum::extract::Path<String>) -> impl IntoResponse {
    serve_static(&path).await
}
