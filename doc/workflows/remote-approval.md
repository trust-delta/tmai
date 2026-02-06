# Remote Approval (Web Remote Control)

Approve agent requests from your smartphone using Web Remote Control.

## Use Cases

- Run long tasks and approve remotely while away
- Operate agents running on another PC from your phone
- Centrally manage agents across multiple machines

## Setup

### 1. Check configuration

`~/.config/tmai/config.toml`:

```toml
[web]
enabled = true  # Enabled by default
port = 9876     # Port number
```

### 2. Start tmai

```bash
tmai
```

### 3. Display QR code

Press `r` in tmai to display the QR code.

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
│   Press any key to close                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4. Scan with your phone

Scan the QR code with your phone's camera and open in browser.

## Smartphone Operations

### Agent List

```
┌─────────────────────────────────────┐
│  tmai Remote                        │
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

### Approval

- **Approve** button: Sends Enter to confirm

> **Note**: For rejection or other options, use number keys or text input.

### AskUserQuestion

When options are available, number buttons are displayed.

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

### Text Input

An input field is displayed when text input is needed.

## Network Setup

### Same LAN

Works directly if phone and PC are on the same Wi-Fi.

### WSL Environment

#### Mirrored mode (recommended)

If `.wslconfig` has `networkingMode=mirrored`:

```powershell
# Allow port through Windows Firewall
New-NetFirewallRule -DisplayName "tmai Web Remote" -Direction Inbound -Protocol TCP -LocalPort 9876 -Action Allow
```

#### NAT mode

```powershell
# Set up port forwarding
.\scripts\setup-wsl-portforward.ps1
```

## Security

- URL contains a random token
- Cannot access without knowing the token
- Only accessible from the same LAN

## Next Steps

- [Web Remote Control Details](../features/web-remote.md)
- [Multi-Agent Monitoring](./multi-agent.md)
