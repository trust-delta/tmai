# Issue-Driven Orchestration

A workflow where a **main agent** (your interactive Claude Code session) orchestrates multiple sub-agents through GitHub Issues, worktrees, and PRs.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Main Agent (your interactive session)                       │
│                                                             │
│  1. Identify issues while using the product (dogfooding)    │
│  2. Create GitHub issues from the conversation              │
│  3. Dispatch: issue → worktree → sub-agent (parallel)       │
│  4. Continue working: more issues, research, planning       │
│  5. Review incoming PRs and merge                           │
│  6. Release when ready                                      │
└─────────────────────────────────────────────────────────────┘
```

## The Workflow

### Step 1: Main Agent Creates Issues

While working in your main Claude Code session, you notice bugs, improvements, or feature ideas. Create issues directly:

```
You: "The cursor overlay is misaligned when panes are small. Create an issue."
Main Agent: → gh issue create --title "fix: cursor overlay misalignment..."
```

The main agent stays in context — it knows the codebase, the architecture, and your intent. Issues it creates are high-quality because they include root cause analysis and proposed solutions.

### Step 2: Dispatch via tmai WebUI

In the tmai git panel:

1. Open the **Issues** tab
2. Select an issue
3. Click **Create & Launch Agent** (or future **Create & Resolve**)
4. tmai creates a worktree and starts a Claude Code agent

Repeat for multiple issues — agents work in parallel on isolated branches.

```
┌─ tmai WebUI ────────────────────────────────────────────────┐
│                                                             │
│  Issues                          Agents                     │
│  ┌─────────────────────────┐     ┌───────────────────────┐  │
│  │ #134 md panel root  🔄  │     │ Agent 1  Processing   │  │
│  │ #135 focus state    🔄  │     │ Agent 2  Processing   │  │
│  │ #136 usage auto     ○  │     │ Agent 3  Idle         │  │
│  │ #137 config audit   ○  │     │ Main     Processing   │  │
│  └─────────────────────────┘     └───────────────────────┘  │
│                                                             │
│  🔄 = worktree in progress    ○ = not started               │
└─────────────────────────────────────────────────────────────┘
```

### Step 3: Main Agent Continues Working

While sub-agents implement, the main agent is free to:

- Create more issues
- Research and investigate problems (e.g., Chrome DevTools MCP inspection)
- Plan architecture decisions
- Review and discuss with the user
- Handle Dependabot alerts, releases, documentation

### Step 4: Review & Merge

When PRs arrive:

```
You: "Check the open PRs and merge if they look good."
Main Agent:
  → gh pr list
  → Spawn parallel review agents for each PR
  → Report findings
  → gh pr merge (with your approval)
```

The main agent can review multiple PRs in parallel by delegating to sub-agents, then making the merge decision.

### Step 5: Cleanup & Release

After merging:

```
You: "Clean up worktrees and release."
Main Agent:
  → git worktree remove (merged branches)
  → Version bump, CHANGELOG update
  → Tag and push
```

## Real-World Example

A single afternoon session (2 hours) produced:

| Activity | Count |
|----------|-------|
| Issues created | 7 |
| PRs reviewed & merged | 5 |
| Conflict resolution + rebuild | 1 |
| Dependabot alerts resolved | 2 |
| Version released | 1 (v1.1.0) |

This throughput comes from three key properties:

1. **Parallelism** — Multiple agents implement while the main agent plans and reviews
2. **Context continuity** — The main agent holds the full picture across all work streams
3. **Fast feedback loop** — Dogfooding surfaces issues → immediate dispatch → quick resolution

## Tips

### Main Agent Best Practices

- **Stay on main branch** — The main agent orchestrates, it doesn't implement in worktrees
- **Create detailed issues** — Include root cause, proposed solution, and files to modify. Sub-agents work better with clear instructions
- **Batch PR reviews** — Review multiple PRs in parallel using sub-agents, then merge sequentially
- **Merge in dependency order** — If PRs touch overlapping files, merge the base one first, then rebase others

### Handling Conflicts

When PRs conflict after merging another:

1. Rebase the conflicting branch onto updated main
2. Resolve conflicts (usually just rebuild web assets)
3. Force push and wait for CI
4. Merge

### When Not to Dispatch

Some tasks are better kept in the main agent:

- Architecture decisions and design discussions
- Investigating production issues
- Tasks requiring Chrome DevTools or external tool interaction
- Release management
- Anything requiring user input mid-task

## Prerequisites

- tmai with WebUI running
- GitHub CLI (`gh`) authenticated
- Projects registered in tmai Settings
- Claude Code Hooks configured (`tmai init`)

## Next Steps

- [Parallel Development with Worktrees](./worktree-parallel.md) — Lower-level worktree setup
- [Multi-Agent Monitoring](./multi-agent.md) — Basic multi-agent monitoring
