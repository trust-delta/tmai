# tmai error taxonomy

> **Taxonomy version:** `1` · See `openapi.json` → `components.schemas.TmaiError` for the machine-readable shape.

Every failure that crosses a tmai contract boundary — MCP tool call, WebUI REST response, CLI invocation, or internal facade API — is expressed as a **`TmaiError`**. Callers switch on the stable `code` field instead of parsing free-form `message` text.

## Payload shape

```json
{
  "code": "CapacityExceeded",
  "message": "max dispatchable agents reached (8/8)",
  "retry_hint": { "kind": "backoff_ms", "ms": 2000 },
  "context": { "current": 8, "limit": 8 },
  "trace_id": "req-2f9a…"
}
```

| Field        | Type                        | Required | Meaning |
|--------------|-----------------------------|----------|---------|
| `code`       | [`ErrorCode`](#errorcode)   | yes      | Machine-readable, stable classification |
| `message`    | string                      | yes      | Human-readable summary (English v1) |
| `retry_hint` | [`RetryHint`](#retryhint)   | no       | Advisory retry guidance; absent when not retryable by design |
| `context`    | object                      | no       | Code-specific structured detail |
| `trace_id`   | string                      | no       | Correlation id threaded through MCP / WebUI / `tracing` spans |

`context` and `retry_hint` are **omitted from the wire** when the emitter attached nothing (`null` / `None`). UI clients MUST tolerate their absence.

## Surfaces

| Surface | How the error appears |
|---------|-----------------------|
| **MCP** | Tool error with structured payload (MCP's tool-error-with-data convention) |
| **WebUI REST** | JSON body on `4xx` / `5xx`; toast uses `code` + `message`, details panel shows `context` |
| **CLI** | Non-zero exit; single-line JSON printed to stderr, parseable by callers |
| **Internal** | `Result<T, TmaiError>` at every contract boundary — `anyhow::Error` never leaks out |

## Versioning

- `code` values are **stable forever once added**. Deprecations get serde aliases; removals never happen.
- Adding a new `code` is a **minor-version bump** of the taxonomy. The current version is `1` and is exposed at `GET /api/version` and in MCP server info.
- UI clients MUST treat unknown `code` values as `Internal` and surface the `message` — forward compatibility rule.

## `ErrorCode`

Codes are grouped into four buckets. Within each bucket, callers reason about whole categories (e.g., "should I retry capacity-class errors?") rather than matching individual variants.

### Capacity & availability

| Code | When it fires | Typical `context` | Typical `retry_hint` |
|------|---------------|-------------------|-----------------------|
| `CapacityExceeded` | Global dispatch-slot ceiling reached (max dispatchable agents, queue depth against a hard cap) | `{ current, limit }` | `BackoffMs` |
| `VendorUnavailable` | Downstream vendor rate-limited or in outage; retry is gated on vendor recovery | `{ vendor, account?, reason? }` | `RetryAfter` when `resume_at` known, else `BackoffMs` |
| `QueueFull` | A bounded queue (e.g. dispatch queue) rejected enqueue | `{ queue, depth, capacity }` | `BackoffMs` |

### State & lifecycle

| Code | When it fires | Typical `context` | Typical `retry_hint` |
|------|---------------|-------------------|-----------------------|
| `AgentNotFound` | Target does not resolve to a live or remembered agent | `{ target }` | `NotRetryable` |
| `AgentInTerminalState` | Agent exists but has exited / been killed; the requested operation is no longer valid | `{ target, state }` | `NotRetryable` |
| `WorktreeConflict` | Worktree operation conflicts with current filesystem / agent state (name taken, dirty tree, still-running agent) | `{ path?, branch?, reason }` | `NotRetryable` |

### Permissions & auth

| Code | When it fires | Typical `context` | Typical `retry_hint` |
|------|---------------|-------------------|-----------------------|
| `PermissionDenied` | Caller is authenticated but not authorized for the operation | `{ operation, required }` | `NotRetryable` |
| `TokenInvalid` | Credential / token missing, expired, or malformed | `{ reason }` (never the token itself) | `NotRetryable` |

### Input / request

| Code | When it fires | Typical `context` | Typical `retry_hint` |
|------|---------------|-------------------|-----------------------|
| `InvalidArgument` | A request argument failed validation (out-of-range, malformed) | `{ field, received?, expected? }` | `NotRetryable` |
| `SchemaMismatch` | Request body or MCP tool-input schema did not match the expected shape | `{ pointer, expected, received }` | `NotRetryable` |

### Downstream

| Code | When it fires | Typical `context` | Typical `retry_hint` |
|------|---------------|-------------------|-----------------------|
| `VendorError` | Vendor returned an error that is **not** a rate-limit / outage; the raw vendor response is preserved in `context.vendor_error` | `{ vendor, vendor_error }` | caller-dependent |
| `TmuxError` | A tmux command failed (spawn, `new-window`, `send-keys`) | `{ operation, reason }` | `BackoffMs` often applicable |
| `IpcError` | IPC channel (PTY / socket) disconnected or errored | `{ endpoint?, reason }` | `BackoffMs` |

### Internal

| Code | When it fires | Typical `context` | Typical `retry_hint` |
|------|---------------|-------------------|-----------------------|
| `Internal` | Fallback for unexpected failures. New call sites MUST prefer a more specific code when one exists | varies | varies |

## `RetryHint`

Internally tagged on `kind`.

```json
{ "kind": "retry_after", "resume_at": "2026-04-18T12:34:56Z" }
{ "kind": "backoff_ms",  "ms": 2000 }
{ "kind": "not_retryable" }
```

- `retry_after` — used when the underlying resource advertises a wall-clock reset (typical for vendor rate limits).
- `backoff_ms` — caller-driven clock; appropriate for transient capacity / IPC conditions.
- `not_retryable` — the caller should surface the failure; retrying will not change the outcome without external action.

Retry orchestration is explicitly **out of scope** for the taxonomy itself — `retry_hint` is advisory.

## Non-goals for the taxonomy

- **Localization** — v1 is English; the shape supports future i18n.
- **Warning / notice channel** — non-fatal conditions (e.g. auto-resume scheduled) are emitted as [`CoreEvent`](./corevents.schema.json) variants, not as `TmaiError`.
- **Full internal-error migration** — existing `anyhow::Error` paths migrate incrementally as each boundary is touched.

## Emitting a new code

1. Add the variant to `ErrorCode` in `openapi.json` → `components.schemas.ErrorCode.enum`.
2. Document its firing condition, typical `context`, and typical `retry_hint` in this file.
3. Bump `x-taxonomy-version` on `ErrorCode` **by one**.
4. Call out the new code in the release notes — callers may want to add handling.

Removing or renaming a code is **never** allowed; deprecations are handled by keeping the code and annotating its documentation.
