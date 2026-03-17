//! PTY session — spawns a command in a pseudo-terminal and provides
//! broadcast-based output streaming and input injection.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use anyhow::{Context, Result};
use bytes::Bytes;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::broadcast;

/// Broadcast channel capacity for PTY output
const OUTPUT_CHANNEL_CAPACITY: usize = 256;

/// Maximum scrollback buffer size (bytes). Roughly 256KB — enough to
/// reconstruct several screens of terminal content on reconnect.
const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;

/// Scrollback buffer that accumulates raw PTY output for replay on reconnect.
struct ScrollbackBuffer {
    chunks: VecDeque<Bytes>,
    total_bytes: usize,
}

impl ScrollbackBuffer {
    fn new() -> Self {
        Self {
            chunks: VecDeque::new(),
            total_bytes: 0,
        }
    }

    /// Append a chunk, evicting old data if over the limit
    fn push(&mut self, data: Bytes) {
        self.total_bytes += data.len();
        self.chunks.push_back(data);
        while self.total_bytes > SCROLLBACK_MAX_BYTES {
            if let Some(old) = self.chunks.pop_front() {
                self.total_bytes -= old.len();
            } else {
                break;
            }
        }
    }

    /// Return all buffered chunks as a single contiguous Bytes
    fn snapshot(&self) -> Bytes {
        if self.chunks.is_empty() {
            return Bytes::new();
        }
        let mut buf = Vec::with_capacity(self.total_bytes);
        for chunk in &self.chunks {
            buf.extend_from_slice(chunk);
        }
        Bytes::from(buf)
    }
}

/// PTY session wrapping a spawned command.
///
/// Output is streamed via a `broadcast::Sender<Bytes>` so that multiple
/// consumers (WebSocket connections, analyzers) can subscribe independently.
/// A scrollback buffer is maintained so that late-joining consumers can
/// replay past output (e.g. when switching between agents in the UI).
pub struct PtySession {
    /// Unique session identifier
    pub id: String,
    /// Writer end of the PTY master (input injection)
    writer: parking_lot::Mutex<Box<dyn Write + Send>>,
    /// PTY master handle (for resize)
    master: parking_lot::Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    /// Broadcast sender for raw PTY output
    output_tx: broadcast::Sender<Bytes>,
    /// Scrollback buffer for replay on reconnect
    scrollback: parking_lot::Mutex<ScrollbackBuffer>,
    /// Whether the child process is still running
    running: Arc<AtomicBool>,
    /// Working directory the command was started in
    pub cwd: String,
    /// Command that was spawned
    pub command: String,
    /// Child process ID
    pub pid: u32,
}

impl PtySession {
    /// Spawn a command in a new PTY session.
    ///
    /// Starts a background thread that reads PTY output and broadcasts it.
    /// Optional `env` pairs are set as environment variables in the child.
    pub fn spawn(
        command: &str,
        args: &[&str],
        cwd: &str,
        rows: u16,
        cols: u16,
        env: &[(&str, &str)],
    ) -> Result<Arc<Self>> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to open PTY")?;

        // Build command
        let mut cmd = CommandBuilder::new(command);
        cmd.args(args);
        cmd.cwd(cwd);
        for (key, val) in env {
            cmd.env(key, val);
        }

        // Spawn child
        let child = pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command")?;
        let child_pid = child.process_id().unwrap_or(0);

        tracing::info!(
            "PTY session spawned: command={} pid={} cwd={}",
            command,
            child_pid,
            cwd
        );

        // Get master reader/writer
        let master_reader = pair
            .master
            .try_clone_reader()
            .context("Failed to clone PTY reader")?;
        let master_writer = pair
            .master
            .take_writer()
            .context("Failed to take PTY writer")?;

        let (output_tx, _) = broadcast::channel(OUTPUT_CHANNEL_CAPACITY);
        let running = Arc::new(AtomicBool::new(true));
        let id = uuid::Uuid::new_v4().to_string();

        let session = Arc::new(Self {
            id: id.clone(),
            writer: parking_lot::Mutex::new(master_writer),
            master: parking_lot::Mutex::new(pair.master),
            output_tx: output_tx.clone(),
            scrollback: parking_lot::Mutex::new(ScrollbackBuffer::new()),
            running: running.clone(),
            cwd: cwd.to_string(),
            command: command.to_string(),
            pid: child_pid,
        });

        // Background thread: read PTY output → broadcast + scrollback
        let running_out = running.clone();
        let session_for_output = session.clone();
        thread::spawn(move || {
            Self::output_loop(master_reader, output_tx, running_out, session_for_output);
        });

        // Background thread: wait for child exit
        let running_child = running.clone();
        thread::spawn(move || {
            Self::child_wait_loop(child, running_child, &id);
        });

