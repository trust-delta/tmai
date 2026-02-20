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
mode = "hybrid"
model = "haiku"

[auto_approve.rules]
allow_read = true
allow_tests = true
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

Automatic approval of safe agent actions. Supports 4 modes: Off, Rules, AI, Hybrid.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | string | — | Operating mode: `"off"`, `"rules"`, `"ai"`, `"hybrid"` |
| `enabled` | bool | `false` | Legacy toggle (`mode` takes precedence) |
| `model` | string | `"haiku"` | Model passed to `claude --model` (AI/Hybrid modes) |
| `timeout_secs` | integer | `30` | Timeout for each AI judgment in seconds |
| `cooldown_secs` | integer | `10` | Cooldown before re-evaluating the same agent |
| `check_interval_ms` | integer | `1000` | Interval between candidate scans in ms |
| `max_concurrent` | integer | `3` | Maximum parallel AI judgments |
| `allowed_types` | string[] | `[]` | Approval types to auto-approve (empty = all except genuine user questions) |
| `custom_command` | string | `null` | Custom command instead of `claude` |

### [auto_approve.rules]

Rule engine settings for Rules and Hybrid modes.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `allow_read` | bool | `true` | Auto-approve Read tool and read-only shell commands |
| `allow_tests` | bool | `true` | Auto-approve test execution |
| `allow_fetch` | bool | `true` | Auto-approve WebFetch, WebSearch, curl GET |
| `allow_git_readonly` | bool | `true` | Auto-approve read-only git commands |
| `allow_format_lint` | bool | `true` | Auto-approve format/lint commands |
| `allow_patterns` | string[] | `[]` | Additional regex patterns to allow |

#### Examples

Hybrid mode (recommended):

```toml
[auto_approve]
mode = "hybrid"
model = "haiku"

[auto_approve.rules]
allow_read = true
allow_tests = true
```

Rules only (no AI, instant):

```toml
[auto_approve]
mode = "rules"
```

Legacy compatible:

```toml
[auto_approve]
enabled = true  # Equivalent to mode = "ai"
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
| `auto_approve.mode` | — (use `enabled` fallback) |
| `auto_approve.enabled` | `false` |
| `auto_approve.model` | `"haiku"` |
| `auto_approve.timeout_secs` | `30` |
| `auto_approve.cooldown_secs` | `10` |
| `auto_approve.check_interval_ms` | `1000` |
| `auto_approve.max_concurrent` | `3` |
| `auto_approve.allowed_types` | `[]` |
| `auto_approve.rules.allow_read` | `true` |
| `auto_approve.rules.allow_tests` | `true` |
| `auto_approve.rules.allow_fetch` | `true` |
| `auto_approve.rules.allow_git_readonly` | `true` |
| `auto_approve.rules.allow_format_lint` | `true` |
| `auto_approve.rules.allow_patterns` | `[]` |

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
