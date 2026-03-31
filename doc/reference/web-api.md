# Web API Reference

Complete REST API, SSE events, and WebSocket endpoints for tmai.

## Base URL

```
http://localhost:9876
```

Default port: `9876` (configurable via `[web] port` in config).

## Authentication

All API endpoints require token authentication:

- **Primary**: `Authorization: Bearer <token>` header (preferred)
- **Fallback**: `?token=<token>` query parameter (for SSE EventSource)

The token is generated at startup and displayed in the browser URL.

Hook endpoints use a separate token (`~/.config/tmai/hooks_token`).

## Error Responses

| Status | Description |
|--------|-------------|
| `400` | Bad request (invalid input, path traversal, validation error) |
| `401` | Invalid or missing token |
| `404` | Resource not found |
| `500` | Internal server error |

Error body:

```json
{
  "error": "Error description"
}
```

---

## Agent Control

### GET /api/agents

List all monitored agents.

**Response**: `AgentSnapshot[]`

### GET /api/agents/{id}/preview

Get pane content for an agent.

**Response**:

```json
{
  "content": "$ claude\nWelcome to Claude Code...",
  "lines": 42
}
```

### GET /api/agents/{id}/output

Get raw agent output (for PTY sessions).

**Response**:

```json
{
  "session_id": "a1b2c3d4",
  "output": "...",
  "bytes": 4096
}
```

### POST /api/agents/{id}/approve

Send approval (y + Enter) to agent.

**Response**: `{"status": "ok"}`

### POST /api/agents/{id}/select

Select an AskUserQuestion option.

**Request**:

```json
{
  "choice": 2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `choice` | number | Option number (1-indexed) |

### POST /api/agents/{id}/submit

Confirm multi-select selections.

**Request**:

```json
{
  "selected_choices": [1, 3]
}
```

### POST /api/agents/{id}/input

Send text input to agent.

**Request**:

```json
{
  "text": "hello world"
}
```

### POST /api/agents/{id}/key

Send a special key to agent.

**Request**:

```json
{
  "key": "Enter"
}
```

### POST /api/agents/{id}/passthrough

Send raw terminal input (characters or keys).

**Request**:

```json
{
  "chars": "ls -la",
  "key": "Enter"
}
```

Both fields are optional — send either or both.

### PUT /api/agents/{id}/auto-approve

Set per-agent auto-approve override.

**Request**:

```json
{
  "enabled": true
}
```

### POST /api/agents/{id}/kill

Terminate an agent process.

**Response**: `{"status": "ok"}`

### POST /api/agents/{from}/send-to/{to}

Send text from one agent to another.

**Request**:

```json
{
  "text": "Check the auth module"
}
```

**Response**:

```json
{
  "status": "ok",
  "method": "ipc"
}
```

---

## Teams

### GET /api/teams

List all detected Agent Teams.

**Response**:

```json
[
  {
    "name": "my-project",
    "description": "Project description",
    "task_summary": {
      "total": 5,
      "completed": 2,
      "in_progress": 1,
      "pending": 2
    },
    "members": [
      {
        "name": "team-lead",
        "agent_type": "general-purpose",
        "is_lead": true,
        "pane_target": "main:0.1",
        "current_task": {
          "id": "1",
          "subject": "Implement auth",
          "status": "in_progress"
        }
      }
    ],
    "worktree_names": ["feature-a"]
  }
]
```

### GET /api/teams/{name}/tasks

List tasks for a specific team.

**Response**:

```json
[
  {
    "id": "1",
    "subject": "Implement auth module",
    "description": "...",
    "active_form": "Implementing auth",
    "status": "completed",
    "owner": "team-lead",
    "blocks": [],
    "blocked_by": []
  }
]
```

---

## Worktrees

### GET /api/worktrees

List all worktrees. **Response**: `WorktreeSnapshot[]`

### POST /api/worktrees

Create a new worktree.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo",
  "branch_name": "feature-xyz",
  "base_branch": "main"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo_path` | string | Yes | Repository path |
| `branch_name` | string | Yes | Branch name for the worktree |
| `base_branch` | string | No | Base branch (default: current branch) |

**Response**: `{"status": "ok", "path": "...", "branch": "..."}`

### POST /api/worktrees/delete

Delete a worktree.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo",
  "worktree_name": "feature-xyz",
  "force": false
}
```

### POST /api/worktrees/launch

Launch an agent in a worktree.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo",
  "worktree_name": "feature-xyz",
  "agent_type": "claude",
  "session": null
}
```

### POST /api/worktrees/diff

Get diff between worktree and base branch.

**Request**:

```json
{
  "worktree_path": "/home/user/myrepo/.claude/worktrees/feature-xyz",
  "base_branch": "main"
}
```

