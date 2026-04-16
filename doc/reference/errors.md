# Error Taxonomy

_Structured error shape used across every tmai contract boundary (MCP,
WebUI, CLI, internal facade API). Tracked by [#458]._

Source: [`crates/tmai-core/src/error/mod.rs`][src].

[#458]: https://github.com/trust-delta/tmai/issues/458
[src]: ../../crates/tmai-core/src/error/mod.rs

## Why

As more contract-layer concerns land (capacity #454, vendor availability
#455, dispatch queue, fallback routing, permission checks, cross-repo
bundle failures), defining error types ad-hoc per issue fragments the
contract surface. Orchestrator agents, external MCP clients, and the
producer layer all need **one taxonomy to reason about**, not N ad-hoc
error shapes.

## Shape

Every contract-layer failure serializes as a `TmaiError`:

```json
{
  "code": "AgentNotFound",
  "message": "agent not found: main:0.0",
  "retry_hint": { "kind": "not_retryable" },
  "context": { "target": "main:0.0" },
  "trace_id": "req-abc123"
}
```

| Field        | Type                | Description |
| ------------ | ------------------- | ----------- |
| `code`       | `ErrorCode`         | Machine-readable, stable enum — primary dispatch key. |
| `message`    | `string`            | Human-readable summary. English-only in v1. |
| `retry_hint` | `RetryHint?`        | Advisory retry guidance; omitted when not applicable. |
| `context`    | `object?`           | Code-specific structured detail; omitted when empty. |
| `trace_id`   | `string?`           | Correlates this error across MCP, WebUI, and tracing spans. |

### `RetryHint` variants

```json
{ "kind": "retry_after", "resume_at": "2026-04-17T12:00:00Z" }
{ "kind": "backoff_ms", "ms": 1500 }
{ "kind": "not_retryable" }
```

`retry_hint` is **informational only** — the caller decides whether to
act on it. Retry orchestration is explicitly out of scope for v1.

## `ErrorCode` catalogue (v1)

Codes are grouped by concern. Every code is stable forever once shipped;
deprecations get serde aliases, never removals.

### Capacity & availability

| Code                 | Meaning |
| -------------------- | ------- |
| `CapacityExceeded`   | Capacity limit reached (max dispatchable agents, queue depth). Target of #454. |
| `VendorUnavailable`  | A downstream vendor is temporarily unavailable. Target of #455. |
| `QueueFull`          | A bounded queue is full; retry later. |

### State / lifecycle

| Code                   | Meaning |
| ---------------------- | ------- |
| `AgentNotFound`        | The referenced agent does not exist in current state. |
| `AgentInTerminalState` | Agent exists but has exited / been killed. |
| `WorktreeConflict`     | Worktree operation conflict (name in use, dirty tree, still-running agent). |

### Permissions / auth

| Code               | Meaning |
| ------------------ | ------- |
| `PermissionDenied` | Authenticated but not authorized. |
| `TokenInvalid`     | Credential missing, expired, or malformed. |

### Input / request

| Code              | Meaning |
| ----------------- | ------- |
| `InvalidArgument` | Argument failed validation. |
| `SchemaMismatch`  | Request body / tool input shape mismatch. |

### Downstream

| Code           | Meaning |
| -------------- | ------- |
| `VendorError`  | Vendor-originating failure. Raw vendor payload preserved in `context.vendor_error`. |
| `TmuxError`    | tmux command failed (spawn, new-window, send-keys). |
| `IpcError`     | IPC channel failed or disconnected. |

### Internal

| Code       | Meaning |
| ---------- | ------- |
| `Internal` | Fallback for unexpected failures. New call sites prefer a more specific code. |

## Surfaces

- **MCP**: tool errors carry `TmaiError` as the structured payload.
- **WebUI**: failing API responses return `TmaiError` JSON; toasts surface
  `code` + `message`, a details panel shows `context`.
- **CLI**: non-zero exit; `TmaiError` printed as one-line JSON on stderr.
- **Internal**: contract-boundary functions return `Result<T, TmaiError>`.
  `anyhow::Error` no longer leaks across contract boundaries.

## Versioning

`ErrorCode` values are **stable forever once added**:

- Deprecations get serde aliases, never removals.
- Adding a new code is a minor-version bump.
- The taxonomy version is exposed as `TAXONOMY_VERSION` (current: `"1"`)
  and surfaced on MCP server info / WebUI `/api/version`.

Callers may treat unknown codes as a signal to upgrade, but must still
fall back gracefully (read `message`, drop `context`).

## Scope (v1) — what's done

- `TmaiError`, `ErrorCode` (full enum), `RetryHint` defined in
  [`crates/tmai-core/src/error/`][src].
- First-wave migrations: `AgentNotFound`, `SpawnFailed` (→ `TmuxError`),
  `NoCommandSender` (→ `IpcError`). Surfaces via `From<ApiError>`.
- Taxonomy documented here.

## Non-goals (v1)

- Full migration of every internal `anyhow::Error`. Remaining variants
  flow through `ErrorCode::Internal` until their boundary is touched.
- Message localization. Shape supports future i18n; v1 is English.
- Retry orchestration. `retry_hint` is advisory only.

## Migration guidance

When you touch a contract boundary that currently returns `anyhow::Error`
or a domain-specific enum:

1. Pick the most specific `ErrorCode` — add a new one only if no existing
   code fits.
2. Populate `context` with the structured fields callers will want
   (prefer snake_case keys).
3. Set `retry_hint` only when the caller has a concrete action.
4. If ingressing at MCP/WebUI, attach `trace_id` from the incoming span.
5. Cover the call site with a unit test that round-trips the serialized
   error.
