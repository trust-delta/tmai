//! Loopback client for connecting to the running tmai instance's Web API
//! over a Unix domain socket (see issue #448).
//!
//! The MCP server (spawned as `tmai mcp` by Claude Code) needs to call the
//! same Web API handlers browsers use, but it reaches them through
//! `$XDG_RUNTIME_DIR/tmai/api.sock` instead of the rotating TCP port. The
//! socket path is stable across tmai restarts, so MCP clients do not need
//! to reconnect after a restart.
//!
//! `api.json` is still written by the parent tmai process because the
//! Web/Tauri paths continue to use bearer-token auth over TCP. The MCP
//! client no longer reads it.

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

/// Error type for operations that need to distinguish HTTP status codes.
#[derive(Debug)]
pub enum ValidateError {
    /// HTTP 4xx/5xx response with status code
    HttpError { status: u16 },
    /// Transport or parsing error
    Transport(anyhow::Error),
}

/// Connection info for the tmai HTTP API — written to `api.json` for
/// external consumers (Web frontend served over TCP, Tauri). The MCP
/// server no longer consults this file.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ApiConnectionInfo {
    pub port: u16,
    pub token: String,
}

/// Path to the runtime API connection file (still used by Web/Tauri).
fn api_info_path() -> PathBuf {
    tmai_core::ipc::protocol::state_dir().join("api.json")
}

/// Write API connection info (called by tmai when starting the web server).
///
/// Kept for Web/Tauri clients that still authenticate over TCP with the
/// rotating bearer token. The MCP loopback path ignores this file.
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

/// Spawn a background task that rewrites `api.json` whenever it disappears.
///
/// api.json has been observed going missing while tmai is still running
/// (root cause undetermined — no code path in the tmai binary removes it
/// while the main loop is live). Web/Tauri clients still depend on the
/// file for port+token discovery, so the watchdog makes it self-healing.
/// Noop while the file exists; writes exactly the same port+token the
/// parent already uses. Task runs for the lifetime of the tokio runtime.
pub fn spawn_api_info_watchdog(port: u16, token: String) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        interval.tick().await; // skip first fire
        loop {
            interval.tick().await;
            if !api_info_path().exists() {
                match write_api_info(port, &token) {
                    Ok(()) => {
                        tracing::info!(
                            path = %api_info_path().display(),
                            "api.json watchdog: rewrote missing connection file"
                        );
                    }
                    Err(e) => {
                        tracing::warn!("api.json watchdog: rewrite failed: {e}");
                    }
                }
            }
        }
    });
}

/// Loopback HTTP client that speaks HTTP/1.1 over the tmai Unix domain
/// socket. Each call opens a new socket connection (HTTP `Connection:
/// close` semantics) so there is no cached state to invalidate across a
/// tmai restart — once the socket path is rebound, subsequent calls just
/// succeed.
///
/// Retains the `TmaiHttpClient` name from the pre-#448 implementation so
/// call sites throughout `mcp/tools.rs` do not need to change.
#[derive(Debug, Clone)]
pub struct TmaiHttpClient {
    /// JSON-encoded `X-Tmai-Origin` header value for all requests.
    origin_header: String,
}

impl TmaiHttpClient {
    /// Create a new client. Verifies that the loopback socket is reachable
    /// right now (fail-fast if tmai isn't running).
    pub fn from_runtime() -> Result<Self> {
        probe_socket()?;
        let origin = tmai_core::api::ActionOrigin::Agent {
            id: "mcp".to_string(),
            is_orchestrator: false,
        };
        let origin_header = serde_json::to_string(&origin).unwrap_or_else(|_| {
            r#"{"kind":"Agent","id":"mcp","is_orchestrator":false}"#.to_string()
        });
        Ok(Self { origin_header })
    }

