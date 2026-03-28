# Terminal Panel

Full interactive terminal in the browser with xterm.js and WebSocket I/O.

## Overview

The Terminal Panel provides a real-time terminal connected to an AI agent's PTY session via WebSocket. It supports full ANSI color rendering, keyboard input, and IME for non-ASCII text.

<!-- screenshot: terminal-panel.png -->

## Features

### xterm.js Rendering

- **WebGL renderer** — Hardware-accelerated terminal rendering
- **ANSI colors** — Full 256-color and true-color support
- **Scrollback** — 5000 lines of scrollback history
- **Scrollback replay** — Previous output is replayed on connection

### WebSocket I/O

The terminal connects to the agent's PTY via WebSocket at `/api/agents/{id}/terminal`:

- **Server → Client**: Binary frames (raw PTY output with ANSI escapes)
- **Client → Server**: Binary frames (raw keyboard input)
- **Control messages**: JSON text frames (e.g., terminal resize)

### IME Support

For Japanese and other non-ASCII input:

- Press **Ctrl+I** to toggle the IME overlay
- Click the **あ** button in the header
- Type in the overlay and submit to send text to the PTY

### Terminal Resize

The terminal automatically sends resize events when the browser window changes size:

```json
{
  "type": "resize",
  "cols": 120,
  "rows": 40
}
```

## Header

The terminal header displays:

- **Session ID** — First 8 characters of the PTY session identifier
- **IME toggle** — Button to enable/disable IME input overlay

## Passthrough Input

For direct terminal input without the full terminal view, use the passthrough API:

```
POST /api/agents/{id}/passthrough
```

Supports sending individual characters or special keys (e.g., `Enter`, `Tab`, `Escape`).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| ANY | `/api/agents/{id}/terminal` | WebSocket terminal connection |
| GET | `/api/agents/{id}/output` | Get agent output text |
| POST | `/api/agents/{id}/passthrough` | Send raw terminal input |

## Related Documentation

- [Agent Spawn](./agent-spawn.md) — Launching agents with PTY
- [WebUI Overview](./webui-overview.md) — Dashboard layout
- [Web API Reference](../reference/web-api.md) — WebSocket protocol details
