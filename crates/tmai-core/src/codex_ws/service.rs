//! CodexWsService — manages multiple WebSocket client connections
//! to Codex CLI app-server instances with bidirectional control.

use std::collections::HashMap;

use tokio::sync::broadcast;
use tracing::info;

use crate::api::CoreEvent;
use crate::config::CodexWsConnection;
use crate::hooks::registry::HookRegistry;
use crate::state::SharedState;

use super::client::{self, CodexWsClientConfig};
use super::sender::CodexWsSender;

/// Service that manages WebSocket connections to Codex CLI app-servers
pub struct CodexWsService {
    configs: Vec<CodexWsClientConfig>,
    hook_registry: HookRegistry,
    event_tx: broadcast::Sender<CoreEvent>,
    state: SharedState,
    /// Senders keyed by URL for external access (send_prompt, approve, etc.)
    senders: HashMap<String, CodexWsSender>,
}

impl CodexWsService {
    /// Create a new service from connection configurations
    pub fn new(
        connections: &[CodexWsConnection],
        hook_registry: HookRegistry,
        event_tx: broadcast::Sender<CoreEvent>,
        state: SharedState,
    ) -> Self {
        let mut configs = Vec::with_capacity(connections.len());
        let mut senders = HashMap::with_capacity(connections.len());

        for conn in connections {
            let config = CodexWsClientConfig {
                url: conn.url.clone(),
                pane_id: conn.pane_id.clone(),
            };
            let sender = CodexWsSender::new(conn.url.clone());
            senders.insert(conn.url.clone(), sender);
            configs.push(config);
        }

        Self {
            configs,
            hook_registry,
            event_tx,
            state,
            senders,
        }
    }

    /// Get all senders (keyed by URL) for external access to bidirectional control.
    /// Call this before `start()` — the returned senders are clones that share
    /// state with the background tasks.
    pub fn senders(&self) -> &HashMap<String, CodexWsSender> {
        &self.senders
    }

    /// Start all WebSocket client connections as background tasks.
    ///
    /// Each connection runs in its own tokio task with automatic reconnection.
    pub fn start(self) {
        if self.configs.is_empty() {
            return;
        }

        info!(
            count = self.configs.len(),
            "Starting Codex WS client connections"
        );

        for config in self.configs {
            let registry = self.hook_registry.clone();
            let event_tx = self.event_tx.clone();
            let state = self.state.clone();
            let sender = self
                .senders
                .get(&config.url)
                .cloned()
                .unwrap_or_else(|| CodexWsSender::new(config.url.clone()));

            tokio::spawn(async move {
                client::run(config, registry, event_tx, state, sender).await;
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hooks::registry::new_hook_registry;
    use crate::state::AppState;

    #[test]
    fn test_service_creation_empty() {
        let registry = new_hook_registry();
        let (tx, _rx) = broadcast::channel(16);
        let state = AppState::shared();

        let service = CodexWsService::new(&[], registry, tx, state);
        assert!(service.configs.is_empty());
    }

    #[test]
    fn test_service_creation_with_connections() {
        let registry = new_hook_registry();
        let (tx, _rx) = broadcast::channel(16);
        let state = AppState::shared();

        let connections = vec![
            CodexWsConnection {
                url: "ws://127.0.0.1:15710".to_string(),
                pane_id: Some("5".to_string()),
            },
            CodexWsConnection {
                url: "ws://127.0.0.1:15711".to_string(),
                pane_id: None,
            },
        ];

        let service = CodexWsService::new(&connections, registry, tx, state);
        assert_eq!(service.configs.len(), 2);
        assert_eq!(service.configs[0].url, "ws://127.0.0.1:15710");
        assert_eq!(service.configs[0].pane_id.as_deref(), Some("5"));
        assert_eq!(service.configs[1].url, "ws://127.0.0.1:15711");
        assert!(service.configs[1].pane_id.is_none());
        // Senders are created for each connection
        assert_eq!(service.senders().len(), 2);
        assert!(service.senders().contains_key("ws://127.0.0.1:15710"));
        assert!(service.senders().contains_key("ws://127.0.0.1:15711"));
    }
}
