//! Web server implementation using axum

use anyhow::Result;
use axum::http::{HeaderName, Method};
use axum::{
    middleware,
    routing::{any, get, post, put},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use tmai_core::api::TmaiCore;
use tmai_core::config::Settings;

use super::api;
use super::auth::{self, AuthState};
use super::events;
use super::hooks;
use super::static_files;
use super::ws;

/// Web server for remote control
pub struct WebServer {
    settings: Settings,
    core: Arc<TmaiCore>,
    token: String,
}

impl WebServer {
    /// Create a new web server
    pub fn new(settings: Settings, core: Arc<TmaiCore>, token: String) -> Self {
        Self {
            settings,
            core,
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

        let api_state = self.core.clone();
        let sse_state = self.core.clone();

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
        let api_routes = Router::new()
            .route("/agents", get(api::get_agents))
            .route("/agents/{id}/approve", post(api::approve_agent))
            .route("/agents/{id}/select", post(api::select_choice))
            .route("/agents/{id}/submit", post(api::submit_selection))
            .route("/agents/{id}/input", post(api::send_text))
            .route("/agents/{id}/prompt", post(api::send_prompt))
            .route("/agents/{id}/key", post(api::send_key))
            .route("/agents/{id}/auto-approve", put(api::set_auto_approve))
            .route("/agents/{id}/kill", post(api::kill_agent))
            .route("/agents/{id}/set-orchestrator", post(api::set_orchestrator))
            .route("/agents/{id}/passthrough", post(api::passthrough_input))
            .route("/agents/{id}/preview", get(api::get_preview))
            .route("/agents/{id}/transcript", get(api::get_transcript))
            .route("/teams", get(api::get_teams))
            .route("/teams/{name}/tasks", get(api::get_team_tasks))
            .route("/worktrees", get(api::get_worktrees))
            .route("/worktrees/delete", post(api::delete_worktree))
            .route("/worktrees/launch", post(api::launch_agent_in_worktree))
            .route("/worktrees/diff", post(api::get_worktree_diff))
            .route("/worktrees/move", post(api::move_to_worktree))
            .route("/git/diff-stat", get(api::git_diff_stat))
            .route("/git/diff", get(api::git_branch_diff))
            .route("/git/branches/delete", post(api::delete_branch))
            .route("/git/branches/delete-bulk", post(api::bulk_delete_branches))
            .route("/git/log", get(api::git_log))
            .route("/git/graph", get(api::git_graph))
            .route("/git/branches/create", post(api::create_branch))
            .route("/git/checkout", post(api::checkout_branch))
            .route("/git/fetch", post(api::git_fetch))
            .route("/git/pull", post(api::git_pull))
            .route("/github/prs", get(api::list_prs))
            .route("/github/checks", get(api::list_checks))
            .route("/github/issues", get(api::list_issues))
            .route("/github/issue/detail", get(api::get_issue_detail))
            .route("/github/pr/comments", get(api::get_pr_comments))
            .route("/github/pr/files", get(api::get_pr_files))
            .route("/github/pr/merge-status", get(api::get_pr_merge_status))
            .route("/github/ci/failure-log", get(api::get_ci_failure_log))
            .route("/github/ci/rerun", post(api::rerun_failed_checks))
            .route("/github/pr/review", post(api::review_pr))
            .route("/github/pr/merge", post(api::merge_pr))
            .route("/git/merge", post(api::git_merge))
            .route("/projects", get(api::get_projects).post(api::add_project))
            .route("/projects/remove", post(api::remove_project))
            .route("/directories", get(api::list_directories))
            .route("/files/read", get(api::read_file))
            .route("/files/write", post(api::write_file))
            .route("/files/md-tree", get(api::md_tree))
            .route(
                "/settings/spawn",
                get(api::get_spawn_settings).put(api::update_spawn_settings),
            )
            .route(
                "/settings/orchestrator",
                get(api::get_orchestrator_settings).put(api::update_orchestrator_settings),
            )
            .route(
                "/settings/auto-approve",
                get(api::get_auto_approve_settings).put(api::update_auto_approve_settings),
            )
            .route("/spawn", post(api::spawn_agent))
            .route("/spawn/worktree", post(api::spawn_worktree))
            .route("/orchestrator/spawn", post(api::spawn_orchestrator))
            .route("/git/branches", get(api::list_branches))
            .route("/agents/{id}/output", get(api::get_agent_output))
            .route("/agents/{from}/send-to/{to}", post(api::send_to_agent))
            .route("/agents/{id}/terminal", any(ws::ws_terminal))
            .route("/config-audit/run", post(api::config_audit))
            .route("/config-audit/last", get(api::last_config_audit))
            .route("/defer", get(api::list_deferred))
            .route("/defer/{id}/resolve", post(api::resolve_deferred))
            .route("/usage", get(api::get_usage))
            .route("/usage/fetch", post(api::trigger_usage_fetch))
            .route(
                "/settings/usage",
                get(api::get_usage_settings).put(api::update_usage_settings),
            )
            .route(
                "/settings/preview",
                get(api::get_preview_settings).put(api::update_preview_settings),
            )
            .route(
                "/settings/notification",
                get(api::get_notification_settings).put(api::update_notification_settings),
            )
            .route(
                "/settings/theme",
                get(api::get_theme_settings).put(api::update_theme_settings),
            )
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

        // Hook routes (separate auth via hook token, not web API token)
        let hook_routes = Router::new()
            .route("/event", post(hooks::hook_event))
            .route("/statusline", post(hooks::statusline))
            .route("/review-complete", post(hooks::review_complete))
            .with_state(self.core.clone());

        // Combine all routes
        let app = Router::new()
            .nest("/api", api_routes)
            .nest("/api", events_routes)
            .nest("/hooks", hook_routes)
            .merge(static_routes)
            .layer(cors);

        tracing::info!("Web server starting on http://0.0.0.0:{}", port);

        let listener = tokio::net::TcpListener::bind(addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}
