# tmai-ratatui

> 🏠 **Project hub**: [`trust-delta/tmai`](https://github.com/trust-delta/tmai) — start there for binary installs, overview, and a map of all sub-repos.

A [ratatui](https://ratatui.rs/) TUI client for [tmai-core](https://github.com/trust-delta/tmai-core) — speaks the HTTP + SSE contract defined by [tmai-api-spec](https://github.com/trust-delta/tmai-api-spec).

## Status

**Early scaffold.** The first milestone implements the agent list screen only: discover a running `tmai-core`, list agents, and approve / send-text / send-key / kill over HTTP. Team overview, worktree ops, selection popups, git/PR panels and the full multi-pane layout from the original bundled TUI are tracked as follow-up work (see the upstream `tmai-core` issue tracker).

## Repository layout

tmai was split into three repositories in April 2026:

| Repo            | Visibility | Role                                                                 |
| --------------- | ---------- | -------------------------------------------------------------------- |
| `tmai-core`     | private    | Rust backend + agent runtime. Closed for IP protection.              |
| `tmai-api-spec` | public     | OpenAPI document + CoreEvent JSON Schema. The wire contract.         |
| `tmai-react`    | public     | Reference React/TypeScript client.                                   |
| `tmai-ratatui`  | public     | This repo. Terminal client for the same contract.                    |

This client never imports from `tmai-core` directly — all coupling goes through HTTP + SSE as described in `tmai-api-spec`.

## Stack

- Rust 2021, `rustc` ≥ 1.91
- `ratatui` 0.30 + `crossterm` 0.29 (terminal rendering)
- `tokio` (async runtime)
- `reqwest` + `reqwest-eventsource` (HTTP + SSE transport)

## Development

```bash
cargo build
cargo test
cargo run -- --help
```

### Running against tmai-core locally

1. Start `tmai-core` (it is private — access the repo to self-host; there is no public managed endpoint).
2. `tmai-core` writes its port + bearer token to `$XDG_RUNTIME_DIR/tmai/api.json` (mode `0600`).
3. Launch `tmai-ratatui` — it reads `api.json` and connects to `http://127.0.0.1:<port>/api`.

```bash
cargo run
```

Override connection details explicitly:

```bash
cargo run -- --url http://127.0.0.1:9876 --token <token>
```

## Contract

This client consumes:

- **HTTP REST API** — endpoints defined in [tmai-api-spec/openapi.json](https://github.com/trust-delta/tmai-api-spec/blob/main/openapi.json). Currently used: `GET /api/agents`, `POST /api/agents/{id}/approve`, `POST /api/agents/{id}/input`, `POST /api/agents/{id}/key`, `POST /api/agents/{id}/kill`.
- **SSE event stream** at `/api/events` — the `agents` named event carries a full `AgentSnapshot[]` JSON array.

Types in `src/types.rs` are hand-written against `tmai-api-spec` and carry only the fields this client reads. Following the `tmai-react` forward-compat rule, **unknown SSE event names and unknown struct fields are ignored** so newer `tmai-core` versions don't break older builds.

## License

MIT — see [LICENSE](LICENSE).
