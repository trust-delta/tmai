//! WebSocket sender for bidirectional Codex CLI control.
//!
//! Wraps the WebSocket write half and tracks per-connection state
//! (thread_id, request counter) to enable sending prompts, approvals,
//! and interrupts to a Codex app-server.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use futures_util::stream::SplitSink;
use futures_util::SinkExt;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::debug;

use super::types::{JsonRpcRequest, JsonRpcResponseOut};

type WsSink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

/// Handle for sending messages to a Codex CLI app-server via WebSocket.
///
/// Thread-safe: can be cloned and shared across tasks.
/// The write half is protected by a Mutex to serialize sends.
#[derive(Clone)]
pub struct CodexWsSender {
    write: Arc<Mutex<Option<WsSink>>>,
    /// Thread ID from the most recent thread/started notification
    thread_id: Arc<parking_lot::Mutex<Option<String>>>,
    /// Monotonic request ID counter (shared across clones)
    next_id: Arc<AtomicU64>,
    /// URL for logging/identification
    url: String,
}

impl CodexWsSender {
    /// Create a new sender (write half will be set after connection)
    pub fn new(url: String) -> Self {
        Self {
            write: Arc::new(Mutex::new(None)),
            thread_id: Arc::new(parking_lot::Mutex::new(None)),
            // Start IDs at 100 to avoid collision with initialize (id=1)
            next_id: Arc::new(AtomicU64::new(100)),
            url,
        }
    }

    /// Set the WebSocket write half (called after successful connection)
    pub async fn set_write(&self, sink: WsSink) {
        let mut guard = self.write.lock().await;
        *guard = Some(sink);
    }

    /// Clear the write half (called on disconnect)
    pub async fn clear_write(&self) {
        let mut guard = self.write.lock().await;
        *guard = None;
    }

    /// Update the tracked thread_id (called when thread/started is received)
    pub fn set_thread_id(&self, id: String) {
        let mut guard = self.thread_id.lock();
        *guard = Some(id);
    }

    /// Get the current thread_id (if known)
    pub fn thread_id(&self) -> Option<String> {
        self.thread_id.lock().clone()
    }

    /// Check if the sender has an active write connection
    pub async fn is_connected(&self) -> bool {
        self.write.lock().await.is_some()
    }

    /// Allocate the next request ID
    fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Send a raw JSON-RPC message over the WebSocket
    async fn send_json(&self, value: &impl serde::Serialize) -> Result<()> {
        let json = serde_json::to_string(value)?;
        let mut guard = self.write.lock().await;
        let sink = guard
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Codex WS not connected: {}", self.url))?;
        sink.send(Message::Text(json.into())).await?;
        Ok(())
    }

    /// Send a prompt to the Codex agent via turn/start.
    ///
    /// Requires a thread_id — either auto-tracked from thread/started
    /// or explicitly provided.
    pub async fn send_prompt(&self, text: &str) -> Result<()> {
        let thread_id = self
            .thread_id()
            .ok_or_else(|| anyhow::anyhow!("No thread_id available — thread not started yet"))?;
        let id = self.next_request_id();
        let req = JsonRpcRequest::turn_start(id, &thread_id, text);
        self.send_json(&req).await?;
        debug!(url = %self.url, id, %thread_id, "Sent turn/start prompt");
        Ok(())
    }

    /// Send a prompt to a specific thread
    pub async fn send_prompt_to_thread(&self, thread_id: &str, text: &str) -> Result<()> {
        let id = self.next_request_id();
        let req = JsonRpcRequest::turn_start(id, thread_id, text);
        self.send_json(&req).await?;
        debug!(url = %self.url, id, %thread_id, "Sent turn/start prompt");
        Ok(())
    }

    /// Approve a command or file change by responding to a server request.
    ///
    /// `request_id` is the JSON-RPC id from the approval request message.
    pub async fn approve_command(&self, request_id: u64) -> Result<()> {
        let resp = JsonRpcResponseOut::approval(request_id, "accept");
        self.send_json(&resp).await?;
        debug!(url = %self.url, request_id, "Sent approval: accept");
        Ok(())
    }

    /// Deny a command or file change
    pub async fn deny_command(&self, request_id: u64) -> Result<()> {
        let resp = JsonRpcResponseOut::approval(request_id, "deny");
        self.send_json(&resp).await?;
        debug!(url = %self.url, request_id, "Sent approval: deny");
        Ok(())
    }

    /// Interrupt the active turn
    pub async fn interrupt_turn(&self) -> Result<()> {
        let thread_id = self
            .thread_id()
            .ok_or_else(|| anyhow::anyhow!("No thread_id available — thread not started yet"))?;
        let id = self.next_request_id();
        let req = JsonRpcRequest::turn_interrupt(id, &thread_id);
        self.send_json(&req).await?;
        debug!(url = %self.url, id, %thread_id, "Sent turn/interrupt");
        Ok(())
    }

    /// Start a new thread (returns the request id; thread_id comes via notification)
    pub async fn start_thread(&self) -> Result<u64> {
        let id = self.next_request_id();
        let req = JsonRpcRequest::thread_start(id);
        self.send_json(&req).await?;
        debug!(url = %self.url, id, "Sent thread/start");
        Ok(id)
    }

    /// Send a Pong frame (for keepalive/ping handling)
    pub async fn send_pong(&self, data: Vec<u8>) -> Result<()> {
        let mut guard = self.write.lock().await;
        if let Some(sink) = guard.as_mut() {
            sink.send(Message::Pong(data.into())).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sender_new_starts_disconnected() {
        let sender = CodexWsSender::new("ws://127.0.0.1:9999".to_string());
        assert!(sender.thread_id().is_none());
    }

    #[test]
    fn test_sender_thread_id_tracking() {
        let sender = CodexWsSender::new("ws://127.0.0.1:9999".to_string());
        assert!(sender.thread_id().is_none());
        sender.set_thread_id("thread-abc-123".to_string());
        assert_eq!(sender.thread_id().as_deref(), Some("thread-abc-123"));
    }

    #[test]
    fn test_sender_request_id_monotonic() {
        let sender = CodexWsSender::new("ws://127.0.0.1:9999".to_string());
        let id1 = sender.next_request_id();
        let id2 = sender.next_request_id();
        let id3 = sender.next_request_id();
        assert!(id1 < id2);
        assert!(id2 < id3);
        assert!(id1 >= 100); // starts at 100
    }

    #[test]
    fn test_sender_clone_shares_state() {
        let sender = CodexWsSender::new("ws://127.0.0.1:9999".to_string());
        let cloned = sender.clone();
        sender.set_thread_id("shared-thread".to_string());
        assert_eq!(cloned.thread_id().as_deref(), Some("shared-thread"));
        // IDs are shared
        let id1 = sender.next_request_id();
        let id2 = cloned.next_request_id();
        assert_eq!(id2, id1 + 1);
    }

    #[tokio::test]
    async fn test_sender_not_connected_returns_error() {
        let sender = CodexWsSender::new("ws://127.0.0.1:9999".to_string());
        assert!(!sender.is_connected().await);
        sender.set_thread_id("t1".to_string());
        let err = sender.send_prompt("hello").await.unwrap_err();
        assert!(err.to_string().contains("not connected"));
    }

    #[tokio::test]
    async fn test_sender_prompt_without_thread_id_errors() {
        let sender = CodexWsSender::new("ws://127.0.0.1:9999".to_string());
        let err = sender.send_prompt("hello").await.unwrap_err();
        assert!(err.to_string().contains("thread_id"));
    }
}
