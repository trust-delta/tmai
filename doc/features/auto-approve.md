# Auto-Approve

Automatic approval of safe agent actions with 4 operating modes.

## Overview

Auto-approve supports 4 modes to balance speed, accuracy, and cost:

| Mode | Description | Speed | Requires `claude` CLI |
|------|-------------|-------|-----------------------|
| **Off** | No auto-approval (default) | — | No |
| **Rules** | Pattern-based instant approval | Sub-millisecond | No |
| **AI** | AI model judges each prompt | ~2-15 seconds | Yes |
| **Hybrid** | Rules first, AI fallback for uncertain | Fast for common ops | Yes |

**Rules mode** matches Claude Code's approval prompts against built-in patterns (read operations, test execution, git read-only commands, etc.) and approves instantly without any AI call.

**AI mode** sends screen context to an AI model (Claude Haiku by default) for judgment. This is the most accurate but slowest option.

**Hybrid mode** (recommended) tries rules first — if no rule matches, it falls back to AI judgment. This gives instant approval for common operations while maintaining AI coverage for everything else.

## How It Works

### Rules Mode

```
Agent enters AwaitingApproval
  ↓ (instant, sub-millisecond)
Rule engine parses approval prompt
  ├─ Allow rule matches → Approval keys sent automatically
  └─ No match           → Marked as manual (user must act)
```

### AI Mode

```
Agent enters AwaitingApproval
  ↓ (~1 second check interval)
Screen context sent to AI judge
  ├─ Approve   → Approval keys sent automatically
  ├─ Reject    → Marked as manual (user must act)
  └─ Uncertain → Marked as manual (user must act)
```

### Hybrid Mode

```
Agent enters AwaitingApproval
  ↓ (instant)
Rule engine evaluates first
  ├─ Allow rule matches → Approved instantly
  └─ No match → AI fallback
                  ├─ Approve   → Approved
                  ├─ Reject    → Manual required
                  └─ Uncertain → Manual required
```

## Built-in Allow Rules

The rule engine recognizes Claude Code's approval prompt format and matches against these categories:

| Rule | Setting | What it matches |
|------|---------|-----------------|
| **Read operations** | `allow_read` | `Read` tool, `cat`, `head`, `tail`, `ls`, `find`, `grep`, `wc` |
| **Test execution** | `allow_tests` | `cargo test`, `npm test`, `pytest`, `go test`, `dotnet test`, etc. |
| **Fetch/search** | `allow_fetch` | `WebFetch`, `WebSearch`, `curl` GET (no POST/data) |
| **Git read-only** | `allow_git_readonly` | `git status/log/diff/branch/show/blame/stash list/remote -v/tag/rev-parse/ls-files/ls-tree` |
| **Format/lint** | `allow_format_lint` | `cargo fmt/clippy`, `prettier`, `eslint`, `rustfmt`, `black`, `gofmt`, `biome`, etc. |
| **Custom patterns** | `allow_patterns` | User-defined regex patterns |

All built-in rules are enabled by default. Operations that don't match any rule fall through to manual approval (Rules mode) or AI judgment (Hybrid mode).

## UI Indicators

### TUI

| Phase | Indicator | Color | Label |
|-------|-----------|-------|-------|
| Judging (AI thinking) | `⟳` | Cyan | `Judging: File Edit` |
| Rule-approved | `✓` | Green | `Rule-Approved: File Edit` |
| AI-approved | `✓` | Green | `AI-Approved: File Edit` |
| Manual required | `⚠` | Magenta | `Awaiting: File Edit` |

### Web UI

- **Judging**: Blue badge showing "AI judging..."
- **Rule-approved**: Green badge showing "Rule-Approved"
- **AI-approved**: Green badge showing "AI-Approved"
- **Manual required**: Standard approval buttons (Approve / Reject)

## Configuration

`~/.config/tmai/config.toml`:

```toml
[auto_approve]
mode = "hybrid"             # Operating mode: off/rules/ai/hybrid
model = "haiku"             # AI model for judgment (AI/Hybrid modes)

[auto_approve.rules]
allow_read = true           # Auto-approve read operations
allow_tests = true          # Auto-approve test execution
allow_fetch = true          # Auto-approve WebFetch/WebSearch
allow_git_readonly = true   # Auto-approve read-only git commands
allow_format_lint = true    # Auto-approve format/lint commands
allow_patterns = []         # Additional allow patterns (regex)
```

### Mode Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | string | — | Operating mode: `"off"`, `"rules"`, `"ai"`, `"hybrid"` |
| `enabled` | bool | `false` | Legacy toggle (use `mode` instead) |

**Backward compatibility**: If `mode` is not set, tmai falls back to the `enabled` field — `enabled = true` maps to AI mode, `enabled = false` maps to Off.

### Rule Settings (`[auto_approve.rules]`)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `allow_read` | bool | `true` | Auto-approve Read tool and read-only shell commands |
| `allow_tests` | bool | `true` | Auto-approve test execution (cargo test, npm test, etc.) |
| `allow_fetch` | bool | `true` | Auto-approve WebFetch, WebSearch, curl GET |
| `allow_git_readonly` | bool | `true` | Auto-approve read-only git commands |
| `allow_format_lint` | bool | `true` | Auto-approve format/lint commands |
| `allow_patterns` | string[] | `[]` | Additional regex patterns to allow |

