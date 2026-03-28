# Branch Graph

Interactive Git commit graph with lane-based visualization, inspired by GitKraken.

<!-- screenshot: branch-graph.png -->

## Overview

The Branch Graph displays the full Git history of a registered project as a visual graph. Select a project in the sidebar to view it.

## Features

### Lane-Based Commit Graph

Each branch gets its own vertical lane with a unique color. The graph shows:

- **Commit dots** — Circles on each lane, larger for branch tips
- **Merge indicators** — Double circles for merge commits
- **Fork/merge lines** — Straight connection lines between lanes
- **Branch headers** — Branch name with commit count at the top of each lane

### Branch Hierarchy

Branches are organized by parent relationship:

- **Default branch** (main/master) — Always visible as the leftmost lane
- **Current branch** (HEAD) — Highlighted with a distinct indicator
- **Worktree branches** — Marked with worktree badge
- **Regular branches** — Sorted by recency
- **Inactive branches** — Branches without recent commits shown in a separate section

### Collapsible Commits

Intermediate commits on a lane can be collapsed to reduce visual clutter:

- Click the collapse toggle on a branch header to fold/unfold
- Fold indicators (ellipsis with dashed line) show where commits are hidden
- Click the fold indicator to expand hidden commits

### Remote Tracking

For branches with remote tracking:

- **Ahead count** — Commits not yet pushed
- **Behind count** — Commits not yet pulled
- **Push/pull indicators** — Visual markers showing sync status

### Depth Warning

When branch nesting gets too deep (many branches created from branches), a warning is displayed to encourage flattening the branch structure.

## GitHub Integration

PR and CI status are overlaid directly on the branch graph:

- **PR badges** — Show on branch tips with review status (approved, changes requested, draft)
- **CI check indicators** — Pass/fail/pending status from GitHub Actions
- **Linked issues** — Extracted from branch names and PR titles (e.g., `fix/issue-42` links to issue #42)

See [GitHub Integration](./github-integration.md) for details.

## Commit Details

Click any commit dot to view details:

- Full SHA hash
- Commit subject and body
- Branch name
- Merge commit flag

Click again or press Escape to close.

## Pagination

The graph loads a limited number of commits by default. Click "Load more" to fetch additional history.

## Actions

Selecting a branch in the graph opens the Action Panel on the right side with:

- **View Diff** — Show changes vs base branch
- **Launch Agent** — Spawn an AI agent in the branch's worktree
- **Create Worktree** — Create a new worktree from this branch
- **Delete Branch/Worktree** — With confirmation dialog
- **AI Merge** — Delegate merge operation to an AI agent
- **AI Create PR** — Delegate PR creation to an AI agent
- **Checkout** — Switch to this branch
- **CI Checks** — Expandable list of GitHub Actions check results

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/git/branches` | List branches with parent relationships |
| GET | `/api/git/graph` | Get commit graph layout data |
| GET | `/api/git/log` | Get commit log for a branch |
| POST | `/api/git/fetch` | Fetch from remote |
| GET | `/api/github/prs` | Get PR info for branches |
| GET | `/api/github/checks` | Get CI check status |
| GET | `/api/github/issues` | Get linked issues |

## Related Documentation

- [GitHub Integration](./github-integration.md) — PR, CI, and issue details
- [Worktree Management](./worktree-ui.md) — Creating and managing worktrees
- [WebUI Overview](./webui-overview.md) — Dashboard layout
