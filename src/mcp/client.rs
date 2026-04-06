//! HTTP client for connecting to the running tmai instance's Web API.

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use std::path::PathBuf;

/// Error type for operations that need to distinguish HTTP status codes.
#[derive(Debug)]
pub enum ValidateError {
    /// HTTP 4xx/5xx response with status code
    HttpError { status: u16 },
    /// Transport or parsing error
    Transport(anyhow::Error),
}

/// Connection info for the tmai HTTP API
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ApiConnectionInfo {
    pub port: u16,
    pub token: String,
}

/// Path to the runtime API connection file
fn api_info_path() -> PathBuf {
    tmai_core::ipc::protocol::state_dir().join("api.json")
}

/// Write API connection info (called by tmai when starting the web server)
pub fn write_api_info(port: u16, token: &str) -> Result<()> {
    let dir = tmai_core::ipc::protocol::state_dir();
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create state dir: {}", dir.display()))?;

    let info = ApiConnectionInfo {
        port,
        token: token.to_string(),
    };
    let path = api_info_path();
    let json = serde_json::to_string(&info)?;
    std::fs::write(&path, &json)
        .with_context(|| format!("Failed to write API info: {}", path.display()))?;

    // Restrict permissions (token is sensitive)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

/// Remove API connection info (called on tmai shutdown)
pub fn remove_api_info() {
    let _ = std::fs::remove_file(api_info_path());
}

/// HTTP client for tmai's Web API.
/// Re-reads `api.json` on every request so that token and port changes
/// (e.g. after tmai restart) are picked up transparently.
#[derive(Debug, Clone)]
pub struct TmaiHttpClient {
    _private: (),
}

impl TmaiHttpClient {
    /// Create a new client. Validates that `api.json` is readable at construction time.
    pub fn from_runtime() -> Result<Self> {
        // Validate that we can read the file now (fail-fast)
        Self::read_connection_info()?;
        Ok(Self { _private: () })
    }

    /// Read fresh connection info from `api.json`.
    fn read_connection_info() -> Result<ApiConnectionInfo> {
        let path = api_info_path();
        let data = std::fs::read_to_string(&path).with_context(|| {
            format!(
                "tmai is not running (no API info at {}). Start tmai first.",
                path.display()
            )
        })?;
        serde_json::from_str(&data).context("Invalid API info file")
    }

    /// Make a GET request to the tmai API
    pub fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let info = Self::read_connection_info()?;
        let url = format!("http://localhost:{}/api{}", info.port, path);
        let resp: T = ureq::get(&url)
            .header("Authorization", &format!("Bearer {}", info.token))
            .call()
            .with_context(|| format!("GET {path} failed"))?
            .body_mut()
            .read_json()
            .with_context(|| format!("Failed to parse response from {path}"))?;
        Ok(resp)
    }

    /// Make a POST request to the tmai API with a JSON body
    pub fn post<T: DeserializeOwned>(&self, path: &str, body: &serde_json::Value) -> Result<T> {
        let info = Self::read_connection_info()?;
        let url = format!("http://localhost:{}/api{}", info.port, path);
        let resp: T = ureq::post(&url)
            .header("Authorization", &format!("Bearer {}", info.token))
            .send_json(body)
            .with_context(|| format!("POST {path} failed"))?
            .body_mut()
            .read_json()
            .with_context(|| format!("Failed to parse response from {path}"))?;
        Ok(resp)
    }

    /// Make a POST request that returns a simple status (no body parsing)
    pub fn post_ok(&self, path: &str, body: &serde_json::Value) -> Result<()> {
        let info = Self::read_connection_info()?;
        let url = format!("http://localhost:{}/api{}", info.port, path);
        ureq::post(&url)
            .header("Authorization", &format!("Bearer {}", info.token))
            .send_json(body)
            .with_context(|| format!("POST {path} failed"))?;
        Ok(())
    }

    /// Resolve the repository path: use the given repo, fall back to cwd, then first registered project.
    pub fn resolve_repo(&self, repo: &Option<String>) -> Result<String> {
        if let Some(r) = repo {
            return Ok(r.clone());
        }
        // Fall back to current working directory (where the MCP server was spawned)
        if let Ok(cwd) = std::env::current_dir() {
            let cwd_str = cwd.to_string_lossy().to_string();
            // Verify it's a git repo by checking for .git
            if cwd.join(".git").exists() {
                return Ok(cwd_str);
            }
        }
        // Last resort: first registered project
        let projects: Vec<String> = self.get("/projects")?;
        projects
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("No registered projects. Specify repo explicitly."))
    }

    /// Resolve the git common directory for the MCP client's project context.
    ///
    /// Runs `git rev-parse --git-common-dir` in the resolved repo directory to get the
    /// canonical git directory path. This is used for project-scoped filtering of agents.
    pub fn resolve_git_common_dir(&self) -> Result<String> {
        let repo = self.resolve_repo(&None)?;
        let output = std::process::Command::new("git")
            .args(["rev-parse", "--git-common-dir"])
            .current_dir(&repo)
            .output()
            .context("Failed to run git rev-parse --git-common-dir")?;
        if !output.status.success() {
            anyhow::bail!(
                "git rev-parse --git-common-dir failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        let git_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // If the result is relative, resolve it against the repo path
        let path = std::path::Path::new(&git_dir);
        let resolved = if path.is_relative() {
            let abs = std::path::Path::new(&repo).join(path);
            abs.canonicalize()
                .unwrap_or(abs)
                .to_string_lossy()
                .to_string()
        } else {
            git_dir
        };
        // Strip /.git suffix to match agent git_common_dir format (poller strips it)
        Ok(resolved
            .strip_suffix("/.git")
            .unwrap_or(&resolved)
            .to_string())
    }

    /// Make a POST request and return the parsed JSON error body on failure.
    ///
    /// Unlike `post()`, HTTP 4xx/5xx responses are read and returned as a
    /// structured error value instead of a generic ureq error.
    pub fn post_with_error_body(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, ValidateError> {
        let info = Self::read_connection_info().map_err(ValidateError::Transport)?;
        let url = format!("http://localhost:{}/api{}", info.port, path);
        match ureq::post(&url)
            .header("Authorization", &format!("Bearer {}", info.token))
            .send_json(body)
        {
            Ok(mut resp) => {
                let val: serde_json::Value = resp
                    .body_mut()
                    .read_json()
                    .map_err(|e| ValidateError::Transport(e.into()))?;
                Ok(val)
            }
            Err(ureq::Error::StatusCode(status)) => Err(ValidateError::HttpError { status }),
            Err(e) => Err(ValidateError::Transport(e.into())),
        }
    }

    /// Make a DELETE request that returns a simple status (no body parsing)
    pub fn delete_ok(&self, path: &str) -> Result<()> {
        let info = Self::read_connection_info()?;
        let url = format!("http://localhost:{}/api{}", info.port, path);
        ureq::delete(&url)
            .header("Authorization", &format!("Bearer {}", info.token))
            .call()
            .with_context(|| format!("DELETE {path} failed"))?;
        Ok(())
    }

    // =========================================================
    // MCP tool helpers — collapse Ok/Err into a single String
    // =========================================================

    /// GET a JSON endpoint and return pretty-printed JSON or "Error: …".
    pub fn get_json_or_error(&self, path: &str) -> String {
        match self.get::<serde_json::Value>(path) {
            Ok(data) => format_json(&data),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// GET a text endpoint and return the body or "Error: …".
    pub fn get_text_or_error(&self, path: &str) -> String {
        match self.get_text(path) {
            Ok(text) => text,
            Err(e) => format!("Error: {e}"),
        }
    }

    /// POST with a JSON body and return pretty-printed response or "Error: …".
    pub fn post_json_or_error(&self, path: &str, body: &serde_json::Value) -> String {
        match self.post::<serde_json::Value>(path, body) {
            Ok(data) => format_json(&data),
            Err(e) => format!("Error: {e}"),
        }
    }

    /// POST and return a fixed success message or "Error: …".
    pub fn post_ok_or_error(
        &self,
        path: &str,
        body: &serde_json::Value,
        success: String,
    ) -> String {
        match self.post_ok(path, body) {
            Ok(()) => success,
            Err(e) => format!("Error: {e}"),
        }
    }

    /// DELETE and return a fixed success message or "Error: …".
    pub fn delete_ok_or_error(&self, path: &str, success: String) -> String {
        match self.delete_ok(path) {
            Ok(()) => success,
            Err(e) => format!("Error: {e}"),
        }
    }

    /// Make a GET request that returns raw text.
    pub fn get_text(&self, path: &str) -> Result<String> {
        let info = Self::read_connection_info()?;
        let url = format!("http://localhost:{}/api{}", info.port, path);
        let text = ureq::get(&url)
            .header("Authorization", &format!("Bearer {}", info.token))
            .call()
            .with_context(|| format!("GET {path} failed"))?
            .body_mut()
            .read_to_string()
            .with_context(|| format!("Failed to read response from {path}"))?;
        Ok(text)
    }
}

/// Format a JSON value as pretty-printed string for MCP tool responses.
pub fn format_json(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// All tests that touch the shared `api.json` file must hold this lock
    /// to prevent parallel test execution from causing races.
    static API_FILE_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn read_connection_info_picks_up_updated_token() {
        let _lock = API_FILE_LOCK.lock().unwrap();

        // Write initial api.json
        write_api_info(3000, "token-old").unwrap();

        // Client reads and validates at construction
        let info = TmaiHttpClient::read_connection_info().unwrap();
        assert_eq!(info.port, 3000);
        assert_eq!(info.token, "token-old");

        // Simulate tmai restart: new port and token
        write_api_info(3001, "token-new").unwrap();

        // read_connection_info picks up the new values
        let info = TmaiHttpClient::read_connection_info().unwrap();
        assert_eq!(info.port, 3001);
        assert_eq!(info.token, "token-new");

        // Cleanup
        remove_api_info();
    }

    #[test]
    fn read_connection_info_error_when_file_missing() {
        let _lock = API_FILE_LOCK.lock().unwrap();

        // Ensure no api.json exists
        remove_api_info();

        let err = TmaiHttpClient::read_connection_info().unwrap_err();
        assert!(
            err.to_string().contains("tmai is not running"),
            "Expected 'tmai is not running' error, got: {err}"
        );
    }

    #[test]
    fn from_runtime_succeeds_when_api_json_exists() {
        let _lock = API_FILE_LOCK.lock().unwrap();

        write_api_info(4000, "test-token").unwrap();
        let client = TmaiHttpClient::from_runtime();
        assert!(client.is_ok());
        remove_api_info();
    }

    #[test]
    fn from_runtime_fails_when_api_json_missing() {
        let _lock = API_FILE_LOCK.lock().unwrap();

        remove_api_info();
        let result = TmaiHttpClient::from_runtime();
        assert!(result.is_err());
    }

    #[test]
    fn format_json_pretty_prints_object() {
        let val = serde_json::json!({"key": "value"});
        let result = format_json(&val);
        assert!(result.contains("\"key\": \"value\""));
        assert!(result.contains('\n')); // pretty-printed
    }

    #[test]
    fn format_json_handles_array() {
        let val = serde_json::json!([1, 2, 3]);
        let result = format_json(&val);
        assert!(result.contains('1'));
        assert!(result.contains('3'));
    }

    #[test]
    fn format_json_handles_null() {
        let val = serde_json::Value::Null;
        assert_eq!(format_json(&val), "null");
    }
}
