//! External transmission detection module
//!
//! Detects potentially dangerous external transmission commands and sensitive data patterns
//! in AI agent output, logging them for security monitoring.

use crate::config::ExfilDetectionSettings;
use regex::Regex;
use std::sync::LazyLock;

/// Built-in commands that may transmit data externally
const BUILTIN_COMMANDS: &[&str] = &[
    // HTTP tools
    "curl",
    "wget",
    "httpie",
    "http",
    // Network tools
    "nc",
    "netcat",
    "ncat",
    "socat",
    "telnet",
    // File transfer
    "scp",
    "sftp",
    "rsync",
    "ftp",
    // Cloud CLIs
    "aws",
    "gcloud",
    "az",
    "gsutil",
    // Other
    "ssh",
    "git push",
    "npm publish",
    "cargo publish",
];

/// Sensitive data patterns (pub(crate) for reuse in auto-approve sanitization)
pub(crate) static SENSITIVE_PATTERNS: LazyLock<Vec<SensitivePattern>> = LazyLock::new(|| {
    vec![
        SensitivePattern {
            name: "OpenAI API Key",
            pattern: Regex::new(r"sk-[a-zA-Z0-9]{20,}").unwrap(),
        },
        SensitivePattern {
            name: "GitHub Token",
            pattern: Regex::new(r"gh[pousr]_[a-zA-Z0-9]{36,}").unwrap(),
        },
        SensitivePattern {
            name: "AWS Access Key",
            pattern: Regex::new(r"AKIA[0-9A-Z]{16}").unwrap(),
        },
        SensitivePattern {
            name: "Generic API Key",
            pattern: Regex::new(r"(?i)(api[_-]?key|apikey)\s*[=:]\s*['\x22]?[a-zA-Z0-9_-]{16,}")
                .unwrap(),
        },
        SensitivePattern {
            name: "Bearer Token",
            pattern: Regex::new(r"(?i)bearer\s+[a-zA-Z0-9_.-]{20,}").unwrap(),
        },
        SensitivePattern {
            name: "Private Key",
            pattern: Regex::new(r"-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----").unwrap(),
        },
        SensitivePattern {
            name: "Anthropic API Key",
            pattern: Regex::new(r"sk-ant-[a-zA-Z0-9_-]{20,}").unwrap(),
        },
        SensitivePattern {
            name: "Google API Key",
            pattern: Regex::new(r"AIza[0-9A-Za-z_-]{35}").unwrap(),
        },
        SensitivePattern {
            name: "Slack Token",
            pattern: Regex::new(r"xox[baprs]-[0-9]{10,}-[0-9a-zA-Z]{10,}").unwrap(),
        },
    ]
});

/// Sensitive data pattern definition
pub(crate) struct SensitivePattern {
    pub(crate) name: &'static str,
    pub(crate) pattern: Regex,
}

/// External transmission detector
pub struct ExfilDetector {
    enabled: bool,
    additional_commands: Vec<String>,
    pid: u32,
}

impl ExfilDetector {
    /// Create a new ExfilDetector
    pub fn new(settings: &ExfilDetectionSettings, pid: u32) -> Self {
        Self {
            enabled: settings.enabled,
            additional_commands: settings.additional_commands.clone(),
            pid,
        }
    }

    /// Check output for external transmission commands and sensitive data
    pub fn check_output(&self, output: &str) {
        if !self.enabled {
            return;
        }

        // Check for external transmission commands
        if let Some(command) = self.detect_transmission_command(output) {
            // Check if output contains sensitive data
            let sensitive_types = self.detect_sensitive_data(output);

            if sensitive_types.is_empty() {
                tracing::info!(
                    command = %command,
                    pid = %self.pid,
                    "External transmission detected"
                );
            } else {
                for sensitive_type in sensitive_types {
                    tracing::warn!(
                        command = %command,
                        sensitive_type = %sensitive_type,
                        pid = %self.pid,
                        "Sensitive data in transmission"
                    );
                }
            }
        }
    }

    /// Detect if output contains an external transmission command
    fn detect_transmission_command(&self, output: &str) -> Option<String> {
        let output_lower = output.to_lowercase();

        // Check built-in commands
        for &cmd in BUILTIN_COMMANDS {
            if self.is_command_present(&output_lower, cmd) {
                return Some(cmd.to_string());
            }
        }

        // Check additional commands from config
        for cmd in &self.additional_commands {
            if self.is_command_present(&output_lower, cmd) {
                return Some(cmd.clone());
            }
        }

        None
    }

