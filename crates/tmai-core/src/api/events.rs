//! Core event system for push-based change notification.
//!
//! The event system supports two modes:
//! - **Bridge mode**: `start_monitoring()` spawns a Poller internally and
//!   bridges `PollMessage` → `CoreEvent` automatically (for headless/web-only).
//! - **External mode**: The consumer (TUI) runs its own Poller and calls
//!   `notify_agents_updated()` / `notify_teams_updated()` to emit events.

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

    /// Notify subscribers that the agent list was updated.
    ///
    /// Called by external consumers (e.g. TUI main loop) after processing
    /// `PollMessage::AgentsUpdated`. Ignored if no subscribers are listening.
    pub fn notify_agents_updated(&self) {
        let _ = self.event_sender().send(CoreEvent::AgentsUpdated);
    }

    /// Notify subscribers that team data was updated.
    ///
    /// Called by external consumers after team scan completes.
    pub fn notify_teams_updated(&self) {
        let _ = self.event_sender().send(CoreEvent::TeamsUpdated);
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

    #[tokio::test]
    async fn test_notify_agents_updated() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        core.notify_agents_updated();

        let event = rx.recv().await.unwrap();
        assert!(matches!(event, CoreEvent::AgentsUpdated));
    }

    #[tokio::test]
    async fn test_notify_teams_updated() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let mut rx = core.subscribe();

        core.notify_teams_updated();

        let event = rx.recv().await.unwrap();
        assert!(matches!(event, CoreEvent::TeamsUpdated));
    }

    #[test]
    fn test_notify_no_subscribers() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        // Should not panic even with no subscribers
        core.notify_agents_updated();
        core.notify_teams_updated();
    }
}