**Response**: `{"diff": "...", "summary": "..."}`

---

## Git Operations

### GET /api/git/branches

List branches with parent relationships.

**Query**: `?repo=/path/to/repo`

**Response**: `BranchListResult` (branches with parent info, tracking status, ahead/behind counts)

### GET /api/git/log

Get commit log for a branch.

**Query**: `?repo=/path/to/repo&base=main&branch=feature-a`

**Response**: `CommitEntry[]`

### GET /api/git/graph

Get commit graph data for lane-based visualization.

**Query**: `?repo=/path/to/repo&limit=100`

**Response**: Graph layout data with lanes, rows, and connections.

### POST /api/git/branches/create

Create a new branch.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo",
  "name": "feature-new",
  "base": "main"
}
```

### POST /api/git/branches/delete

Delete a branch.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo",
  "branch": "feature-old",
  "force": false
}
```

### POST /api/git/checkout

Switch to a branch.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo",
  "branch": "feature-a"
}
```

### POST /api/git/fetch

Fetch from remote.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo",
  "remote": "origin"
}
```

### POST /api/git/pull

Pull from remote.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo"
}
```

### POST /api/git/merge

Merge a branch.

**Request**:

```json
{
  "repo_path": "/home/user/myrepo",
  "branch": "feature-a"
}
```

---

## GitHub Integration

Requires `gh` CLI installed and authenticated.

### GET /api/github/prs

List open pull requests.

**Query**: `?repo=/path/to/repo`

**Response**: `HashMap<branch_name, PrInfo>` — PR info keyed by branch name.

### GET /api/github/checks

List CI check status for a branch.

**Query**: `?repo=/path/to/repo&branch=feature-a`

**Response**: `CiSummary` with rollup status and individual checks.

### GET /api/github/issues

List repository issues.

**Query**: `?repo=/path/to/repo`

**Response**: `IssueInfo[]` with title, labels, state, and number.

---

## File Operations

### GET /api/files/read

Read a file (max 1MB).

**Query**: `?path=/path/to/file`

**Response**:

```json
{
  "path": "/path/to/file",
  "content": "file content...",
  "editable": true
}
```

The `editable` flag is `true` for supported file types (`.md`, `.json`, `.toml`, `.txt`, `.yaml`, `.yml`).

### POST /api/files/write

Write file content (restricted to supported file types, existing files only).

**Request**:

```json
{
  "path": "/path/to/file.md",
  "content": "new content"
}
```

### GET /api/files/md-tree

Get a file tree for markdown/config files in a directory.

**Query**: `?root=/path/to/project`

**Response**:

```json
[
  {
    "name": "CLAUDE.md",
    "path": "/path/to/project/CLAUDE.md",
    "is_dir": false,
    "openable": true,
    "children": null
  },
  {
    "name": "doc",
    "path": "/path/to/project/doc",
    "is_dir": true,
    "openable": false,
    "children": [...]
  }
]
```

---

## Projects

### GET /api/projects

List registered project directories.

**Response**: `string[]` (absolute paths)

### POST /api/projects

Add a project directory.

**Request**:

```json
{
  "path": "/home/user/myproject"
}
```

### POST /api/projects/remove

Remove a registered project.

**Request**:

```json
{
  "path": "/home/user/myproject"
}
```

### GET /api/directories

List directory contents.

**Query**: `?path=/home/user` (optional, defaults to home directory)

**Response**:

```json
[
  {
    "name": "myproject",
    "path": "/home/user/myproject",
    "is_git": true
  }
]
```

---

## Spawn

### POST /api/spawn

Spawn an agent in a PTY session.

**Request**:

```json
{
  "command": "claude",
  "args": [],
  "cwd": "/home/user/project",
  "rows": 24,
  "cols": 80,
  "force_pty": false
}
```

Allowed commands: `claude`, `codex`, `gemini`, `bash`, `sh`, `zsh`

**Response**:

```json
{
  "session_id": "a1b2c3d4-...",
  "pid": 12345,
  "command": "claude"
}
```

### POST /api/spawn/worktree

Spawn an agent in a new worktree.

**Request**:

```json
{
  "name": "feature-xyz",
  "cwd": "/home/user/myrepo",
  "base_branch": "main",
  "rows": 24,
  "cols": 80
}
```

---

## Settings

### GET /api/settings/spawn

Get spawn settings.

**Response**:

```json
{
  "use_tmux_window": false,
  "tmux_available": true,
  "tmux_window_name": "tmai-agents"
}
```

### PUT /api/settings/spawn

Update spawn settings.

**Request**:

```json
{
  "use_tmux_window": true,
  "tmux_window_name": "my-agents"
}
```

### GET /api/settings/auto-approve

Get auto-approve settings.

**Response**:

```json
{
  "mode": "hybrid",
  "running": true
}
```

### PUT /api/settings/auto-approve

Change auto-approve mode.

**Request**:

```json
{
  "mode": "rules"
}
```

Modes: `off`, `rules`, `ai`, `hybrid`

### GET /api/settings/usage

Get usage tracking settings.

**Response**:

```json
{
  "enabled": true,
  "auto_refresh_min": 5
}
```

### PUT /api/settings/usage

Update usage tracking settings.

**Request**:

```json
{
  "enabled": true,
  "auto_refresh_min": 10
}
```

---

## Config Audit

### POST /api/config-audit/run

Run a config audit.

**Response**: `ScanResult` with risks, scanned files, and timestamp.

### GET /api/config-audit/last

Get the last audit result (cached).

**Response**: `ScanResult` or `null` if no audit has been run.

---

## Usage

### GET /api/usage

Get current usage meter data.

**Response**: `UsageSnapshot` with meter values, percentages, and reset info.

### POST /api/usage/fetch

Trigger a usage data fetch from the provider.

**Response**: `202 Accepted`

---

## SSE Events

### GET /api/events

Server-Sent Events stream for real-time updates.

**Authentication**: Query parameter (`?token=<token>`) since EventSource cannot set headers.

**Keep-alive**: 15-second intervals.

**Event Types**:

| Event | Payload | Description |
|-------|---------|-------------|
| `agents` | `AgentSnapshot[]` | Agent status changes (deduplicated) |
| `teams` | `TeamInfoResponse[]` | Team structure updates |
| `teammate_idle` | `{team_name, member_name}` | Team member became idle |
| `task_completed` | `{team_name, task_id, task_subject}` | Task completed |
| `context_compacting` | `{target, compaction_count}` | Agent context compaction |
| `usage` | `UsageSnapshot` | Usage meter updates |
| `worktree_created` | `{target, worktree}` | Worktree created |
| `worktree_removed` | `{target, worktree}` | Worktree removed |
| `review_launched` | `{source_target, review_target}` | Code review started |
| `review_completed` | `{source_target, summary}` | Code review finished |

---

## WebSocket Terminal

### ANY /api/agents/{id}/terminal

WebSocket connection for interactive terminal I/O.

**Authentication**: Query parameter (`?token=<token>`).

**Protocol**:

| Direction | Frame Type | Content |
|-----------|-----------|---------|
| Server → Client | Binary | Raw PTY output (ANSI escapes) |
| Client → Server | Binary | Raw keyboard input bytes |
| Client → Server | Text (JSON) | Control messages |

**Control Messages**:

```json
{
  "type": "resize",
  "cols": 120,
  "rows": 40
}
```

**Features**:
- Scrollback buffer replay on connection
- Automatic cleanup on disconnect

---

## Hook Endpoints

Internal endpoints for Claude Code hook events. Configured by `tmai init`.

### POST /hooks/event

Receive Claude Code hook events.

**Authentication**: `Authorization: Bearer <hooks_token>` (separate from web API token)

**Request**: `HookEventPayload` from Claude Code

**Response** (varies by event):

- **PreToolUse**: Returns auto-approve decision

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "approved",
    "permissionDecisionReason": "tmai auto-approve: rules:allow_read"
  }
}
```

