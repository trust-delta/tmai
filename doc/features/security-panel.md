# Config Audit Panel

Audit Claude Code settings, MCP server configurations, custom commands, and CLAUDE.md files for security risks.

## Overview

The Config Audit Panel analyzes configuration files for potential security risks, categorizes findings by severity, and displays actionable details.

## Accessing

Click the audit button (🛡) in the status bar to open the Config Audit Panel.

<!-- screenshot: security-panel.png -->

## Running an Audit

1. Open the Config Audit Panel
2. Click **Audit** to run a config audit
3. View results grouped by severity

The last audit result is cached and displayed automatically when reopening the panel.

## Scan Targets

| Target | Description |
|--------|-------------|
| `settings.json` | User-level and project-level settings |
| `settings.local.json` | Local overrides that may weaken security |
| `mcp.json` | MCP server configurations |
| Hook scripts | Shell scripts in `hooks/` directories |
| `.claude/commands/` | Custom command files for dangerous patterns |
| `CLAUDE.md` | Instruction files for prompt injection patterns |

## Risk Categories

| Category | Description |
|----------|-------------|
| **Permissions** | Overly broad file or command permissions in Claude Code settings |
| **MCP Server** | Insecure MCP server configurations |
| **Environment** | Sensitive environment variables or credentials |
| **Hooks** | Potentially dangerous hook configurations |
| **FilePermissions** | File-level permission issues |
| **CustomCommand** | Dangerous patterns in custom command files |
| **InstructionFile** | Prompt injection patterns in CLAUDE.md |

## Severity Levels

| Level | Color | Description |
|-------|-------|-------------|
| **Critical** | Red | Immediate security risk requiring action |
| **High** | Orange | Significant vulnerability |
| **Medium** | Yellow | Moderate risk worth addressing |
| **Low** | Blue | Minor concern or best practice suggestion |

## Audit Results

Each finding includes:

- **Rule ID** — Identifier for the audit rule triggered
- **Category** — Which category the risk falls under
- **Source** — The file where the risk was found
- **Description** — Explanation of the vulnerability
- **Matched Value** — The actual configuration value that triggered the finding

## Summary View

The top of the panel shows a summary with counts per severity level, along with:

- Total files scanned
- Total projects scanned
- Audit timestamp

## Relationship to Exfil Detection

The Config Audit Panel performs static analysis of configuration files. For runtime detection of external data transmission by AI agents, see [Exfil Detection](./exfil-detection.md).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/config-audit/run` | Run a config audit |
| GET | `/api/config-audit/last` | Get the last audit result |

## Related Documentation

- [Exfil Detection](./exfil-detection.md) — Runtime security monitoring
- [Configuration Reference](../reference/config.md) — Configuration options
