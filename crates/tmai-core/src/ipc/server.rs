//! IPC server for tmai parent process
//!
//! Listens on a Unix domain socket for wrapper connections and maintains
//! a registry of connected wrapper states.

use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;

use anyhow::{Context, Result};
use parking_lot::RwLock;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::mpsc;

use crate::ipc::protocol::*;

/// Registry of connected wrapper states, keyed by pane_id
pub type IpcRegistry = Arc<RwLock<HashMap<String, WrapState>>>;

/// Handle to a connected wrapper, allowing server-to-wrapper messaging
struct ConnectionHandle {
    pane_id: String,
    tx: mpsc::Sender<ServerMessage>,
}

/// IPC server that manages wrapper connections
pub struct IpcServer {
    registry: IpcRegistry,
    connections: Arc<RwLock<HashMap<String, ConnectionHandle>>>,
}

impl IpcServer {
    /// Start the IPC server, binding to the Unix domain socket
    pub async fn start() -> Result<Self> {
        let registry: IpcRegistry = Arc::new(RwLock::new(HashMap::new()));
        let connections: Arc<RwLock<HashMap<String, ConnectionHandle>>> =
            Arc::new(RwLock::new(HashMap::new()));

        // Ensure state directory exists with 0o700 permissions
        ensure_state_dir()?;

        // Clean up stale socket
        let sock = socket_path();
        if sock.exists() {
            match tokio::net::UnixStream::connect(&sock).await {
                Ok(_) => {
                    anyhow::bail!(
                        "Another tmai instance is already running (socket {} is active)",
                        sock.display()
                    );
                }
                Err(_) => {
                    // Stale socket, safe to remove
                    std::fs::remove_file(&sock).with_context(|| {
                        format!("Failed to remove stale socket: {}", sock.display())
                    })?;
                }
            }
        }

        let listener = UnixListener::bind(&sock).context("Failed to bind IPC Unix socket")?;

        // Set socket permissions to owner-only
        std::fs::set_permissions(&sock, std::fs::Permissions::from_mode(0o700))
            .context("Failed to set socket permissions")?;

        let server = Self {
            registry: registry.clone(),
            connections: connections.clone(),
        };

        // Spawn accept loop
        tokio::spawn(async move {
            Self::accept_loop(listener, registry, connections).await;
        });

        tracing::debug!("IPC server started on {}", sock.display());
        Ok(server)
    }

