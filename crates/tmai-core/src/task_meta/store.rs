//! Task metadata data structures and file I/O.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tracing::{debug, warn};

/// A single milestone event in the task lifecycle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Milestone {
    /// When the milestone occurred
    pub at: DateTime<Utc>,
    /// Human-readable event description
    pub event: String,
}

/// Persistent metadata for a task branch.
///
/// Stored as `.task-meta/{branch-name}.json` in the project root.
/// Only contains information that git doesn't know — no commit hashes,
/// no file lists, no branch existence (git already tracks those).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMeta {
    /// Associated GitHub issue number
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<u64>,
    /// Agent ID working on this task (target or session_id)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Associated pull request number
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr: Option<u64>,
    /// Review agent ID (if a review agent was dispatched)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_agent_id: Option<String>,
    /// Milestone history
    #[serde(default)]
    pub milestones: Vec<Milestone>,
}

impl TaskMeta {
    /// Create a new TaskMeta with an issue association
    pub fn for_issue(issue_number: u64, agent_id: Option<String>) -> Self {
        let mut meta = Self {
            issue: Some(issue_number),
            agent_id,
            pr: None,
            review_agent_id: None,
            milestones: Vec::new(),
        };
        meta.add_milestone("Implementation started");
        meta
    }

    /// Append a milestone with the current timestamp
    pub fn add_milestone(&mut self, event: &str) {
        self.milestones.push(Milestone {
            at: Utc::now(),
            event: event.to_string(),
        });
    }
}

/// Sanitize a branch name for use as a filename.
/// Replaces `/` with `--` to avoid directory creation.
fn branch_to_filename(branch: &str) -> String {
    branch.replace('/', "--")
}

/// Resolve the `.task-meta/` directory for a project root.
fn task_meta_dir(project_root: &Path) -> PathBuf {
    project_root.join(".task-meta")
}

/// Resolve the JSON file path for a branch.
fn meta_path(project_root: &Path, branch: &str) -> PathBuf {
    task_meta_dir(project_root).join(format!("{}.json", branch_to_filename(branch)))
}

/// Read task metadata for a branch. Returns None if file doesn't exist.
pub fn read_meta(project_root: &Path, branch: &str) -> Option<TaskMeta> {
    let path = meta_path(project_root, branch);
    match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(meta) => Some(meta),
            Err(e) => {
                warn!(path = %path.display(), error = %e, "Failed to parse task meta");
                None
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            warn!(path = %path.display(), error = %e, "Failed to read task meta");
            None
        }
    }
}

/// Write task metadata for a branch. Creates the `.task-meta/` directory if needed.
pub fn write_meta(project_root: &Path, branch: &str, meta: &TaskMeta) -> std::io::Result<()> {
    let dir = task_meta_dir(project_root);
    std::fs::create_dir_all(&dir)?;
    let path = meta_path(project_root, branch);
    let content = serde_json::to_string_pretty(meta)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, content)?;
    debug!(branch = %branch, path = %path.display(), "Wrote task meta");
    Ok(())
}

