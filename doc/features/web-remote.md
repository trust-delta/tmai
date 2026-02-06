# Web Remote Control

Operate AI agents from your smartphone via QR code.

## Overview

Web Remote Control lets you monitor and approve AI agent requests from any device with a web browser. Scan a QR code to connect instantly.

## Features

- Agent list with real-time updates (SSE)
- y/n approval buttons
- AskUserQuestion option selection
- Multi-select support
- Text input
- Pane preview (5-second auto-refresh)
- Dark/Light theme toggle
- Toast notifications on state changes

## Quick Start

### 1. Start tmai

```bash
tmai
```

### 2. Display QR Code

Press `r` to show the QR code:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ███████████████████████████                               │
│   █ ▄▄▄▄▄ █▀▄▀▄▀▀▄█ ▄▄▄▄▄ █                               │
│   █ █   █ █▄▀█▀▄▀▄█ █   █ █                               │
│   █ █▄▄▄█ █ ▄▀▄█▀██ █▄▄▄█ █                               │
│   ███████████████████████████                               │
│                                                             │
│   Scan with your phone                                      │
│   http://192.168.1.100:9876/?token=xxxx                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. Scan and Connect

Scan the QR code with your phone's camera and open in browser.

## Mobile Interface

### Agent List

```
┌─────────────────────────────────────┐
│  tmai Remote                    ☀️  │
├─────────────────────────────────────┤
│                                     │
│  ● agent-1        [Approval]        │
│    → Approve                        │
│                                     │
│  ○ agent-2        [Processing]      │
│                                     │
│  ○ agent-3        [Idle]            │
│                                     │
└─────────────────────────────────────┘
```

### Approval Button

- **Approve** - Sends `Enter` to confirm

> **Note**: For rejection or other options, use number keys or text input.

### AskUserQuestion

When options are available:

```
┌─────────────────────────────────────┐
│  Which approach?                    │
│                                     │
│  [1] async/await                   │
│  [2] callbacks                     │
│  [3] promises                      │
│                                     │
└─────────────────────────────────────┘
```

Tap a button to select.

### Multi-Select

For multi-select questions, toggle options and tap Submit:

```
┌─────────────────────────────────────┐
│  Which features?                    │
│                                     │
│  [1] ✓ Authentication              │
│  [2]   Dark mode                   │
│  [3] ✓ API integration             │
│                                     │
│  [Submit]                           │
└─────────────────────────────────────┘
```

### Text Input

When free-form input is needed:

```
┌─────────────────────────────────────┐
│  Enter the API endpoint:            │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ https://api.example.com     │   │
│  └─────────────────────────────┘   │
│  [Send]                             │
└─────────────────────────────────────┘
```

### Pane Preview

Tap an agent to view its pane content. Auto-refreshes every 5 seconds.

## Configuration

`~/.config/tmai/config.toml`:

```toml
[web]
enabled = true  # Enable web server (default: true)
port = 9876     # Port number (default: 9876)
```

## Security

- **Token authentication**: URL contains a random token
- **LAN-only access**: Only accessible from the same network
- **No external exposure**: Does not bind to external interfaces by default

## Network Setup

### Same LAN

Works directly if phone and PC are on the same Wi-Fi network.

### WSL Environment

#### Mirrored Mode (Recommended)

If `.wslconfig` has `networkingMode=mirrored`:

```powershell
# Allow port through Windows Firewall (run as admin)
New-NetFirewallRule -DisplayName "tmai Web Remote" -Direction Inbound -Protocol TCP -LocalPort 9876 -Action Allow
```

#### NAT Mode

If not using mirrored mode:

```powershell
# Set up port forwarding (run as admin)
.\scripts\setup-wsl-portforward.ps1

# To remove
.\scripts\setup-wsl-portforward.ps1 -Remove
```

**Note**: In NAT mode, WSL IP changes on reboot. Re-run the script if connection fails.

## REST API

For programmatic access:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List agents |
| POST | `/api/agents/:id/approve` | Approve (send y) |
| POST | `/api/agents/:id/select` | Select option |
| POST | `/api/agents/:id/submit` | Confirm multi-select |
| POST | `/api/agents/:id/input` | Send text |
| GET | `/api/agents/:id/preview` | Get pane content |
| GET | `/api/events` | SSE stream |
| GET | `/api/teams` | List teams with task summaries |
| GET | `/api/teams/:name/tasks` | List team tasks |

See [Web API Reference](../reference/web-api.md) for details.

## Next Steps

- [Web API Reference](../reference/web-api.md) - Full API documentation
- [Remote Approval Workflow](../workflows/remote-approval.md) - Usage scenarios