    /// Accept loop for incoming wrapper connections
    async fn accept_loop(
        listener: UnixListener,
        registry: IpcRegistry,
        connections: Arc<RwLock<HashMap<String, ConnectionHandle>>>,
    ) {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let registry = registry.clone();
                    let connections = connections.clone();
                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_connection(stream, registry, connections).await
                        {
                            tracing::debug!("IPC connection ended: {}", e);
                        }
                    });
                }
                Err(e) => {
                    tracing::warn!("IPC accept error: {}", e);
                }
            }
        }
    }

    /// Handle a single wrapper connection
    async fn handle_connection(
        stream: tokio::net::UnixStream,
        registry: IpcRegistry,
        connections: Arc<RwLock<HashMap<String, ConnectionHandle>>>,
    ) -> Result<()> {
        let (reader, mut writer) = stream.into_split();
        let mut buf_reader = BufReader::new(reader);
        let mut line_buf = String::new();

        // First message must be Register
        buf_reader.read_line(&mut line_buf).await?;
        if line_buf.is_empty() {
            anyhow::bail!("Connection closed before registration");
        }
        let first_msg: ClientMessage = decode(line_buf.trim_end().as_bytes())?;

        let pane_id = match first_msg {
            ClientMessage::Register {
                pane_id,
                pid,
                team_name,
                team_member_name,
                is_team_lead,
            } => {
                let state = WrapState {
                    pid,
                    pane_id: Some(pane_id.clone()),
                    team_name,
                    team_member_name,
                    is_team_lead,
                    ..Default::default()
                };
                registry.write().insert(pane_id.clone(), state);
                pane_id
            }
            _ => anyhow::bail!("First message must be Register"),
        };

        // Create channel for server → wrapper messages
        let (tx, mut rx) = mpsc::channel::<ServerMessage>(32);
        let connection_id = uuid::Uuid::new_v4().to_string();

        // Send Registered response
        let registered = ServerMessage::Registered {
            connection_id: connection_id.clone(),
        };
        let msg_bytes = encode(&registered)?;
        writer.write_all(&msg_bytes).await?;
        writer.flush().await?;

        // Remove any existing connection for this pane_id (reconnect scenario)
        // then store the new connection handle
        {
            let mut conns = connections.write();
            conns.retain(|_, handle| handle.pane_id != pane_id);
            conns.insert(
                connection_id.clone(),
                ConnectionHandle {
                    pane_id: pane_id.clone(),
                    tx,
                },
            );
        }

        tracing::debug!("IPC client registered: pane_id={}", pane_id);

        // Main loop: read from client OR send to client
        line_buf.clear();
        loop {
            tokio::select! {
                result = buf_reader.read_line(&mut line_buf) => {
                    match result {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            if let Ok(msg) = decode::<ClientMessage>(line_buf.trim_end().as_bytes()) {
                                match msg {
                                    ClientMessage::StateUpdate { state } => {
                                        registry.write().insert(pane_id.clone(), state);
                                    }
                                    ClientMessage::Register { .. } => {
                                        // Ignore duplicate register
                                    }
                                }
                            }
                            line_buf.clear();
                        }
                        Err(e) => {
                            tracing::debug!("IPC read error for pane {}: {}", pane_id, e);
                            break;
                        }
                    }
                }
                msg = rx.recv() => {
                    match msg {
                        Some(server_msg) => {
                            match encode(&server_msg) {
                                Ok(msg_bytes) => {
                                    if writer.write_all(&msg_bytes).await.is_err() {
                                        break;
                                    }
                                    let _ = writer.flush().await;
                                }
                                Err(_) => break,
                            }
                        }
                        None => break, // Channel closed
                    }
                }
            }
        }

        // Cleanup on disconnect
        registry.write().remove(&pane_id);
        connections.write().remove(&connection_id);
        tracing::debug!("IPC client disconnected: pane_id={}", pane_id);

        Ok(())
    }

    /// Get the registry for reading wrapper states
    pub fn registry(&self) -> IpcRegistry {
        self.registry.clone()
    }

    /// Check if a wrapper with the given pane_id is connected
    pub fn has_connection(&self, pane_id: &str) -> bool {
        self.connections
            .read()
            .values()
            .any(|c| c.pane_id == pane_id)
    }

    /// Send keys to a wrapper via IPC. Returns true if sent successfully.
    pub fn try_send_keys(&self, pane_id: &str, keys: &str, literal: bool) -> bool {
        let connections = self.connections.read();
        for handle in connections.values() {
            if handle.pane_id == pane_id {
                let msg = ServerMessage::SendKeys {
                    keys: keys.to_string(),
                    literal,
                };
                return handle.tx.try_send(msg).is_ok();
            }
        }
        false
    }

    /// Send text + Enter to a wrapper via IPC. Returns true if sent successfully.
    pub fn try_send_keys_and_enter(&self, pane_id: &str, text: &str) -> bool {
        let connections = self.connections.read();
        for handle in connections.values() {
            if handle.pane_id == pane_id {
                let msg = ServerMessage::SendKeysAndEnter {
                    text: text.to_string(),
                };
                return handle.tx.try_send(msg).is_ok();
            }
        }
        false
    }
}

/// Ensure state directory exists with proper permissions
fn ensure_state_dir() -> Result<()> {
    let dir = state_dir();
    // Check for symlink attack before creating
    if dir.exists() {
        let meta = std::fs::symlink_metadata(&dir)
            .with_context(|| format!("Failed to read metadata for: {}", dir.display()))?;
        if meta.is_symlink() {
            anyhow::bail!(
                "State directory is a symlink (possible attack): {}",
                dir.display()
            );
        }
    }
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create state directory: {}", dir.display()))?;
    let metadata = std::fs::metadata(&dir)
        .with_context(|| format!("Failed to read metadata for: {}", dir.display()))?;
    if !metadata.is_dir() {
        anyhow::bail!("State path is not a directory: {}", dir.display());
    }
    let mode = metadata.permissions().mode() & 0o777;
    if mode != 0o700 {
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .with_context(|| format!("Failed to set permissions on: {}", dir.display()))?;
    }
    Ok(())
}

impl Drop for IpcServer {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(socket_path());
    }
}
