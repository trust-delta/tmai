import { useCallback, useRef, useState } from "react";
import { useTerminal } from "@/hooks/useTerminal";
import { ImeOverlay } from "./ImeOverlay";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  sessionId: string;
}

// Single terminal panel connected to a PTY session
export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showIme, setShowIme] = useState(false);

  const { writeText } = useTerminal({ sessionId, containerRef });

  // Send IME-composed text to PTY via WebSocket
  const handleImeSubmit = useCallback(
    (text: string) => {
      writeText(text);
      setShowIme(false);
    },
    [writeText],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "i") {
      e.preventDefault();
      setShowIme((v) => !v);
    }
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: section captures keyboard shortcuts for child terminals
    <section className="relative flex h-full w-full flex-col" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-xs text-zinc-500">{sessionId.slice(0, 8)}</span>
        <button
          type="button"
          onClick={() => setShowIme((v) => !v)}
          className="rounded px-1.5 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          title="IME input (Ctrl+I)"
        >
          あ
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden bg-[#09090b] p-1" />
      {showIme && <ImeOverlay onSubmit={handleImeSubmit} onClose={() => setShowIme(false)} />}
    </section>
  );
}
