// xterm.js-backed terminal view (#174 Phase 3a).
//
// Wraps `useAgentTerminalStream` with an `xterm.Terminal` for visual
// rendering. Receives ANSI bytes from the stream and writes them to the
// terminal; forwards xterm's `onData` / `onBinary` to the keys-mode WS.
//
// Migrated from `connectTerminal(sessionId)` (which spoke to the legacy
// `/api/agents/{id}/terminal` WS using a `pty_session_id` selector) to
// `useAgentTerminalStream({ agentId })` (rev3 ticket-authorized
// stream/keys pair scoped on the canonical agent_id).
//
// Note: an earlier revision kept a module-level `AGENT_REPLAY_BUFFERS`
// map that replayed prior bytes when the user switched back to an
// agent. tmai-core PR #227 made the PTY-server flush its own
// per-agent scrollback as the first frames of every Stream attach,
// so the React-side buffer became redundant — and worse, double-
// rendered every reattach (PTY flush bytes were re-appended to the
// React buffer via `onData`, so each switch grew the next replay).

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentTerminalStream } from "./useAgentTerminalStream";

interface UseTerminalOptions {
  agentId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  autoScroll?: boolean;
}

export function useTerminal({ agentId, containerRef, autoScroll = true }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const binaryDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const [attached, setAttached] = useState(true);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  // Stream incoming ANSI bytes into the terminal — `term.write` accepts
  // `Uint8Array` directly. Re-attach replay is owned by the PTY-server
  // (it flushes its scrollback ring before live ANSI on every Stream
  // attach), so this hook does not need a local buffer.
  const onData = useCallback((bytes: Uint8Array): void => {
    termRef.current?.write(bytes);
  }, []);

  const { sendKeys } = useAgentTerminalStream({ agentId, onData });

  useEffect(() => {
    if (!agentId || !containerRef.current) return;

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

    // Re-attach replay is handled by the PTY-server: the first frames
    // delivered by `useAgentTerminalStream` are the agent's scrollback
    // (tmai-core PR #227) and xterm renders them as soon as they
    // arrive — no client-side warmup write needed.

    // Forward xterm input → keys-mode WS.
    const inputDisposable = term.onData((data: string): void => {
      sendKeys(data);
    });
    inputDisposableRef.current = inputDisposable;

    const binaryDisposable = term.onBinary((data: string): void => {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i);
      }
      sendKeys(bytes.buffer);
    });
    binaryDisposableRef.current = binaryDisposable;

    // The legacy `/terminal` WS accepted a `{type:"resize"}` JSON frame
    // on the same socket. The rev3 keys WS is byte-only — resize plumbing
    // is not yet defined upstream (#174 Phase 2b notes raw byte mode after
    // the handshake). For now we observe locally so the canvas still fits,
    // and leave SIGWINCH propagation to a follow-up wire frame.
    const resizeDisposable = term.onResize((): void => {});

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
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [agentId, containerRef, sendKeys]);

  // Toggle keyboard attachment (input vs select mode).
  const setAttachable = useCallback(
    (enable: boolean): void => {
      const term = termRef.current;
      if (!term) return;

      if (enable && !inputDisposableRef.current) {
        inputDisposableRef.current = term.onData((data: string): void => {
          sendKeys(data);
        });
        binaryDisposableRef.current = term.onBinary((data: string): void => {
          const bytes = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) {
            bytes[i] = data.charCodeAt(i);
          }
          sendKeys(bytes.buffer);
        });
        term.focus();
      } else if (!enable && inputDisposableRef.current) {
        inputDisposableRef.current.dispose();
        inputDisposableRef.current = null;
        binaryDisposableRef.current?.dispose();
        binaryDisposableRef.current = null;
        term.blur();
      }

      setAttached(enable);
    },
    [sendKeys],
  );

  // Auto-scroll: pin to bottom on new bytes when enabled.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (autoScroll) {
      term.scrollToBottom();
      const disposable = term.onWriteParsed(() => {
        term.scrollToBottom();
      });
      return () => disposable.dispose();
    }
  }, [autoScroll]);

  // Send raw text to PTY via the keys WebSocket.
  const writeText = useCallback(
    (text: string): void => {
      sendKeys(text);
    },
    [sendKeys],
  );

  return { terminal: termRef, fit, writeText, setAttachable, attached };
}
