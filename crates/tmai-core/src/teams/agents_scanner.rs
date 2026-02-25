//! Scanner for `.claude/agents/*.md` agent definition files.
//!
//! Reads frontmatter (YAML between `---` delimiters) from Markdown files
//! in both project-local (`.claude/agents/`) and global (`~/.claude/agents/`)
//! directories.

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Where the agent definition was found
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentDefinitionSource {
    /// `.claude/agents/` in the project directory
    Project,
    /// `~/.claude/agents/` (global)
    Global,
}

/// Parsed agent definition from a `.claude/agents/*.md` file
#[derive(Debug, Clone)]
pub struct AgentDefinition {
    /// Agent name (from frontmatter `name`, or filename stem as fallback)
    pub name: String,
    /// Human-readable description
    pub description: Option<String>,
    /// Model to use (e.g., "sonnet", "opus")
    pub model: Option<String>,
    /// Isolation mode (e.g., "worktree")
    pub isolation: Option<String>,
    /// Where the definition was found
    pub source: AgentDefinitionSource,
    /// Absolute path to the definition file
    pub file_path: PathBuf,
}

/// Raw YAML frontmatter structure
#[derive(Debug, Deserialize)]
struct Frontmatter {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    isolation: Option<String>,
    // allowed_tools is parsed but not stored in AgentDefinition
    // since it's not needed for display purposes
}

/// Extract YAML frontmatter from a Markdown file's content.
///
/// Frontmatter is delimited by `---` lines at the start of the file.
fn parse_frontmatter(content: &str) -> Option<Frontmatter> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }

    // Find the closing `---`
    let after_first = &trimmed[3..];
    let after_first = after_first.strip_prefix('\n').unwrap_or(after_first);

    let end_idx = after_first.find("\n---")?;
    let yaml_block = &after_first[..end_idx];

    serde_yaml::from_str(yaml_block).ok()
}

/// Scan a single directory for agent definition files
fn scan_directory(dir: &Path, source: AgentDefinitionSource) -> Vec<AgentDefinition> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut definitions = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();

        // Only process .md files
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let filename_stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let frontmatter = parse_frontmatter(&content);

        let (name, description, model, isolation) = match frontmatter {
            Some(fm) => (
                fm.name.unwrap_or(filename_stem),
                fm.description,
                fm.model,
                fm.isolation,
            ),
            None => (filename_stem, None, None, None),
        };

        definitions.push(AgentDefinition {
            name,
            description,
            model,
            isolation,
            source: source.clone(),
            file_path: path,
        });
    }

    definitions
}

