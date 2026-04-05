//! Worktree path guard — prevents worktree agents from modifying files
//! outside their designated worktree directory.
//!
//! When a PreToolUse hook event fires for a file-modifying tool (Edit, Write),
//! this guard checks whether the target file path falls within the agent's
//! worktree directory. If the path escapes the worktree (e.g., pointing to
//! the main repository), the tool call is denied with a clear error message.
//!
//! This prevents the "worktree contamination" bug where agents spawned in
//! worktrees accidentally write to the main working tree via absolute path
//! resolution.

use std::path::Path;

use tracing::{info, warn};

use crate::auto_approve::types::{PermissionDecision, PreToolUseDecision};
use crate::hooks::HookEventPayload;

use super::core::TmaiCore;

/// Tools that modify files and should be guarded
const FILE_MUTATING_TOOLS: &[&str] = &["Edit", "Write", "NotebookEdit"];

impl TmaiCore {
    /// Validate that a PreToolUse event does not target files outside the
    /// agent's worktree directory.
    ///
    /// Returns `Some(PreToolUseDecision::Deny)` if the tool targets a path
    /// outside the worktree. Returns `None` if no violation is detected
    /// (i.e., the agent is not a worktree agent, or the path is valid).
    pub fn validate_worktree_path(
        &self,
        pane_id: &str,
        payload: &HookEventPayload,
    ) -> Option<PreToolUseDecision> {
        let tool_name = payload.tool_name.as_deref()?;

        // Only guard file-mutating tools
        if !FILE_MUTATING_TOOLS.contains(&tool_name) {
            return None;
        }

        // Look up the agent to check if it's a worktree agent
        let (is_worktree, agent_cwd) = {
            #[allow(deprecated)]
            let state = self.raw_state().read();
            match state.agents.get(pane_id) {
                Some(agent) => {
                    let is_wt = agent.is_worktree.unwrap_or(false);
                    (is_wt, agent.cwd.clone())
                }
                None => return None,
            }
        };

        if !is_worktree {
            return None;
        }

        // Extract the target file path from tool_input
        let file_path = extract_file_path(tool_name, payload.tool_input.as_ref())?;

        // Canonicalize both paths to handle symlinks and ".." components
        let worktree_dir = match Path::new(&agent_cwd).canonicalize() {
            Ok(p) => p,
            Err(_) => Path::new(&agent_cwd).to_path_buf(),
        };
        let target_path = match Path::new(&file_path).canonicalize() {
            // File exists: use canonical path
            Ok(p) => p,
            // File doesn't exist yet (Write): canonicalize the parent, then append filename
            Err(_) => {
                let path = Path::new(&file_path);
                let parent = path.parent().unwrap_or(path);
                let filename = path.file_name();
                match (parent.canonicalize(), filename) {
                    (Ok(canonical_parent), Some(name)) => canonical_parent.join(name),
                    _ => path.to_path_buf(),
                }
            }
        };

        // Check if the target path is within the worktree directory
        if target_path.starts_with(&worktree_dir) {
            return None;
        }

        // Path violation detected!
        warn!(
            pane_id,
            tool = tool_name,
            target = %file_path,
            worktree = %agent_cwd,
            "Worktree path violation: tool targets file outside worktree"
        );

        info!(
            pane_id,
            "Denied {} on '{}' — worktree agent confined to '{}'", tool_name, file_path, agent_cwd
        );

        Some(PreToolUseDecision {
            decision: PermissionDecision::Deny,
            reason: format!(
                "PATH VIOLATION: You are a worktree agent confined to '{}'. \
                 The target path '{}' is outside your worktree directory. \
                 All file modifications must use paths within your worktree. \
                 Use paths starting with '{}' instead.",
                agent_cwd, file_path, agent_cwd,
            ),
            model: "worktree_guard".to_string(),
            elapsed_ms: 0,
        })
    }
}

