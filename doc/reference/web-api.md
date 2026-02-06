# Web API Reference

REST API for Web Remote Control.

## Base URL

```
http://<host>:<port>/?token=<token>
```

Default port: `9876`

All API endpoints require the token as a query parameter.

## Authentication

All requests must include the token:

```
GET /api/agents?token=abc123
POST /api/agents/1/approve?token=abc123
```

The token is displayed in the QR code URL.

## Endpoints

### GET /api/agents

List all monitored agents.

**Response:**

```json
{
  "agents": [
    {
      "id": "0",
      "name": "dev:claude",
      "status": "awaiting_approval",
      "approval_type": "user_question",
      "details": "Which approach do you prefer?",
      "choices": ["async/await", "callbacks", "promises"],
      "multi_select": false,
      "cursor_position": 1,
      "detection_source": "pty"
    },
    {
      "id": "1",
      "name": "dev:codex",
      "status": "processing",
      "detection_source": "capture"
    }
  ]
}
```

**Agent Object:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique agent identifier |
| `name` | string | Display name (session:window) |
| `status` | string | `processing`, `idle`, `awaiting_approval` |
| `approval_type` | string? | Type of approval needed |
| `details` | string? | Description of approval request |
| `choices` | string[]? | AskUserQuestion options |
| `multi_select` | bool? | Whether multi-select is enabled |
| `cursor_position` | number? | Current selection (1-indexed) |
| `detection_source` | string | `pty` or `capture` |

### POST /api/agents/:id/approve

Send approval (y) to agent.

**Request:**

```
POST /api/agents/0/approve?token=abc123
```

**Response:**

```json
{
  "success": true
}
```

### POST /api/agents/:id/select

Select an AskUserQuestion option.

**Request:**

```
POST /api/agents/0/select?token=abc123
Content-Type: application/json

{
  "option": 2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `option` | number | Option number (1-indexed) |

**Response:**

```json
{
  "success": true
}
```

### POST /api/agents/:id/submit

Confirm multi-select selections.

**Request:**

```
POST /api/agents/0/submit?token=abc123
Content-Type: application/json

{
  "selections": [1, 3]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `selections` | number[] | Selected option numbers (1-indexed) |

**Response:**

```json
{
  "success": true
}
```

### POST /api/agents/:id/input

Send text input to agent.

**Request:**

```
POST /api/agents/0/input?token=abc123
Content-Type: application/json

{
  "text": "https://api.example.com"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Text to send |

**Response:**

```json
{
  "success": true
}
```

### GET /api/agents/:id/preview

Get pane content for agent.

**Request:**

```
GET /api/agents/0/preview?token=abc123
```

**Response:**

```json
{
  "content": "$ claude\n\nWelcome to Claude Code...\n\n> Working on task..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Pane content (ANSI codes stripped) |

### GET /api/events

Server-Sent Events stream for real-time updates.

**Request:**

```
GET /api/events?token=abc123
```

**Response:**

```
event: agents
data: {"agents":[...]}

event: teams
data: {"teams":[...]}
```

| Event | Description |
|-------|-------------|
| `agents` | Sent when agent status changes |
| `teams` | Sent when team/task data changes |

### GET /api/teams

List all detected Agent Teams with task summaries.

**Request:**

```
GET /api/teams?token=abc123
```

**Response:**

```json
{
  "teams": [
    {
      "name": "my-project",
      "members": [
        {
          "name": "team-lead",
          "agent_type": "general-purpose"
        },
        {
          "name": "researcher",
          "agent_type": "Explore"
        }
      ],
      "task_summary": {
        "total": 5,
        "completed": 2,
        "in_progress": 1,
        "pending": 2
      }
    }
  ]
}
```

### GET /api/teams/:name/tasks

List tasks for a specific team.

**Request:**

```
GET /api/teams/my-project/tasks?token=abc123
```

**Response:**

```json
{
  "tasks": [
    {
      "id": "1",
      "subject": "Implement auth module",
      "status": "completed",
      "owner": "researcher"
    },
    {
      "id": "2",
      "subject": "Write tests",
      "status": "in_progress",
      "owner": "team-lead"
    }
  ]
}
```

## Error Responses

### 401 Unauthorized

Invalid or missing token.

```json
{
  "error": "Invalid token"
}
```

### 404 Not Found

Agent not found.

```json
{
  "error": "Agent not found"
}
```

### 500 Internal Server Error

Server error (check logs).

```json
{
  "error": "Internal server error"
}
```

## Status Values

| Status | Description |
|--------|-------------|
| `processing` | Agent is working |
| `idle` | Agent is waiting for input |
| `awaiting_approval` | Agent needs user approval |

## Approval Types

| Type | Description |
|------|-------------|
| `file_edit` | File modification approval |
| `shell_command` | Shell command execution |
| `mcp_tool` | MCP tool usage |
| `user_question` | AskUserQuestion |
| `yes_no` | Simple yes/no confirmation |
| `other` | Other approval type |

## Detection Sources

| Source | Description |
|--------|-------------|
| `pty` | PTY wrapping (high precision) |
| `capture` | tmux capture-pane (traditional) |

## Example: curl

```bash
TOKEN="your-token-here"
BASE="http://localhost:9876"

# List agents
curl "$BASE/api/agents?token=$TOKEN"

# Approve
curl -X POST "$BASE/api/agents/0/approve?token=$TOKEN"

# Select option 2
curl -X POST "$BASE/api/agents/0/select?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"option": 2}'

# Send text
curl -X POST "$BASE/api/agents/0/input?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "hello"}'

# List teams
curl "$BASE/api/teams?token=$TOKEN"

# Get team tasks
curl "$BASE/api/teams/my-project/tasks?token=$TOKEN"
```

## Next Steps

- [Web Remote Control](../features/web-remote.md) - Feature overview
- [Configuration Reference](./config.md) - Config options
