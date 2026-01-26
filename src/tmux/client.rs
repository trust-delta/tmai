use anyhow::{Context, Result};
use std::process::Command;

use super::pane::PaneInfo;

/// Client for interacting with tmux
pub struct TmuxClient {
    /// Number of lines to capture from pane
    capture_lines: u32,
}

impl TmuxClient {
    /// Creates a new TmuxClient with default settings
    pub fn new() -> Self {
        Self { capture_lines: 100 }
    }

    /// Creates a new TmuxClient with custom capture lines
    pub fn with_capture_lines(capture_lines: u32) -> Self {
        Self { capture_lines }
    }

    /// Check if tmux is available and running
    pub fn is_available(&self) -> bool {
        Command::new("tmux")
            .arg("list-sessions")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Lists all sessions
    pub fn list_sessions(&self) -> Result<Vec<String>> {
        let output = Command::new("tmux")
            .args(["list-sessions", "-F", "#{session_name}"])
            .output()
            .context("Failed to execute tmux list-sessions")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux list-sessions failed: {}", stderr);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().map(|s| s.to_string()).collect())
    }

    /// Lists all panes across all attached sessions
    pub fn list_panes(&self) -> Result<Vec<PaneInfo>> {
        // Use tab separator to handle spaces in titles/paths
        // Include session_attached to filter out detached sessions
        let output = Command::new("tmux")
            .args([
                "list-panes",
                "-a",
                "-F",
                "#{session_attached}\t#{session_name}:#{window_index}.#{pane_index}\t#{window_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_title}\t#{pane_current_path}",
            ])
            .output()
            .context("Failed to execute tmux list-panes")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux list-panes failed: {}", stderr);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let panes: Vec<PaneInfo> = stdout
            .lines()
            .filter_map(|line| {
                // First field is session_attached (0 = detached, 1+ = number of attached clients)
                let (attached, rest) = line.split_once('\t')?;

                // Only include panes from attached sessions
                if attached != "0" {
                    PaneInfo::parse(rest)
                } else {
                    None
                }
            })
            .collect();

        Ok(panes)
    }

    /// Lists all panes including detached sessions
    pub fn list_all_panes(&self) -> Result<Vec<PaneInfo>> {
        let output = Command::new("tmux")
            .args([
                "list-panes",
                "-a",
                "-F",
                "#{session_name}:#{window_index}.#{pane_index}\t#{window_name}\t#{pane_current_command}\t#{pane_pid}\t#{pane_title}\t#{pane_current_path}",
            ])
            .output()
            .context("Failed to execute tmux list-panes")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux list-panes failed: {}", stderr);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let panes: Vec<PaneInfo> = stdout.lines().filter_map(PaneInfo::parse).collect();

        Ok(panes)
    }

    /// Captures the content of a specific pane
    pub fn capture_pane(&self, target: &str) -> Result<String> {
        let start_line = format!("-{}", self.capture_lines);

        let output = Command::new("tmux")
            .args(["capture-pane", "-p", "-t", target, "-S", &start_line, "-e"])
            .output()
            .context("Failed to execute tmux capture-pane")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux capture-pane failed for {}: {}", target, stderr);
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Captures the content of a specific pane without ANSI codes
    pub fn capture_pane_plain(&self, target: &str) -> Result<String> {
        let start_line = format!("-{}", self.capture_lines);

        let output = Command::new("tmux")
            .args(["capture-pane", "-p", "-t", target, "-S", &start_line])
            .output()
            .context("Failed to execute tmux capture-pane")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux capture-pane failed for {}: {}", target, stderr);
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Get the pane title
    pub fn get_pane_title(&self, target: &str) -> Result<String> {
        let output = Command::new("tmux")
            .args(["display-message", "-p", "-t", target, "#{pane_title}"])
            .output()
            .context("Failed to execute tmux display-message")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux display-message failed for {}: {}", target, stderr);
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// Sends keys to a specific pane
    pub fn send_keys(&self, target: &str, keys: &str) -> Result<()> {
        let output = Command::new("tmux")
            .args(["send-keys", "-t", target, keys])
            .output()
            .context("Failed to execute tmux send-keys")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux send-keys failed for {}: {}", target, stderr);
        }

        Ok(())
    }

    /// Sends literal keys (with -l flag) to a specific pane
    pub fn send_keys_literal(&self, target: &str, keys: &str) -> Result<()> {
        let output = Command::new("tmux")
            .args(["send-keys", "-t", target, "-l", keys])
            .output()
            .context("Failed to execute tmux send-keys")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux send-keys failed for {}: {}", target, stderr);
        }

        Ok(())
    }

    /// Selects (focuses) a specific pane
    pub fn select_pane(&self, target: &str) -> Result<()> {
        let output = Command::new("tmux")
            .args(["select-pane", "-t", target])
            .output()
            .context("Failed to execute tmux select-pane")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux select-pane failed for {}: {}", target, stderr);
        }

        Ok(())
    }

    /// Selects a specific window
    pub fn select_window(&self, target: &str) -> Result<()> {
        // Extract session:window from full target
        let window_target = if let Some(pos) = target.rfind('.') {
            &target[..pos]
        } else {
            target
        };

        let output = Command::new("tmux")
            .args(["select-window", "-t", window_target])
            .output()
            .context("Failed to execute tmux select-window")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "tmux select-window failed for {}: {}",
                window_target,
                stderr
            );
        }

