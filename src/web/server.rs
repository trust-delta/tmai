//! Web server implementation using axum

use anyhow::Result;
use axum::http::{HeaderName, Method};
use axum::{
    middleware,
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use crate::config::Settings;
use crate::state::SharedState;
use crate::tmux::TmuxClient;

use super::api::{self, ApiState};
use super::auth::{self, AuthState};
use super::events::{self, SseState};
use super::static_files;

/// Web server for remote control
pub struct WebServer {
    settings: Settings,
    app_state: SharedState,
    token: String,
}

impl WebServer {
    /// Create a new web server
    pub fn new(settings: Settings, app_state: SharedState, token: String) -> Self {
        Self {
            settings,
            app_state,
            token,
        }
    }

    /// Start the web server in a background task
    pub fn start(self) -> tokio::task::JoinHandle<Result<()>> {
        tokio::spawn(async move { self.run().await })
    }

    /// Run the web server
    async fn run(self) -> Result<()> {
        let port = self.settings.web.port;
        let addr = SocketAddr::from(([0, 0, 0, 0], port));

        // Create shared states
        let auth_state = Arc::new(AuthState {
            token: self.token.clone(),
        });

        let api_state = Arc::new(ApiState {
            app_state: self.app_state.clone(),
            tmux_client: TmuxClient::new(),
        });

        let sse_state = Arc::new(SseState {
            app_state: self.app_state.clone(),
        });

        // Security: Token authentication in URL is the primary defense.
        // CORS is restricted as defense-in-depth but allow_origin(Any) is
        // intentional since mobile devices on the same LAN need access.
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([
                HeaderName::from_static("content-type"),
                HeaderName::from_static("authorization"),
            ]);

        // API routes (require authentication)
        // Note: reject endpoint removed - use select with option number instead
        let api_routes = Router::new()
            .route("/agents", get(api::get_agents))
            .route("/agents/{id}/approve", post(api::approve_agent))
            .route("/agents/{id}/select", post(api::select_choice))
            .route("/agents/{id}/submit", post(api::submit_selection))
            .route("/agents/{id}/input", post(api::send_text))
            .route("/agents/{id}/preview", get(api::get_preview))
            .route("/teams", get(api::get_teams))
            .route("/teams/{name}/tasks", get(api::get_team_tasks))
            .with_state(api_state)
            .route_layer(middleware::from_fn_with_state(
                auth_state.clone(),
                auth::auth_middleware,
            ));

        // SSE route (require authentication)
        let events_routes = Router::new()
            .route("/events", get(events::events))
            .with_state(sse_state)
            .route_layer(middleware::from_fn_with_state(
                auth_state.clone(),
                auth::auth_middleware,
            ));

        // Static file routes (no auth for loading the page, token is in URL)
        let static_routes = Router::new()
            .route("/", get(static_files::index))
            .route("/{*path}", get(static_files::asset));

        // Combine all routes
        let app = Router::new()
            .nest("/api", api_routes)
            .nest("/api", events_routes)
            .merge(static_routes)
            .layer(cors);

        tracing::info!("Web server starting on http://0.0.0.0:{}", port);

        let listener = tokio::net::TcpListener::bind(addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}
