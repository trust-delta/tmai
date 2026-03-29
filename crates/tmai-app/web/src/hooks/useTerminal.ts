import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectTerminal } from "@/lib/api";

interface UseTerminalOptions {
  sessionId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  autoScroll?: boolean;
}

// Hook to manage xterm.js terminal connected to a PTY session via WebSocket.
// Supports input/select mode toggling via setAttachable and auto-scroll control.
export function useTerminal({ sessionId, containerRef, autoScroll = true }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sendRef = useRef<((data: string | ArrayBuffer) => void) | null>(null);
  const inputDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const binaryDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const [attached, setAttached] = useState(true);

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
    inputDisposableRef.current = inputDisposable;

    const binaryDisposable = term.onBinary((data) => {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i);
      }
      send(bytes.buffer);
    });
    binaryDisposableRef.current = binaryDisposable;

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
      inputDisposableRef.current = null;
      binaryDisposableRef.current = null;
      ws.close();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      sendRef.current = null;
    };
  }, [sessionId, containerRef]);

  // Toggle keyboard attachment (input vs select mode)
  const setAttachable = useCallback(
    (enable: boolean) => {
      const term = termRef.current;
      const send = sendRef.current;
      if (!term || !send) return;

      if (enable && !inputDisposableRef.current) {
        // Re-attach keyboard listeners
        inputDisposableRef.current = term.onData((data) => {
          send(new TextEncoder().encode(data));
        });
        binaryDisposableRef.current = term.onBinary((data) => {
          const bytes = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) {
            bytes[i] = data.charCodeAt(i);
          }
          send(bytes.buffer);
        });
        term.focus();
      } else if (!enable && inputDisposableRef.current) {
        // Detach keyboard listeners for text selection
        inputDisposableRef.current.dispose();
        inputDisposableRef.current = null;
        binaryDisposableRef.current?.dispose();
        binaryDisposableRef.current = null;
        term.blur();
      }

      setAttached(enable);
    },
    [], // refs are stable
  );

  // Auto-scroll control: scroll to bottom on new data when enabled
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (autoScroll) {
      term.scrollToBottom();
      // Also scroll on each new write
      const disposable = term.onWriteParsed(() => {
        term.scrollToBottom();
      });
      return () => disposable.dispose();
    }
  }, [autoScroll]);

  // Send raw text to PTY via WebSocket
  const writeText = useCallback((text: string) => {
    sendRef.current?.(new TextEncoder().encode(text));
  }, []);

  return { terminal: termRef, fit, writeText, setAttachable, attached };
}
