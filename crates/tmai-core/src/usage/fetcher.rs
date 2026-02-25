//! Background fetcher that spawns a hidden Claude Code instance to get usage data.

use std::time::Duration;

use anyhow::{Context, Result};
use tokio::sync::watch;
use tracing::{debug, info, warn};

use super::parser::parse_usage_output;
use super::types::UsageSnapshot;
use crate::tmux::TmuxClient;

/// Sender for usage snapshot updates
pub type UsageSnapshotSender = watch::Sender<UsageSnapshot>;
/// Receiver for usage snapshot updates
pub type UsageSnapshotReceiver = watch::Receiver<UsageSnapshot>;

/// Create a watch channel for usage data
pub fn usage_channel() -> (UsageSnapshotSender, UsageSnapshotReceiver) {
    watch::channel(UsageSnapshot::default())
}

/// Fetch usage data by spawning a temporary Claude Code instance in a hidden tmux window.
///
/// 1. Creates a detached window in the given tmux session
/// 2. Runs `claude` and waits for it to become idle
/// 3. Sends `/usage` command
/// 4. Captures pane output and parses it
/// 5. Cleans up the temporary pane
pub async fn fetch_usage(session: &str) -> Result<UsageSnapshot> {
    let tmux = TmuxClient::new();

    // Use home directory (trusted by Claude Code, avoids "trust this folder?" prompt)
    let home = std::env::var("HOME")
        .context("HOME environment variable is not set; cannot determine trusted directory")?;

    // Create a detached window for the usage fetch
    let target = tmux
        .new_window(session, &home, Some("tmai-usage"))
        .context("Failed to create hidden window for usage fetch")?;

    info!("Usage fetch: created hidden pane {}", target);

    // Run claude in the pane
    tmux.run_command(&target, "claude")
        .context("Failed to start claude in usage pane")?;

    // Wait for Claude Code to start up (poll for idle state)
    let started = wait_for_claude_ready(&tmux, &target, Duration::from_secs(30)).await;
    if !started {
        // Cleanup on failure
        let _ = tmux.kill_pane(&target);
        anyhow::bail!("Claude Code did not start within timeout");
    }

    debug!("Usage fetch: Claude Code ready, sending /usage");

    // Brief delay to ensure Claude Code is fully ready for input
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Send /usage command (slash command, confirmed with Enter)
    tmux.send_keys_literal(&target, "/usage")
        .context("Failed to send /usage")?;
    // Small delay so Claude Code can process the slash command menu
    tokio::time::sleep(Duration::from_millis(300)).await;
    tmux.send_keys(&target, "Enter")
        .context("Failed to send Enter after /usage")?;

    // Wait for the usage overlay to appear
    let usage_text = wait_for_usage_output(&tmux, &target, Duration::from_secs(15)).await;

    // Cleanup: Escape to close /usage overlay, then Ctrl+C twice to quit Claude Code
    let _ = tmux.send_keys(&target, "Escape");
    tokio::time::sleep(Duration::from_millis(300)).await;
    let _ = tmux.send_keys(&target, "C-c");
    tokio::time::sleep(Duration::from_millis(300)).await;
    let _ = tmux.send_keys(&target, "C-c");
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = tmux.kill_pane(&target);

    info!("Usage fetch: cleaned up pane {}", target);

    match usage_text {
        Some(text) => {
            let snapshot = parse_usage_output(&text);
            if snapshot.meters.is_empty() {
                anyhow::bail!("Failed to parse usage output (no meters found)");
            }
            Ok(snapshot)
        }
        None => anyhow::bail!("Usage overlay did not appear within timeout"),
    }
}

/// Poll until Claude Code appears ready (idle prompt with INSERT mode visible).
/// Automatically handles "trust this folder?" prompt by pressing Enter.
async fn wait_for_claude_ready(tmux: &TmuxClient, target: &str, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(500);
    let mut trust_confirmed = false;

    while start.elapsed() < timeout {
        tokio::time::sleep(poll_interval).await;

        if let Ok(content) = tmux.capture_pane_plain(target) {
            // Claude Code shows "-- INSERT --" at the bottom when ready for input
            if content.contains("-- INSERT --") {
                debug!("Usage fetch: detected INSERT mode, Claude is ready");
                return true;
            }

            // Handle "trust this folder?" prompt automatically
            if !trust_confirmed && content.contains("Yes, I trust this folder") {
                debug!("Usage fetch: auto-confirming trust prompt");
                let _ = tmux.send_keys(target, "Enter");
                trust_confirmed = true;
            }
        }
    }

    warn!("Usage fetch: timed out waiting for Claude Code to start");
    false
}

/// Poll until `/usage` output appears in the pane
async fn wait_for_usage_output(
    tmux: &TmuxClient,
    target: &str,
    timeout: Duration,
) -> Option<String> {
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(300);

    while start.elapsed() < timeout {
        tokio::time::sleep(poll_interval).await;

        if let Ok(content) = tmux.capture_pane_plain(target) {
            // Check if usage output is visible (contains "% used")
            if content.contains("% used") {
                debug!("Usage fetch: detected usage output");
                return Some(content);
            }
            debug!(
                "Usage fetch: waiting for /usage output ({:.1}s elapsed)",
                start.elapsed().as_secs_f32()
            );
        }
    }

    warn!("Usage fetch: timed out waiting for /usage output");
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_usage_channel() {
        let (tx, rx) = usage_channel();
        assert!(rx.borrow().meters.is_empty());

        let snapshot = UsageSnapshot {
            meters: vec![],
            fetched_at: Some(chrono::Utc::now()),
            fetching: false,
            error: None,
        };
        tx.send(snapshot).unwrap();
        assert!(rx.borrow().fetched_at.is_some());
    }
}