- **TeammateIdle / TaskCompleted**: Returns continuation signal

```json
{
  "continue": true,
  "stopReason": null
}
```

- **Other events**: `{}`

### POST /hooks/review-complete

Receive review completion notification.

**Authentication**: `Authorization: Bearer <hooks_token>`

**Request**:

```json
{
  "source_target": "main:0.1",
  "summary": "Review summary..."
}
```

---

## Examples

```bash
TOKEN="your-token-here"
BASE="http://localhost:9876"

# List agents
curl "$BASE/api/agents?token=$TOKEN"

# Approve agent
curl -X POST "$BASE/api/agents/main:0.1/approve" \
  -H "Authorization: Bearer $TOKEN"

# Send text to agent
curl -X POST "$BASE/api/agents/main:0.1/input" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "hello"}'

# List branches
curl "$BASE/api/git/branches?repo=/path/to/repo&token=$TOKEN"

# Create worktree
curl -X POST "$BASE/api/worktrees" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repo_path":"/path/to/repo","branch_name":"feature-xyz","base_branch":"main"}'

# SSE stream
curl "$BASE/api/events?token=$TOKEN"

# Spawn agent
curl -X POST "$BASE/api/spawn" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"claude","cwd":"/path/to/project"}'

# Config audit
curl -X POST "$BASE/api/config-audit/run" \
  -H "Authorization: Bearer $TOKEN"

# List teams
curl "$BASE/api/teams?token=$TOKEN"
```