/// Scan agent definitions from project and global directories.
///
/// Project definitions take precedence over global ones when both define
/// an agent with the same name.
pub fn scan_agent_definitions(project_dir: Option<&Path>) -> Vec<AgentDefinition> {
    let mut definitions = Vec::new();

    // Scan global directory first
    if let Some(home) = dirs::home_dir() {
        let global_dir = home.join(".claude").join("agents");
        definitions.extend(scan_directory(&global_dir, AgentDefinitionSource::Global));
    }

    // Scan project directory (project definitions override global by name)
    if let Some(project) = project_dir {
        let project_dir = project.join(".claude").join("agents");
        let project_defs = scan_directory(&project_dir, AgentDefinitionSource::Project);

        for def in project_defs {
            // Remove any global definition with the same name
            definitions.retain(|d| d.name != def.name);
            definitions.push(def);
        }
    }

    definitions
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Helper: create an agent definition file
    fn write_agent_file(dir: &Path, filename: &str, content: &str) {
        let agents_dir = dir.join(".claude").join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(agents_dir.join(filename), content).unwrap();
    }

    #[test]
    fn test_parse_frontmatter_valid() {
        let content = r#"---
name: parallel-worker
description: Works on tasks in isolation
model: sonnet
isolation: worktree
allowed_tools:
  - Read
  - Glob
---

You are a parallel worker that..."#;

        let fm = parse_frontmatter(content).unwrap();
        assert_eq!(fm.name.as_deref(), Some("parallel-worker"));
        assert_eq!(
            fm.description.as_deref(),
            Some("Works on tasks in isolation")
        );
        assert_eq!(fm.model.as_deref(), Some("sonnet"));
        assert_eq!(fm.isolation.as_deref(), Some("worktree"));
    }

    #[test]
    fn test_parse_frontmatter_no_frontmatter() {
        let content = "Just regular markdown content\nwith no frontmatter.";
        assert!(parse_frontmatter(content).is_none());
    }

    #[test]
    fn test_parse_frontmatter_empty_yaml() {
        // Empty frontmatter with no YAML content returns None since serde_yaml
        // cannot deserialize an empty string into a struct
        let content = "---\n---\nBody content.";
        let fm = parse_frontmatter(content);
        assert!(fm.is_none());
    }

    #[test]
    fn test_parse_frontmatter_invalid_yaml() {
        let content = "---\n[invalid yaml: {{\n---\nBody.";
        assert!(parse_frontmatter(content).is_none());
    }

    #[test]
    fn test_parse_frontmatter_partial_fields() {
        let content = "---\nname: my-agent\n---\nBody.";
        let fm = parse_frontmatter(content).unwrap();
        assert_eq!(fm.name.as_deref(), Some("my-agent"));
        assert!(fm.description.is_none());
        assert!(fm.model.is_none());
    }

    #[test]
    fn test_scan_directory_basic() {
        let tmp = TempDir::new().unwrap();
        write_agent_file(
            tmp.path(),
            "researcher.md",
            "---\nname: researcher\ndescription: Research agent\nmodel: opus\n---\nPrompt body.",
        );
        write_agent_file(
            tmp.path(),
            "coder.md",
            "---\nname: coder\nisolation: worktree\n---\nCoder prompt.",
        );

        let agents_dir = tmp.path().join(".claude").join("agents");
        let defs = scan_directory(&agents_dir, AgentDefinitionSource::Project);

        assert_eq!(defs.len(), 2);

        let researcher = defs.iter().find(|d| d.name == "researcher").unwrap();
        assert_eq!(researcher.description.as_deref(), Some("Research agent"));
        assert_eq!(researcher.model.as_deref(), Some("opus"));
        assert_eq!(researcher.source, AgentDefinitionSource::Project);

        let coder = defs.iter().find(|d| d.name == "coder").unwrap();
        assert!(coder.description.is_none());
        assert_eq!(coder.isolation.as_deref(), Some("worktree"));
    }

    #[test]
    fn test_scan_directory_no_frontmatter_uses_filename() {
        let tmp = TempDir::new().unwrap();
        write_agent_file(
            tmp.path(),
            "simple-agent.md",
            "No frontmatter here, just a prompt.",
        );

        let agents_dir = tmp.path().join(".claude").join("agents");
        let defs = scan_directory(&agents_dir, AgentDefinitionSource::Global);

        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].name, "simple-agent");
        assert!(defs[0].description.is_none());
        assert_eq!(defs[0].source, AgentDefinitionSource::Global);
    }

    #[test]
    fn test_scan_directory_ignores_non_md() {
        let tmp = TempDir::new().unwrap();
        let agents_dir = tmp.path().join(".claude").join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(agents_dir.join("notes.txt"), "Not an agent def").unwrap();
        fs::write(agents_dir.join("config.json"), "{}").unwrap();

        let defs = scan_directory(&agents_dir, AgentDefinitionSource::Project);
        assert!(defs.is_empty());
    }

    #[test]
    fn test_scan_directory_nonexistent() {
        let defs = scan_directory(
            Path::new("/nonexistent/path"),
            AgentDefinitionSource::Global,
        );
        assert!(defs.is_empty());
    }

    #[test]
    fn test_scan_agent_definitions_project_overrides_global() {
        let global_dir = TempDir::new().unwrap();
        let project_dir = TempDir::new().unwrap();

        // Global definition
        write_agent_file(
            global_dir.path(),
            "worker.md",
            "---\nname: worker\ndescription: Global worker\n---\n",
        );

        // Project definition with same name
        write_agent_file(
            project_dir.path(),
            "worker.md",
            "---\nname: worker\ndescription: Project worker\nisolation: worktree\n---\n",
        );

        // We can't easily test the global directory path, so test scan_directory directly
        let global_agents = global_dir.path().join(".claude").join("agents");
        let project_agents = project_dir.path().join(".claude").join("agents");

        let mut definitions = scan_directory(&global_agents, AgentDefinitionSource::Global);
        let project_defs = scan_directory(&project_agents, AgentDefinitionSource::Project);

        for def in project_defs {
            definitions.retain(|d| d.name != def.name);
            definitions.push(def);
        }

        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].name, "worker");
        assert_eq!(
            definitions[0].description.as_deref(),
            Some("Project worker")
        );
        assert_eq!(definitions[0].source, AgentDefinitionSource::Project);
    }
}
