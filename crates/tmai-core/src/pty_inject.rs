//! PTY stdin injection via `/proc/{pid}/fd/0`.
//!
//! Writes keystrokes directly to a Claude Code process's PTY stdin,
//! enabling input delivery in web-only mode without tmux or IPC.

use std::fs::OpenOptions;
use std::io::Write;

use anyhow::{Context, Result};
use tracing::debug;

use crate::utils::keys::tmux_key_to_bytes;

/// Inject raw bytes into a process's PTY stdin via `/proc/{pid}/fd/0`
pub fn inject_keys(pid: u32, data: &[u8]) -> Result<()> {
    let fd_path = format!("/proc/{}/fd/0", pid);
    let mut file = OpenOptions::new()
        .write(true)
        .open(&fd_path)
        .with_context(|| format!("Failed to open {} for PTY injection", fd_path))?;
    file.write_all(data)
        .with_context(|| format!("Failed to write to {}", fd_path))?;
    file.flush()?;
    debug!(pid, bytes = data.len(), "PTY inject: wrote bytes");
    Ok(())
}

/// Inject tmux-style key names (e.g., "y", "Enter") into a process's PTY stdin
pub fn inject_text(pid: u32, keys: &str) -> Result<()> {
    let data = tmux_key_to_bytes(keys);
    inject_keys(pid, &data)
}

/// Inject literal text (no key-name conversion) into a process's PTY stdin
pub fn inject_text_literal(pid: u32, text: &str) -> Result<()> {
    inject_keys(pid, text.as_bytes())
}

/// Inject literal text followed by Enter into a process's PTY stdin
pub fn inject_text_and_enter(pid: u32, text: &str) -> Result<()> {
    let mut data = text.as_bytes().to_vec();
    data.push(b'\r');
    inject_keys(pid, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inject_keys_nonexistent_pid() {
        // Should fail gracefully for a non-existent PID
        let result = inject_keys(999_999_999, b"test");
        assert!(result.is_err());
    }

    #[test]
    fn test_inject_text_converts_key_names() {
        // Verify key conversion happens (we can't inject into a real process in unit tests,
        // so we just check that the function properly fails for non-existent PID)
        let result = inject_text(999_999_999, "Enter");
        assert!(result.is_err());
    }
}
