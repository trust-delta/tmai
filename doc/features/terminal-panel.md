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

## Hybrid Scrollback Preview

For agents running in tmux, the preview panel uses a hybrid approach combining two data sources:

- **Live area (bottom)**: `tmux capture-pane` with ANSI escapes — shows the exact terminal appearance in real-time (spinners, colors, tool output folding)
- **History area (top)**: Parsed from Claude Code's session JSONL transcript (`~/.claude/projects/<project>/<session-uuid>.jsonl`) — provides scrollable conversation history

This design is resilient to scrollback resets caused by Claude Code's context compaction or plan mode clears. The JSONL transcript persists on disk regardless of terminal state, so the full conversation history remains scrollable even after compaction.

### JSONL Transcript Format

Each line is a JSON object with a `type` field:

| Type | Content |
|------|---------|
| `user` | User prompt text |
| `assistant_text` | Claude's response text |
| `tool_use` | Tool name and input summary |
| `tool_result` | Tool output summary |

### Known Limitation: CLAUDE_CODE_NO_FLICKER

Claude Code v2.1.89 introduced `CLAUDE_CODE_NO_FLICKER=1` for flicker-free rendering using the alternate screen buffer. This is **incompatible with `capture-pane`** — the live area will be empty when this env var is set. Hook and IPC detection are unaffected. tmai does not set this env var automatically.

## Related Documentation

- [Agent Spawn](./agent-spawn.md) — Launching agents with PTY
- [WebUI Overview](./webui-overview.md) — Dashboard layout
- [Web API Reference](../reference/web-api.md) — WebSocket protocol details
