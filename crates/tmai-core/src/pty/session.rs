//! PTY session — spawns a command in a pseudo-terminal and provides
//! broadcast-based output streaming and input injection.
//!
//! Supports two modes:
//! - **Direct**: PtySession holds the PTY master FD (original behavior).
//!   Child is killed on drop. Used for ephemeral/test processes.
//! - **Detached**: A separate `tmai pty-hold` daemon holds the master FD.
//!   PtySession connects via Unix socket. Child survives tmai restart.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use anyhow::{Context, Result};
use bytes::Bytes;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::broadcast;

use super::holder;
use super::persistence;

/// Broadcast channel capacity for PTY output
const OUTPUT_CHANNEL_CAPACITY: usize = 256;

/// Maximum scrollback buffer size (bytes). Roughly 256KB — enough to
/// reconstruct several screens of terminal content on reconnect.
const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;

/// Control message prefix byte for the daemon protocol
const CONTROL_PREFIX: u8 = 0x00;

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

/// How the PTY I/O is managed
enum PtyBackend {
    /// Direct: tmai holds the master PTY FD (killed on drop)
    Direct {
        writer: parking_lot::Mutex<Box<dyn Write + Send>>,
        master: parking_lot::Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    },
    /// Detached: a pty-hold daemon holds the master FD, we connect via socket
    Detached {
        socket_writer: parking_lot::Mutex<Option<UnixStream>>,
    },
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
    /// Backend (direct or daemon-backed)
    backend: PtyBackend,
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
    /// Whether this session is detached (daemon-backed)
    detached: bool,
}

