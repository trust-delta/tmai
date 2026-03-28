# Best Practices

Recommended ways to use tmai effectively.

## Getting Started

### Set Up Claude Code Hooks (One-Time)

Run `tmai init` once to enable HTTP hooks for event-driven state detection:

```bash
# One-time setup
tmai init
```

After this, all Claude Code sessions automatically send events to tmai. No wrapper needed.

### Use PTY Wrapping When Needed

Add PTY wrapping for exfil detection or full AskUserQuestion parsing:

```bash
# When you need extra features
tmai wrap claude

# Hooks + PTY wrapping work together (hooks take priority for status)
```

## WebUI Tips

### Register Your Projects

Register project directories to unlock branch graph, GitHub integration, and worktree management:

1. Click the settings button (⚙) in the status bar
2. Add project paths
3. Select projects in the sidebar to view the branch graph

### Leverage the Branch Graph

The branch graph provides a visual overview of all branches, PRs, and CI status:

- Click branches to see diff summary and actions
- Use "AI Merge" or "AI Create PR" to delegate operations
- Check CI status directly on branch tips

### Run Security Scans

Periodically scan your Claude Code configuration for vulnerabilities:

1. Click the security button (🛡) in the status bar
2. Review findings by severity
3. Address Critical and High severity issues promptly

### Monitor Usage

Keep an eye on subscription usage to avoid rate limits:

- The Usage Panel at the bottom of the sidebar shows meter status
- Color changes from cyan to amber (50%) to red (80%)
- Click refresh to fetch latest data

### Use Inter-Agent Messaging

When agents need to coordinate, use the "Send To" feature to pass context between them without manual copy-paste.

## TUI Tips (`--tmux` mode)

### Keep tmai in a Dedicated Pane

```
┌───────────────────────┬───────────────────────┐
│                       │                       │
│      Agent pane       │      tmai pane        │
│                       │                       │
└───────────────────────┴───────────────────────┘
```

### Use View Modes Appropriately

| Mode | Best For |
|------|----------|
| Split | Monitoring 1-3 agents with preview |
| List | Monitoring many agents at once |
| Preview | Focusing on single agent output |

Toggle with `Tab`.

## Multi-Agent Tips

### Naming Convention (tmux mode)

Use descriptive session/window names:

```bash
# Clear naming
tmux new-session -s project-a
tmux new-window -n feature-auth
# Agent shows as: project-a:feature-auth
```

### Worktree Workflow

In the WebUI, create and manage worktrees visually from the branch graph. In tmux mode:

```bash
git worktree add ../project-feature-a feature/a
cd ../project-feature-a
tmai wrap claude
```

## Agent Teams Tips

### Monitor Team Progress

- **WebUI**: Team data appears in the sidebar with real-time updates
- **TUI**: Press `T` to see all teams, `t` for task overlay

### Configure Scan Interval

```toml
[teams]
scan_interval = 2  # Faster updates (default: 5)
```

## Security Tips

### Enable Audit Logging

```bash
tmai --audit
```

Review audit data:

```bash
tmai audit stats
tmai audit misdetections
```

### Limit Web Server Exposure

- Use on trusted networks
- Don't share the token URL publicly
- Use token-based authentication (automatic)

## Troubleshooting

### Agent Not Detected

1. Verify `tmai init` was run (for Claude Code hooks)
2. In tmux mode, check if agent is in a tmux pane
3. Verify process name matches supported agents
4. Check logs with `tmai --debug`

### Wrong State Detected

1. Run `tmai init` to enable hooks (recommended for Claude Code)
2. Use PTY wrapping for additional accuracy (`tmai wrap claude`)
3. Check detection source: `◈ Hook` > `⊙ IPC` > `● capture`

### Web Server Not Accessible

1. Check `[web] enabled = true` in config
2. Verify firewall allows the port (default 9876)
3. For WSL, check networking mode and port forwarding

## Next Steps

- [tmai's Strengths](./strengths.md) - What makes tmai unique
- [Multi-Agent Monitoring](../workflows/multi-agent.md) - Managing multiple agents
