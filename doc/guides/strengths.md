# tmai's Strengths

What tmai excels at and features unique to tmai.

## 1. Single-Pane Operation

tmai lets you approve **without attaching** to agent panes.

```
┌─────────────────────────────────────────────────────────────┐
│ Typical tools                                               │
│                                                             │
│  Monitor → Attach → Type y → Detach → Monitor               │
│           (3 steps)                                         │
│                                                             │
│  Problem: Can't see other agents while operating            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ tmai                                                        │
│                                                             │
│  Press y while monitoring                                   │
│  (1 step)                                                   │
│                                                             │
│  Benefit: Respond immediately while seeing all agents       │
└─────────────────────────────────────────────────────────────┘
```

**Impact**:
- Approve 3 agents: Other tools 9 operations → tmai 6 operations
- No context switching
- Full visibility even during emergencies

## 2. Full AskUserQuestion Support

Complete support for Claude Code's `AskUserQuestion` tool.

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Code question                                        │
│                                                             │
│  Which approach do you prefer?                              │
│                                                             │
│  1. Use async/await                                        │
│  2. Use callbacks                                          │
│  3. Use promises                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘

tmai operation: Just press "1"
```

- Direct selection with number keys (1-9)
- All keys support full-width input (IME on)
- Multi-select with Space key toggle

**Other tools**: Most only support y/n approval, no option selection

## 3. Low Adoption Barrier

tmai can be adopted **without changing your existing workflow**.

```
┌─────────────────────────────────────────────────────────────┐
│ Adopting other tools                                        │
│                                                             │
│  Previous method:                                           │
│    tmux → claude                                            │
│                                                             │
│  After tool adoption:                                       │
│    Tool-specific command to create session                  │
│    → Workflow change required                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Adopting tmai                                               │
│                                                             │
│  Previous method:                                           │
│    tmux → claude                                            │
│                                                             │
│  After tmai:                                                │
│    tmux → claude (unchanged)                                │
│    + tmai in another pane                                   │
│                                                             │
│  → No workflow change                                       │
└─────────────────────────────────────────────────────────────┘
```

**Impact**:
- Start with "just monitoring"
- Gradual team adoption possible
- Keep existing environment and scripts

## 4. Flexible Worktree Support

tmai "monitors" rather than "manages", so it doesn't force any workflow.

- Use worktrees or not - your choice
- Add/remove dynamically while running
- Proceed your own way

Details: [Parallel Development with Worktrees](../workflows/worktree-parallel.md)

## 5. High-Precision Detection via PTY Wrapping

Start with `tmai wrap claude` for direct I/O monitoring via PTY proxy.

```
┌─────────────────────────────────────────────────────────────┐
│ Traditional method (capture-pane)                           │
│                                                             │
│  tmux capture-pane → Parse screen text → Estimate state     │
│                                                             │
│  Problem: May miss state changes depending on timing        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PTY Wrapping                                                │
│                                                             │
│  Direct I/O monitoring → Real-time state detection          │
│                                                             │
│  Benefit: Never miss state transitions, more accurate       │
└─────────────────────────────────────────────────────────────┘
```

Details: [PTY Wrapping](../features/pty-wrapping.md)

## 6. Exfil Detection (Security)

Detect and log external data transmission by AI agents.

Detection targets:
- HTTP requests (curl, wget, etc.)
- File transfers (scp, rsync, etc.)
- Cloud CLIs (aws, gcloud, etc.)
- API keys, credential patterns

```
INFO  External transmission detected command="curl" pid=12345
WARN  Sensitive data in transmission command="curl" sensitive_type="API Key"
```

Details: [Exfil Detection](../features/exfil-detection.md)

## 7. Web Remote Control

Operate via smartphone by scanning a QR code.

- Agent list display
- y/n approval
- AskUserQuestion selection
- Text input

Approve from anywhere, even while away.

Details: [Web Remote Control](../features/web-remote.md)

## 8. Agent Teams Visualization

Monitor Claude Code Agent Teams structure and task progress.

- View all teams and their members
- Track task status (pending, in progress, completed)
- See which team member is working on what

```
┌─────────────────────────────────────────────────────────────┐
│ Team: my-project                                            │
│                                                             │
│  team-lead     [Processing]  Task: Implement auth module    │
│  researcher    [Idle]        Task: Write tests (completed)  │
│  tester        [Approval]    Task: Run integration tests    │
│                                                             │
│  Progress: ████████░░ 3/5 tasks                             │
└─────────────────────────────────────────────────────────────┘
```

Keys: `t` for task overlay, `T` for team overview.

Details: [Agent Teams](../features/agent-teams.md)

## Summary

| Strength | Description |
|----------|-------------|
| Single-pane operation | Operate immediately without attaching |
| AskUserQuestion | Direct option selection with number keys |
| Low adoption barrier | No changes to existing workflow |
| Flexibility | Use worktrees freely |
| High-precision detection | Real-time detection via PTY wrapping |
| Security | Exfil detection |
| Remote operation | Approve from smartphone |
| Agent Teams | Visualize team structure and task progress |
