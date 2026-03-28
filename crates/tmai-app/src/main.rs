#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;

use tauri::Manager;
use tmai_core::api::TmaiCoreBuilder;
use tmai_core::config::Settings;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::agents::list_agents,
            commands::agents::get_agent,
            commands::agents::attention_count,
        ])
        .setup(|app| {
            // Initialize TmaiCore with default settings
            let settings = Settings::default();
            let core = TmaiCoreBuilder::new(settings).build();

            // Store core in app state
            app.manage(core);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
