//! State file management for PTY wrapper
//!
//! Writes agent state to `/tmp/tmai/{pane_id}.state` for the main tmai process to read.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// Base directory for state files
const STATE_DIR: &str = "/tmp/tmai";

/// Status of a wrapped agent
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WrapStatus {
    /// Agent is actively outputting (last output within 200ms)
    Processing,
    /// Agent is idle (output stopped, no approval detected)
    #[default]
    Idle,
    /// Agent is awaiting approval (output stopped with approval pattern)
    AwaitingApproval,
}

/// Type of approval being requested (for wrapped agents)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WrapApprovalType {
    /// File edit/create/delete
    FileEdit,
    /// Shell command execution
    ShellCommand,
    /// MCP tool invocation
    McpTool,
    /// User question with selectable choices
    UserQuestion,
    /// Yes/No confirmation
    YesNo,
    /// Other/unknown
    Other,
}

/// State data written to the state file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrapState {
    /// Current status
    pub status: WrapStatus,
    /// Type of approval (if awaiting approval)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_type: Option<WrapApprovalType>,
    /// Details about the current state
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// Available choices (for UserQuestion)
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub choices: Vec<String>,
    /// Whether multiple selections are allowed
    #[serde(default)]
    pub multi_select: bool,
    /// Current cursor position (1-indexed, for UserQuestion)
    #[serde(default)]
    pub cursor_position: usize,
    /// Timestamp of last output (Unix millis)
    pub last_output: u64,
    /// Timestamp of last input (Unix millis)
    pub last_input: u64,
    /// Process ID of the wrapped command
    pub pid: u32,
    /// Tmux pane ID (if known)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
}

impl Default for WrapState {
    fn default() -> Self {
        let now = current_time_millis();
        Self {
            status: WrapStatus::Idle,
            approval_type: None,
            details: None,
            choices: Vec::new(),
            multi_select: false,
            cursor_position: 0,
            last_output: now,
            last_input: now,
            pid: 0,
            pane_id: None,
        }
    }
}

impl WrapState {
    /// Create a new state for processing
    pub fn processing(pid: u32) -> Self {
        Self {
            status: WrapStatus::Processing,
            pid,
            ..Default::default()
        }
    }

    /// Create a new state for idle
    pub fn idle(pid: u32) -> Self {
        Self {
            status: WrapStatus::Idle,
            pid,
            ..Default::default()
        }
    }

    /// Create a new state for awaiting approval
    pub fn awaiting_approval(
        pid: u32,
        approval_type: WrapApprovalType,
        details: Option<String>,
    ) -> Self {
        Self {
            status: WrapStatus::AwaitingApproval,
            approval_type: Some(approval_type),
            details,
            pid,
            ..Default::default()
        }
    }

    /// Create a state for user question
    pub fn user_question(
        pid: u32,
        choices: Vec<String>,
        multi_select: bool,
        cursor_position: usize,
    ) -> Self {
        Self {
            status: WrapStatus::AwaitingApproval,
            approval_type: Some(WrapApprovalType::UserQuestion),
            choices,
            multi_select,
            cursor_position,
            pid,
            ..Default::default()
        }
    }

    /// Update last output timestamp
    pub fn touch_output(&mut self) {
        self.last_output = current_time_millis();
    }

    /// Update last input timestamp
    pub fn touch_input(&mut self) {
        self.last_input = current_time_millis();
    }

    /// Set pane ID
    pub fn with_pane_id(mut self, pane_id: String) -> Self {
        self.pane_id = Some(pane_id);
        self
    }
}

/// Manager for state file operations
pub struct StateFile {
    /// Unique identifier for this wrapper instance
    id: String,
    /// Path to the state file
    path: PathBuf,
}

impl StateFile {
    /// Create a new state file manager
    ///
    /// The `id` should be unique per wrapper instance. Typically this is
    /// the tmux pane ID or a UUID if pane ID is not yet known.
    ///
    /// # Security
    /// The `id` is sanitized to prevent path traversal attacks.
    /// Only alphanumeric characters, `-`, and `_` are allowed.
    pub fn new(id: &str) -> Result<Self> {
        // Sanitize id to prevent path traversal attacks
        // Only allow alphanumeric, '-', '_' characters
        if !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            bail!(
                "Invalid state file ID: '{}'. Only alphanumeric, '-', and '_' characters are allowed.",
                id
            );
        }

        // Reject empty id
        if id.is_empty() {
            bail!("State file ID cannot be empty");
        }

        // Ensure state directory exists with secure permissions (0700)
        let state_dir = PathBuf::from(STATE_DIR);
        if !state_dir.exists() {
            fs::create_dir_all(&state_dir)
                .with_context(|| format!("Failed to create state directory: {}", STATE_DIR))?;
            // Set directory permissions to 0700 (owner only)
            fs::set_permissions(&state_dir, fs::Permissions::from_mode(0o700))
                .with_context(|| format!("Failed to set permissions on state directory: {}", STATE_DIR))?;
        }

        let path = state_dir.join(format!("{}.state", id));

