//! CoreEvent → Tauri event bridge.
//!
//! Subscribes to TmaiCore events and forwards them to the frontend
//! via Tauri's event system.

use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tmai_core::api::TmaiCore;
use tracing::debug;

/// Start bridging CoreEvents to Tauri frontend events.
///
/// Spawns a background task that listens on core.subscribe()
/// and emits each event as a Tauri "core-event".
pub fn start_event_bridge(app: AppHandle, core: Arc<TmaiCore>) {
    let mut rx = core.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Err(e) = app.emit("core-event", &event) {
                        debug!("Failed to emit core-event: {e}");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    debug!("Event bridge lagged {n} events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    debug!("Event bridge closed");
                    break;
                }
            }
        }
    });
}
