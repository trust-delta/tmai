# Parallel Development with Worktrees

Workflow for multiple agents working in parallel on independent branches using Git worktrees.

## Overview

tmai is a "monitor-only" tool, so you're free to create worktrees however you like.
Create worktrees your way, start agents there, and tmai auto-detects them.

```
┌─────────────────────────────────────────────────────────────┐
│ Workflow                                                    │
│                                                             │
│  1. Create working directories with git worktree            │
│  2. Start claude there                                      │
│  3. tmai auto-detects and starts monitoring                 │
│  4. Add more while running - no problem                     │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### Create worktrees

```bash
# From your main repository
cd ~/myproject

# Create worktree for feature-a
git worktree add ../myproject-feature-a -b feature-a

# Create worktree for feature-b
git worktree add ../myproject-feature-b -b feature-b

# Create worktree for bugfix
git worktree add ../myproject-bugfix -b bugfix/issue-123
```

Result:

```
~/
├── myproject/              # main branch
├── myproject-feature-a/    # feature-a branch
├── myproject-feature-b/    # feature-b branch
└── myproject-bugfix/       # bugfix/issue-123 branch
```

### Start agents in each worktree

```bash
# Create tmux windows for each worktree
tmux new-window -n feature-a -c ~/myproject-feature-a
tmux new-window -n feature-b -c ~/myproject-feature-b
tmux new-window -n bugfix -c ~/myproject-bugfix

# Start claude in each window
# (navigate to each window and run)
claude
```

Or with PTY wrapping (recommended):

```bash
# In each window
tmai wrap claude
```

### Monitor with tmai

```bash
# Start tmai in another window
tmux new-window -n monitor
tmai
```

tmai automatically detects all agents.

## Add Dynamically

A key strength of tmai: **add while running**.

```bash
# New task arrived!
git worktree add ../myproject-hotfix -b hotfix/urgent

# Start claude in a new window
tmux new-window -n hotfix -c ~/myproject-hotfix
claude

# → tmai auto-detects and adds to monitoring
```

## Practical Example

```
┌─────────────────────────────────────────────────────────────┐
│ Directory structure                                         │
│                                                             │
│  ~/myproject/           (main)                              │
│  ~/myproject-feature-a/ (feature-a) ← Agent 1              │
│  ~/myproject-feature-b/ (feature-b) ← Agent 2              │
│  ~/myproject-bugfix/    (bugfix)    ← Agent 3              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ tmux                                                        │
│                                                             │
│  Window 1: ~/myproject-feature-a  claude                   │
│  Window 2: ~/myproject-feature-b  claude                   │
│  Window 3: ~/myproject-bugfix     claude                   │
│  Window 4: tmai                    ← Monitor all           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ tmai screen                                                 │
│                                                             │
│  ┌─ Agents ─────────────────┬─ Preview ─────────────────┐  │
│  │ ● feature-a [Approval]   │ Confirm file creation...   │  │
│  │   feature-b [Processing] │                            │  │
│  │   bugfix    [Idle]       │ [Yes] [No]                │  │
│  └──────────────────────────┴────────────────────────────┘  │
│                                                             │
│  → Each agent works on an independent branch                │
│  → No conflicts                                             │
│  → Just discard the branch if it fails                     │
└─────────────────────────────────────────────────────────────┘
```

## Cleanup

After completing work:

```bash
# Merge
cd ~/myproject
git merge feature-a

# Remove worktree
git worktree remove ../myproject-feature-a
```

## Benefits

| Aspect | Description |
|--------|-------------|
| Independence | Each agent on separate branch, no conflicts |
| Safety | Can discard entire branch if it fails |
| Flexibility | Add/remove dynamically while running |
| Simplicity | tmai doesn't force worktrees - use when you want |

## tmai's Philosophy

tmai "monitors" rather than "manages" worktrees.

- Create worktrees however you like
- Don't have to use them at all
- Add anytime if you do use them
- No changes to your existing workflow

## Next Steps

- [Multi-Agent Monitoring](./multi-agent.md) - Basic multi-agent monitoring
- [Best Practices](../guides/best-practices.md) - Recommended workflows