    /// Make a GET request to the tmai API
    pub fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let (status, body) = http_request("GET", path, None, &self.origin_header)?;
        check_status(status, &body, path)?;
        serde_json::from_slice(&body)
            .with_context(|| format!("Failed to parse response from {path}"))
    }

    /// Make a POST request to the tmai API with a JSON body
    pub fn post<T: DeserializeOwned>(&self, path: &str, body: &serde_json::Value) -> Result<T> {
        let body_bytes = serde_json::to_vec(body)?;
        let (status, resp) = http_request("POST", path, Some(&body_bytes), &self.origin_header)?;
        check_status(status, &resp, path)?;
        serde_json::from_slice(&resp)
            .with_context(|| format!("Failed to parse response from {path}"))
    }

    /// Make a POST request that returns a simple status (no body parsing)
    pub fn post_ok(&self, path: &str, body: &serde_json::Value) -> Result<()> {
        let body_bytes = serde_json::to_vec(body)?;
        let (status, resp) = http_request("POST", path, Some(&body_bytes), &self.origin_header)?;
        check_status(status, &resp, path)
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
    /// structured error value instead of a generic transport error.
    pub fn post_with_error_body(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, ValidateError> {
        let body_bytes =
            serde_json::to_vec(body).map_err(|e| ValidateError::Transport(e.into()))?;
        let (status, resp) = http_request("POST", path, Some(&body_bytes), &self.origin_header)
            .map_err(ValidateError::Transport)?;
        if (200..300).contains(&status) {
            let val =
                serde_json::from_slice(&resp).map_err(|e| ValidateError::Transport(e.into()))?;
            Ok(val)
        } else {
            Err(ValidateError::HttpError { status })
        }
    }

    /// Make a DELETE request that returns a simple status (no body parsing)
    pub fn delete_ok(&self, path: &str) -> Result<()> {
        let (status, resp) = http_request("DELETE", path, None, &self.origin_header)?;
        check_status(status, &resp, path)
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
        let (status, body) = http_request("GET", path, None, &self.origin_header)?;
        check_status(status, &body, path)?;
        String::from_utf8(body).context("Response is not valid UTF-8")
    }
}

/// Format a JSON value as pretty-printed string for MCP tool responses.
pub fn format_json(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

// =========================================================
// Minimal HTTP/1.1-over-UDS transport
// =========================================================

/// Connect once to verify the API socket is reachable.
///
/// Used by `from_runtime` to fail fast with a descriptive error when
/// tmai isn't running. A bare connect is enough — we don't need to send
/// any traffic.
fn probe_socket() -> Result<()> {
    let socket = tmai_core::ipc::protocol::api_socket_path();
    UnixStream::connect(&socket).with_context(|| {
        format!(
            "tmai is not running (no API socket at {}). Start tmai first.",
            socket.display()
        )
    })?;
    Ok(())
}

/// Perform a single HTTP/1.1 request over the Unix domain socket.
///
/// Opens a fresh `UnixStream`, writes a request with `Connection: close`,
/// half-closes the write side, and reads until EOF. Returns the parsed
/// `(status, body)` pair. `method` must be a valid HTTP token; `path` is
/// the path below `/api` (e.g. `/agents`).
fn http_request(
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    origin_header: &str,
) -> Result<(u16, Vec<u8>)> {
    let socket = tmai_core::ipc::protocol::api_socket_path();
    let mut stream = UnixStream::connect(&socket).with_context(|| {
        format!(
            "Cannot connect to tmai API socket at {} — is tmai running?",
            socket.display()
        )
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .context("failed to set read timeout on API socket")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .context("failed to set write timeout on API socket")?;

    let mut req = Vec::with_capacity(256);
    write!(&mut req, "{method} /api{path} HTTP/1.1\r\n")?;
    // Host header is required by HTTP/1.1. Value is irrelevant for a
    // loopback socket — axum routes by path.
    req.extend_from_slice(b"Host: tmai.local\r\n");
    write!(&mut req, "X-Tmai-Origin: {origin_header}\r\n")?;
    req.extend_from_slice(b"Connection: close\r\n");
    if let Some(body) = body {
        req.extend_from_slice(b"Content-Type: application/json\r\n");
        write!(&mut req, "Content-Length: {}\r\n", body.len())?;
        req.extend_from_slice(b"\r\n");
        req.extend_from_slice(body);
    } else {
        req.extend_from_slice(b"\r\n");
    }
    stream.write_all(&req)?;
    stream.flush()?;
    // Half-close the write side so the server sees EOF on its read end
    // and can flush the response. `Connection: close` then triggers the
    // server to close its side after writing.
    let _ = stream.shutdown(std::net::Shutdown::Write);

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;

    parse_http_response(&raw)
}

/// Parse a complete HTTP/1.1 response. Handles both `Content-Length` and
/// `Transfer-Encoding: chunked` framing; falls back to "everything after
/// the headers" when neither is present (valid for `Connection: close`).
fn parse_http_response(raw: &[u8]) -> Result<(u16, Vec<u8>)> {
    let header_end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .context("Malformed HTTP response: no header terminator")?;
    let head = std::str::from_utf8(&raw[..header_end])
        .context("Malformed HTTP response: invalid UTF-8 in headers")?;
    let mut lines = head.split("\r\n");
    let status_line = lines
        .next()
        .context("Malformed HTTP response: no status line")?;
    let mut parts = status_line.split_whitespace();
    parts.next(); // HTTP/1.1
    let status: u16 = parts
        .next()
        .context("Malformed HTTP response: no status code")?
        .parse()
        .context("Malformed HTTP response: non-numeric status")?;

    let mut chunked = false;
    let mut content_length: Option<usize> = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim();
            let value = value.trim();
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().ok();
            } else if name.eq_ignore_ascii_case("transfer-encoding")
                && value.eq_ignore_ascii_case("chunked")
            {
                chunked = true;
            }
        }
    }

    let body_start = header_end + 4;
    let raw_body = &raw[body_start..];

    let body = if chunked {
        decode_chunked(raw_body)?
    } else if let Some(len) = content_length {
        raw_body.get(..len).unwrap_or(raw_body).to_vec()
    } else {
        raw_body.to_vec()
    };
    Ok((status, body))
}

/// Decode a chunked transfer-coding body. hyper (which powers axum) uses
/// chunked when the response size isn't known up front; our JSON and text
/// handlers produce known-size bodies, but SSE and future streaming
/// endpoints could trip this path, so we handle it.
fn decode_chunked(raw: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut pos = 0;
    loop {
        let eol = raw[pos..]
            .windows(2)
            .position(|w| w == b"\r\n")
            .context("Malformed chunked response: missing size CRLF")?;
        let size_line = std::str::from_utf8(&raw[pos..pos + eol])
            .context("Malformed chunked response: invalid UTF-8 in size line")?;
        // Strip any chunk-extensions after ';'
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .context("Malformed chunked response: invalid hex size")?;
        pos += eol + 2;
        if size == 0 {
            break;
        }
        if pos + size > raw.len() {
            anyhow::bail!("Malformed chunked response: truncated chunk data");
        }
        out.extend_from_slice(&raw[pos..pos + size]);
        pos += size;
        if raw.get(pos..pos + 2) != Some(b"\r\n") {
            anyhow::bail!("Malformed chunked response: missing CRLF after chunk");
        }
        pos += 2;
    }
    Ok(out)
}

fn check_status(status: u16, body: &[u8], path: &str) -> Result<()> {
    if (200..300).contains(&status) {
        Ok(())
    } else {
        let body_str = std::str::from_utf8(body).unwrap_or("<non-utf8 body>");
        anyhow::bail!("HTTP {status} from {path}: {body_str}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// All tests that touch the shared `api.json` file must hold this lock
    /// to prevent parallel test execution from causing races.
    static API_FILE_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn write_api_info_round_trips_port_and_token() {
        let _lock = API_FILE_LOCK.lock().unwrap();

        write_api_info(3000, "token-old").unwrap();
        let data = std::fs::read_to_string(api_info_path()).unwrap();
        let info: ApiConnectionInfo = serde_json::from_str(&data).unwrap();
        assert_eq!(info.port, 3000);
        assert_eq!(info.token, "token-old");

        // Simulate tmai restart: new port and token
        write_api_info(3001, "token-new").unwrap();
        let data = std::fs::read_to_string(api_info_path()).unwrap();
        let info: ApiConnectionInfo = serde_json::from_str(&data).unwrap();
        assert_eq!(info.port, 3001);
        assert_eq!(info.token, "token-new");

        remove_api_info();
    }

    #[test]
    fn from_runtime_fails_when_socket_missing() {
        // XDG_RUNTIME_DIR is process-global, so hold API_FILE_LOCK to
        // serialize with tests that also read the env var or state_dir().
        let _lock = API_FILE_LOCK.lock().unwrap();
        temp_env::with_var(
            "XDG_RUNTIME_DIR",
            Some("/nonexistent-xdg-for-tmai-tests"),
            || {
                let result = TmaiHttpClient::from_runtime();
                assert!(
                    result.is_err(),
                    "from_runtime should fail when socket dir does not exist"
                );
                let err = result.unwrap_err().to_string();
                assert!(
                    err.contains("tmai is not running"),
                    "Expected 'tmai is not running' error, got: {err}"
                );
            },
        );
    }

    #[test]
    fn parse_http_response_basic_ok() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 13\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}\r\n";
        let (status, body) = parse_http_response(raw).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, b"{\"ok\":true}\r\n");
    }

    #[test]
    fn parse_http_response_truncates_to_content_length() {
        // Trailing garbage after Content-Length bytes is ignored.
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhellodropped";
        let (status, body) = parse_http_response(raw).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, b"hello");
    }

    #[test]
    fn parse_http_response_no_length_reads_to_eof() {
        // With Connection: close and no Content-Length, everything after
        // the header terminator is the body.
        let raw = b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
        let (status, body) = parse_http_response(raw).unwrap();
        assert_eq!(status, 204);
        assert_eq!(body, b"");
    }

    #[test]
    fn parse_http_response_rejects_malformed() {
        let raw = b"not an http response";
        assert!(parse_http_response(raw).is_err());
    }

    #[test]
    fn parse_http_response_picks_up_status_code() {
        let raw = b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";
        let (status, _) = parse_http_response(raw).unwrap();
        assert_eq!(status, 403);
    }

    #[test]
    fn decode_chunked_joins_chunks() {
        let raw = b"5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        let body = decode_chunked(raw).unwrap();
        assert_eq!(body, b"hello world");
    }

    #[test]
    fn decode_chunked_handles_empty_body() {
        let raw = b"0\r\n\r\n";
        let body = decode_chunked(raw).unwrap();
        assert!(body.is_empty());
    }

    #[test]
    fn decode_chunked_rejects_bad_size() {
        let raw = b"zz\r\nhello\r\n0\r\n\r\n";
        assert!(decode_chunked(raw).is_err());
    }

    #[test]
    fn parse_http_response_chunked_roundtrip() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n3\r\ndef\r\n0\r\n\r\n";
        let (status, body) = parse_http_response(raw).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, b"abcdef");
    }

    #[test]
    fn check_status_accepts_2xx() {
        assert!(check_status(200, b"", "/x").is_ok());
        assert!(check_status(201, b"", "/x").is_ok());
        assert!(check_status(299, b"", "/x").is_ok());
    }

    #[test]
    fn check_status_rejects_non_2xx_with_body_in_message() {
        let err = check_status(500, b"boom", "/foo").unwrap_err().to_string();
        assert!(err.contains("500"));
        assert!(err.contains("/foo"));
        assert!(err.contains("boom"));
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
