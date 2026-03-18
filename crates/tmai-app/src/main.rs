#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod events;
mod hooks_server;
mod state;

use tauri::Manager;
use tmai_core::config::Settings;
use tracing::info;
use tracing_subscriber::EnvFilter;

fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("tmai_app=info,tmai_core=info")),
        )
        .init();

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let settings = Settings::load(None).unwrap_or_default();
                info!("Initializing tmai-core...");

                let core = state::init_core(settings)
                    .await
                    .expect("Failed to initialize tmai-core");

                // Start hook event receiver (axum HTTP server)
                hooks_server::start_hooks_server(core.clone()).await;

                // Bridge CoreEvents → Tauri events
                events::start_event_bridge(handle.clone(), core.clone());

                // Register core as Tauri managed state
                handle.manage(core);

                info!("tmai-core initialized");
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Agent queries
            commands::list_agents,
            commands::get_agent,
            commands::attention_count,
            // Agent actions
            commands::approve,
            commands::select_choice,
            commands::submit_selection,
            commands::send_text,
            commands::send_key,
            commands::kill_agent,
            // Terminal (PTY)
            commands::spawn_pty,
            commands::subscribe_pty,
            commands::write_pty,
            commands::resize_pty,
            commands::kill_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error running tmai-app");
}
