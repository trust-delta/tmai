//! HTTP client against the tmai-core API.
//!
//! Connection info is discovered from `$XDG_RUNTIME_DIR/tmai/api.json`
//! (mode 0600, written by tmai-core — see `src/mcp/client.rs::write_api_info`).
//! The CLI can override with `--url` / `--token`.

use std::path::PathBuf;

use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;

use crate::types::{Agent, KeyRequest, TextInputRequest};

/// Port + bearer token, as written by tmai-core.
#[derive(Debug, Clone, Deserialize)]
pub struct ApiConnectionInfo {
    pub port: u16,
    pub token: String,
}

/// Resolve `$XDG_RUNTIME_DIR/tmai/api.json`. Mirrors
/// `tmai_core::ipc::protocol::state_dir` for the XDG path. Callers can
/// override with `--url` / `--token` when XDG_RUNTIME_DIR is unset.
pub fn api_info_path() -> Option<PathBuf> {
    std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .map(|xdg| PathBuf::from(xdg).join("tmai").join("api.json"))
}

pub fn load_connection_info() -> Result<ApiConnectionInfo> {
    let path =
        api_info_path().context("XDG_RUNTIME_DIR is unset; pass --url/--token explicitly")?;
    let raw = std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let info: ApiConnectionInfo =
        serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    Ok(info)
}

/// Authenticated HTTP client. Base URL should include scheme + host + port
/// (no trailing slash), e.g. `http://127.0.0.1:9876`.
#[derive(Clone)]
pub struct ApiClient {
    base: String,
    token: String,
    http: Client,
}

impl ApiClient {
    pub fn new(base: impl Into<String>, token: impl Into<String>) -> Self {
        let http = Client::builder()
            .user_agent(concat!("tmai-ratatui/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("reqwest client");
        Self {
            base: base.into(),
            token: token.into(),
            http,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    /// Full URL for a given API path (must start with `/`).
    pub fn url(&self, path: &str) -> String {
        format!("{}/api{}", self.base.trim_end_matches('/'), path)
    }

    /// `GET /api/agents`
    pub async fn list_agents(&self) -> Result<Vec<Agent>> {
        let resp = self
            .http
            .get(self.url("/agents"))
            .bearer_auth(&self.token)
            .send()
            .await
            .context("GET /agents")?;
        let resp = ensure_ok(resp).await?;
        resp.json::<Vec<Agent>>()
            .await
            .context("decode /agents body")
    }

    /// `POST /api/agents/{id}/approve`
    pub async fn approve(&self, id: &str) -> Result<()> {
        let resp = self
            .http
            .post(self.url(&format!("/agents/{id}/approve")))
            .bearer_auth(&self.token)
            .send()
            .await
            .context("POST approve")?;
        ensure_ok(resp).await?;
        Ok(())
    }

    /// `POST /api/agents/{id}/input`
    pub async fn send_text(&self, id: &str, text: &str) -> Result<()> {
        let resp = self
            .http
            .post(self.url(&format!("/agents/{id}/input")))
            .bearer_auth(&self.token)
            .json(&TextInputRequest { text })
            .send()
            .await
            .context("POST input")?;
        ensure_ok(resp).await?;
        Ok(())
    }

    /// `POST /api/agents/{id}/key`
    pub async fn send_key(&self, id: &str, key: &str) -> Result<()> {
        let resp = self
            .http
            .post(self.url(&format!("/agents/{id}/key")))
            .bearer_auth(&self.token)
            .json(&KeyRequest { key })
            .send()
            .await
            .context("POST key")?;
        ensure_ok(resp).await?;
        Ok(())
    }

    /// `POST /api/agents/{id}/kill`
    pub async fn kill(&self, id: &str) -> Result<()> {
        let resp = self
            .http
            .post(self.url(&format!("/agents/{id}/kill")))
            .bearer_auth(&self.token)
            .send()
            .await
            .context("POST kill")?;
        ensure_ok(resp).await?;
        Ok(())
    }
}

async fn ensure_ok(resp: reqwest::Response) -> Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    anyhow::bail!("{status}: {body}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_nests_under_api() {
        let c = ApiClient::new("http://127.0.0.1:9876", "t");
        assert_eq!(c.url("/agents"), "http://127.0.0.1:9876/api/agents");
        assert_eq!(
            c.url("/agents/main:0.0/approve"),
            "http://127.0.0.1:9876/api/agents/main:0.0/approve"
        );
    }

    #[test]
    fn url_strips_trailing_slash_on_base() {
        let c = ApiClient::new("http://localhost:9876/", "t");
        assert_eq!(c.url("/agents"), "http://localhost:9876/api/agents");
    }

    #[test]
    fn api_info_path_respects_xdg() {
        let _guard = TempEnv::set("XDG_RUNTIME_DIR", "/run/user/1000");
        assert_eq!(
            api_info_path().unwrap(),
            std::path::PathBuf::from("/run/user/1000/tmai/api.json")
        );
    }

    struct TempEnv {
        key: &'static str,
        prev: Option<String>,
    }

    impl TempEnv {
        fn set(key: &'static str, val: &str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, val);
            Self { key, prev }
        }
    }

    impl Drop for TempEnv {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var(self.key, v),
                None => std::env::remove_var(self.key),
            }
        }
    }
}
