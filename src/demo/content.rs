use std::collections::HashMap;
use std::sync::LazyLock;

/// Pre-built demo preview content keyed by scenario content_key
static CONTENT_MAP: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::new();

    m.insert(
        "processing_read",
        "\
\x1b[1m\x1b[36m✻ Reading files...\x1b[0m

  Reading src/auth/middleware.rs
  Reading src/auth/mod.rs
  Reading src/config/settings.rs

  I'll implement the authentication middleware. Let me first review
  the existing code structure to understand the patterns used.",
    );

    m.insert(
        "processing_test",
        "\
\x1b[1m\x1b[36m✻ Analyzing test failures...\x1b[0m

  Reading tests/auth_test.rs
  Reading tests/integration/api_test.rs

  I can see the test failures are related to the updated auth module.
  Let me fix the assertions to match the new response format.",
    );

    m.insert(
        "processing_gemini",
        "\
\x1b[1m\x1b[33m● Working...\x1b[0m

  Analyzing the API schema for potential improvements.
  Checking endpoint consistency across v1 and v2 routes.",
    );

    m.insert(
        "processing_gemini_2",
        "\
\x1b[1m\x1b[33m● Working...\x1b[0m

  Generating API documentation from schema definitions.
  Cross-referencing with existing endpoint tests.",
    );

    m.insert(
        "approval_file_edit",
        "\
\x1b[1m\x1b[36m⏺ Claude Code\x1b[0m wants to edit \x1b[1msrc/auth/middleware.rs\x1b[0m

\x1b[32m+  use jsonwebtoken::{decode, DecodingKey, Validation};\x1b[0m
\x1b[32m+\x1b[0m
\x1b[32m+  pub async fn auth_middleware(\x1b[0m
\x1b[32m+      req: Request<Body>,\x1b[0m
\x1b[32m+      next: Next,\x1b[0m
\x1b[32m+  ) -> Result<Response, StatusCode> {\x1b[0m
\x1b[32m+      let token = req.headers()\x1b[0m
\x1b[32m+          .get(\"Authorization\")\x1b[0m
\x1b[32m+          .and_then(|v| v.to_str().ok())\x1b[0m
\x1b[32m+          .and_then(|v| v.strip_prefix(\"Bearer \"));\x1b[0m

  Do you want to edit this file?
  \x1b[1m1. Yes\x1b[0m  2. No",
    );

    m.insert(
        "approval_shell_command",
        "\
\x1b[1m\x1b[36m⏺ Claude Code\x1b[0m wants to run a shell command

  \x1b[1m$ cargo test --lib\x1b[0m

  Allow this command?
  \x1b[1m1. Yes\x1b[0m  2. No",
    );

    m.insert(
        "approval_user_question",
        "\
\x1b[1m\x1b[36m⏺ Claude Code\x1b[0m

  Which authentication strategy should I use?

  \x1b[1;36m❯ 1. JWT with refresh tokens\x1b[0m
    2. Session-based auth
    3. OAuth 2.0 integration",
    );

    m.insert("idle", "\x1b[1m✳ \x1b[0mHow can I help you?");

    m.insert("idle_gemini", "\x1b[1m\x1b[33m●\x1b[0m Ready for input.");

    m.insert(
        "idle_tests_pass",
        "\
\x1b[1m✳ \x1b[0mAll tasks completed.

  \x1b[32m✓\x1b[0m Fixed 3 test assertions in tests/auth_test.rs
  \x1b[32m✓\x1b[0m Updated integration tests for new response format
  \x1b[32m✓\x1b[0m All 24 tests passing",
    );

    m.insert(
        "idle_auth_done",
        "\
\x1b[1m✳ \x1b[0mAuthentication implementation complete.

  \x1b[32m✓\x1b[0m Created auth middleware with JWT validation
  \x1b[32m✓\x1b[0m Added refresh token endpoint
  \x1b[32m✓\x1b[0m Updated route configuration",
    );

    m
});

/// Get preview content for a given content key
///
/// Returns empty string for unknown keys or the "quit" sentinel.
pub fn get_content(key: &str) -> &'static str {
    CONTENT_MAP.get(key).copied().unwrap_or("")
}
