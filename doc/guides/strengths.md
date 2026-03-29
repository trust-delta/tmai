# tmai's Strengths

What tmai excels at and features unique to tmai.

## 1. Unified WebUI Dashboard

tmai provides a full-featured WebUI for managing AI agents — no terminal switching needed.

- **Branch graph** — GitKraken-style lane-based commit visualization with PR/CI status
- **GitHub integration** — PR review status, CI checks, and issue tracking
- **Worktree management** — Create, delete, and manage worktrees visually
- **Interactive terminal** — Full xterm.js terminal with WebSocket I/O
- **Security scanning** — Detect configuration vulnerabilities
- **Usage tracking** — Monitor subscription token consumption

Launch with a single command: `tmai` — Chrome App Mode opens automatically.

## 2. Single-Pane Operation

Approve **without attaching** to agent panes — in both WebUI and TUI modes.

```
┌─────────────────────────────────────────────────────────────┐
│ Typical tools                                               │
│                                                             │
│  Monitor → Attach → Type y → Detach → Monitor               │
│           (3 steps per agent)                               │
│                                                             │
│  Problem: Can't see other agents while operating            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ tmai                                                        │
│                                                             │
│  Click approve (WebUI) or press y (TUI)                     │
│  (1 step)                                                   │
│                                                             │
│  Benefit: Respond immediately while seeing all agents       │
└─────────────────────────────────────────────────────────────┘
```

## 3. Full AskUserQuestion Support

Complete support for Claude Code's `AskUserQuestion` tool.

- Direct selection with number keys (1-9) or click (WebUI)
- Multi-select with Space key toggle (TUI) or checkboxes (WebUI)
- Free-text input via input bar

**Other tools**: Most only support y/n approval, no option selection.

## 4. Low Adoption Barrier

tmai can be adopted **without changing your existing workflow**.

- **WebUI (default)**: No tmux required. Just `tmai init && tmai`
- **TUI mode**: Add tmai alongside existing tmux setup
- **Hooks**: One-time `tmai init` — then use `claude` normally
- No changes to how you start or use AI agents

Start with "just monitoring" and adopt features gradually.

## 5. 3-Tier High-Precision Detection

tmai uses a 3-tier detection strategy for maximum accuracy:

| Priority | Method | Precision | Requirements |
|----------|--------|-----------|-------------|
| 1 | **HTTP Hooks** | Event-driven (highest) | `tmai init` + web server |
| 2 | **IPC Socket** | Real-time (high) | `tmai wrap` |
| 3 | **capture-pane** | Polling (moderate) | tmux only |

Automatic fallback ensures detection works regardless of setup.

Details: [Claude Code Hooks](../features/hooks.md) | [PTY Wrapping](../features/pty-wrapping.md)

## 6. AI-Delegated Git Operations

Delegate complex Git operations to AI agents from the branch graph:

- **AI Merge** — Spawn an agent with merge context and conflict resolution instructions
- **AI Create PR** — Agent creates a PR with correct base branch

The AI handles the operation autonomously while you monitor from the dashboard.

## 7. Security Monitoring

Two layers of security:

- **Security Panel** — Static analysis of Claude Code settings and MCP configs for vulnerabilities
- **Exfil Detection** — Runtime monitoring for external data transmission (PTY wrap mode)

Details: [Security Panel](../features/security-panel.md) | [Exfil Detection](../features/exfil-detection.md)

## 8. Mobile Remote Control

Operate via smartphone by scanning a QR code (TUI mode) or opening the URL on any device.

- Agent list with real-time updates
- Approval buttons
- AskUserQuestion selection
- Text input

Details: [Mobile Remote Control](../features/web-remote.md)

## 9. Agent Teams Visualization

Monitor Claude Code Agent Teams structure and task progress.

- View all teams and their members
- Track task status (pending, in progress, completed)
- Real-time updates via SSE

Details: [Agent Teams](../features/agent-teams.md)

## Summary

| Strength | Description |
|----------|-------------|
| WebUI dashboard | Full-featured web interface with branch graph, GitHub, worktrees |
| Single-pane operation | Operate immediately without attaching |
| AskUserQuestion | Direct option selection |
| Low adoption barrier | No workflow changes required |
| 3-tier detection | Hooks → IPC → capture-pane fallback |
| AI Git operations | Delegate merge and PR creation |
| Security | Config scanning + runtime exfil detection |
| Remote operation | Approve from smartphone |
| Agent Teams | Visualize team structure and task progress |