### AI Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `model` | string | `"haiku"` | Model passed to `claude --model` |
| `timeout_secs` | integer | `30` | Timeout for each AI judgment |
| `cooldown_secs` | integer | `10` | Wait time before re-evaluating the same agent |
| `check_interval_ms` | integer | `1000` | Interval between candidate scans |
| `max_concurrent` | integer | `3` | Maximum parallel AI judgments |
| `allowed_types` | string[] | `[]` | Approval types to auto-approve (empty = all except genuine user questions) |
| `custom_command` | string | `null` | Custom command instead of `claude` |

### Custom Allow Patterns

Add regex patterns to allow additional operations:

```toml
[auto_approve.rules]
allow_patterns = [
    "my-safe-tool",           # Match anywhere in the prompt
    "^Allow Bash: make ",     # Commands starting with make
]
```

### Filtering by Approval Type

Restrict auto-approve to specific approval types (applies to AI mode):

```toml
[auto_approve]
mode = "ai"
allowed_types = ["file_edit", "shell_command"]
```

Available types: `file_edit`, `file_create`, `file_delete`, `shell_command`, `mcp_tool`, `user_question`

## Safety

### Rule Engine

The rule engine only has **allow rules** — there are no deny rules. Operations that don't match any allow rule are passed to manual approval (Rules mode) or AI judgment (Hybrid mode). This fail-safe design ensures unknown operations always require explicit approval.

### AI Judge

The AI judge follows these rules:

**Approve** when all apply:
- Operation is read-only OR explicitly low-risk
- No file modification that could break the build or delete important data
- No privilege escalation (`sudo`, `chmod 777`, etc.)
- No network/data exfiltration risk

**Reject** when any apply:
- Destructive operations (`rm -rf`, `DROP TABLE`, force push, etc.)
- Writing to system files outside the project
- Network requests with sensitive data
- Privilege escalation attempts

**Uncertain** (fallback to manual):
- When the AI cannot confidently determine safety

## What Gets Skipped

The following are never sent to judgment:

| Reason | Description |
|--------|-------------|
| **Genuine user questions** | `AskUserQuestion` with custom choices (not standard Yes/No) |
| **Multi-select prompts** | Questions requiring multiple selections |
| **Auto-approve mode agents** | Agents already in `--dangerously-skip-permissions` mode |
| **Virtual agents** | Agents without a physical pane |
| **Not in allowed_types** | When `allowed_types` is configured and type doesn't match |

## Audit Logging

When `--audit` is enabled, each judgment is logged as an `AutoApproveJudgment` event. The `model` field distinguishes rule vs AI approvals:

```json
{
  "event": "AutoApproveJudgment",
  "pane_id": "main:0.1",
  "decision": "approve",
  "model": "rules:allow_read",
  "elapsed_ms": 0,
  "approval_sent": true
}
```

```json
{
  "event": "AutoApproveJudgment",
  "pane_id": "main:0.1",
  "decision": "approve",
  "model": "haiku",
  "elapsed_ms": 3200,
  "approval_sent": true
}
```

Query audit logs:

```bash
# All auto-approve judgments
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment")'

# Rule-based approvals only
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment" and (.model | startswith("rules:")))'

# AI approvals only
cat /tmp/tmai/audit/detection.ndjson | jq 'select(.event == "AutoApproveJudgment" and (.model | startswith("rules:") | not))'
```

## Troubleshooting

### Auto-approve not activating

1. Check `mode` setting (or legacy `enabled = true`)
2. For AI/Hybrid: verify `claude` CLI is installed (`which claude`)
3. For AI/Hybrid: verify authentication (`claude --version`)
4. Check logs with `--debug` flag

### Rules not matching expected commands

1. Verify the relevant allow setting is `true` (all are `true` by default)
2. Check `--audit` logs to see what operation/target was parsed
3. Add a custom `allow_patterns` regex for non-standard commands

### Agent stuck in "Judging" state

The `cooldown_secs` setting prevents re-evaluation too quickly. If an agent appears stuck:

1. Manually approve/reject from tmai (`y` key or Web UI)
2. The phase will clear when the agent transitions out of `AwaitingApproval`

## Example Setup

### Rules only (no AI, instant, free)

```toml
[auto_approve]
mode = "rules"
```

### Hybrid (recommended)

```toml
[auto_approve]
mode = "hybrid"
model = "haiku"
```

### AI only (most accurate, slower)

```toml
[auto_approve]
mode = "ai"
```

### Conservative rules (read-only)

```toml
[auto_approve]
mode = "rules"

[auto_approve.rules]
allow_tests = false
allow_fetch = false
allow_format_lint = false
```

### Legacy compatible

```toml
[auto_approve]
enabled = true   # Equivalent to mode = "ai"
```

## Next Steps

- [Configuration Reference](../reference/config.md) - Full config options
- [Exfil Detection](./exfil-detection.md) - Security monitoring
- [Web Remote Control](./web-remote.md) - Remote approval fallback
