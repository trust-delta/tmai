import { useCallback, useEffect, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { api } from "@/lib/tauri";

interface UseTerminalOptions {
  sessionId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

// Hook to manage xterm.js terminal connected to a PTY session via Tauri Channel
export function useTerminal({ sessionId, containerRef }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Fit terminal to container
  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  useEffect(() => {
    if (!sessionId || !containerRef.current) return;

    const container = containerRef.current;

    // Create terminal (WebGL disabled — interferes with IME on Linux/WebKitGTK)
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      theme: {
        background: "#09090b", // zinc-950
        foreground: "#fafafa", // zinc-50
        cursor: "#a1a1aa", // zinc-400
        selectionBackground: "#3f3f46", // zinc-700
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Subscribe to PTY output via Tauri Channel
    const channel = new Channel<number[]>();
    channel.onmessage = (data) => {
      term.write(new Uint8Array(data));
    };
    api.subscribePty(sessionId, channel).catch(console.error);

    // Forward terminal input to PTY
    const inputDisposable = term.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      api.writePty(sessionId, bytes).catch(console.error);
    });

    // Handle binary input (paste, etc.)
    const binaryDisposable = term.onBinary((data) => {
      const bytes = Array.from(data, (c) => c.charCodeAt(0));
      api.writePty(sessionId, bytes).catch(console.error);
    });

    // Sync terminal size to PTY on resize
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      api.resizePty(sessionId, rows, cols).catch(console.error);
    });

    // ResizeObserver for container size changes
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(container);

    // Initial resize sync
    const { rows, cols } = term;
    api.resizePty(sessionId, rows, cols).catch(console.error);

    return () => {
      observer.disconnect();
      inputDisposable.dispose();
      binaryDisposable.dispose();
      resizeDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, containerRef]);

  return { terminal: termRef, fit };
}
