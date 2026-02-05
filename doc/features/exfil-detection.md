# Exfil Detection

Security monitoring for external data transmission by AI agents.

## Overview

Exfil detection monitors AI agent output in PTY wrap mode, detecting and logging external transmission commands and sensitive data patterns.

**Note**: This feature requires PTY wrapping mode (`tmai wrap`).

## Configuration

`~/.config/tmai/config.toml`:

```toml
[exfil_detection]
enabled = true                          # Default: true
additional_commands = ["custom-upload"] # Add custom commands
```

## Detected Commands

### Built-in Commands

| Category | Commands |
|----------|----------|
| HTTP | `curl`, `wget`, `httpie`, `http` |
| Network | `nc`, `netcat`, `ncat`, `socat`, `telnet` |
| File Transfer | `scp`, `sftp`, `rsync`, `ftp` |
| Cloud CLI | `aws`, `gcloud`, `az`, `gsutil` |
| Other | `ssh`, `git push`, `npm publish`, `cargo publish` |

### Custom Commands

Add your own commands to detect:

```toml
[exfil_detection]
additional_commands = ["custom-sync", "my-upload-tool"]
```

## Sensitive Data Patterns

The following patterns are flagged when found in transmission commands:

| Pattern | Example |
|---------|---------|
| OpenAI API Key | `sk-...` |
| Anthropic API Key | `sk-ant-...` |
| GitHub Token | `ghp_...`, `gho_...`, `ghs_...` |
| AWS Access Key | `AKIA...` |
| Google API Key | `AIza...` |
| Slack Token | `xox...` |
| Bearer Token | `Bearer ...` |
| Private Key | `-----BEGIN PRIVATE KEY-----` |
| Generic API Key | `api_key=...`, `apikey=...` |

## Log Output

### External Transmission Detected

```
INFO  External transmission detected command="curl" pid=12345
```

### Sensitive Data in Transmission

```
WARN  Sensitive data in transmission command="curl" sensitive_type="API Key" pid=12345
```

## Log Levels

| Situation | Level | Message |
|-----------|-------|---------|
| External transmission command | `info` | `External transmission detected` |
| Transmission with sensitive data | `warn` | `Sensitive data in transmission` |

## Viewing Logs

Use `--debug` flag for detailed logging:

```bash
tmai --debug
```

Or set log level via environment:

```bash
RUST_LOG=info tmai
```

## What This Does NOT Do

- **Block transmissions** - Detection only, no prevention
- **Capture transmitted data** - Only logs that transmission occurred
- **Monitor non-PTY sessions** - Requires PTY wrapping

## Use Cases

1. **Audit trail** - Track what external calls agents make
2. **Security awareness** - Notice when agents attempt data exfiltration
3. **Incident investigation** - Review logs after suspicious activity

## Limitations

- Only detects command-line patterns, not library-level HTTP calls
- Sensitive data detection uses pattern matching, may have false positives/negatives
- Cannot detect encrypted or obfuscated transmissions

## Example Scenarios

### Scenario 1: Normal API Call

```
$ curl https://api.example.com/data
```

Log: `INFO External transmission detected command="curl" pid=12345`

### Scenario 2: Accidental Key Exposure

```
$ curl -H "Authorization: Bearer sk-ant-xxx" https://api.example.com
```

Log: `WARN Sensitive data in transmission command="curl" sensitive_type="Anthropic API Key" pid=12345`

## Next Steps

- [PTY Wrapping](./pty-wrapping.md) - Required for exfil detection
- [Configuration Reference](../reference/config.md) - Full config options
