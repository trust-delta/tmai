# Issue-Driven Orchestration

A workflow where an **orchestrator agent** (a Claude Code session using tmai MCP tools) autonomously manages sub-agents through GitHub Issues, worktrees, and PRs.

## Overview

The orchestrator is a Claude Code agent that uses tmai's MCP tools to drive a full development cycle — from issue triage to PR merge — without manual WebUI interaction.

```
┌─────────────────────────────────────────────────────────────┐
│ Orchestrator Agent (MCP-driven)                             │
│                                                             │
│  1. list_issues        → Identify work to dispatch          │
│  2. dispatch_issue     → Worktree + agent (one-shot)        │
│  3. list_agents        → Monitor sub-agent progress         │
│  4. get_ci_status      → Check CI results                   │
│  5. send_prompt        → Instruct agent to fix failures     │
│  6. gh pr merge        → Merge passing PRs                  │
│  7. delete_worktree    → Clean up after merge               │
│  8. Loop               → Next issue or next cycle           │
└─────────────────────────────────────────────────────────────┘
```

Think of tmai as **"Kubernetes for AI dev tools"** — an IDE-independent, multi-vendor orchestration layer that coordinates autonomous coding agents.

## The Orchestrator Loop

### Step 1: Identify Issues

The orchestrator lists open issues and decides what to dispatch:

```
Orchestrator: list_issues
  → #270 feat: add retry logic to MCP reconnect
  → #271 fix: branch graph label overlap
  → #272 docs: update orchestration docs
  → #273 fix: worktree cleanup race condition
```

The user can also create issues in conversation:

```
You: "The cursor overlay is misaligned when panes are small. Create an issue."
Orchestrator: → gh issue create --title "fix: cursor overlay misalignment..."
```

### Step 2: Dispatch Issues to Sub-Agents

Use `dispatch_issue` — a one-shot tool that fetches the issue, creates a worktree, and spawns an agent with the issue context:

```
Orchestrator:
  dispatch_issue(issue_number: 270)  → Agent spawned in .claude/worktrees/270-feat-retry-logic/
  dispatch_issue(issue_number: 271)  → Agent spawned in .claude/worktrees/271-fix-branch-label/
  dispatch_issue(issue_number: 272)  → Agent spawned in .claude/worktrees/272-docs-orchestration/
  dispatch_issue(issue_number: 273)  → Agent spawned in .claude/worktrees/273-fix-worktree-race/
```

Each sub-agent works in an isolated branch — no conflicts between agents.

### Step 3: Monitor Progress

The orchestrator tracks sub-agent status and CI results:

```
Orchestrator: list_agents
  → Agent 270  Processing (feat: retry logic)
  → Agent 271  Idle (fix: branch label) — likely done
  → Agent 272  Processing (docs: orchestration)
  → Agent 273  Processing (fix: worktree race)

Orchestrator: get_ci_status(branch: "271-fix-branch-label-overlap")
  → ✅ All checks passed

Orchestrator: get_ci_status(branch: "270-feat-retry-logic")
  → ❌ test_reconnect_timeout failed
```

### Step 4: Handle CI Failures

When CI fails, the orchestrator can instruct the sub-agent to fix it:

```
Orchestrator: get_ci_failure_log(branch: "270-feat-retry-logic")
  → test_reconnect_timeout: assertion failed, expected 3 retries got 0

Orchestrator: send_prompt(id: "agent-270", prompt: "CI failed: test_reconnect_timeout expects 3 retries. Fix the test or implementation.")
  → Prompt queued (agent is Processing, will receive when idle)
```

If the failure is environmental (timeout, flaky test), rerun CI directly:

```
Orchestrator: rerun_ci(branch: "270-feat-retry-logic")
  → CI rerun triggered
```

### Step 5: Merge & Cleanup

When PRs pass CI and look good:

```
Orchestrator:
  → gh pr merge 275 --squash    (PR for issue #271)
  → delete_worktree(worktree_name: "271-fix-branch-label-overlap")
  → gh pr merge 276 --squash    (PR for issue #270)
  → delete_worktree(worktree_name: "270-feat-retry-logic")
```

Merge in dependency order — if PRs touch overlapping files, merge the base one first.

### Step 6: Continue the Loop

The orchestrator can:

- Dispatch more issues from the backlog
- Create new issues discovered during the session
- Handle Dependabot alerts, releases, documentation
- Research and plan architecture decisions

## Orchestrator Configuration

Configure the orchestrator in `~/.config/tmai/config.toml`:

