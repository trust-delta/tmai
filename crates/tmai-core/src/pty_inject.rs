//! PTY stdin injection via `/proc/{pid}/fd/0`.
//!
//! Delivers keystrokes to a process's stdin. Strategy depends on fd type:
//! - **Pipe/file**: direct `write()` (data flows to the reader)
//! - **PTY slave**: `ioctl(TIOCSTI)` to push bytes into the input queue.
//!   Plain `write()` on a PTY slave sends data toward the *master* (output
//!   direction), so the target process never sees it as input.
//!   If TIOCSTI is disabled (`dev.tty.legacy_tiocsti=0`, Linux 6.2+),
//!   the call returns `Err` so the caller can fall through to Tier 3
//!   (e.g. `tmux send-keys`).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::io::AsRawFd;
use std::sync::OnceLock;

use anyhow::{Context, Result};
use tracing::{debug, warn};

use crate::utils::keys::tmux_key_to_bytes;

/// Check whether the given fd path (e.g. `/proc/{pid}/fd/0`) points to a PTY slave
fn is_pty_slave(fd_path: &str) -> bool {
    match fs::read_link(fd_path) {
        Ok(target) => {
            let s = target.to_string_lossy();
            // PTY slaves are /dev/pts/N
            s.starts_with("/dev/pts/")
        }
        Err(_) => false,
    }
}

/// Inject bytes via TIOCSTI ioctl (pushes each byte into the terminal input queue)
///
/// Requires the fd to be a TTY and `dev.tty.legacy_tiocsti=1` (or kernel < 6.2).
/// Returns Err if TIOCSTI is disabled or the fd is not a TTY.
fn inject_via_tiocsti(fd: std::os::unix::io::RawFd, data: &[u8]) -> Result<()> {
    for &byte in data {
        // SAFETY: TIOCSTI takes a pointer to a single byte.
        // The ioctl pushes the byte into the terminal's input queue.
        let ret = unsafe { libc::ioctl(fd, libc::TIOCSTI, &byte as *const u8) };
        if ret < 0 {
            let err = std::io::Error::last_os_error();
            return Err(anyhow::anyhow!(
                "TIOCSTI ioctl failed (legacy_tiocsti may be disabled): {}",
                err
            ));
        }
    }
    Ok(())
}

/// Inject raw bytes into a process's stdin via `/proc/{pid}/fd/0`
///
/// For PTY-attached processes, uses TIOCSTI ioctl for proper input injection.
/// For pipe/file stdin, uses direct write.
/// Returns Err if injection fails, allowing the caller to fall back to other methods.
pub fn inject_keys(pid: u32, data: &[u8]) -> Result<()> {
    let fd_path = format!("/proc/{}/fd/0", pid);

    if is_pty_slave(&fd_path) {
        // PTY slave: must use TIOCSTI — plain write goes output direction
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&fd_path)
            .with_context(|| format!("Failed to open {} for TIOCSTI injection", fd_path))?;

        match inject_via_tiocsti(file.as_raw_fd(), data) {
            Ok(()) => {
                debug!(
                    pid,
                    bytes = data.len(),
                    "PTY inject via TIOCSTI: wrote bytes"
                );
                Ok(())
            }
            Err(e) => {
                warn!(
                    pid,
                    "PTY inject: TIOCSTI failed (fd is PTY slave, direct write would go output direction). \
                     Falling back to Tier 3. Error: {}", e
                );
                Err(e)
            }
        }
    } else {
        // Pipe or file: direct write delivers data to the reader
        let mut file = OpenOptions::new()
            .write(true)
            .open(&fd_path)
            .with_context(|| format!("Failed to open {} for pipe injection", fd_path))?;
        file.write_all(data)
            .with_context(|| format!("Failed to write to {}", fd_path))?;
        file.flush()?;
        debug!(
            pid,
            bytes = data.len(),
            "PTY inject via pipe write: wrote bytes"
        );
        Ok(())
    }
}

/// Inject tmux-style key names (e.g., "y", "Enter") into a process's stdin
pub fn inject_text(pid: u32, keys: &str) -> Result<()> {
    let data = tmux_key_to_bytes(keys);
    inject_keys(pid, &data)
}

/// Inject literal text (no key-name conversion) into a process's stdin
pub fn inject_text_literal(pid: u32, text: &str) -> Result<()> {
    inject_keys(pid, text.as_bytes())
}

/// Inject literal text followed by Enter into a process's stdin
pub fn inject_text_and_enter(pid: u32, text: &str) -> Result<()> {
    let mut data = text.as_bytes().to_vec();
    data.push(b'\r');
    inject_keys(pid, &data)
}

/// Check whether TIOCSTI is available on this system.
///
/// Reads `/proc/sys/dev/tty/legacy_tiocsti` once and caches the result.
/// Returns `true` if TIOCSTI can be used (value is "1" or file doesn't exist
/// on pre-6.2 kernels where TIOCSTI is always available).
pub fn is_tiocsti_available() -> bool {
    static CACHED: OnceLock<bool> = OnceLock::new();
    *CACHED.get_or_init(|| {
        match fs::read_to_string("/proc/sys/dev/tty/legacy_tiocsti") {
            Ok(content) => content.trim() == "1",
            // File doesn't exist → pre-6.2 kernel → TIOCSTI always available
            Err(_) => true,
        }
    })
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

    #[test]
    fn test_is_pty_slave_self_stdin() {
        // Current process stdin — should be a PTY in interactive terminals,
        // but may be a pipe in CI. Just verify it doesn't panic.
        let result = is_pty_slave("/proc/self/fd/0");
        // Result depends on environment, just ensure no crash
        let _ = result;
    }

    #[test]
    fn test_is_pty_slave_nonexistent() {
        assert!(!is_pty_slave("/proc/999999999/fd/0"));
    }
}
