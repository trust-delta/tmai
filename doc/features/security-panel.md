# Security Panel

Scan Claude Code settings and MCP server configurations for security vulnerabilities.

## Overview

The Security Panel analyzes configuration files for potential security risks, categorizes findings by severity, and displays actionable details.

## Accessing

Click the security button (🛡) in the status bar to open the Security Panel.

<!-- screenshot: security-panel.png -->

## Running a Scan

1. Open the Security Panel
2. Click **Scan** to run a security scan
3. View results grouped by severity

The last scan result is cached and displayed automatically when reopening the panel.

## Risk Categories

| Category | Description |
|----------|-------------|
| **Permissions** | Overly broad file or command permissions in Claude Code settings |
| **MCP Server** | Insecure MCP server configurations |
| **Environment** | Sensitive environment variables or credentials |
| **Hooks** | Potentially dangerous hook configurations |
| **FilePermissions** | File-level permission issues |

## Severity Levels

| Level | Color | Description |
|-------|-------|-------------|
| **Critical** | Red | Immediate security risk requiring action |
| **High** | Orange | Significant vulnerability |
| **Medium** | Yellow | Moderate risk worth addressing |
| **Low** | Blue | Minor concern or best practice suggestion |

## Scan Results

Each finding includes:

- **Rule ID** — Identifier for the security rule triggered
- **Category** — Which category the risk falls under
- **Source** — The file where the risk was found
- **Description** — Explanation of the vulnerability
- **Matched Value** — The actual configuration value that triggered the finding

## Summary View

The top of the panel shows a summary with counts per severity level, along with:

- Total files scanned
- Total projects scanned
- Scan timestamp

## Relationship to Exfil Detection

The Security Panel performs static analysis of configuration files. For runtime detection of external data transmission by AI agents, see [Exfil Detection](./exfil-detection.md).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/security/scan` | Run a security scan |
| GET | `/api/security/last` | Get the last scan result |

## Related Documentation

- [Exfil Detection](./exfil-detection.md) — Runtime security monitoring
- [Configuration Reference](../reference/config.md) — Configuration options