/// Delete task metadata for a branch.
pub fn delete_meta(project_root: &Path, branch: &str) -> std::io::Result<()> {
    let path = meta_path(project_root, branch);
    match std::fs::remove_file(&path) {
        Ok(()) => {
            debug!(branch = %branch, "Deleted task meta");
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Append a milestone to an existing task meta file.
/// No-op if the file doesn't exist.
pub fn append_milestone(project_root: &Path, branch: &str, event: &str) {
    if let Some(mut meta) = read_meta(project_root, branch) {
        meta.add_milestone(event);
        if let Err(e) = write_meta(project_root, branch, &meta) {
            warn!(branch = %branch, error = %e, "Failed to append milestone");
        }
    }
}

/// Scan all `.task-meta/*.json` files and return (branch_name, TaskMeta) pairs.
pub fn scan_all(project_root: &Path) -> Vec<(String, TaskMeta)> {
    let dir = task_meta_dir(project_root);
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // Reverse the filename sanitization: `--` back to `/`
        let branch = stem.replace("--", "/");
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<TaskMeta>(&content) {
                Ok(meta) => results.push((branch, meta)),
                Err(e) => warn!(path = %path.display(), error = %e, "Skipping malformed task meta"),
            },
            Err(e) => warn!(path = %path.display(), error = %e, "Failed to read task meta"),
        }
    }
    results
}

/// Update task meta for a branch: read existing or create new, apply changes, write back.
pub fn update_meta<F>(project_root: &Path, branch: &str, updater: F)
where
    F: FnOnce(&mut TaskMeta),
{
    let mut meta = read_meta(project_root, branch).unwrap_or(TaskMeta {
        issue: None,
        agent_id: None,
        pr: None,
        review_agent_id: None,
        milestones: Vec::new(),
    });
    updater(&mut meta);
    if let Err(e) = write_meta(project_root, branch, &meta) {
        warn!(branch = %branch, error = %e, "Failed to update task meta");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_branch_to_filename() {
        assert_eq!(branch_to_filename("feat/add-auth"), "feat--add-auth");
        assert_eq!(branch_to_filename("main"), "main");
        assert_eq!(
            branch_to_filename("fix/42-nested/deep"),
            "fix--42-nested--deep"
        );
    }

    #[test]
    fn test_write_read_delete() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let branch = "feat/42-auth";

        // Initially no meta
        assert!(read_meta(root, branch).is_none());

        // Write
        let meta = TaskMeta::for_issue(42, Some("agent-1".into()));
        write_meta(root, branch, &meta).unwrap();

        // Read back
        let loaded = read_meta(root, branch).unwrap();
        assert_eq!(loaded.issue, Some(42));
        assert_eq!(loaded.agent_id.as_deref(), Some("agent-1"));
        assert_eq!(loaded.milestones.len(), 1);
        assert_eq!(loaded.milestones[0].event, "Implementation started");

        // Delete
        delete_meta(root, branch).unwrap();
        assert!(read_meta(root, branch).is_none());
    }

    #[test]
    fn test_append_milestone() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let branch = "feat/99-test";

        let meta = TaskMeta::for_issue(99, None);
        write_meta(root, branch, &meta).unwrap();

        append_milestone(root, branch, "PR #10 created");
        append_milestone(root, branch, "CI passed");

        let loaded = read_meta(root, branch).unwrap();
        assert_eq!(loaded.milestones.len(), 3);
        assert_eq!(loaded.milestones[1].event, "PR #10 created");
        assert_eq!(loaded.milestones[2].event, "CI passed");
    }

    #[test]
    fn test_append_milestone_no_file() {
        let dir = tempfile::tempdir().unwrap();
        // Should be a no-op, not panic
        append_milestone(dir.path(), "nonexistent", "nothing");
    }

    #[test]
    fn test_scan_all() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        write_meta(root, "feat/a", &TaskMeta::for_issue(1, None)).unwrap();
        write_meta(root, "feat/b", &TaskMeta::for_issue(2, None)).unwrap();
        write_meta(root, "simple", &TaskMeta::for_issue(3, None)).unwrap();

        let mut all = scan_all(root);
        all.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].0, "feat/a");
        assert_eq!(all[1].0, "feat/b");
        assert_eq!(all[2].0, "simple");
    }

    #[test]
    fn test_scan_all_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(scan_all(dir.path()).is_empty());
    }

    #[test]
    fn test_update_meta_creates_new() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        update_meta(root, "new-branch", |m| {
            m.issue = Some(50);
            m.add_milestone("Created from update");
        });

        let loaded = read_meta(root, "new-branch").unwrap();
        assert_eq!(loaded.issue, Some(50));
        assert_eq!(loaded.milestones.len(), 1);
    }

    #[test]
    fn test_update_meta_modifies_existing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        write_meta(root, "branch", &TaskMeta::for_issue(10, None)).unwrap();
        update_meta(root, "branch", |m| {
            m.pr = Some(42);
            m.add_milestone("PR created");
        });

        let loaded = read_meta(root, "branch").unwrap();
        assert_eq!(loaded.issue, Some(10));
        assert_eq!(loaded.pr, Some(42));
        assert_eq!(loaded.milestones.len(), 2);
    }

    #[test]
    fn test_delete_nonexistent() {
        let dir = tempfile::tempdir().unwrap();
        // Should not error
        delete_meta(dir.path(), "nonexistent").unwrap();
    }

    #[test]
    fn test_serde_defaults() {
        // Verify that missing optional fields deserialize correctly
        let json = r#"{"milestones": []}"#;
        let meta: TaskMeta = serde_json::from_str(json).unwrap();
        assert!(meta.issue.is_none());
        assert!(meta.agent_id.is_none());
        assert!(meta.pr.is_none());
        assert!(meta.review_agent_id.is_none());
    }
}
