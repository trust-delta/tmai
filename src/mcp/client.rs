//! HTTP client for connecting to the running tmai instance's Web API.

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use std::path::PathBuf;

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

/// HTTP client for tmai's Web API
#[derive(Debug, Clone)]
pub struct TmaiHttpClient {
    base_url: String,
    token: String,
}

impl TmaiHttpClient {
    /// Create a new client by reading the runtime API info file
    pub fn from_runtime() -> Result<Self> {
        let path = api_info_path();
        let data = std::fs::read_to_string(&path)
            .with_context(|| format!("tmai is not running (no API info at {})", path.display()))?;
        let info: ApiConnectionInfo =
            serde_json::from_str(&data).context("Invalid API info file")?;

        Ok(Self {
            base_url: format!("http://localhost:{}", info.port),
            token: info.token,
        })
    }

    /// Make a GET request to the tmai API
    pub fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}/api{}", self.base_url, path);
        let resp: T = ureq::get(&url)
            .header("Authorization", &format!("Bearer {}", self.token))
            .call()
            .with_context(|| format!("GET {path} failed"))?
            .body_mut()
            .read_json()
            .with_context(|| format!("Failed to parse response from {path}"))?;
        Ok(resp)
    }

    /// Make a POST request to the tmai API with a JSON body
    pub fn post<T: DeserializeOwned>(&self, path: &str, body: &serde_json::Value) -> Result<T> {
        let url = format!("{}/api{}", self.base_url, path);
        let resp: T = ureq::post(&url)
            .header("Authorization", &format!("Bearer {}", self.token))
            .send_json(body)
            .with_context(|| format!("POST {path} failed"))?
            .body_mut()
            .read_json()
            .with_context(|| format!("Failed to parse response from {path}"))?;
        Ok(resp)
    }

    /// Make a POST request that returns a simple status (no body parsing)
    pub fn post_ok(&self, path: &str, body: &serde_json::Value) -> Result<()> {
        let url = format!("{}/api{}", self.base_url, path);
        ureq::post(&url)
            .header("Authorization", &format!("Bearer {}", self.token))
            .send_json(body)
            .with_context(|| format!("POST {path} failed"))?;
        Ok(())
    }

    /// Make a GET request that returns raw text.
    pub fn get_text(&self, path: &str) -> Result<String> {
        let url = format!("{}/api{}", self.base_url, path);
        let text = ureq::get(&url)
            .header("Authorization", &format!("Bearer {}", self.token))
            .call()
            .with_context(|| format!("GET {path} failed"))?
            .body_mut()
            .read_to_string()
            .with_context(|| format!("Failed to read response from {path}"))?;
        Ok(text)
    }
}