impl PtySession {
    /// Spawn a command in a new PTY session (direct mode — child killed on drop).
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
            "PTY session spawned (direct): command={} pid={} cwd={}",
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
            backend: PtyBackend::Direct {
                writer: parking_lot::Mutex::new(master_writer),
                master: parking_lot::Mutex::new(pair.master),
            },
            output_tx: output_tx.clone(),
            scrollback: parking_lot::Mutex::new(ScrollbackBuffer::new()),
            running: running.clone(),
            cwd: cwd.to_string(),
            command: command.to_string(),
            pid: child_pid,
            detached: false,
        });

        // Background thread: read PTY output → broadcast + scrollback
        let running_out = running.clone();
        let session_for_output = session.clone();
        thread::spawn(move || {
            Self::reader_loop(master_reader, output_tx, running_out, session_for_output);
        });

        // Background thread: wait for child exit
        let running_child = running.clone();
        thread::spawn(move || {
            Self::child_wait_loop(child, running_child, &id);
        });

        Ok(session)
    }

    /// Spawn a command via a detached pty-hold daemon (survives tmai restart).
    ///
    /// Launches `tmai pty-hold` as a separate process that holds the PTY master FD.
    /// This session connects to the daemon via Unix socket for I/O relay.
    pub fn spawn_detached(
        command: &str,
        args: &[&str],
        cwd: &str,
        rows: u16,
        cols: u16,
        env: &[(&str, &str)],
    ) -> Result<Arc<Self>> {
        let id = uuid::Uuid::new_v4().to_string();
        let socket_path = holder::daemon_socket_path(&id);

        // Build args for `tmai pty-hold`
        let tmai_exe = std::env::current_exe().context("Failed to find tmai executable path")?;

        let mut daemon_cmd = std::process::Command::new(&tmai_exe);
        daemon_cmd.arg("pty-hold");
        daemon_cmd.arg("--id").arg(&id);
        daemon_cmd.arg("--cmd").arg(command);
        daemon_cmd.arg("--cwd").arg(cwd);
        daemon_cmd
            .arg("--rows")
            .arg(rows.to_string())
            .arg("--cols")
            .arg(cols.to_string());

        // Pass additional command args
        if !args.is_empty() {
            daemon_cmd.arg("--");
            daemon_cmd.args(args);
        }

        // Pass env vars as KEY=VALUE pairs via --env
        for (key, val) in env {
            daemon_cmd.arg("--env").arg(format!("{}={}", key, val));
        }

        // Spawn daemon as a fully independent process
        // Redirect stderr to a log file for debugging
        let log_dir = crate::ipc::protocol::state_dir().join("pty_sessions");
        let _ = std::fs::create_dir_all(&log_dir);
        let log_path = log_dir.join(format!("{}.log", id));
        let log_file = std::fs::File::create(&log_path).ok();

        daemon_cmd
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(
                log_file
                    .map(std::process::Stdio::from)
                    .unwrap_or_else(std::process::Stdio::null),
            );

        let child = daemon_cmd
            .spawn()
            .context("Failed to spawn pty-hold daemon")?;
        let daemon_pid = child.id();

        tracing::info!(
            "PTY session spawned (detached): command={} daemon_pid={} session={} socket={}",
            command,
            daemon_pid,
            id,
            socket_path.display()
        );

        // Wait for daemon socket to appear (with timeout)
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !socket_path.exists() {
            if std::time::Instant::now() > deadline {
                anyhow::bail!(
                    "pty-hold daemon did not create socket within 5s: {}",
                    socket_path.display()
                );
            }
            thread::sleep(std::time::Duration::from_millis(50));
        }
        // Brief extra wait for the daemon to start listening
        thread::sleep(std::time::Duration::from_millis(100));

        // Read the persisted session to get the actual child PID
        let persisted_path = persistence::daemon_socket_path(&id)
            .with_extension("json")
            .with_file_name(format!("{}.json", id));
        let child_pid = {
            let sessions_dir = crate::ipc::protocol::state_dir().join("pty_sessions");
            let path = sessions_dir.join(format!("{}.json", id));
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(ps) = serde_json::from_str::<persistence::PersistedSession>(&content) {
                    ps.pid
                } else {
                    0
                }
            } else {
                0
            }
        };
        // Suppress unused variable warning
        let _ = persisted_path;

        // Connect to daemon socket
        Self::connect_to_daemon(&id, child_pid, command, cwd)
    }

    /// Connect to an existing pty-hold daemon (for reconnection after restart)
    pub fn connect_to_daemon(
        session_id: &str,
        pid: u32,
        command: &str,
        cwd: &str,
    ) -> Result<Arc<Self>> {
        let socket_path = holder::daemon_socket_path(session_id);
        let stream =
            UnixStream::connect(&socket_path).context("Failed to connect to pty-hold daemon")?;
        let reader_stream = stream
            .try_clone()
            .context("Failed to clone daemon socket")?;

        let (output_tx, _) = broadcast::channel(OUTPUT_CHANNEL_CAPACITY);
        let running = Arc::new(AtomicBool::new(true));

        let session = Arc::new(Self {
            id: session_id.to_string(),
            backend: PtyBackend::Detached {
                socket_writer: parking_lot::Mutex::new(Some(stream)),
            },
            output_tx: output_tx.clone(),
            scrollback: parking_lot::Mutex::new(ScrollbackBuffer::new()),
            running: running.clone(),
            cwd: cwd.to_string(),
            command: command.to_string(),
            pid,
            detached: true,
        });

        // Background thread: read daemon socket → broadcast + scrollback
        let running_r = running.clone();
        let session_for_output = session.clone();
        thread::spawn(move || {
            Self::reader_loop(
                Box::new(reader_stream),
                output_tx,
                running_r,
                session_for_output,
            );
        });

        tracing::info!(
            "PTY session connected (detached): session={} pid={} command={}",
            session_id,
            pid,
            command
        );

        Ok(session)
    }

    /// Generic read loop: reader → broadcast channel + scrollback buffer
    fn reader_loop(
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
                    session.scrollback.lock().push(data.clone());
                    let _ = tx.send(data);
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::WouldBlock {
                        tracing::debug!("PTY read error: {}", e);
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
    pub fn scrollback_snapshot(&self) -> Bytes {
        self.scrollback.lock().snapshot()
    }

    /// Write input bytes to the PTY
    pub fn write_input(&self, data: &[u8]) -> Result<()> {
        match &self.backend {
            PtyBackend::Direct { writer, .. } => {
                let mut w = writer.lock();
                w.write_all(data).context("Failed to write to PTY")?;
                w.flush().context("Failed to flush PTY writer")?;
            }
            PtyBackend::Detached { socket_writer } => {
                let mut sw = socket_writer.lock();
                if let Some(ref mut stream) = *sw {
                    stream
                        .write_all(data)
                        .context("Failed to write to daemon socket")?;
                    stream.flush().context("Failed to flush daemon socket")?;
                } else {
                    anyhow::bail!("Daemon socket not connected");
                }
            }
        }
        Ok(())
    }

    /// Resize the PTY terminal
    pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        match &self.backend {
            PtyBackend::Direct { master, .. } => {
                let m = master.lock();
                m.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .context("Failed to resize PTY")?;
            }
            PtyBackend::Detached { socket_writer } => {
                // Send control message to daemon
                let msg = format!(
                    "{}",
                    serde_json::json!({"type": "resize", "rows": rows, "cols": cols})
                );
                let mut payload = vec![CONTROL_PREFIX];
                payload.extend_from_slice(msg.as_bytes());

                let mut sw = socket_writer.lock();
                if let Some(ref mut stream) = *sw {
                    stream
                        .write_all(&payload)
                        .context("Failed to send resize to daemon")?;
                    stream.flush()?;
                }
            }
        }
        Ok(())
    }

    /// Check whether the child process is still running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Whether this session is detached (daemon-backed)
    pub fn is_detached(&self) -> bool {
        self.detached
    }

    /// Kill the child process
    pub fn kill(&self) {
        if self.detached {
            // Send kill control message to daemon
            if let PtyBackend::Detached { socket_writer } = &self.backend {
                let msg = format!("{}", serde_json::json!({"type": "kill"}));
                let mut payload = vec![CONTROL_PREFIX];
                payload.extend_from_slice(msg.as_bytes());

                let mut sw = socket_writer.lock();
                if let Some(ref mut stream) = *sw {
                    let _ = stream.write_all(&payload);
                    let _ = stream.flush();
                }
            }
        } else if self.pid > 0 {
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
        if self.detached {
            // Detached sessions: just disconnect, don't kill the child
            tracing::debug!(
                "PTY session {} dropping (detached, child preserved)",
                self.id
            );
        } else {
            // Direct sessions: kill the child as before
            self.kill();
        }
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

        // Poll for output with timeout (more reliable than fixed sleep)
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            let snapshot = session.scrollback_snapshot();
            let text = String::from_utf8_lossy(&snapshot);
            if text.contains("hello world") {
                break;
            }
            if tokio::time::Instant::now() > deadline {
                panic!(
                    "Expected 'hello world' in scrollback within 3s, got: {}",
                    text
                );
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
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
