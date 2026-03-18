import { useRef } from "react";
import { useTerminal } from "@/hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  sessionId: string;
}

// Single terminal panel connected to a PTY session
export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useTerminal({ sessionId, containerRef });

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-xs text-zinc-500">{sessionId.slice(0, 8)}</span>
      </div>
      <div ref={containerRef} className="flex-1 overflow-hidden bg-[#09090b] p-1" />
    </div>
  );
}
