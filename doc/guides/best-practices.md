# Best Practices

Recommended ways to use tmai effectively.

## Workflow Tips

### Use PTY Wrapping for New Sessions

Always start new AI agents with PTY wrapping when possible:

```bash
# Recommended
tmai wrap claude

# Instead of
claude  # then monitor with capture-pane
```

Benefits:
- More accurate state detection
- Exfil detection enabled
- Faster response to state changes

### Keep tmai in a Dedicated Pane

Create a consistent layout:

```
┌───────────────────────┬───────────────────────┐
│                       │                       │
│      Agent pane       │      tmai pane        │
│                       │                       │
│                       │                       │
└───────────────────────┴───────────────────────┘
```

Or use a smaller tmai pane:

```
┌───────────────────────────────────────────────┐
│                                               │
│                Agent pane                     │
│                                               │
├───────────────────────────────────────────────┤
│  tmai (List view)                             │
└───────────────────────────────────────────────┘
```

### Use View Modes Appropriately

| Mode | Best For |
|------|----------|
| Split | Monitoring 1-3 agents with preview |
| List | Monitoring many agents at once |
| Preview | Focusing on single agent output |

Toggle with `Tab`.

### Monitor Session vs Window vs All

> **Note**: Monitor scope (`m`) is currently disabled while Agent Teams integration is active. Scope is fixed to AllSessions.

| Scope | Use Case |
|-------|----------|
| All | Overview of all agents |
| Session | Focus on current project |
| Window | Focus on specific task |

## Multi-Agent Tips

### Naming Convention

Use descriptive session/window names:

```bash
# Clear naming
tmux new-session -s project-a
tmux new-window -n feature-auth

# Agent will show as: project-a:feature-auth
```

### Worktree Workflow

When using Git worktrees:

```bash
# Create worktree
git worktree add ../project-feature-a feature/a

# Start agent in worktree
cd ../project-feature-a
tmux new-session -s feature-a
tmai wrap claude
```

tmai monitors the existing session—no special commands needed.

## Agent Teams Tips

### Monitor Team Progress

When using Claude Code Agent Teams, use the team overview (`T`) to see all teams and their task progress at a glance.

### Use Task Overlay for Details

Select a team member in the agent list and press `t` to see their team's task list with status indicators.

### Configure Scan Interval

If team data updates too frequently or not often enough:

```toml
[teams]
scan_interval = 2  # Faster updates (default: 5)
```

## Security Tips

### Enable Debug Logging for Audits

When running sensitive tasks:

```bash
tmai --debug 2>&1 | tee ~/tmai-audit.log
```

This captures exfil detection logs.

### Review Exfil Logs Periodically

Check for unexpected external transmissions:

```bash
grep "External transmission" ~/tmai-audit.log
grep "Sensitive data" ~/tmai-audit.log
```

### Limit Web Remote Exposure

- Only enable when needed
- Use on trusted networks
- Don't share the QR code/URL publicly

## Performance Tips

### Reduce Polling Frequency for Many Agents

If monitoring many agents causes lag, consider:

1. Using session/window scope to limit monitored panes
2. Running agents in batches

### Use List View for Overview

Split view with preview uses more resources. Switch to List view when just checking status.

## Troubleshooting

### Agent Not Detected

1. Check if agent is in a tmux pane
2. Verify process name matches supported agents
3. Try restarting tmai

### Wrong State Detected

1. Use PTY wrapping for better accuracy
2. Check detection source (PTY vs CAP in status bar)
3. Report persistent issues with reproduction steps

### Web Remote Not Connecting

1. Check `[web] enabled = true` in config
2. Verify firewall allows the port
3. For WSL, check networking mode and port forwarding

### High CPU Usage

1. Reduce number of monitored panes
2. Use session/window scope
3. Switch to List view

## Anti-Patterns

### Don't

- Run tmai in the same pane as an agent
- Share Web Remote URLs on public networks
- Ignore exfil detection warnings
- Use passthrough mode for extended periods

### Do

- Keep tmai in a dedicated monitoring pane
- Review agent activity periodically
- Use appropriate view modes
- Check logs when something seems off

## Next Steps

- [tmai's Strengths](./strengths.md) - What makes tmai unique
- [Multi-Agent Monitoring](../workflows/multi-agent.md) - Managing multiple agents
