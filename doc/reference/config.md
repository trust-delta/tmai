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
