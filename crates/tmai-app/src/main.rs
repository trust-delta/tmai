#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod events;
mod hooks_server;
mod state;

use std::sync::Arc;
use tauri::Manager;
use tmai_core::api::TmaiCoreBuilder;
use tmai_core::config::Settings;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("tmai_app=debug".parse().unwrap())
                .add_directive("tmai_core=debug".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::agents::list_agents,
            commands::agents::get_agent,
            commands::agents::attention_count,
        ])
        .setup(|app| {
            // Initialize TmaiCore with default settings
            let settings = Settings::default();
            let core = Arc::new(TmaiCoreBuilder::new(settings).build());

            // Start event bridge
            let _event_bridge = events::start_event_bridge(core.clone(), app.app_handle().clone());

            // Store core in app state for IPC commands
            app.manage(core);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