        Ok(())
    }

    /// Focuses on a pane by selecting its window and pane
    pub fn focus_pane(&self, target: &str) -> Result<()> {
        self.select_window(target)?;
        self.select_pane(target)?;
        Ok(())
    }

    /// Create a new tmux session
    pub fn create_session(&self, name: &str, cwd: &str) -> Result<()> {
        let output = Command::new("tmux")
            .args(["new-session", "-d", "-s", name, "-c", cwd])
            .output()
            .context("Failed to execute tmux new-session")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux new-session failed: {}", stderr);
        }

        // Open in new wezterm tab if running in wezterm
        self.open_session_in_wezterm_tab(name);

        Ok(())
    }

    /// Open a tmux session in a new wezterm tab (if running in wezterm)
    fn open_session_in_wezterm_tab(&self, session_name: &str) {
        // Check if we're running in wezterm
        if std::env::var("WEZTERM_PANE").is_err() {
            return; // Not in wezterm, skip
        }

        // Get current window ID from wezterm cli
        let window_id = match Self::get_wezterm_window_id() {
            Some(id) => id,
            None => return,
        };

        // Spawn a new wezterm tab (in current window) attached to the tmux session
        let _ = Command::new("wezterm")
            .args([
                "cli",
                "spawn",
                "--window-id",
                &window_id,
                "--",
                "tmux",
                "attach",
                "-t",
                session_name,
            ])
            .spawn();
    }

    /// Get the current wezterm window ID
    fn get_wezterm_window_id() -> Option<String> {
        // Use wezterm cli list to find the window_id for the active pane
        // Note: WEZTERM_PANE env var can be stale over SSH, so we use is_active flag
        let output = Command::new("wezterm")
            .args(["cli", "list", "--format", "json"])
            .output()
            .ok()?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse JSON to find window_id for active pane
        // Format: [{"window_id": 0, "tab_id": 0, "pane_id": 0, "is_active": true, ...}, ...]
        if let Ok(panes) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
            for pane in &panes {
                // Find the active pane
                if let Some(is_active) = pane.get("is_active").and_then(|v| v.as_bool()) {
                    if is_active {
                        if let Some(window_id) = pane.get("window_id").and_then(|v| v.as_u64()) {
                            return Some(window_id.to_string());
                        }
                    }
                }
            }
            // Fallback: use first pane's window_id if no active pane found
            if let Some(first) = panes.first() {
                if let Some(window_id) = first.get("window_id").and_then(|v| v.as_u64()) {
                    return Some(window_id.to_string());
                }
            }
        }

        None
    }

    /// Create a new window in an existing session
    /// Returns the new pane's target identifier (session:window.pane)
    pub fn new_window(&self, session: &str, cwd: &str) -> Result<String> {
        let output = Command::new("tmux")
            .args([
                "new-window",
                "-t",
                session,
                "-c",
                cwd,
                "-P",
                "-F",
                "#{session_name}:#{window_index}.#{pane_index}",
            ])
            .output()
            .context("Failed to execute tmux new-window")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux new-window failed: {}", stderr);
        }

        let target = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(target)
    }

    /// Split a window to create a new pane
    /// Returns the new pane's target identifier (session:window.pane)
    pub fn split_window(&self, session: &str, cwd: &str) -> Result<String> {
        let output = Command::new("tmux")
            .args([
                "split-window",
                "-t",
                session,
                "-c",
                cwd,
                "-P",
                "-F",
                "#{session_name}:#{window_index}.#{pane_index}",
            ])
            .output()
            .context("Failed to execute tmux split-window")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("tmux split-window failed: {}", stderr);
        }

        let target = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(target)
    }

    /// Run a command in a specific pane
    pub fn run_command(&self, target: &str, command: &str) -> Result<()> {
        // Send the command as literal text
        self.send_keys_literal(target, command)?;
        // Press Enter to execute
        self.send_keys(target, "Enter")?;
        Ok(())
    }
}

impl Default for TmuxClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = TmuxClient::new();
        assert_eq!(client.capture_lines, 100);

        let custom_client = TmuxClient::with_capture_lines(200);
        assert_eq!(custom_client.capture_lines, 200);
    }
}