```toml
[orchestrator]
enabled = true
role = "You are an orchestrator agent managing a team of AI coding agents..."

[orchestrator.rules]
branch = "Create feature branches from main"
merge = "Squash merge all PRs"
review = "Check CI passes before merging"
custom = "Run cargo fmt and cargo clippy before committing"

[orchestrator.notify]
on_idle = true           # Notify when sub-agent becomes idle
on_ci = true             # Notify on CI status changes
on_pr_comment = true     # Notify on PR review comments
on_pr_created = true     # Notify when PR is created

pr_monitor_enabled = true
pr_monitor_interval_secs = 60
```

Per-project overrides are supported via `[[projects]]`:

```toml
[[projects]]
path = "/home/user/myproject"

[projects.orchestrator]
enabled = true
rules.custom = "This project uses npm, not cargo"
```

## Orchestrator-to-Agent Communication

### `send_prompt` — One-Way Instruction

The orchestrator can send instructions to sub-agents via `send_prompt`:

```
send_prompt(id: "agent-270", prompt: "CI failed on test_foo. Please fix.")
```

**Behavior by agent status:**

| Agent Status | Behavior |
|-------------|----------|
| Idle | Sent immediately (agent starts working) |
| Processing | Queued (delivered when agent becomes idle) |
| AwaitingApproval | Queued (delivered after approval completes) |
| Offline | Sent immediately (attempts restart) |

**Limitations:**
- One-way only — the orchestrator cannot read the sub-agent's response directly
- Use `get_agent_output` or `get_transcript` to check what the agent did
- Queue limit: 5 prompts per agent (oldest are dropped if exceeded)

## Recovery Flow

If the orchestrator agent is accidentally killed (e.g., terminal closed):

```bash
# 1. Restart Claude Code
claude

# 2. Resume the previous session
/resume

# 3. Re-register as orchestrator (MCP tool)
set_orchestrator(id: "your-agent-id")
```

The `set_orchestrator` tool marks the resumed agent as the orchestrator, re-enabling notifications from sub-agents. Any previous orchestrator for the same project is automatically demoted.

## Real-World Example

A dogfooding session (2026-04-05) demonstrated the full cycle:

| Activity | Details |
|----------|---------|
| Issues dispatched | 4 (in parallel to worktree agents) |
| CI failure detected | 1 (timeout, not code issue) |
| Recovery action | `send_prompt` → agent diagnosed timeout → `rerun_ci` |
| PRs merged | 4 (all via orchestrator) |
| Worktrees cleaned | 4 (via `delete_worktree`) |
| Orchestrator recovery | kill → `/resume` → `set_orchestrator` |

Key observations:

1. **Parallelism** — 4 agents implementing simultaneously while orchestrator monitors
2. **Autonomous failure handling** — Agent diagnosed CI timeout as environmental, not a code bug
3. **Full lifecycle** — Issue → worktree → agent → PR → CI → merge → cleanup, all via MCP tools
4. **Resilient** — Orchestrator recovered from accidental kill without losing sub-agent state

## Tips

### Orchestrator Best Practices

- **Stay on main branch** — The orchestrator coordinates, it doesn't implement in worktrees
- **Use `dispatch_issue`** — One-shot dispatch is simpler and more reliable than manual `spawn_worktree` + prompt composition
- **Batch CI checks** — Use `list_prs` to see all PR statuses at once, then act on failures
- **Merge in dependency order** — If PRs touch overlapping files, merge the base one first, then rebase others
- **Create detailed issues** — Include root cause, proposed solution, and files to modify. Sub-agents work better with clear instructions
- **Use `additional_instructions`** — Pass extra context to `dispatch_issue` when the issue body alone isn't enough

### When Not to Dispatch

Some tasks are better kept in the orchestrator:

- Architecture decisions and design discussions
- Investigating production issues
- Tasks requiring external tool interaction (Chrome DevTools, etc.)
- Release management
- Anything requiring user input mid-task

### Handling Conflicts

When PRs conflict after merging another:

1. Use `send_prompt` to instruct the agent to rebase
2. Or: merge the conflicting PR manually after resolving
3. Force push and wait for CI
4. Merge

## Prerequisites

- tmai running (`tmai init && tmai`)
- GitHub CLI (`gh`) authenticated
- Projects registered in tmai Settings
- Claude Code Hooks configured (`tmai init`)
- `[orchestrator]` config in `~/.config/tmai/config.toml` (optional but recommended)

## Next Steps

- [MCP Server](../features/mcp-server.md) — Full list of available MCP tools
- [Parallel Development with Worktrees](./worktree-parallel.md) — Lower-level worktree setup
- [Multi-Agent Monitoring](./multi-agent.md) — Dashboard monitoring and operations
