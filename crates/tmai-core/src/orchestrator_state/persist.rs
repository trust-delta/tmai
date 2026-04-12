//! Persistence for orchestrator identity records.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

/// Default TTL for records — entries older than this are pruned on read.
pub const DEFAULT_TTL_DAYS: i64 = 30;

/// Default recency window for Tier 2 restore.
pub const TIER2_RECENCY_HOURS: i64 = 24;

/// Single persisted orchestrator identity record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrchestratorRecord {
    /// Absolute path to the project (e.g. git_common_dir or cwd).
    pub project_path: String,
    /// Claude Code `session_id` observed when the record was last updated.
    pub claude_session_id: String,
    /// Wall-clock timestamp of the last update.
    pub last_seen: DateTime<Utc>,
}

/// Persisted store of orchestrator records.
#[derive(Debug, Clone)]
pub struct OrchestratorStore {
    path: PathBuf,
    pub(crate) records: Vec<OrchestratorRecord>,
    ttl: Duration,
}

/// Shared handle for injection into `AppState` and other services.
pub type SharedOrchestratorStore = Arc<RwLock<OrchestratorStore>>;

impl OrchestratorStore {
    /// Create an empty in-memory store backed by the given path.
    /// The file is NOT read — call [`Self::load`] to populate.
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            records: Vec::new(),
            ttl: Duration::days(DEFAULT_TTL_DAYS),
        }
    }

    /// Override the TTL. Primarily useful in tests.
    pub fn with_ttl(mut self, ttl: Duration) -> Self {
        self.ttl = ttl;
        self
    }

    /// Load records from disk, applying TTL pruning. Missing file is treated
    /// as an empty store and is not an error.
    pub fn load(path: PathBuf) -> Self {
        let mut store = Self::new(path);
        store.reload_from_disk();
        store
    }

    /// Re-read the backing file from disk and prune expired records.
    pub fn reload_from_disk(&mut self) {
        if !self.path.exists() {
            self.records = Vec::new();
            return;
        }
        match std::fs::read_to_string(&self.path) {
            Ok(body) => match serde_json::from_str::<Vec<OrchestratorRecord>>(&body) {
                Ok(mut recs) => {
                    let cutoff = Utc::now() - self.ttl;
                    recs.retain(|r| r.last_seen >= cutoff);
                    self.records = recs;
                }
                Err(e) => {
                    tracing::warn!(path = %self.path.display(), error = %e, "failed to parse orchestrators.json — ignoring");
                    self.records = Vec::new();
                }
            },
            Err(e) => {
                tracing::warn!(path = %self.path.display(), error = %e, "failed to read orchestrators.json — ignoring");
                self.records = Vec::new();
            }
        }
    }

    /// Path to the backing file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// All records currently held in memory.
    pub fn records(&self) -> &[OrchestratorRecord] {
        &self.records
    }

    /// Prune expired records in place. Returns the number removed.
    pub fn prune(&mut self) -> usize {
        let cutoff = Utc::now() - self.ttl;
        let before = self.records.len();
        self.records.retain(|r| r.last_seen >= cutoff);
        before - self.records.len()
    }

    /// Find a record matching an exact `(project_path, session_id)` tuple.
    pub fn find_exact(&self, project_path: &str, session_id: &str) -> Option<&OrchestratorRecord> {
        self.records
            .iter()
            .find(|r| r.project_path == project_path && r.claude_session_id == session_id)
    }

    /// All records for a given project.
    pub fn records_for_project(&self, project_path: &str) -> Vec<&OrchestratorRecord> {
        self.records
            .iter()
            .filter(|r| r.project_path == project_path)
            .collect()
    }

    /// Upsert a record — updates `last_seen` if an entry with the same
    /// `(project_path, claude_session_id)` exists, otherwise inserts.
    /// Persists to disk and returns the I/O result.
    pub fn upsert_and_save(&mut self, project_path: &str, session_id: &str) -> std::io::Result<()> {
        self.upsert_in_memory(project_path, session_id);
        self.save()
    }

    /// In-memory upsert without touching disk. Exposed for bulk updates
    /// (e.g. the poller refreshing `last_seen` for many orchestrators).
    pub fn upsert_in_memory(&mut self, project_path: &str, session_id: &str) {
        let now = Utc::now();
        if let Some(rec) = self
            .records
            .iter_mut()
            .find(|r| r.project_path == project_path && r.claude_session_id == session_id)
        {
            rec.last_seen = now;
        } else {
            self.records.push(OrchestratorRecord {
                project_path: project_path.to_string(),
                claude_session_id: session_id.to_string(),
                last_seen: now,
            });
        }
    }

    /// Rotate the session_id for an existing record (Tier 2 restore). If no
    /// record for `project_path` with `old_session_id` exists the call is a no-op.
    pub fn rotate_session(
        &mut self,
        project_path: &str,
        old_session_id: &str,
        new_session_id: &str,
    ) {
        let now = Utc::now();
        if let Some(rec) = self
            .records
            .iter_mut()
            .find(|r| r.project_path == project_path && r.claude_session_id == old_session_id)
        {
            rec.claude_session_id = new_session_id.to_string();
            rec.last_seen = now;
        }
    }

    /// Persist the records to disk atomically, prune first, 0600 on unix.
    pub fn save(&mut self) -> std::io::Result<()> {
        self.prune();
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let body = serde_json::to_vec_pretty(&self.records)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        let tmp_path = self.path.with_extension("json.tmp");
        {
            let mut opts = std::fs::OpenOptions::new();
            opts.create(true).write(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut f = opts.open(&tmp_path)?;
            f.write_all(&body)?;
            f.sync_all()?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&tmp_path, perms)?;
        }
        std::fs::rename(&tmp_path, &self.path)?;
        Ok(())
    }
}

