# Configuration Reference

Complete configuration options for tmai.

## Config File Location

```
~/.config/tmai/config.toml
```

If the file doesn't exist, tmai uses default values.

## Full Example

```toml
[web]
enabled = true
port = 9876

[exfil_detection]
enabled = true
additional_commands = ["custom-upload", "my-sync"]

[teams]
enabled = true
scan_interval = 5

[auto_approve]
enabled = true
model = "haiku"
```

## Sections

### [web]

Web Remote Control settings.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | `true` | Enable/disable web server |
| `port` | integer | `9876` | HTTP server port |

#### Examples

Disable web server:

```toml
[web]
enabled = false
```

Use different port:

```toml
[web]
port = 8080
```

### [exfil_detection]

External transmission detection settings (PTY wrap mode only).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | `true` | Enable/disable exfil detection |
| `additional_commands` | string[] | `[]` | Additional commands to detect |

#### Examples

Disable exfil detection:

```toml
[exfil_detection]
enabled = false
```

Add custom commands:

```toml
[exfil_detection]
additional_commands = ["custom-upload", "internal-sync", "deploy-tool"]
```

### [teams]

Agent Teams integration settings (experimental).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | `true` | Enable/disable team scanning |
| `scan_interval` | integer | `5` | Scan interval in polling cycles (~2.5 seconds at default poll rate) |

#### Examples

Disable team scanning:

```toml
[teams]
enabled = false
```

Increase scan frequency:

```toml
[teams]
scan_interval = 2
```

### [auto_approve]

AI-powered automatic approval of safe agent actions. Requires the `claude` CLI.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | `false` | Enable/disable auto-approve |
| `provider` | string | `"claude_haiku"` | Judgment provider |
| `model` | string | `"haiku"` | Model passed to `claude --model` |
| `timeout_secs` | integer | `30` | Timeout for each judgment in seconds |
| `cooldown_secs` | integer | `10` | Cooldown before re-evaluating the same agent |
| `check_interval_ms` | integer | `1000` | Interval between candidate scans in ms |
| `max_concurrent` | integer | `3` | Maximum parallel judgments |
| `allowed_types` | string[] | `[]` | Approval types to auto-approve (empty = all except genuine user questions) |
| `custom_command` | string | `null` | Custom command instead of `claude` |

#### Examples

Enable with defaults:

```toml
[auto_approve]
enabled = true
```

Only auto-approve file operations:

```toml
[auto_approve]
enabled = true
allowed_types = ["file_edit", "file_create"]
```

For detailed usage, see [Auto-Approve](../features/auto-approve.md).

## Environment Variables

### RUST_LOG

Control log verbosity:

```bash
# Show info and above
RUST_LOG=info tmai

# Show debug messages
RUST_LOG=debug tmai

# Show only warnings
RUST_LOG=warn tmai
```

### TMAI_CONFIG

Override config file location:

```bash
TMAI_CONFIG=/path/to/config.toml tmai
```

## Command Line Options

| Option | Description |
|--------|-------------|
| `--debug` | Enable debug mode (verbose logging) |
| `--version` | Show version |
| `--help` | Show help |

### Subcommands

| Command | Description |
|---------|-------------|
| `tmai` | Start TUI monitor |
| `tmai wrap <command>` | Start agent with PTY wrapping |

#### wrap Examples

```bash
# Basic
tmai wrap claude

# With arguments (quote the full command)
tmai wrap "claude --dangerously-skip-permissions"

# Other agents
tmai wrap codex
tmai wrap gemini
```

## Default Values Summary

| Setting | Default |
|---------|---------|
| `web.enabled` | `true` |
| `web.port` | `9876` |
| `exfil_detection.enabled` | `true` |
| `exfil_detection.additional_commands` | `[]` |
| `teams.enabled` | `true` |
| `teams.scan_interval` | `5` |
| `auto_approve.enabled` | `false` |
| `auto_approve.model` | `"haiku"` |
| `auto_approve.timeout_secs` | `30` |
| `auto_approve.cooldown_secs` | `10` |
| `auto_approve.check_interval_ms` | `1000` |
| `auto_approve.max_concurrent` | `3` |
| `auto_approve.allowed_types` | `[]` |

## Config File Format

tmai uses TOML format. Basic syntax:

```toml
# Comment
[section]
key = "string value"
number = 123
boolean = true
list = ["item1", "item2"]
```

## Reloading Config

Config is read at startup. To apply changes, restart tmai.

## Troubleshooting

### Config Not Applied

1. Check file location: `~/.config/tmai/config.toml`
2. Verify TOML syntax (no trailing commas, proper quoting)
3. Restart tmai after changes

### Permission Errors

Ensure config file is readable:

```bash
chmod 644 ~/.config/tmai/config.toml
```

## Next Steps

- [Web API Reference](./web-api.md) - REST API documentation
- [Keybindings Reference](./keybindings.md) - Keyboard shortcuts
