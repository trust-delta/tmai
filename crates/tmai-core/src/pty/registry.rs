//! PTY session registry — manages multiple spawned PTY sessions.

use std::sync::Arc;

use anyhow::Result;
use parking_lot::RwLock;

use super::persistence;
use super::session::PtySession;

/// Registry that tracks all active PTY sessions.
pub struct PtyRegistry {
    sessions: RwLock<std::collections::HashMap<String, Arc<PtySession>>>,
}

impl PtyRegistry {
    /// Create a new empty registry
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            sessions: RwLock::new(std::collections::HashMap::new()),
        })
    }

    /// Spawn a new agent process (direct mode) and register the session.
    pub fn spawn_session(
        &self,
        command: &str,
        args: &[&str],
        cwd: &str,
        rows: u16,
        cols: u16,
        env: &[(&str, &str)],
    ) -> Result<Arc<PtySession>> {
        let session = PtySession::spawn(command, args, cwd, rows, cols, env)?;
        let id = session.id.clone();
        self.sessions.write().insert(id, session.clone());
        Ok(session)
    }

    /// Spawn a new agent process via detached daemon and register the session.
    ///
    /// The child process survives tmai restart. The daemon holds the master PTY FD.
    pub fn spawn_detached(
        &self,
        command: &str,
        args: &[&str],
        cwd: &str,
        rows: u16,
        cols: u16,
        env: &[(&str, &str)],
    ) -> Result<Arc<PtySession>> {
        let session = PtySession::spawn_detached(command, args, cwd, rows, cols, env)?;
        let id = session.id.clone();
        self.sessions.write().insert(id, session.clone());
        Ok(session)
    }

    /// Restore sessions from persisted metadata (reconnect to daemons).
    ///
    /// Called on tmai startup to rediscover PTY-spawned agents.
    /// Returns list of (session_id, command, cwd, pid) for each restored session.
    pub fn restore_sessions(&self) -> Vec<(String, String, String, u32)> {
        let persisted = persistence::load_sessions();
        let mut restored = Vec::new();

        for ps in persisted {
            match PtySession::connect_to_daemon(&ps.id, ps.pid, &ps.command, &ps.cwd) {
                Ok(session) => {
                    tracing::info!(
                        "Restored PTY session: id={} command={} pid={}",
                        ps.id,
                        ps.command,
                        ps.pid
                    );
                    let info = (
                        session.id.clone(),
                        session.command.clone(),
                        session.cwd.clone(),
                        session.pid,
                    );
                    self.sessions.write().insert(session.id.clone(), session);
                    restored.push(info);
                }
                Err(e) => {
                    tracing::warn!(
                        "Failed to restore PTY session {}: {}. Cleaning up.",
                        ps.id,
                        e
                    );
                    persistence::remove_session(&ps.id);
                }
            }
        }

        restored
    }

    /// Get a session by ID
    pub fn get(&self, id: &str) -> Option<Arc<PtySession>> {
        self.sessions.read().get(id).cloned()
    }

    /// Remove a session by ID
    pub fn remove(&self, id: &str) -> Option<Arc<PtySession>> {
        self.sessions.write().remove(id)
    }

    /// List all sessions (id, session)
    pub fn list(&self) -> Vec<(String, Arc<PtySession>)> {
        self.sessions
            .read()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// Remove sessions whose child process has exited.
    ///
    /// Returns the IDs of removed sessions.
    pub fn cleanup_dead(&self) -> Vec<String> {
        let mut sessions = self.sessions.write();
        let dead: Vec<String> = sessions
            .iter()
            .filter(|(_, s)| !s.is_running())
            .map(|(k, _)| k.clone())
            .collect();

        for id in &dead {
            sessions.remove(id);
        }

        dead
    }
}

impl Default for PtyRegistry {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(std::collections::HashMap::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_spawn_and_get() {
        let registry = PtyRegistry::new();
        let session = registry
            .spawn_session("echo", &["hello"], "/tmp", 24, 80, &[])
            .expect("spawn_session failed");

        let id = session.id.clone();
        assert!(registry.get(&id).is_some());
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn test_registry_remove() {
        let registry = PtyRegistry::new();
        let session = registry
            .spawn_session("echo", &["hello"], "/tmp", 24, 80, &[])
            .expect("spawn_session failed");

        let id = session.id.clone();
        let removed = registry.remove(&id);
        assert!(removed.is_some());
        assert!(registry.get(&id).is_none());
    }

    #[test]
    fn test_registry_cleanup_dead() {
        let registry = PtyRegistry::new();
        let session = registry
            .spawn_session("true", &[], "/tmp", 24, 80, &[])
            .expect("spawn_session failed");

        let _id = session.id.clone();

        // Wait for 'true' to exit
        std::thread::sleep(std::time::Duration::from_millis(500));

        let dead = registry.cleanup_dead();
        assert!(!dead.is_empty());
        assert!(registry.list().is_empty());
    }
}
