import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminal } from "@/hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";

// Trim the canonical id (`<scheme>:<id>`) to `<scheme>:<first-8-chars>`
// for the panel header. `provisional:abcd1234` is more useful than the
// raw 8-char prefix of the whole string ("provisi…").
function agentIdShort(agentId: string): string {
  const colon = agentId.indexOf(":");
  if (colon < 0) return agentId.slice(0, 8);
  return `${agentId.slice(0, colon)}:${agentId.slice(colon + 1, colon + 9)}`;
}

interface TerminalPanelProps {
  /** Canonical agent id (`<scheme>:<id>`). The terminal-plane stream
   *  scopes on this; ticket subscription happens inside `useTerminal`. */
  agentId: string;
}

// Single terminal panel connected to a PTY session via the rev3
// terminal plane (#174 Phase 3a).
// Shares the same Input/Select + Auto-scroll footer pattern as PreviewPanel.
export function TerminalPanel({ agentId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inputMode, setInputMode] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  const { setAttachable } = useTerminal({ agentId, containerRef, autoScroll });

  // Switch to input mode (xterm captures keyboard)
  const enterInputMode = useCallback(() => {
    setInputMode(true);
    setAttachable(true);
  }, [setAttachable]);

  // Switch to select mode (text selection enabled, keyboard capture off)
  const enterSelectMode = useCallback(() => {
    setInputMode(false);
    setAttachable(false);
  }, [setAttachable]);

  // In select mode, listen for Enter key on the container to switch to input mode
  useEffect(() => {
    if (inputMode) return;
    const el = containerRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        enterInputMode();
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [inputMode, enterInputMode]);

  return (
    <section className="relative flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-xs text-zinc-500">{agentIdShort(agentId)}</span>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal container needs pointer events for selection mode */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-[#09090b] p-1"
        onMouseDown={() => {
          if (inputMode) enterSelectMode();
        }}
        onMouseUp={() => {
          if (!inputMode) {
            const sel = window.getSelection();
            if (!sel || sel.toString().length === 0) {
              enterInputMode();
            }
          }
        }}
        onTouchStart={() => {
          // On touch, switch to select mode so text is selectable/copyable
          if (inputMode) enterSelectMode();
        }}
      />

      {/* Footer status bar */}
      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-1.5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={inputMode ? enterSelectMode : enterInputMode}
          className={`touch-target-sm rounded px-2 py-1 text-xs transition-colors ${
            inputMode ? "bg-cyan-500/20 text-cyan-400" : "bg-amber-500/20 text-amber-400"
          }`}
          title={
            inputMode
              ? "Input mode — keystrokes sent to agent (click for select mode)"
              : "Select mode — click to copy text (click for input mode)"
          }
        >
          {inputMode ? "⌨ Input" : "📋 Select"}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAutoScroll((v) => !v)}
          className={`touch-target-sm rounded px-2 py-1 text-xs transition-colors ${
            autoScroll
              ? "bg-cyan-500/15 text-cyan-400"
              : "bg-white/5 text-zinc-600 hover:text-zinc-400"
          }`}
          title={autoScroll ? "Auto-scroll: ON" : "Auto-scroll: OFF"}
        >
          {autoScroll ? "⇩ Auto" : "⇩ Off"}
        </button>
        <div className="flex-1" />
        <span className="hidden text-[10px] text-zinc-600 sm:block">
          {inputMode ? "click to select" : "Enter or click ⌨ to input"}
        </span>
      </div>
    </section>
  );
}
