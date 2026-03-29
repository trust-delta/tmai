# TUI Mode

tmai includes a ratatui-based terminal UI for tmux power users. While the default mode is WebUI, the TUI remains a fully supported interface — especially useful for users who prefer staying in the terminal.

## Launch

```bash
# Requires tmux — run inside a tmux pane
tmai --tmux
```

> **Note**: Since v0.20, the default mode is WebUI. The TUI is available via the `--tmux` flag.

## When to Use TUI

- You already work in tmux and want to stay in the terminal
- SSH sessions where a browser is unavailable
- Lightweight monitoring without the overhead of a browser window
- You prefer keyboard-driven workflows over mouse interaction

## Layout

```
┌─────────────────┬─────────────────────────────────┐
│ Sessions        │ Preview                         │
│                 │                                 │
│ [◈Hook] main:0  │ Do you want to make this edit?  │
│   Claude Code   │                                 │
│   ⠋ Processing  │ ❯ 1. Yes                        │
│                 │   2. Yes, allow all...          │
│ [IPC] main:0.1  │   3. No                         │
│   Claude Code   │                                 │
│   ✳ Idle        │                                 │
└─────────────────┴─────────────────────────────────┘
 j/k:Nav 1-9:Select i:Input →:Direct ?:Help q:Quit
```

- **Left panel**: Agent list with detection source icons and status
- **Right panel**: Live preview of the selected agent's terminal output (ANSI color supported)
- **Status bar**: Keyboard shortcut hints

## Modes

### Normal Mode

Navigate agents and perform quick actions:

| Key | Action |
|-----|--------|
| `j` / `k`, `↓` / `↑` | Select agent |
| `y` | Approve / Yes |
| `n` | No (UserQuestion only) |
| `1-9` | Select option by number |
| `Space` | Toggle multi-select |
| `f` | Focus pane |
| `x` | Kill pane (with confirmation) |
| `?` | Help |
| `q` / `Esc` | Quit |

### Input Mode (`i`)

Type text and send it to the selected agent on Enter.

### Passthrough Mode (`p` / `→`)

All key events are forwarded directly to the agent's tmux pane. Useful for interactive editing or scrolling within the agent. Press `Esc` to exit.

## View Options

| Key | Action |
|-----|--------|
| `Tab` | Cycle view mode (Split / List / Preview) |
| `l` | Toggle split direction (Horizontal / Vertical) |
| `Ctrl+d` / `Ctrl+u` | Scroll preview |

## Additional Features

| Key | Action |
|-----|--------|
| `t` | Task overlay (when a team member is selected) |
| `T` | Team overview |
| `r` | QR code for mobile remote |
| `W` | Restart agent as IPC-wrapped |
| `R` | Launch Fresh Session Review |
| `U` | Fetch usage (Claude Max/Pro) |

## Configuration

TUI-specific options in `~/.config/tmai/config.toml`:

```toml
[ui]
show_preview = true        # Show preview panel
preview_height = 40        # Preview height (percentage)
color = true               # Enable colors
line_wrap = true           # Wrap long lines in preview
```

All core features (hooks, auto-approve, teams, PTY wrapping) work identically in both TUI and WebUI modes.

## Future Plans

The TUI will continue to be maintained alongside the WebUI. Future terminal multiplexer support (WezTerm, etc.) will expand TUI's reach beyond tmux.

## See Also

- [Keybindings Reference](../reference/keybindings.md) - Complete keybinding list
- [WebUI Overview](./webui-overview.md) - Default WebUI mode
- [Configuration](../reference/config.md) - Full configuration reference
