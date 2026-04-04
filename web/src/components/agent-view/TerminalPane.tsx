import { useRef } from "react";
import { useTerminal } from "../../hooks/useTerminal";

interface TerminalPaneProps {
  /** PTY session ID for the WebSocket connection */
  sessionId: string;
}

/** xterm.js terminal pane connected to a PTY session via WebSocket */
export function TerminalPane({ sessionId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, containerRef);

  return (
    <div
      ref={containerRef}
      className="h-full w-full rounded-lg border border-neutral-300 overflow-hidden dark:border-neutral-700"
      style={{ minHeight: "200px" }}
    />
  );
}
