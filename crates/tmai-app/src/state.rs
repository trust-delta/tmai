//! TmaiCore initialization for Tauri app.
//!
//! Mirrors the web-only mode flow from the main tmai binary,
//! adapted for the Tauri context.

use std::sync::Arc;

use anyhow::{Context, Result};
use tmai_core::api::TmaiCore;
use tmai_core::api::TmaiCoreBuilder;
use tmai_core::command_sender::CommandSender;
use tmai_core::config::Settings;
use tmai_core::ipc::IpcServer;
use tmai_core::monitor::PollMessage;
use tmai_core::runtime::StandaloneAdapter;
use tmai_core::state::SharedState;
use tracing::info;

/// Load hook token from ~/.config/tmai/hooks_token
fn load_hook_token() -> Option<String> {
    let config_dir = dirs::config_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))?
        .join("tmai");
    std::fs::read_to_string(config_dir.join("hooks_token"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Initialize TmaiCore with standalone runtime (no tmux).
///
/// Starts IPC server, poller, and background event loop.
/// Returns the core facade for Tauri state management.
pub async fn init_core(settings: Settings) -> Result<Arc<TmaiCore>> {
    // 1. IPC server
    let ipc_server = IpcServer::start()
        .await
        .context("Failed to start IPC server")?;
    let ipc_server = Arc::new(ipc_server);

    // 2. Standalone runtime (no tmux)
    let runtime: Arc<dyn tmai_core::runtime::RuntimeAdapter> = Arc::new(StandaloneAdapter::new());

    // 3. Shared state
    let state: SharedState = tmai_core::state::AppState::shared();
    {
        let mut s = state.write();
        s.show_activity_name = settings.ui.show_activity_name;
    }

    // 4. Hook registry + session pane map
    let hook_registry = tmai_core::hooks::new_hook_registry();
    let session_pane_map = tmai_core::hooks::new_session_pane_map();
    let hook_token = load_hook_token();

    // 5. Command sender (IPC → PTY inject → standalone error)
    let cmd_sender = Arc::new(
        CommandSender::new(Some(ipc_server.clone()), runtime.clone(), state.clone())
            .with_hook_registry(hook_registry.clone()),
    );

    // 6. Build TmaiCore facade
    let mut core_builder = TmaiCoreBuilder::new(settings.clone())
        .with_state(state.clone())
        .with_ipc_server(ipc_server.clone())
        .with_command_sender(cmd_sender)
        .with_hook_registry(hook_registry.clone())
        .with_session_pane_map(session_pane_map);

    if let Some(token) = hook_token {
        info!("Hook token loaded, hook endpoint enabled");
        core_builder = core_builder.with_hook_token(token);
    }

    let core = Arc::new(core_builder.build());

    // 7. Start poller
    let ipc_registry = ipc_server.registry();
    let mut poller = tmai_core::monitor::Poller::new(
        settings,
        state.clone(),
        runtime,
        ipc_registry,
        hook_registry,
        None,
    );
    poller = poller.with_event_tx(core.event_sender().clone());
    let mut poll_rx = poller.start();

    // 8. Background event loop (poll messages + PTY sync)
    let core_bg = core.clone();
    let state_bg = state;
    tokio::spawn(async move {
        let mut pty_sync_interval = tokio::time::interval(std::time::Duration::from_secs(2));
        pty_sync_interval.tick().await; // skip first tick

        loop {
            tokio::select! {
                msg = poll_rx.recv() => {
                    match msg {
                        Some(PollMessage::AgentsUpdated(agents)) => {
                            {
                                let mut s = state_bg.write();
                                s.update_agents(agents);
                                s.clear_error();
                            }
                            core_bg.notify_agents_updated();
                        }
                        Some(PollMessage::Error(err)) => {
                            let mut s = state_bg.write();
                            s.error_message = Some(err);
                        }
                        None => break,
                    }
                }
                _ = pty_sync_interval.tick() => {
                    if core_bg.sync_pty_sessions() {
                        core_bg.notify_agents_updated();
                    }
                }
            }
        }
    });

    Ok(core)
}
