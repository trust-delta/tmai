//! PTY holder daemon — a separate process that holds the master PTY FD
//! and relays I/O over a Unix domain socket. Survives tmai restarts.
//!
//! Spawned as `tmai pty-hold --id <id> --cmd <cmd> --cwd <cwd>`.
//! Listens on `$XDG_RUNTIME_DIR/tmai/pty_sessions/<id>.sock`.
//!
//! Protocol (binary, over Unix stream socket):
//! - Daemon → Client: raw PTY output bytes (just forwarded as-is)
//! - Client → Daemon: raw input bytes (forwarded to PTY stdin)
//! - Client → Daemon: control message (JSON text prefixed with 0x00 byte):
//!   `\0{"type":"resize","rows":40,"cols":120}`
//!   `\0{"type":"kill"}`

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

use super::persistence;

/// Control message prefix byte (0x00 is not valid UTF-8 start, so unambiguous)
const CONTROL_PREFIX: u8 = 0x00;

/// Run the PTY holder daemon (called from `tmai pty-hold` subcommand)
///
/// This function blocks until the child process exits.
pub fn run_holder(
    session_id: &str,
    command: &str,
    args: &[String],
    cwd: &str,
    rows: u16,
    cols: u16,
    env_pairs: &[(String, String)],
) -> Result<()> {
    let socket_path = persistence::daemon_socket_path(session_id);

    // Ensure parent directory exists
    if let Some(parent) = socket_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Remove stale socket
    let _ = std::fs::remove_file(&socket_path);

    // Open PTY
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("Failed to open PTY")?;

    // Spawn child
    let mut cmd = CommandBuilder::new(command);
    cmd.args(args);
    cmd.cwd(cwd);
    for (key, val) in env_pairs {
        cmd.env(key, val);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .context("Failed to spawn command")?;
    let child_pid = child.process_id().unwrap_or(0);

    eprintln!(
        "pty-hold: spawned {}[{}] session={} socket={}",
        command,
        child_pid,
        session_id,
        socket_path.display()
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
    let master_for_resize = Arc::new(parking_lot::Mutex::new(pair.master));

    // Save persistence metadata
    let persisted = persistence::PersistedSession {
        id: session_id.to_string(),
        pid: child_pid,
        command: command.to_string(),
        cwd: cwd.to_string(),
        socket_path: socket_path.to_string_lossy().to_string(),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };
    persistence::save_session(&persisted)?;

    let running = Arc::new(AtomicBool::new(true));

    // Listen on Unix socket
    let listener = UnixListener::bind(&socket_path).context("Failed to bind daemon socket")?;
    listener
        .set_nonblocking(true)
        .context("Failed to set nonblocking")?;

    // Current connected client (only one at a time)
    let client_writer: Arc<parking_lot::Mutex<Option<UnixStream>>> =
        Arc::new(parking_lot::Mutex::new(None));

    // Thread: read PTY output → write to connected client
    let running_out = running.clone();
    let client_w = client_writer.clone();
    thread::spawn(move || {
        output_relay(master_reader, running_out, client_w);
    });

    // Thread: wait for child exit
    let running_child = running.clone();
    let sid = session_id.to_string();
    thread::spawn(move || {
        child_wait(child, running_child, &sid);
    });

    // Shared writer for PTY input
    let pty_writer = Arc::new(parking_lot::Mutex::new(master_writer));

    // Main loop: accept connections and handle I/O
    while running.load(Ordering::Relaxed) {
        // Accept new connection (non-blocking)
        match listener.accept() {
            Ok((stream, _)) => {
                eprintln!("pty-hold: client connected (session={})", session_id);

                // Replace old client
                {
                    let mut cw = client_writer.lock();
                    *cw = stream.try_clone().ok();
                }

                // Handle input from this client in a new thread
                let pty_w = pty_writer.clone();
                let r = running.clone();
                let master_r = master_for_resize.clone();
                let client_stream = stream;
                thread::spawn(move || {
                    input_relay(client_stream, pty_w, r, master_r);
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // No pending connection, sleep briefly
                thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                eprintln!("pty-hold: accept error: {}", e);
                break;
            }
        }
    }

    // Cleanup
    eprintln!("pty-hold: shutting down (session={})", session_id);
    let _ = std::fs::remove_file(&socket_path);
    persistence::remove_session(session_id);
    Ok(())
}

/// Relay PTY output to the connected client
fn output_relay(
    mut reader: Box<dyn Read + Send>,
    running: Arc<AtomicBool>,
    client: Arc<parking_lot::Mutex<Option<UnixStream>>>,
) {
    let mut buf = [0u8; 4096];
    while running.load(Ordering::Relaxed) {
        match reader.read(&mut buf) {
            Ok(0) => break, // EOF — PTY closed
            Ok(n) => {
                let data = &buf[..n];
                let mut cw = client.lock();
                if let Some(ref mut stream) = *cw {
                    if stream.write_all(data).is_err() || stream.flush().is_err() {
                        // Client disconnected — clear it, wait for reconnect
                        *cw = None;
                    }
                }
                // If no client, output is silently dropped (scrollback is in tmai)
            }
            Err(e) => {
                if e.kind() != std::io::ErrorKind::WouldBlock {
                    break;
                }
            }
        }
    }
    running.store(false, Ordering::Relaxed);
}

/// Relay client input to PTY stdin, handling control messages
fn input_relay(
    mut client: UnixStream,
    pty_writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
    running: Arc<AtomicBool>,
    master: Arc<parking_lot::Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
) {
    let mut buf = [0u8; 4096];
    while running.load(Ordering::Relaxed) {
        match client.read(&mut buf) {
            Ok(0) => {
                // Client disconnected
                eprintln!("pty-hold: client disconnected");
                break;
            }
            Ok(n) => {
                let data = &buf[..n];

                // Check for control message prefix
                if data[0] == CONTROL_PREFIX && n > 1 {
                    handle_control(&data[1..n], &master, &running);
                } else {
                    // Raw input → PTY stdin
                    let mut w = pty_writer.lock();
                    if w.write_all(data).is_err() || w.flush().is_err() {
                        break;
                    }
                }
            }
            Err(e) => {
                if e.kind() != std::io::ErrorKind::WouldBlock
                    && e.kind() != std::io::ErrorKind::Interrupted
                {
                    break;
                }
            }
        }
    }
}

/// Handle a JSON control message from the client
fn handle_control(
    data: &[u8],
    master: &Arc<parking_lot::Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    running: &Arc<AtomicBool>,
) {
    #[derive(serde::Deserialize)]
    struct ControlMsg {
        #[serde(rename = "type")]
        msg_type: String,
        #[serde(default)]
        rows: u16,
        #[serde(default)]
        cols: u16,
    }

    let msg: ControlMsg = match serde_json::from_slice(data) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("pty-hold: invalid control message: {}", e);
            return;
        }
    };

    match msg.msg_type.as_str() {
        "resize" => {
            if msg.cols > 0 && msg.rows > 0 {
                let m = master.lock();
                let _ = m.resize(PtySize {
                    rows: msg.rows,
                    cols: msg.cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
        }
        "kill" => {
            running.store(false, Ordering::Relaxed);
        }
        other => {
            eprintln!("pty-hold: unknown control type: {}", other);
        }
    }
}

/// Wait for child process to exit
fn child_wait(
    mut child: Box<dyn portable_pty::Child + Send>,
    running: Arc<AtomicBool>,
    session_id: &str,
) {
    match child.wait() {
        Ok(status) => {
            eprintln!(
                "pty-hold: child exited (session={} code={})",
                session_id,
                status.exit_code()
            );
        }
        Err(e) => {
            eprintln!("pty-hold: child wait error: {} (session={})", e, session_id);
        }
    }
    running.store(false, Ordering::Relaxed);
}

/// Get the socket path for connecting to a daemon
pub fn daemon_socket_path(session_id: &str) -> PathBuf {
    persistence::daemon_socket_path(session_id)
}