        Ok(Self {
            id: id.to_string(),
            path,
        })
    }

    /// Get the path to the state file
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Get the ID
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Write state to file
    ///
    /// Uses atomic write with temp file to prevent partial reads.
    /// The temp file is created with O_CREAT|O_EXCL to prevent symlink attacks.
    pub fn write(&self, state: &WrapState) -> Result<()> {
        let json = serde_json::to_string_pretty(state).context("Failed to serialize state")?;

        // Write atomically using temp file
        let temp_path = self.path.with_extension("tmp");

        // Remove existing temp file if it exists (from a previous failed write)
        let _ = fs::remove_file(&temp_path);

        // Create temp file with O_CREAT|O_EXCL to prevent symlink attacks
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .with_context(|| format!("Failed to create temp state file: {:?}", temp_path))?;

        file.write_all(json.as_bytes())
            .with_context(|| format!("Failed to write temp state file: {:?}", temp_path))?;

        file.sync_all()
            .with_context(|| format!("Failed to sync temp state file: {:?}", temp_path))?;

        fs::rename(&temp_path, &self.path)
            .with_context(|| format!("Failed to rename state file: {:?}", self.path))?;

        Ok(())
    }

    /// Read state from file
    pub fn read(&self) -> Result<WrapState> {
        let content = fs::read_to_string(&self.path)
            .with_context(|| format!("Failed to read state file: {:?}", self.path))?;

        serde_json::from_str(&content)
            .with_context(|| format!("Failed to parse state file: {:?}", self.path))
    }

    /// Check if state file exists
    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    /// Remove the state file
    pub fn remove(&self) -> Result<()> {
        if self.path.exists() {
            fs::remove_file(&self.path)
                .with_context(|| format!("Failed to remove state file: {:?}", self.path))?;
        }
        Ok(())
    }
}

impl Drop for StateFile {
    fn drop(&mut self) {
        // Clean up state file on drop
        let _ = self.remove();
    }
}

/// Read a state file by pane ID without managing lifecycle
pub fn read_state(pane_id: &str) -> Result<WrapState> {
    let path = PathBuf::from(STATE_DIR).join(format!("{}.state", pane_id));
    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read state file: {:?}", path))?;

    serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse state file: {:?}", path))
}

/// Check if a state file exists for a pane
pub fn has_state_file(pane_id: &str) -> bool {
    PathBuf::from(STATE_DIR)
        .join(format!("{}.state", pane_id))
        .exists()
}

/// List all state files
pub fn list_state_files() -> Result<Vec<String>> {
    let dir = PathBuf::from(STATE_DIR);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut ids = Vec::new();
    for entry in
        fs::read_dir(&dir).with_context(|| format!("Failed to read state directory: {:?}", dir))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("state") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                ids.push(stem.to_string());
            }
        }
    }

    Ok(ids)
}

/// Get current time in milliseconds
fn current_time_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wrap_state_serialization() {
        let state = WrapState::processing(1234);
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"status\":\"processing\""));
        assert!(json.contains("\"pid\":1234"));
    }

    #[test]
    fn test_wrap_state_deserialization() {
        let json = r#"{
            "status": "awaiting_approval",
            "approval_type": "user_question",
            "choices": ["Yes", "No"],
            "multi_select": false,
            "cursor_position": 1,
            "last_output": 1234567890,
            "last_input": 1234567890,
            "pid": 5678
        }"#;

        let state: WrapState = serde_json::from_str(json).unwrap();
        assert_eq!(state.status, WrapStatus::AwaitingApproval);
        assert_eq!(state.approval_type, Some(WrapApprovalType::UserQuestion));
        assert_eq!(state.choices, vec!["Yes", "No"]);
        assert_eq!(state.cursor_position, 1);
        assert_eq!(state.pid, 5678);
    }

    #[test]
    fn test_current_time_millis() {
        let t1 = current_time_millis();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let t2 = current_time_millis();
        assert!(t2 > t1);
    }

    #[test]
    fn test_state_file_rejects_path_traversal() {
        // Path traversal with ../
        assert!(StateFile::new("../etc/passwd").is_err());
        assert!(StateFile::new("foo/../bar").is_err());

        // Path traversal with /
        assert!(StateFile::new("/etc/passwd").is_err());
        assert!(StateFile::new("foo/bar").is_err());

        // Path traversal with backslash
        assert!(StateFile::new("foo\\bar").is_err());

        // Other invalid characters
        assert!(StateFile::new("foo.bar").is_err());
        assert!(StateFile::new("foo bar").is_err());
        assert!(StateFile::new("foo:bar").is_err());

        // Empty id
        assert!(StateFile::new("").is_err());
    }

    #[test]
    fn test_state_file_accepts_valid_ids() {
        // Valid alphanumeric
        assert!(StateFile::new("test123").is_ok());

        // Valid with hyphen
        assert!(StateFile::new("test-123").is_ok());

        // Valid with underscore
        assert!(StateFile::new("test_123").is_ok());

        // UUID-like (common use case)
        assert!(StateFile::new("550e8400-e29b-41d4-a716-446655440000").is_ok());

        // Tmux pane ID (number only)
        assert!(StateFile::new("0").is_ok());
        assert!(StateFile::new("123").is_ok());
    }
}
