//! Team task file reading from `~/.claude/tasks/{team-name}/`

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Status of a team task
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// Task is waiting to be started
    Pending,
    /// Task is currently being worked on
    InProgress,
    /// Task has been completed
    Completed,
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskStatus::Pending => write!(f, "pending"),
            TaskStatus::InProgress => write!(f, "in_progress"),
            TaskStatus::Completed => write!(f, "completed"),
        }
    }
}

/// A task in a team's task list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamTask {
    /// Task identifier (numeric string)
    #[serde(default)]
    pub id: String,
    /// Brief title of the task
    #[serde(default)]
    pub subject: String,
    /// Detailed description
    #[serde(default)]
    pub description: String,
    /// Present continuous form shown in spinner (e.g., "Fixing bug...")
    #[serde(default, rename = "activeForm")]
    pub active_form: Option<String>,
    /// Current status
    #[serde(default = "default_task_status")]
    pub status: TaskStatus,
    /// Owner (member name)
    #[serde(default)]
    pub owner: Option<String>,
    /// Task IDs that this task blocks
    #[serde(default)]
    pub blocks: Vec<String>,
    /// Task IDs that block this task
    #[serde(default, rename = "blockedBy")]
    pub blocked_by: Vec<String>,
}

/// Default task status
fn default_task_status() -> TaskStatus {
    TaskStatus::Pending
}

/// Read a single task file
///
/// # Arguments
/// * `task_path` - Path to the task JSON file (e.g., `1.json`)
pub fn read_task(task_path: &Path) -> Result<TeamTask> {
    let content = std::fs::read_to_string(task_path)
        .with_context(|| format!("Failed to read task file: {:?}", task_path))?;

    let task: TeamTask = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse task file: {:?}", task_path))?;

    Ok(task)
}

/// Read all task files from a team's task directory
///
/// Only reads numeric JSON files (e.g., `1.json`, `2.json`), skipping other files.
///
/// # Arguments
/// * `tasks_dir` - Path to the team's tasks directory
pub fn read_all_tasks(tasks_dir: &Path) -> Result<Vec<TeamTask>> {
    if !tasks_dir.exists() {
        return Ok(Vec::new());
    }

    let mut tasks = Vec::new();
    let entries = std::fs::read_dir(tasks_dir)
        .with_context(|| format!("Failed to read tasks directory: {:?}", tasks_dir))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        // Only process .json files
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        // Only process numeric filenames (e.g., 1.json, 23.json)
        let is_numeric = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false);

        if !is_numeric {
            continue;
        }

        match read_task(&path) {
            Ok(mut task) => {
                // Set task ID from filename if empty
                if task.id.is_empty() {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        task.id = stem.to_string();
                    }
                }
                tasks.push(task);
            }
            Err(e) => {
                eprintln!("Warning: Failed to read task file {:?}: {}", path, e);
            }
        }
    }

    // Sort by ID numerically
    tasks.sort_by(|a, b| {
        let id_a: u64 = a.id.parse().unwrap_or(u64::MAX);
        let id_b: u64 = b.id.parse().unwrap_or(u64::MAX);
        id_a.cmp(&id_b)
    });

    Ok(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_deserialization() {
        let json = r#"{
            "id": "1",
            "subject": "Fix authentication bug",
            "description": "The login flow has a bug",
            "activeForm": "Fixing authentication bug",
            "status": "in_progress",
            "owner": "dev",
            "blocks": ["3"],
            "blockedBy": []
        }"#;

        let task: TeamTask = serde_json::from_str(json).unwrap();
        assert_eq!(task.id, "1");
        assert_eq!(task.subject, "Fix authentication bug");
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.owner.as_deref(), Some("dev"));
        assert_eq!(task.blocks, vec!["3"]);
        assert!(task.blocked_by.is_empty());
        assert_eq!(
            task.active_form.as_deref(),
            Some("Fixing authentication bug")
        );
    }

    #[test]
    fn test_task_default_status() {
        let json = r#"{
            "id": "2",
            "subject": "Write tests"
        }"#;

        let task: TeamTask = serde_json::from_str(json).unwrap();
        assert_eq!(task.status, TaskStatus::Pending);
        assert!(task.owner.is_none());
        assert!(task.blocks.is_empty());
        assert!(task.blocked_by.is_empty());
    }

    #[test]
    fn test_task_forward_compat() {
        let json = r#"{
            "id": "1",
            "subject": "Test",
            "status": "completed",
            "unknown_field": true
        }"#;

        let task: TeamTask = serde_json::from_str(json).unwrap();
        assert_eq!(task.status, TaskStatus::Completed);
    }

    #[test]
    fn test_task_status_display() {
        assert_eq!(TaskStatus::Pending.to_string(), "pending");
        assert_eq!(TaskStatus::InProgress.to_string(), "in_progress");
        assert_eq!(TaskStatus::Completed.to_string(), "completed");
    }
}
