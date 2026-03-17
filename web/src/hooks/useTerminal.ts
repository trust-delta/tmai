import { useEffect, useRef, type RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useAuthStore } from "../stores/auth";
import "@xterm/xterm/css/xterm.css";

/** Build WebSocket URL for a PTY terminal session */
function buildWsUrl(sessionId: string, token: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/agents/${encodeURIComponent(sessionId)}/terminal?token=${encodeURIComponent(token)}`;
}

/**
 * React hook that connects xterm.js to a PTY session via WebSocket.
 *
 * Manages the full lifecycle: Terminal creation → WebSocket connection →
 * bidirectional I/O → resize events → cleanup on unmount.
 */
export function useTerminal(
  sessionId: string | null,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const terminalRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const token = useAuthStore.getState().token;
    const container = containerRef.current;

    // 1. Create terminal instance
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "rgba(0, 0, 0, 0.85)",
        foreground: "#e0e0e0",
        cursor: "#ffffff",
        selectionBackground: "rgba(255, 255, 255, 0.2)",
      },
      allowTransparency: true,
      scrollback: 5000,
    });
    terminalRef.current = terminal;

    // 2. Attach FitAddon
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);

    // 3. Open terminal in container
    terminal.open(container);

    // Try WebGL addon for better performance
    try {
      const webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to canvas renderer
    }

    fitAddon.fit();

    // 4. Connect WebSocket
    const wsUrl = buildWsUrl(sessionId, token);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial resize
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(
          JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }),
        );
      }
    };

    // 5. WS binary → terminal.write
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
      } else if (typeof event.data === "string") {
        terminal.write(event.data);
      }
    };

    ws.onclose = () => {
      terminal.write("\r\n\x1b[90m[Connection closed]\x1b[0m\r\n");
    };

    ws.onerror = () => {
      terminal.write("\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n");
    };

    // 6. terminal.onData → WS send (binary)
    const dataDisposable = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Convert string to binary for raw PTY input
        ws.send(new TextEncoder().encode(data));
      }
    });

    // Also handle onBinary for special keys
    const binaryDisposable = terminal.onBinary((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const buf = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
          buf[i] = data.charCodeAt(i) & 0xff;
        }
        ws.send(buf);
      }
    });

    // 7. ResizeObserver → fitAddon.fit() → WS send resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: dims.cols,
              rows: dims.rows,
            }),
          );
        }
      } catch {
        // Ignore resize errors during cleanup
      }
    });
    resizeObserver.observe(container);

    // Cleanup on unmount
    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      binaryDisposable.dispose();
      ws.close();
      terminal.dispose();
      terminalRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, containerRef]);

  return { terminal: terminalRef, ws: wsRef };
}
