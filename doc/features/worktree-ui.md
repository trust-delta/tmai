# Worktree Management

Create, manage, and operate Git worktrees directly from the WebUI.

## Overview

Git worktrees allow multiple branches to be checked out simultaneously in separate directories. tmai provides a visual interface for managing worktrees and launching AI agents in them.

## Creating a Worktree

1. Select a project in the sidebar to open the Branch Graph
2. Click a branch to select it
3. In the Action Panel, click **Create Worktree**
4. Enter a name (alphanumeric, `-`, `_` only, max 64 characters)
5. The worktree is created under `.claude/worktrees/<name>/`

<!-- screenshot: worktree-create.png -->

Alternatively, create worktrees from a specific base branch by selecting a branch first.

## Worktree Panel

Click a worktree in the Branch Graph or sidebar to open the detail panel:

<!-- screenshot: worktree-panel.png -->

### Information Displayed

- **Branch name** — Current branch of the worktree
- **Dirty indicator** — Shows `*` if there are uncommitted changes
- **Agent status** — Whether an AI agent is running in this worktree
- **Repository name** — Parent repository path
- **Diff stats** — Insertions, deletions, and files changed vs base branch

### Actions

| Action | Description |
|--------|-------------|
| **Launch Agent** | Spawn an AI agent (Claude Code) in this worktree |
| **Create & Resolve** | Create a worktree from an issue and launch an agent with the resolve prompt (reads issue details via `gh`, implements, and creates a PR) |
| **Delete** | Remove the worktree (supports both `.claude/worktrees/` and `.git/.claude/worktrees/` paths) |
| **Refresh Diff** | Reload the diff against the base branch |
| **View Diff** | Show the full diff with DiffViewer |

## Git Operations

The Action Panel provides branch management operations:

| Operation | Description |
|-----------|-------------|
| **Checkout** | Switch the main repo to this branch |
| **Create Branch** | Create a new branch from the selected branch |
| **Delete Branch** | Delete a branch (with confirmation) |
| **Fetch** | Fetch from remote |
| **Pull** | Pull latest changes |
| **AI Merge** | Delegate merge to an AI agent with context |
| **AI Create PR** | Delegate PR creation to an AI agent |

### AI-Delegated Operations

**AI Merge** and **AI Create PR** spawn a new AI agent with a pre-built prompt containing:

- Source and target branch names
- Correct base branch for PR
- Conflict resolution instructions (for merge)

The AI agent handles the operation autonomously, including conflict resolution.

## Diff Viewer

View changes between a worktree and its base branch:

- File-level diff with insertions (green) and deletions (red)
- Summary showing total files changed, insertions, and deletions
- Click "View Diff" in the Action Panel or Worktree Panel

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/worktrees` | List all worktrees |
| POST | `/api/worktrees` | Create a worktree |
| POST | `/api/worktrees/delete` | Delete a worktree |
| POST | `/api/worktrees/launch` | Launch agent in worktree |
| POST | `/api/worktrees/diff` | Get diff vs base branch |
| POST | `/api/git/branches/create` | Create a new branch |
| POST | `/api/git/branches/delete` | Delete a branch |
| POST | `/api/git/checkout` | Checkout a branch |
| POST | `/api/git/fetch` | Fetch from remote |
| POST | `/api/git/pull` | Pull from remote |
| POST | `/api/git/merge` | Merge a branch |

## Related Documentation

- [Branch Graph](./branch-graph.md) — Visual branch navigation
- [Parallel Development with Worktrees](../workflows/worktree-parallel.md) — Workflow guide
- [Agent Spawn](./agent-spawn.md) — Launching agents
