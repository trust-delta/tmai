//! Claude Code settings reader for spinnerVerbs configuration
//!
//! Settings priority (per official docs):
//! 1. `{project}/.claude/settings.local.json` (project local)
//! 2. `{project}/.claude/settings.json` (project shared)
//! 3. `~/.claude/settings.json` (user settings)
//!
//! Note: Settings are cached permanently per project path since Claude Code
//! requires a session restart to pick up setting changes.

use parking_lot::RwLock;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Spinner verbs mode
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpinnerVerbsMode {
    /// Replace default verbs with custom ones
    Replace,
    /// Append custom verbs to defaults
    #[default]
    Append,
}

/// Spinner verbs configuration from Claude Code settings
#[derive(Debug, Clone, Deserialize)]
pub struct SpinnerVerbsConfig {
    #[serde(default)]
    pub mode: SpinnerVerbsMode,
    #[serde(default)]
    pub verbs: Vec<String>,
}

/// Claude Code settings (only fields we care about)
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSettings {
    pub spinner_verbs: Option<SpinnerVerbsConfig>,
}

/// Cache for Claude Code settings per project path
///
/// Settings are cached permanently since Claude Code requires a session
/// restart to pick up setting changes.
pub struct ClaudeSettingsCache {
    /// Cached settings by project path (permanent cache)
    cache: RwLock<HashMap<PathBuf, ClaudeSettings>>,
    /// User-level settings cache (from ~/.claude/settings.json)
    user_settings: RwLock<Option<ClaudeSettings>>,
}

impl ClaudeSettingsCache {
    /// Create a new settings cache
    pub fn new() -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
            user_settings: RwLock::new(None),
        }
    }

    /// Get merged settings for a project path (cwd)
    ///
    /// Returns None if cwd is None or settings cannot be read.
    /// Merges settings in priority order.
    /// Settings are cached permanently per project path.
    pub fn get_settings(&self, cwd: Option<&str>) -> Option<ClaudeSettings> {
        // Get user settings first (lowest priority, used as fallback)
        let user_settings = self.get_user_settings();

        let cwd = cwd?;
        let project_path = PathBuf::from(cwd);

        // Check cache for project settings (permanent cache)
        {
            let cache = self.cache.read();
            if let Some(cached) = cache.get(&project_path) {
                return self.merge_settings(user_settings.as_ref(), Some(cached));
            }
        }

        // Read project settings (first time only)
        let project_settings = self.read_project_settings(&project_path);

        // Cache permanently
        if let Some(ref settings) = project_settings {
            let mut cache = self.cache.write();
            cache.insert(project_path, settings.clone());
        }

        self.merge_settings(user_settings.as_ref(), project_settings.as_ref())
    }

    /// Get user-level settings from ~/.claude/settings.json
    fn get_user_settings(&self) -> Option<ClaudeSettings> {
        // Check cache first (permanent cache)
        {
            let cached = self.user_settings.read();
            if cached.is_some() {
                return cached.clone();
            }
        }

        // Read from file (first time only)
        let home = dirs::home_dir()?;
        let user_settings_path = home.join(".claude").join("settings.json");
        let settings = Self::read_settings_file(&user_settings_path);

        // Cache permanently
        let mut cached = self.user_settings.write();
        *cached = settings.clone();

        settings
    }

    /// Read project-level settings (merges settings.local.json and settings.json)
    fn read_project_settings(&self, project_path: &Path) -> Option<ClaudeSettings> {
        let claude_dir = project_path.join(".claude");

        // Priority order: local > shared
        let local_path = claude_dir.join("settings.local.json");
        let shared_path = claude_dir.join("settings.json");

        let local_settings = Self::read_settings_file(&local_path);
        let shared_settings = Self::read_settings_file(&shared_path);

        // Merge: local overrides shared
        self.merge_settings(shared_settings.as_ref(), local_settings.as_ref())
    }

    /// Read and parse a single settings file
    fn read_settings_file(path: &Path) -> Option<ClaudeSettings> {
        let content = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// Merge two settings, with higher priority overriding lower
    ///
    /// For spinnerVerbs, higher priority completely overrides lower.
    fn merge_settings(
        &self,
        lower: Option<&ClaudeSettings>,
        higher: Option<&ClaudeSettings>,
    ) -> Option<ClaudeSettings> {
        match (lower, higher) {
            (None, None) => None,
            (Some(l), None) => Some(l.clone()),
            (None, Some(h)) => Some(h.clone()),
            (Some(l), Some(h)) => {
                // Higher priority's spinnerVerbs takes precedence if present
                Some(ClaudeSettings {
                    spinner_verbs: h.spinner_verbs.clone().or_else(|| l.spinner_verbs.clone()),
                })
            }
        }
    }

    /// Clear all entries from the cache (for testing)
    #[allow(dead_code)]
    pub fn clear(&self) {
        self.cache.write().clear();
        *self.user_settings.write() = None;
    }
}

