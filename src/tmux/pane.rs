use crate::agents::AgentType;

/// Information about a tmux pane
#[derive(Debug, Clone)]
pub struct PaneInfo {
    /// Full target identifier (session:window.pane)
    pub target: String,
    /// Session name
    pub session: String,
    /// Window index
    pub window_index: u32,
    /// Pane index
    pub pane_index: u32,
    /// Window name
    pub window_name: String,
    /// Current command running in the pane
    pub command: String,
    /// Process ID
    pub pid: u32,
    /// Pane title
    pub title: String,
    /// Current working directory
    pub cwd: String,
}

impl PaneInfo {
    /// Parse a pane info line from tmux list-panes output
    /// Format: session:window.pane\twindow_name\tcommand\tpid\ttitle\tcwd
    pub fn parse(line: &str) -> Option<Self> {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 6 {
            return None;
        }

        let target = parts[0];
        let (session, window_pane) = target.split_once(':')?;
        let (window_str, pane_str) = window_pane.split_once('.')?;
        let window_index = window_str.parse().ok()?;
        let pane_index = pane_str.parse().ok()?;

        Some(Self {
            target: target.to_string(),
            session: session.to_string(),
            window_index,
            pane_index,
            window_name: parts[1].to_string(),
            command: parts[2].to_string(),
            pid: parts[3].parse().unwrap_or(0),
            title: parts[4].to_string(),
            cwd: parts[5].to_string(),
        })
    }

    /// Detect the agent type running in this pane
    pub fn detect_agent_type(&self) -> Option<AgentType> {
        AgentType::from_detection(&self.command, &self.title, &self.window_name)
    }

    /// Detect the agent type with cmdline from /proc
    pub fn detect_agent_type_with_cmdline(&self, cmdline: Option<&str>) -> Option<AgentType> {
        AgentType::from_detection_with_cmdline(&self.command, &self.title, &self.window_name, cmdline)
    }

    /// Check if this pane appears to be running an AI agent
    pub fn is_agent_pane(&self) -> bool {
        self.detect_agent_type().is_some()
    }

    /// Get a short display name for the pane
    pub fn short_name(&self) -> String {
        format!("{}:{}.{}", self.session, self.window_index, self.pane_index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pane_info() {
        let line = "main:0.1\tbash\tclaude\t12345\t✳ Working\t/home/user";
        let pane = PaneInfo::parse(line).expect("Should parse pane info");

        assert_eq!(pane.target, "main:0.1");
        assert_eq!(pane.session, "main");
        assert_eq!(pane.window_index, 0);
        assert_eq!(pane.pane_index, 1);
        assert_eq!(pane.window_name, "bash");
        assert_eq!(pane.command, "claude");
        assert_eq!(pane.pid, 12345);
        assert_eq!(pane.title, "✳ Working");
        assert_eq!(pane.cwd, "/home/user");
    }

    #[test]
    fn test_detect_agent_type() {
        let pane = PaneInfo {
            target: "main:0.1".to_string(),
            session: "main".to_string(),
            window_index: 0,
            pane_index: 1,
            window_name: "bash".to_string(),
            command: "claude".to_string(),
            pid: 12345,
            title: "✳ Working".to_string(),
            cwd: "/home/user".to_string(),
        };

        assert_eq!(pane.detect_agent_type(), Some(AgentType::ClaudeCode));
    }

    #[test]
    fn test_short_name() {
        let pane = PaneInfo {
            target: "dev:2.3".to_string(),
            session: "dev".to_string(),
            window_index: 2,
            pane_index: 3,
            window_name: "work".to_string(),
            command: "claude".to_string(),
            pid: 12345,
            title: "Task".to_string(),
            cwd: "/home/user".to_string(),
        };

        assert_eq!(pane.short_name(), "dev:2.3");
    }
}
