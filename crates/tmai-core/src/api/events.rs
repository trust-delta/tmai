//! Core event system for push-based change notification.
//!
//! Phase 4 will add a poll bridge that converts `PollMessage` into `CoreEvent`
//! and emits them via the broadcast channel. For now, only the types and
//! `subscribe()` method are defined.

use tokio::sync::broadcast;

use super::core::TmaiCore;

/// Events emitted by the core when state changes occur.
///
/// Consumers call [`TmaiCore::subscribe()`] to receive these events
/// via a `broadcast::Receiver`.
#[derive(Debug, Clone)]
pub enum CoreEvent {
    /// The full agent list was refreshed (after a poll cycle)
    AgentsUpdated,

    /// A single agent changed status
    AgentStatusChanged {
        /// Agent target ID
        target: String,
        /// Previous status description
        old_status: String,
        /// New status description
        new_status: String,
    },

    /// A new agent appeared
    AgentAppeared {
        /// Agent target ID
        target: String,
    },

    /// An agent disappeared
    AgentDisappeared {
        /// Agent target ID
        target: String,
    },

    /// Team data was refreshed
    TeamsUpdated,
}

impl TmaiCore {
    /// Subscribe to core events.
    ///
    /// Returns a broadcast receiver that will receive [`CoreEvent`]s.
    /// If the receiver falls behind, older events are dropped (lagged).
    pub fn subscribe(&self) -> broadcast::Receiver<CoreEvent> {
        self.event_sender().subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::builder::TmaiCoreBuilder;
    use crate::config::Settings;

    #[tokio::test]
    async fn test_subscribe_receives_events() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        // Send an event via the internal sender
        let tx = core.event_sender();
        tx.send(CoreEvent::AgentsUpdated).unwrap();

        let event = rx.recv().await.unwrap();
        assert!(matches!(event, CoreEvent::AgentsUpdated));
    }

    #[tokio::test]
    async fn test_subscribe_multiple_receivers() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx1 = core.subscribe();
        let mut rx2 = core.subscribe();

        let tx = core.event_sender();
        tx.send(CoreEvent::TeamsUpdated).unwrap();

        let e1 = rx1.recv().await.unwrap();
        let e2 = rx2.recv().await.unwrap();
        assert!(matches!(e1, CoreEvent::TeamsUpdated));
        assert!(matches!(e2, CoreEvent::TeamsUpdated));
    }
}
