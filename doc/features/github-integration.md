# GitHub Integration

Monitor pull requests, CI checks, and issues directly in the tmai dashboard.

## Requirements

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated
- Project registered in tmai (via Settings panel)

## Pull Requests

PR status is displayed on branch tips in the Branch Graph:

<!-- screenshot: github-prs.png -->

### PR Badges

Each branch with an open PR shows:

- **Title** — PR title
- **Status** — Draft, open, merged, or closed
- **Review decision** — Approved, changes requested, or review required
- **Review count** — Number of reviews submitted
- **Comment count** — Number of PR comments

### Review Status Colors

| Status | Color |
|--------|-------|
| Approved | Green |
| Changes Requested | Red |
| Review Required | Yellow |
| Draft | Gray |

## CI Checks

CI/CD pipeline status from GitHub Actions:

<!-- screenshot: github-checks.png -->

### Check Display

Select a branch in the Branch Graph and expand the CI Checks section in the Action Panel:

- **Rollup status** — Overall pass/fail/pending
- **Individual checks** — Each workflow run with name and status
- **Status icons** — Pass (✓), fail (✗), pending (◌), skipped (⊘)

### Check Statuses

| Status | Description |
|--------|-------------|
| `success` | Check passed |
| `failure` | Check failed |
| `pending` | Check in progress |
| `neutral` | No conclusion |
| `skipped` | Check skipped |

## Issues

Issues are linked to branches automatically:

### Automatic Linking

tmai extracts issue numbers from:

- **Branch names** — `fix/issue-42`, `feat/gh-123`, `42-fix-bug`
- **PR titles** — `Fix #42: resolve timeout`

Linked issues display:

- Issue number and title
- Labels with colors
- Open/closed state

## Caching

GitHub data is cached with a 30-second TTL to minimize API calls:

- PR list is cached per repository
- Issue list is cached per repository
- CI checks are fetched on-demand when expanding the checks section

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/github/prs` | List open PRs (query: `repo`) |
| GET | `/api/github/checks` | List CI checks (query: `repo`, `branch`) |
| GET | `/api/github/issues` | List issues (query: `repo`) |

## Related Documentation

- [Branch Graph](./branch-graph.md) — Where GitHub data is displayed
- [Worktree Management](./worktree-ui.md) — Create worktrees and PRs
- [Web API Reference](../reference/web-api.md) — Full API documentation
