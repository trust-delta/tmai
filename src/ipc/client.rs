//! IPC client for PTY wrapper process
//!
//! Connects to the tmai parent process via Unix domain socket
//! to send state updates and receive keystroke commands.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::ipc::protocol::*;

/// Registration info for the IPC client connection
struct RegistrationInfo {
    pane_id: String,
    pid: u32,
    team_name: Option<String>,
    team_member_name: Option<String>,
    is_team_lead: bool,
}

/// IPC client that connects to the tmai parent process
pub struct IpcClient {
    state_tx: std::sync::mpsc::SyncSender<WrapState>,
}

impl IpcClient {
    /// Start the IPC client
    ///
    /// Creates a background thread that connects to the IPC server
    /// and handles bidirectional communication. The `pty_writer` is
    /// used to forward keystroke commands from the server to the PTY.
    /// The `analyzer` is notified of IPC-originated input so the echo
    /// grace period applies equally to remote keystrokes.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        pane_id: String,
        pid: u32,
        team_name: Option<String>,
        team_member_name: Option<String>,
        is_team_lead: bool,
        running: Arc<AtomicBool>,
        pty_writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
        analyzer: Arc<parking_lot::Mutex<crate::wrap::analyzer::Analyzer>>,
    ) -> Self {
        // Bounded channel with capacity 2 - only recent states matter
        let (state_tx, state_rx) = std::sync::mpsc::sync_channel::<WrapState>(2);

        let reg = RegistrationInfo {
            pane_id,
            pid,
            team_name,
            team_member_name,
            is_team_lead,
        };
        let client_running = running;
        thread::spawn(move || {
            Self::connection_loop(reg, state_rx, client_running, pty_writer, analyzer);
        });

        Self { state_tx }
    }

    /// Send a state update (non-blocking)
    ///
    /// If the channel is full, the update is dropped (the next tick
    /// will send the latest state anyway).
    pub fn send_state(&self, state: WrapState) {
        // try_send: if Full, that's ok - writer thread will catch up
        let _ = self.state_tx.try_send(state);
    }

    /// Connection loop with exponential backoff retry
    fn connection_loop(
        reg: RegistrationInfo,
        state_rx: std::sync::mpsc::Receiver<WrapState>,
        running: Arc<AtomicBool>,
        pty_writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
        analyzer: Arc<parking_lot::Mutex<crate::wrap::analyzer::Analyzer>>,
    ) {
        let mut backoff_ms = 100u64;

        while running.load(Ordering::Relaxed) {
            match UnixStream::connect(socket_path()) {
                Ok(stream) => {
                    backoff_ms = 100; // Reset on successful connect
                    tracing::debug!("IPC connected to server");

                    if let Err(e) = Self::handle_connection(
                        stream,
                        &reg,
                        &state_rx,
                        &running,
                        &pty_writer,
                        &analyzer,
                    ) {
                        tracing::debug!("IPC connection lost: {}", e);
                    }
                }
                Err(e) => {
                    tracing::debug!("IPC connect failed (will retry): {}", e);
                }
            }

            if !running.load(Ordering::Relaxed) {
                break;
            }

            thread::sleep(Duration::from_millis(backoff_ms));
            backoff_ms = (backoff_ms * 2).min(2000);
        }
    }

    /// Handle a single connection session
    fn handle_connection(
        stream: UnixStream,
        reg: &RegistrationInfo,
        state_rx: &std::sync::mpsc::Receiver<WrapState>,
        running: &Arc<AtomicBool>,
        pty_writer: &Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
        analyzer: &Arc<parking_lot::Mutex<crate::wrap::analyzer::Analyzer>>,
    ) -> anyhow::Result<()> {
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;

        let mut write_stream = stream.try_clone()?;
        let read_stream = stream;

        // Send Register message
        let register = ClientMessage::Register {
            pane_id: reg.pane_id.clone(),
            pid: reg.pid,
            team_name: reg.team_name.clone(),
            team_member_name: reg.team_member_name.clone(),
            is_team_lead: reg.is_team_lead,
        };
        let msg = encode(&register)?;
        write_stream.write_all(&msg)?;
        write_stream.flush()?;

        // Wait for Registered response (with timeout)
        read_stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut reader = BufReader::new(read_stream);
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let _response: ServerMessage = decode(line.trim_end().as_bytes())?;

        // Switch to short read timeout for non-blocking reads
        reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_millis(100)))?;

        tracing::debug!("IPC registered as pane_id={}", reg.pane_id);

        // Connection is live flag
        let connected = Arc::new(AtomicBool::new(true));

        // Reader thread: receive SendKeys from server
        let reader_connected = connected.clone();
        let reader_running = running.clone();
        let pty_writer_clone = pty_writer.clone();
        let analyzer_clone = analyzer.clone();
        let reader_thread = thread::spawn(move || {
            let mut read_line = String::new();
            while reader_connected.load(Ordering::Relaxed) && reader_running.load(Ordering::Relaxed)
            {
                read_line.clear();
                match reader.read_line(&mut read_line) {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        if let Ok(msg) = decode::<ServerMessage>(read_line.trim_end().as_bytes()) {
                            match msg {
                                ServerMessage::SendKeys { keys, literal } => {
                                    let data = if literal {
                                        keys.as_bytes().to_vec()
                                    } else {
                                        tmux_key_to_bytes(&keys)
                                    };
                                    let mut writer = pty_writer_clone.lock();
                                    let _ = writer.write_all(&data);
                                    let _ = writer.flush();
                                    // Notify analyzer of IPC-originated input for echo grace
                                    analyzer_clone.lock().process_input(&keys);
                                }
                                ServerMessage::SendKeysAndEnter { text } => {
                                    let mut writer = pty_writer_clone.lock();
                                    let _ = writer.write_all(text.as_bytes());
                                    let _ = writer.write_all(b"\n");
                                    let _ = writer.flush();
                                    // Notify analyzer of IPC-originated input for echo grace
                                    analyzer_clone.lock().process_input(&text);
                                }
                                ServerMessage::Registered { .. } => {
                                    // Ignore duplicate
                                }
                            }
                        }
                    }
                    Err(ref e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        continue;
                    }
                    Err(_) => break,
                }
            }
            reader_connected.store(false, Ordering::Relaxed);
        });

        // Writer loop: send state updates (runs on current thread)
        while connected.load(Ordering::Relaxed) && running.load(Ordering::Relaxed) {
            match state_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(state) => {
                    let msg = ClientMessage::StateUpdate { state };
                    match encode(&msg) {
                        Ok(bytes) => {
                            if write_stream.write_all(&bytes).is_err() {
                                break;
                            }
                            let _ = write_stream.flush();
                        }
                        Err(_) => break,
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        connected.store(false, Ordering::Relaxed);
        let _ = reader_thread.join();

        Ok(())
    }
}

/// Convert tmux key name to bytes for PTY input
fn tmux_key_to_bytes(key: &str) -> Vec<u8> {
    match key {
        "Enter" => vec![b'\r'],
        "Space" => vec![b' '],
        "BSpace" => vec![0x7f],
        "Tab" => vec![b'\t'],
        "Escape" | "Esc" => vec![0x1b],
        "Up" => vec![0x1b, b'[', b'A'],
        "Down" => vec![0x1b, b'[', b'B'],
        "Right" => vec![0x1b, b'[', b'C'],
        "Left" => vec![0x1b, b'[', b'D'],
        "Home" => vec![0x1b, b'[', b'H'],
        "End" => vec![0x1b, b'[', b'F'],
        "PPage" => vec![0x1b, b'[', b'5', b'~'],
        "NPage" => vec![0x1b, b'[', b'6', b'~'],
        "DC" => vec![0x1b, b'[', b'3', b'~'],
        s if s.starts_with("C-") && s.len() == 3 => {
            // Control character via bitmask: C-a/C-A = 0x01, C-@ = 0x00, C-[ = 0x1b
            let c = s.as_bytes()[2];
            vec![c & 0x1f]
        }
        // For literal text like "y"
        other => other.as_bytes().to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tmux_key_to_bytes() {
        assert_eq!(tmux_key_to_bytes("Enter"), vec![b'\r']);
        assert_eq!(tmux_key_to_bytes("Space"), vec![b' ']);
        assert_eq!(tmux_key_to_bytes("Up"), vec![0x1b, b'[', b'A']);
        assert_eq!(tmux_key_to_bytes("C-c"), vec![3]); // 0x03
        assert_eq!(tmux_key_to_bytes("C-A"), vec![1]); // uppercase: same as C-a
        assert_eq!(tmux_key_to_bytes("C-@"), vec![0]); // NUL
        assert_eq!(tmux_key_to_bytes("C-["), vec![0x1b]); // ESC
        assert_eq!(tmux_key_to_bytes("y"), vec![b'y']);
    }
}