impl Default for ClaudeSettingsCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_creation() {
        let cache = ClaudeSettingsCache::new();
        assert!(cache.cache.read().is_empty());
    }

    #[test]
    fn test_spinner_verbs_mode_default() {
        assert_eq!(SpinnerVerbsMode::default(), SpinnerVerbsMode::Append);
    }

    #[test]
    fn test_parse_spinner_verbs() {
        let json = r#"{
            "spinnerVerbs": {
                "mode": "replace",
                "verbs": ["Thinking", "Working"]
            }
        }"#;

        let settings: ClaudeSettings = serde_json::from_str(json).unwrap();
        let verbs = settings.spinner_verbs.unwrap();
        assert_eq!(verbs.mode, SpinnerVerbsMode::Replace);
        assert_eq!(verbs.verbs, vec!["Thinking", "Working"]);
    }

    #[test]
    fn test_parse_spinner_verbs_append() {
        let json = r#"{
            "spinnerVerbs": {
                "mode": "append",
                "verbs": ["CustomVerb"]
            }
        }"#;

        let settings: ClaudeSettings = serde_json::from_str(json).unwrap();
        let verbs = settings.spinner_verbs.unwrap();
        assert_eq!(verbs.mode, SpinnerVerbsMode::Append);
        assert_eq!(verbs.verbs, vec!["CustomVerb"]);
    }

    #[test]
    fn test_parse_empty_settings() {
        let json = r#"{}"#;
        let settings: ClaudeSettings = serde_json::from_str(json).unwrap();
        assert!(settings.spinner_verbs.is_none());
    }

    #[test]
    fn test_merge_settings() {
        let cache = ClaudeSettingsCache::new();

        let lower = ClaudeSettings {
            spinner_verbs: Some(SpinnerVerbsConfig {
                mode: SpinnerVerbsMode::Append,
                verbs: vec!["LowerVerb".to_string()],
            }),
        };

        let higher = ClaudeSettings {
            spinner_verbs: Some(SpinnerVerbsConfig {
                mode: SpinnerVerbsMode::Replace,
                verbs: vec!["HigherVerb".to_string()],
            }),
        };

        let merged = cache.merge_settings(Some(&lower), Some(&higher)).unwrap();
        let verbs = merged.spinner_verbs.unwrap();
        assert_eq!(verbs.mode, SpinnerVerbsMode::Replace);
        assert_eq!(verbs.verbs, vec!["HigherVerb"]);
    }

    #[test]
    fn test_merge_settings_lower_only() {
        let cache = ClaudeSettingsCache::new();

        let lower = ClaudeSettings {
            spinner_verbs: Some(SpinnerVerbsConfig {
                mode: SpinnerVerbsMode::Append,
                verbs: vec!["LowerVerb".to_string()],
            }),
        };

        let merged = cache.merge_settings(Some(&lower), None).unwrap();
        let verbs = merged.spinner_verbs.unwrap();
        assert_eq!(verbs.verbs, vec!["LowerVerb"]);
    }

    #[test]
    fn test_get_settings_without_cwd() {
        let cache = ClaudeSettingsCache::new();
        // Without cwd, should still return user settings if available
        // But since we can't guarantee ~/.claude/settings.json exists,
        // we just test that it doesn't panic
        let _result = cache.get_settings(None);
    }
}