/// Resolve the default path for the orchestrator state file.
///
/// Prefers `$XDG_STATE_HOME/tmai/orchestrators.json`; falls back to
/// `~/.local/state/tmai/orchestrators.json`, then to the current directory.
pub fn default_store_path() -> PathBuf {
    if let Some(state_dir) = dirs::state_dir() {
        return state_dir.join("tmai").join("orchestrators.json");
    }
    if let Some(home) = dirs::home_dir() {
        return home
            .join(".local")
            .join("state")
            .join("tmai")
            .join("orchestrators.json");
    }
    PathBuf::from("orchestrators.json")
}

/// Build a shared store for the default path, loading any existing records.
pub fn new_shared() -> SharedOrchestratorStore {
    Arc::new(RwLock::new(OrchestratorStore::load(default_store_path())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn mk_store(dir: &Path) -> OrchestratorStore {
        OrchestratorStore::new(dir.join("orchestrators.json"))
    }

    #[test]
    fn test_upsert_inserts_new_record() {
        let dir = tempdir().unwrap();
        let mut s = mk_store(dir.path());
        s.upsert_and_save("/proj", "sess-1").unwrap();
        assert_eq!(s.records().len(), 1);
        assert_eq!(s.records()[0].project_path, "/proj");
        assert_eq!(s.records()[0].claude_session_id, "sess-1");
    }

    #[test]
    fn test_upsert_updates_existing_record() {
        let dir = tempdir().unwrap();
        let mut s = mk_store(dir.path());
        s.upsert_and_save("/proj", "sess-1").unwrap();
        let first_seen = s.records()[0].last_seen;
        // Small delay to ensure timestamp differs on fast systems
        std::thread::sleep(std::time::Duration::from_millis(5));
        s.upsert_and_save("/proj", "sess-1").unwrap();
        assert_eq!(s.records().len(), 1);
        assert!(s.records()[0].last_seen >= first_seen);
    }

    #[test]
    fn test_roundtrip_save_and_load() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("orchestrators.json");
        {
            let mut s = OrchestratorStore::new(path.clone());
            s.upsert_and_save("/a", "s1").unwrap();
            s.upsert_and_save("/b", "s2").unwrap();
        }
        let loaded = OrchestratorStore::load(path);
        assert_eq!(loaded.records().len(), 2);
    }

    #[test]
    fn test_ttl_pruning_on_read() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("orchestrators.json");
        // Seed file with two records: one fresh, one 60 days old.
        let records = vec![
            OrchestratorRecord {
                project_path: "/fresh".into(),
                claude_session_id: "fresh-sess".into(),
                last_seen: Utc::now(),
            },
            OrchestratorRecord {
                project_path: "/stale".into(),
                claude_session_id: "stale-sess".into(),
                last_seen: Utc::now() - Duration::days(60),
            },
        ];
        std::fs::write(&path, serde_json::to_vec(&records).unwrap()).unwrap();

        let loaded = OrchestratorStore::load(path);
        assert_eq!(loaded.records().len(), 1);
        assert_eq!(loaded.records()[0].project_path, "/fresh");
    }

    #[test]
    fn test_rotate_session() {
        let dir = tempdir().unwrap();
        let mut s = mk_store(dir.path());
        s.upsert_and_save("/proj", "old-sess").unwrap();
        s.rotate_session("/proj", "old-sess", "new-sess");
        assert_eq!(s.records().len(), 1);
        assert_eq!(s.records()[0].claude_session_id, "new-sess");
    }

    #[test]
    fn test_multi_orchestrator_per_project() {
        let dir = tempdir().unwrap();
        let mut s = mk_store(dir.path());
        s.upsert_and_save("/proj", "sess-1").unwrap();
        s.upsert_and_save("/proj", "sess-2").unwrap();
        let for_proj = s.records_for_project("/proj");
        assert_eq!(for_proj.len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn test_file_permissions_are_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let mut s = mk_store(dir.path());
        s.upsert_and_save("/proj", "sess-1").unwrap();
        let meta = std::fs::metadata(s.path()).unwrap();
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "file mode must be 0600, got {:o}", mode);
    }

    #[test]
    fn test_load_missing_file_is_empty_ok() {
        let dir = tempdir().unwrap();
        let s = OrchestratorStore::load(dir.path().join("does-not-exist.json"));
        assert!(s.records().is_empty());
    }

    #[test]
    fn test_load_corrupt_file_is_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("orchestrators.json");
        std::fs::write(&path, "not-json").unwrap();
        let s = OrchestratorStore::load(path);
        assert!(s.records().is_empty());
    }
}
