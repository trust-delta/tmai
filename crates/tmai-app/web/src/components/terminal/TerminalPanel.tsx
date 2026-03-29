import { useCallback, useRef, useState } from "react";
import { useTerminal } from "@/hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  sessionId: string;
}

// Single terminal panel connected to a PTY session.
// Shares the same Input/Select + Auto-scroll footer pattern as PreviewPanel.
export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inputMode, setInputMode] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  const { setAttachable } = useTerminal({ sessionId, containerRef, autoScroll });

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

  return (
    <section className="relative flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-xs text-zinc-500">{sessionId.slice(0, 8)}</span>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal container needs mouse events for selection mode */}
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
      />

      {/* Footer status bar — same pattern as PreviewPanel */}
      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-1">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={inputMode ? enterSelectMode : enterInputMode}
          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
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
          className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
            autoScroll
              ? "bg-cyan-500/15 text-cyan-400"
              : "bg-white/5 text-zinc-600 hover:text-zinc-400"
          }`}
          title={autoScroll ? "Auto-scroll: ON" : "Auto-scroll: OFF"}
        >
          {autoScroll ? "⇩ Auto" : "⇩ Off"}
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-600">
          {inputMode ? "click to select" : "click ⌨ to input"}
        </span>
      </div>
    </section>
  );
}
