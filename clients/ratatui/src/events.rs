//! SSE client for `/api/events`.
//!
//! tmai-core emits named SSE events — `agents`, `teams`, `teammate_idle`,
//! `usage`, `worktree_created`, etc. This milestone only wires the
//! `agents` event (full AgentSnapshot[] snapshot). Other events are
//! observed but ignored — forward-compat per the tmai-react rule.

use anyhow::Result;
use futures_util::StreamExt;
use reqwest_eventsource::{Event as SseEvent, EventSource};
use tokio::sync::mpsc;

use crate::api::ApiClient;
use crate::types::AgentSnapshot;

/// A decoded SSE event that matters to the UI layer.
#[derive(Debug, Clone)]
pub enum AppEvent {
    /// New full snapshot of the agent list.
    Agents(Vec<AgentSnapshot>),
    /// Transport-level reconnect — UI should refetch state on its own
    /// cadence (e.g. trigger a `GET /agents` to recover missed deltas).
    Reconnected,
    /// Transport gave up after repeated failures.
    Disconnected(String),
}

/// Start the SSE consumer task. Sends decoded events to `tx` until
/// `tx` is dropped or the transport permanently fails.
pub fn spawn(client: ApiClient, tx: mpsc::UnboundedSender<AppEvent>) {
    tokio::spawn(async move {
        let url = format!(
            "{}?token={}",
            client.url("/events"),
            urlencode(client.token())
        );
        let request = reqwest::Client::new().get(&url).bearer_auth(client.token());
        let mut source = match EventSource::new(request) {
            Ok(s) => s,
            Err(e) => {
                let _ = tx.send(AppEvent::Disconnected(format!("init: {e}")));
                return;
            }
        };

        while let Some(event) = source.next().await {
            match event {
                Ok(SseEvent::Open) => {
                    let _ = tx.send(AppEvent::Reconnected);
                }
                Ok(SseEvent::Message(msg)) => {
                    if msg.event == "agents" {
                        match serde_json::from_str::<Vec<AgentSnapshot>>(&msg.data) {
                            Ok(agents) => {
                                if tx.send(AppEvent::Agents(agents)).is_err() {
                                    break;
                                }
                            }
                            Err(e) => {
                                tracing::warn!("decode agents SSE: {e}");
                            }
                        }
                    }
                    // Other named events are ignored at this milestone.
                }
                Err(err) => {
                    // reqwest-eventsource auto-reconnects on transient
                    // errors — a terminal error (the only thing that
                    // reaches here and stays here) closes the stream.
                    let _ = tx.send(AppEvent::Disconnected(err.to_string()));
                    source.close();
                    break;
                }
            }
        }
    });
}

/// Backfill: fetch `/api/agents` once on startup so the UI has a
/// snapshot before the first SSE `agents` event lands.
pub async fn backfill(client: &ApiClient) -> Result<Vec<AgentSnapshot>> {
    client.list_agents().await
}

fn urlencode(s: &str) -> String {
    // RFC 3986 unreserved — good enough for a bearer token (hex chars).
    // Falls back to percent-encoding anything else.
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}
