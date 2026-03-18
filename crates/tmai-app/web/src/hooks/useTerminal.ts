import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { connectTerminal } from "@/lib/api";

interface UseTerminalOptions {
  sessionId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// Hook to manage xterm.js terminal connected to a PTY session via WebSocket
export function useTerminal({ sessionId, containerRef }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sendRef = useRef<((data: string | ArrayBuffer) => void) | null>(null);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const container = containerRef.current;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      theme: {
        background: "#09090b",
        foreground: "#fafafa",
        cursor: "#a1a1aa",
        selectionBackground: "#3f3f46",
      },
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect to PTY via WebSocket
    const { ws, send } = connectTerminal(sessionId, (data) => {
      term.write(data);
    });
    sendRef.current = send;

    // Forward terminal input to PTY via WebSocket
    const inputDisposable = term.onData((data) => {
      send(new TextEncoder().encode(data));
    });

    const binaryDisposable = term.onBinary((data) => {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i);
      }
      send(bytes.buffer);
    });

    // Send resize as JSON text frame
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      send(JSON.stringify({ type: "resize", rows, cols }));
    });

    // ResizeObserver for container size changes
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      inputDisposable.dispose();
      binaryDisposable.dispose();
      resizeDisposable.dispose();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      sendRef.current = null;
    };
  }, [sessionId, containerRef]);

  // Send raw text to PTY via WebSocket
  const writeText = useCallback((text: string) => {
    sendRef.current?.(new TextEncoder().encode(text));
  }, []);

  return { terminal: termRef, fit, writeText };
}
