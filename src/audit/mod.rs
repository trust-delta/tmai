pub mod events;
pub mod helper;
pub mod logger;

pub use events::AuditEvent;
pub use logger::AuditLogger;

/// Sender for audit events from non-Poller threads (UI, Web API)
pub type AuditEventSender = tokio::sync::mpsc::UnboundedSender<AuditEvent>;