        Ok(session)
    }

    /// Read loop: PTY master → broadcast channel + scrollback buffer
    fn output_loop(
        mut reader: Box<dyn Read + Send>,
        tx: broadcast::Sender<Bytes>,
        running: Arc<AtomicBool>,
        session: Arc<PtySession>,
    ) {
        let mut buf = [0u8; 4096];
        while running.load(Ordering::Relaxed) {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = Bytes::copy_from_slice(&buf[..n]);
                    // Append to scrollback buffer
                    session.scrollback.lock().push(data.clone());
                    // Broadcast to live subscribers (ignore errors if none)
                    let _ = tx.send(data);
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::WouldBlock {
                        tracing::debug!("PTY output read error: {}", e);
                        break;
                    }
                }
            }
        }
        running.store(false, Ordering::Relaxed);
    }

    /// Wait for child process to exit, then set running=false
    fn child_wait_loop(
        mut child: Box<dyn portable_pty::Child + Send>,
        running: Arc<AtomicBool>,
        session_id: &str,
    ) {
        match child.wait() {
            Ok(status) => {
                tracing::info!(
                    "PTY session {} child exited: code={}",
                    session_id,
                    status.exit_code()
                );
            }
            Err(e) => {
                tracing::warn!("PTY session {} child wait error: {}", session_id, e);
            }
        }
        running.store(false, Ordering::Relaxed);
    }

    /// Subscribe to the raw PTY output stream
    pub fn subscribe(&self) -> broadcast::Receiver<Bytes> {
        self.output_tx.subscribe()
    }

    /// Get the accumulated scrollback buffer for replay on reconnect.
    ///
    /// Returns a single `Bytes` containing all buffered output (up to
    /// SCROLLBACK_MAX_BYTES). The caller should send this before
    /// forwarding live broadcast messages.
    pub fn scrollback_snapshot(&self) -> Bytes {
        self.scrollback.lock().snapshot()
    }

    /// Write input bytes to the PTY
    pub fn write_input(&self, data: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock();
        writer.write_all(data).context("Failed to write to PTY")?;
        writer.flush().context("Failed to flush PTY writer")?;
        Ok(())
    }

    /// Resize the PTY terminal
    pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        let master = self.master.lock();
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to resize PTY")?;
        Ok(())
    }

    /// Check whether the child process is still running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Kill the child process
    pub fn kill(&self) {
        if self.pid > 0 {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(self.pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            );
        }
        self.running.store(false, Ordering::Relaxed);
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_spawn_echo() {
        let session = PtySession::spawn("echo", &["hello"], "/tmp", 24, 80, &[])
            .expect("Failed to spawn echo");

        let mut rx = session.subscribe();

        // Wait for output with timeout
        let mut output = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            tokio::select! {
                result = rx.recv() => {
                    match result {
                        Ok(data) => {
                            output.extend_from_slice(&data);
                            let text = String::from_utf8_lossy(&output);
                            if text.contains("hello") {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                _ = tokio::time::sleep_until(deadline) => {
                    break;
                }
            }
        }

        let text = String::from_utf8_lossy(&output);
        assert!(
            text.contains("hello"),
            "Expected 'hello' in output: {}",
            text
        );

        // Wait for process to exit
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!session.is_running());
    }

    #[tokio::test]
    async fn test_scrollback_snapshot() {
        let session = PtySession::spawn("echo", &["hello world"], "/tmp", 24, 80, &[])
            .expect("Failed to spawn echo");

        // Wait for output to be buffered
        tokio::time::sleep(Duration::from_millis(500)).await;

        let snapshot = session.scrollback_snapshot();
        let text = String::from_utf8_lossy(&snapshot);
        assert!(
            text.contains("hello world"),
            "Expected 'hello world' in scrollback: {}",
            text
        );
    }

    #[test]
    fn test_write_input() {
        // Spawn cat which echoes input
        let session =
            PtySession::spawn("cat", &[], "/tmp", 24, 80, &[]).expect("Failed to spawn cat");

        // Write something
        session.write_input(b"test\n").expect("write_input failed");

        // Kill it
        session.kill();
        assert!(!session.is_running());
    }

    #[test]
    fn test_resize() {
        let session =
            PtySession::spawn("sleep", &["1"], "/tmp", 24, 80, &[]).expect("Failed to spawn sleep");

        // Resize should not error
        session.resize(40, 120).expect("resize failed");
        session.kill();
    }

    #[test]
    fn test_scrollback_buffer_eviction() {
        let mut buf = ScrollbackBuffer::new();
        // Push more than SCROLLBACK_MAX_BYTES
        let chunk = Bytes::from(vec![b'A'; 64 * 1024]); // 64KB each
        for _ in 0..8 {
            buf.push(chunk.clone()); // 512KB total
        }
        // Should be capped at ~256KB
        assert!(buf.total_bytes <= SCROLLBACK_MAX_BYTES);
        assert!(buf.total_bytes > 0);
    }
}
