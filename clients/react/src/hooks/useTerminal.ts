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

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentTerminalStream } from "./useAgentTerminalStream";

interface UseTerminalOptions {
  agentId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  autoScroll?: boolean;
}

// Per-agent ANSI replay buffer.
//
// The rev3 PTY-server's ANSI broadcast is push-only — there is no
// catch-up replay for late subscribers (scrollback lands with #175).
// When the user switches agents, the xterm instance is disposed and
// recreated, so without our own buffer the new pane is blank until
// the agent next emits anything (which idle agents may not do for a
// long time). We keep a bounded chunk log per agent and replay it on
// re-mount so switching back to a previously-seen agent restores the
// last screen state immediately.
const AGENT_REPLAY_BUFFERS = new Map<string, Uint8Array[]>();
const AGENT_REPLAY_BYTE_CAP = 256_000;

function appendReplay(agentId: string, bytes: Uint8Array): void {
  const list = AGENT_REPLAY_BUFFERS.get(agentId) ?? [];
  list.push(bytes);
  // Drop oldest chunks until total bytes is under the cap. This trims at
  // chunk granularity rather than byte-exact slicing, which keeps ANSI
  // escape sequences whole.
  let total = 0;
  for (const b of list) total += b.byteLength;
  while (total > AGENT_REPLAY_BYTE_CAP && list.length > 1) {
    const dropped = list.shift();
    if (dropped) total -= dropped.byteLength;
  }
  AGENT_REPLAY_BUFFERS.set(agentId, list);
}

function replayInto(term: Terminal, agentId: string): void {
  const list = AGENT_REPLAY_BUFFERS.get(agentId);
  if (!list) return;
  for (const chunk of list) {
    term.write(chunk);
  }
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
  // `Uint8Array` directly. Also append to the per-agent replay buffer
  // so a future re-mount of this hook can restore the screen.
  const onData = useCallback(
    (bytes: Uint8Array): void => {
      termRef.current?.write(bytes);
      if (agentId) {
        // Copy because the underlying ArrayBuffer may be reused by the
        // WebSocket layer for the next frame.
        appendReplay(agentId, new Uint8Array(bytes));
      }
    },
    [agentId],
  );

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

    // Restore the previous screen for this agent before live bytes
    // start arriving on the freshly-opened WebSocket. Without this the
    // pane is blank for any agent that is currently idle.
    replayInto(term, agentId);

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
