// Copy-source affordance for fenced code blocks on PTY surfaces (#819).
//
// Floats over the terminal canvas (top-right) whenever the scrollback
// contains at least one CLOSED ``` fence. Copying goes through
// `lib/fenced-code.ts`, which re-joins soft-wrapped grid rows — the copied
// string is the LOGICAL source, not the rendered grid (no injected newlines
// at wrap columns, no `\r`).
//
// DELIBERATE EXCLUSION — copy only, NO execute button: the operator's
// paste + Enter stays the firing act. One-click execution of agent-authored
// commands is the no-look-execution slide the design explicitly rejects
// (tmai-core docs/archive/slack/2026-06-12-163215.md); do not add a "run" affordance
// here.

import { useEffect, useRef, useState } from "react";
import { type FenceScanTerminal, useFencedCodeBlocks } from "@/hooks/useFencedCodeBlocks";
import type { FencedBlock } from "@/lib/fenced-code";

interface CopySourceOverlayProps {
  /** Ref to the live xterm instance (from `useTerminal`). */
  terminalRef: React.RefObject<FenceScanTerminal | null>;
  /** Re-scan key — `useTerminal` swaps the instance per agent. */
  agentId: string | null;
}

type Feedback = "copied" | "failed";

export function CopySourceOverlay({ terminalRef, agentId }: CopySourceOverlayProps) {
  const blocks = useFencedCodeBlocks(terminalRef, agentId);
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the block list on outside click (same pattern as QueuePopover).
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  if (blocks.length === 0) return null;

  const flash = (kind: Feedback) => {
    setFeedback(kind);
    if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      setFeedback(null);
    }, 1500);
  };

  const copy = (block: FencedBlock) => {
    if (!navigator.clipboard) {
      flash("failed");
      return;
    }
    navigator.clipboard
      .writeText(block.source)
      .then(() => flash("copied"))
      .catch(() => flash("failed"));
  };

  const label =
    feedback === "copied"
      ? "✓ Copied"
      : feedback === "failed"
        ? "✗ Copy failed"
        : blocks.length === 1
          ? "⧉ Copy code"
          : `⧉ Copy code (${blocks.length})`;

  return (
    <div ref={rootRef} className="absolute right-2 top-2 z-10 flex flex-col items-end">
      <button
        type="button"
        data-testid="copy-code-source"
        // preventDefault keeps focus (and the panel's Input mode) on the
        // terminal — the convention all footer controls follow.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (blocks.length === 1) {
            copy(blocks[0]);
          } else {
            setOpen((v) => !v);
          }
        }}
        className={`touch-target-sm rounded border border-hairline bg-surface/80 px-2 py-1 text-xs backdrop-blur transition-colors ${
          feedback === "copied"
            ? "text-success"
            : feedback === "failed"
              ? "text-destructive"
              : "text-muted-foreground hover:text-foreground"
        }`}
        title="Copy fenced code block SOURCE — soft-wrap line breaks are removed; paste + Enter stays your act"
      >
        {label}
      </button>

      {open && blocks.length > 1 && (
        <div className="mt-1 max-h-60 w-72 overflow-y-auto rounded-lg border border-hairline-strong bg-popover shadow-xl">
          {/* Latest first — the freshest block is the one the Producer just
              handed over, which is the incident case this exists for. */}
          {[...blocks].reverse().map((b) => (
            <button
              key={b.openLine}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                copy(b);
                setOpen(false);
              }}
              className="block w-full border-b border-hairline px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-strong/50"
            >
              <p className="truncate font-mono text-[11px] text-foreground">
                {firstLine(b.source)}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {b.info ? `${b.info} · ` : ""}
                {countLines(b.source)} line{countLines(b.source) !== 1 ? "s" : ""}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function firstLine(source: string): string {
  const nl = source.indexOf("\n");
  return nl === -1 ? source : source.slice(0, nl);
}

function countLines(source: string): number {
  return source.length === 0 ? 0 : source.split("\n").length;
}
