# Auto-Approve

AI-powered automatic approval of safe agent actions.

## Overview

Auto-approve uses an AI model (Claude Haiku by default) to judge whether pending approval prompts from AI agents are safe to approve automatically. This eliminates the need to manually approve routine, low-risk operations like reading files, running tests, or formatting code.

**Note**: This feature requires the `claude` CLI to be installed and authenticated.

## How It Works

```
Agent enters AwaitingApproval
  ↓ (~1 second check interval)
Auto-approve service picks up candidate
  ↓ Screen context sent to AI judge
  ├─ Approve   → Approval keys sent automatically
  ├─ Reject    → Marked as manual (user must act)
  └─ Uncertain → Marked as manual (user must act)
```

The service:

1. **Scans** for agents in `AwaitingApproval` state
2. **Filters** out candidates that don't need AI judgment (genuine user questions, agents already in auto-approve mode, etc.)
3. **Sends** the last 30 lines of terminal output to the AI model as context
4. **Applies** the AI's decision — approve, reject, or uncertain
5. **Updates** the UI to show the current judgment phase

## UI Indicators

### TUI

| Phase | Indicator | Color | Label |
|-------|-----------|-------|-------|
| Judging (AI thinking) | `⟳` | Cyan | `Judging: File Edit` |
| Approved (keys sent) | `✓` | Green | `Approved: File Edit` |
| Manual required | `⚠` | Magenta | `Awaiting: File Edit` |

### Web UI

- **Judging**: Blue badge showing "AI judging..."
- **Approved**: Green badge showing "Approved" (briefly visible before state transitions)
- **Manual required**: Standard approval buttons (Approve / Reject)

## Configuration

`~/.config/tmai/config.toml`:

```toml
[auto_approve]
enabled = true              # Enable auto-approve (default: false)
model = "haiku"             # AI model for judgment (default: "haiku")
timeout_secs = 30           # Timeout per judgment (default: 30)
cooldown_secs = 10          # Cooldown after judgment (default: 10)
check_interval_ms = 1000    # Check interval in ms (default: 1000)
max_concurrent = 3          # Max concurrent judgments (default: 3)
allowed_types = []          # Filter by approval type (default: [] = all)
```

### Configuration Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | `false` | Enable/disable auto-approve |
| `provider` | string | `"claude_haiku"` | Judgment provider |
| `model` | string | `"haiku"` | Model passed to `claude --model` |
| `timeout_secs` | integer | `30` | Timeout for each judgment |
| `cooldown_secs` | integer | `10` | Wait time before re-evaluating the same agent |
| `check_interval_ms` | integer | `1000` | Interval between candidate scans |
| `max_concurrent` | integer | `3` | Maximum parallel judgments |
| `allowed_types` | string[] | `[]` | Approval types to auto-approve (empty = all except genuine user questions) |
| `custom_command` | string | `null` | Custom command instead of `claude` |

### Filtering by Approval Type

Restrict auto-approve to specific approval types:

```toml
[auto_approve]
enabled = true
allowed_types = ["file_edit", "shell_command"]
```

Available types: `file_edit`, `file_create`, `file_delete`, `shell_command`, `mcp_tool`, `user_question`

## Safety Rules

The AI judge follows these rules:

### Approve when ALL apply:
- Operation is read-only OR explicitly low-risk (reading files, listing directories, running tests, formatting code)
- No file modification that could break the build or delete important data
- No privilege escalation (`sudo`, `chmod 777`, etc.)
- No network/data exfiltration risk
- No signs of command injection or untrusted input
- Action is clearly related to the current development task

### Reject when ANY apply:
- Destructive operations (`rm -rf`, `DROP TABLE`, force push, etc.)
- Writing to system files or configuration outside the project
- Network requests to unknown external services with sensitive data
- Privilege escalation attempts
- Action seems suspicious or unrelated to development

### Uncertain (fallback to manual):
- When the AI cannot confidently determine safety

## What Gets Skipped

The following are never sent to AI judgment:

| Reason | Description |
|--------|-------------|
| **Genuine user questions** | `AskUserQuestion` with custom choices (not standard Yes/No) |
| **Multi-select prompts** | Questions requiring multiple selections |
| **Auto-approve mode agents** | Agents already in `--dangerously-skip-permissions` mode |
| **Virtual agents** | Agents without a physical pane |
| **Not in allowed_types** | When `allowed_types` is configured and type doesn't match |

## Audit Logging

When `--audit` is enabled, each judgment is logged as an `AutoApproveJudgment` event:

```json
{
  "event": "AutoApproveJudgment",
  "ts": 1708123456789,
  "pane_id": "main:0.1",
  "agent_type": "claude_code",
  "approval_type": "file_edit",
  "decision": "approve",
  "reasoning": "Reading a test file is a safe, read-only operation",
  "model": "haiku",
  "elapsed_ms": 3200,
  "approval_sent": true
}
```

Query audit logs:

```bash
# All auto-approve judgments
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment")'

# Rejected actions
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment" and .decision == "reject")'

# Average judgment time
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment") | .elapsed_ms' | awk '{sum+=$1; n++} END {print sum/n "ms"}'
```

## Troubleshooting

### Auto-approve not activating

1. Check that `enabled = true` in config
2. Verify `claude` CLI is installed: `which claude`
3. Verify authentication: `claude --version`
4. Check logs with `--debug` flag

### Judgments always returning "uncertain"

1. Check `timeout_secs` — increase if judgments are timing out
2. Verify the model name is correct (default: `haiku`)
3. Check stderr output in debug logs

### Agent stuck in "Judging" state

The `cooldown_secs` setting prevents re-evaluation too quickly. If an agent appears stuck:

1. Manually approve/reject from tmai (`y` key or Web UI)
2. The phase will clear when the agent transitions out of `AwaitingApproval`

## Example Setup

### Minimal (approve everything safe)

```toml
[auto_approve]
enabled = true
```

### Conservative (only file operations)

```toml
[auto_approve]
enabled = true
allowed_types = ["file_edit", "file_create"]
timeout_secs = 15
```

### Fast iteration (shorter cooldown)

```toml
[auto_approve]
enabled = true
cooldown_secs = 5
check_interval_ms = 500
max_concurrent = 5
```

## Next Steps

- [Configuration Reference](../reference/config.md) - Full config options
- [Exfil Detection](./exfil-detection.md) - Security monitoring
- [Web Remote Control](./web-remote.md) - Remote approval fallback