/// Extract the file path from tool_input for file-modifying tools
fn extract_file_path(tool_name: &str, tool_input: Option<&serde_json::Value>) -> Option<String> {
    let input = tool_input?;
    match tool_name {
        "Edit" | "Write" | "NotebookEdit" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .map(String::from),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentType, MonitoredAgent};
    use crate::api::builder::TmaiCoreBuilder;
    use crate::config::Settings;

    /// Create a test agent with the given cwd
    fn test_agent(id: &str, cwd: &str) -> MonitoredAgent {
        MonitoredAgent::new(
            id.to_string(),
            AgentType::ClaudeCode,
            "Test".to_string(),
            cwd.to_string(),
            100,
            "main".to_string(),
            "win".to_string(),
            0,
            0,
        )
    }

    /// Build a TmaiCore and register a worktree agent
    fn setup_with_worktree_agent(pane_id: &str, cwd: &str) -> TmaiCore {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        {
            #[allow(deprecated)]
            let state = core.raw_state();
            let mut s = state.write();
            let mut agent = test_agent(pane_id, cwd);
            agent.is_worktree = Some(true);
            s.agents.insert(pane_id.to_string(), agent);
        }
        core
    }

    /// Build a PreToolUse payload for Edit
    fn edit_payload(file_path: &str) -> HookEventPayload {
        serde_json::from_value(serde_json::json!({
            "hook_event_name": "PreToolUse",
            "session_id": "test-session",
            "tool_name": "Edit",
            "tool_input": {
                "file_path": file_path,
                "old_string": "foo",
                "new_string": "bar"
            }
        }))
        .unwrap()
    }

    /// Build a PreToolUse payload for Write
    fn write_payload(file_path: &str) -> HookEventPayload {
        serde_json::from_value(serde_json::json!({
            "hook_event_name": "PreToolUse",
            "session_id": "test-session",
            "tool_name": "Write",
            "tool_input": {
                "file_path": file_path,
                "content": "hello"
            }
        }))
        .unwrap()
    }

    /// Build a PreToolUse payload for Read
    fn read_payload(file_path: &str) -> HookEventPayload {
        serde_json::from_value(serde_json::json!({
            "hook_event_name": "PreToolUse",
            "session_id": "test-session",
            "tool_name": "Read",
            "tool_input": {
                "file_path": file_path
            }
        }))
        .unwrap()
    }

    #[test]
    fn test_allows_edit_within_worktree() {
        let wt = "/tmp/tmai-test-wt-guard/repo/.claude/worktrees/feat-a";
        std::fs::create_dir_all(format!("{wt}/src")).ok();
        let core = setup_with_worktree_agent("pane1", wt);
        let payload = edit_payload(&format!("{wt}/src/main.rs"));
        let result = core.validate_worktree_path("pane1", &payload);
        assert!(result.is_none(), "Edit within worktree should be allowed");
    }

    #[test]
    fn test_denies_edit_to_main_repo() {
        let repo = "/tmp/tmai-test-wt-guard/repo";
        let wt = "/tmp/tmai-test-wt-guard/repo/.claude/worktrees/feat-a";
        std::fs::create_dir_all(format!("{repo}/src")).ok();
        std::fs::create_dir_all(wt).ok();
        let core = setup_with_worktree_agent("pane1", wt);
        let payload = edit_payload(&format!("{repo}/src/main.rs"));
        let result = core.validate_worktree_path("pane1", &payload);
        assert!(result.is_some(), "Edit to main repo should be denied");
        let decision = result.unwrap();
        assert_eq!(decision.decision, PermissionDecision::Deny);
        assert!(decision.reason.contains("PATH VIOLATION"));
    }

    #[test]
    fn test_denies_write_to_main_repo() {
        let repo = "/tmp/tmai-test-wt-guard/repo";
        let wt = "/tmp/tmai-test-wt-guard/repo/.claude/worktrees/feat-a";
        std::fs::create_dir_all(format!("{repo}/src")).ok();
        std::fs::create_dir_all(wt).ok();
        let core = setup_with_worktree_agent("pane1", wt);
        let payload = write_payload(&format!("{repo}/src/new_file.rs"));
        let result = core.validate_worktree_path("pane1", &payload);
        assert!(result.is_some(), "Write to main repo should be denied");
    }

    #[test]
    fn test_read_is_not_guarded() {
        let core = setup_with_worktree_agent(
            "pane1",
            "/tmp/tmai-test-wt-guard/repo/.claude/worktrees/feat-a",
        );
        let payload = read_payload("/tmp/tmai-test-wt-guard/repo/src/main.rs");
        let result = core.validate_worktree_path("pane1", &payload);
        assert!(
            result.is_none(),
            "Read should not be guarded (read-only tool)"
        );
    }

    #[test]
    fn test_non_worktree_agent_is_not_guarded() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        {
            #[allow(deprecated)]
            let state = core.raw_state();
            let mut s = state.write();
            let mut agent = test_agent("pane1", "/tmp/repo");
            agent.is_worktree = Some(false);
            s.agents.insert("pane1".to_string(), agent);
        }
        let payload = edit_payload("/some/other/path/file.rs");
        let result = core.validate_worktree_path("pane1", &payload);
        assert!(result.is_none(), "Non-worktree agent should not be guarded");
    }

    #[test]
    fn test_unknown_agent_is_not_guarded() {
        let core = TmaiCoreBuilder::new(Settings::default()).build();
        let payload = edit_payload("/tmp/repo/src/main.rs");
        let result = core.validate_worktree_path("unknown-pane", &payload);
        assert!(result.is_none(), "Unknown agent should not be guarded");
    }

    #[test]
    fn test_denies_path_traversal_attack() {
        let wt = "/tmp/tmai-test-wt-guard/repo/.claude/worktrees/feat-a";
        std::fs::create_dir_all(wt).ok();
        let core = setup_with_worktree_agent("pane1", wt);
        // Attempt to escape via ".."
        let payload = edit_payload(&format!("{wt}/../../../src/main.rs"));
        let result = core.validate_worktree_path("pane1", &payload);
        assert!(result.is_some(), "Path traversal should be denied");
    }

    #[test]
    fn test_model_field_is_worktree_guard() {
        let repo = "/tmp/tmai-test-wt-guard/repo";
        let wt = "/tmp/tmai-test-wt-guard/repo/.claude/worktrees/feat-a";
        std::fs::create_dir_all(format!("{repo}/src")).ok();
        std::fs::create_dir_all(wt).ok();
        let core = setup_with_worktree_agent("pane1", wt);
        let payload = edit_payload(&format!("{repo}/src/main.rs"));
        let result = core.validate_worktree_path("pane1", &payload).unwrap();
        assert_eq!(result.model, "worktree_guard");
    }
}
