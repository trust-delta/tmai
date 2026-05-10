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
import { api } from "@/lib/api";
import { type TerminalStreamStatus, useAgentTerminalStream } from "./useAgentTerminalStream";

interface UseTerminalOptions {
  agentId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  autoScroll?: boolean;
  /**
   * When `true`, the hook does NOT attach xterm's `onData` / `onBinary`
   * to the keys WebSocket. Callers are expected to drive `sendKeys` from
   * their own input pipeline (e.g. PreviewPanelXterm forwards bytes
   * through a hidden IME input + composition handler so Japanese / CJK
   * input lands correctly). The xterm canvas is still mounted and
   * rendered; only keyboard capture is suppressed.
   */
  keysHandledExternally?: boolean;
}

// Rewrites CSI arrow / Home / End sequences (`\x1b[C`, …) into their SS3
// (`\x1bOC`, …) equivalents on egress to the keys WebSocket. Why: CC and
// other Ink-based TUIs typically sit behind tmux outside of tmai, which
// serves SS3 arrow sequences regardless of whether the inner program ever
// flipped DECCKM. Their key bindings — including the Tab-style "accept
// ghost-text autosuggestion" on ArrowRight — are wired to those SS3
// sequences, so a bare PTY that ships CSI sequences to CC silently misses
// the binding even though every byte is technically valid. Pre-flipping
// DECCKM via `term.write` on mount doesn't survive: CC reliably emits its
// own DECCKM disable shortly after attaching. Rewriting at the egress
// boundary is the narrowest fix that survives whatever DECCKM toggling the
// agent does, and it leaves PageUp/PageDown/Delete (no SS3 form) alone.
//
// `String.fromCharCode` is used instead of an `\x1b` literal in the regex
// source because biome's `noControlCharactersInRegex` rejects the literal
// even though it's the exact byte we need to match.
const ESC = String.fromCharCode(0x1b);
const CSI_ARROW_REGEX = new RegExp(`${ESC}\\[([ABCDHF])`, "g");
function remapArrowsToSs3(data: string): string {
  if (!data.includes(`${ESC}[`)) return data;
  return data.replace(CSI_ARROW_REGEX, (_, c: string) => `${ESC}O${c}`);
}

export function useTerminal({
  agentId,
  containerRef,
  autoScroll = true,
  keysHandledExternally = false,
}: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const binaryDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Reset xterm whenever the stream is about to (re)connect. Each
  // connect triggers a fresh PTY-server scrollback flush; without
  // wiping the canvas first, those bytes would render on top of
  // whatever was already on screen and the preview would stack.
  // The very first connect runs against an empty xterm, so this is
  // a no-op there. (`status === "connecting"` fires synchronously
  // before the WebSocket opens, so the reset always lands before
  // the first byte of the new stream arrives.)
  const onStatus = useCallback((next: TerminalStreamStatus): void => {
    if (next === "connecting") {
      termRef.current?.reset();
    }
  }, []);

  const { sendKeys } = useAgentTerminalStream({ agentId, onData, onStatus });

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
    // Sync initial PTY winsize so the agent doesn't inherit the server's
    // hardcoded 24×80 default on first attach.
    api.resizeAgentTerminal(agentId, term.rows, term.cols).catch(() => {});

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Auto-focus the xterm textarea on every fresh mount so users can
    // type immediately after spawn or agent switch — the wrapping `key`
    // in App.tsx forces a fresh `useTerminal` run on each agent change,
    // so this also covers the spawn case where wire delivery flips the
    // panel from PreviewPanel → TerminalPanel mid-flight (the hidden
    // IME input PreviewPanel briefly held focus on goes away with that
    // unmount, leaving keystrokes nowhere to land without this call).
    // PreviewPanel passes `keysHandledExternally: true` and drives focus
    // through its own hidden input, so skip xterm focus there to avoid
    // fighting that path.
    if (!keysHandledExternally) {
      term.focus();
    }

    // Re-attach replay is handled by the PTY-server: the first frames
    // delivered by `useAgentTerminalStream` are the agent's scrollback
    // (tmai-core PR #227) and xterm renders them as soon as they
    // arrive — no client-side warmup write needed.

    // Forward xterm input → keys-mode WS, unless the caller drives keys
    // from its own input pipeline (PreviewPanelXterm's hidden IME input).
    // Arrow / Home / End get the CSI → SS3 remap applied — see the
    // module-level `remapArrowsToSs3` for why.
    let inputDisposable: { dispose: () => void } | null = null;
    let binaryDisposable: { dispose: () => void } | null = null;
    if (!keysHandledExternally) {
      inputDisposable = term.onData((data: string): void => {
        sendKeys(remapArrowsToSs3(data));
      });
      inputDisposableRef.current = inputDisposable;

      binaryDisposable = term.onBinary((data: string): void => {
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
          bytes[i] = data.charCodeAt(i);
        }
        sendKeys(bytes.buffer);
      });
      binaryDisposableRef.current = binaryDisposable;
    }

    // Debounce resize events (~75 ms trailing edge) to avoid flooding the
    // server during window-drag bursts. FitAddon reflows the canvas on
    // every ResizeObserver tick; this callback only needs to tell the
    // PTY-server about the settled size.
    const resizeDisposable = term.onResize(
      ({ rows, cols }: { rows: number; cols: number }): void => {
        if (resizeTimerRef.current !== null) {
          clearTimeout(resizeTimerRef.current);
        }
        resizeTimerRef.current = setTimeout(() => {
          resizeTimerRef.current = null;
          api.resizeAgentTerminal(agentId, rows, cols).catch(() => {});
        }, 75);
      },
    );

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      inputDisposable?.dispose();
      binaryDisposable?.dispose();
      resizeDisposable.dispose();
      if (resizeTimerRef.current !== null) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      inputDisposableRef.current = null;
      binaryDisposableRef.current = null;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [agentId, containerRef, sendKeys, keysHandledExternally]);

  // Toggle keyboard attachment (input vs select mode).
  const setAttachable = useCallback(
    (enable: boolean): void => {
      const term = termRef.current;
      if (!term) return;

      if (enable && !inputDisposableRef.current) {
        inputDisposableRef.current = term.onData((data: string): void => {
          sendKeys(remapArrowsToSs3(data));
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

  return { terminal: termRef, fit, writeText, sendKeys, setAttachable, attached };
}