    /// Check if a command is present in the output
    ///
    /// Looks for patterns like:
    /// - Command at start of line or after common shell prompts
    /// - Command in backticks or code blocks
    fn is_command_present(&self, output: &str, command: &str) -> bool {
        let cmd_lower = command.to_lowercase();

        // Pattern 1: Command at line start (possibly with prompt)
        for line in output.lines() {
            let trimmed = line.trim();

            // Skip empty lines
            if trimmed.is_empty() {
                continue;
            }

            // Check various patterns
            // Direct command: "curl ..."
            if trimmed.starts_with(&cmd_lower)
                && self.has_command_boundary(trimmed, cmd_lower.len())
            {
                return true;
            }

            // After $ prompt: "$ curl ..."
            if let Some(after_dollar) = trimmed.strip_prefix("$ ") {
                if after_dollar.starts_with(&cmd_lower)
                    && self.has_command_boundary(after_dollar, cmd_lower.len())
                {
                    return true;
                }
            }

            // After > prompt: "> curl ..."
            if let Some(after_gt) = trimmed.strip_prefix("> ") {
                if after_gt.starts_with(&cmd_lower)
                    && self.has_command_boundary(after_gt, cmd_lower.len())
                {
                    return true;
                }
            }
        }

        // Pattern 2: Command in backticks: `curl ...`
        let backtick_pattern = format!("`{}", cmd_lower);
        if output.contains(&backtick_pattern) {
            return true;
        }

        false
    }

    /// Check if there's a word boundary after the command
    fn has_command_boundary(&self, text: &str, cmd_len: usize) -> bool {
        if text.len() == cmd_len {
            return true;
        }
        let next_char = text.chars().nth(cmd_len);
        matches!(
            next_char,
            Some(' ') | Some('\t') | Some('`') | Some('"') | Some('\'') | None
        )
    }

    /// Detect sensitive data patterns in output
    fn detect_sensitive_data(&self, output: &str) -> Vec<&'static str> {
        let mut found = Vec::new();

        for pattern in SENSITIVE_PATTERNS.iter() {
            if pattern.pattern.is_match(output) {
                found.push(pattern.name);
            }
        }

        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_detector() -> ExfilDetector {
        let settings = ExfilDetectionSettings {
            enabled: true,
            additional_commands: vec!["custom-upload".to_string()],
        };
        ExfilDetector::new(&settings, 12345)
    }

    #[test]
    fn test_detect_curl_command() {
        let detector = create_test_detector();
        assert!(detector
            .detect_transmission_command("curl https://example.com")
            .is_some());
        assert!(detector
            .detect_transmission_command("$ curl -X POST")
            .is_some());
        assert!(detector
            .detect_transmission_command("> curl --data")
            .is_some());
    }

    #[test]
    fn test_detect_wget_command() {
        let detector = create_test_detector();
        assert!(detector
            .detect_transmission_command("wget http://example.com/file")
            .is_some());
    }

    #[test]
    fn test_detect_aws_command() {
        let detector = create_test_detector();
        assert!(detector
            .detect_transmission_command("aws s3 cp file.txt s3://bucket/")
            .is_some());
    }

    #[test]
    fn test_detect_custom_command() {
        let detector = create_test_detector();
        assert!(detector
            .detect_transmission_command("custom-upload file.txt")
            .is_some());
    }

    #[test]
    fn test_no_false_positive() {
        let detector = create_test_detector();
        // "curly" should not match "curl"
        assert!(detector
            .detect_transmission_command("curly braces are used in code")
            .is_none());
        // Normal text
        assert!(detector
            .detect_transmission_command("Hello world")
            .is_none());
    }

    #[test]
    fn test_detect_openai_key() {
        let detector = create_test_detector();
        let output = "sk-1234567890abcdefghijklmnop";
        let sensitive = detector.detect_sensitive_data(output);
        assert!(sensitive.contains(&"OpenAI API Key"));
    }

    #[test]
    fn test_detect_github_token() {
        let detector = create_test_detector();
        let output = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
        let sensitive = detector.detect_sensitive_data(output);
        assert!(sensitive.contains(&"GitHub Token"));
    }

    #[test]
    fn test_detect_aws_key() {
        let detector = create_test_detector();
        let output = "AKIAIOSFODNN7EXAMPLE";
        let sensitive = detector.detect_sensitive_data(output);
        assert!(sensitive.contains(&"AWS Access Key"));
    }

    #[test]
    fn test_detect_bearer_token() {
        let detector = create_test_detector();
        let output = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        let sensitive = detector.detect_sensitive_data(output);
        assert!(sensitive.contains(&"Bearer Token"));
    }

    #[test]
    fn test_detect_private_key() {
        let detector = create_test_detector();
        let output = "-----BEGIN PRIVATE KEY-----\nMIIE...";
        let sensitive = detector.detect_sensitive_data(output);
        assert!(sensitive.contains(&"Private Key"));

        let output_rsa = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...";
        let sensitive_rsa = detector.detect_sensitive_data(output_rsa);
        assert!(sensitive_rsa.contains(&"Private Key"));
    }

    #[test]
    fn test_disabled_detector() {
        let settings = ExfilDetectionSettings {
            enabled: false,
            additional_commands: vec![],
        };
        let detector = ExfilDetector::new(&settings, 12345);
        // When disabled, check_output should not log anything (tested by no panic)
        detector.check_output("curl https://example.com");
    }
}
