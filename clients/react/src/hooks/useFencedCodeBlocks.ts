// Live fenced-code-block detection over an xterm buffer (#819).
//
// Subscribes to the terminal's write/resize events and re-scans the
// scrollback (debounced — `onWriteParsed` fires per chunk during streaming,
// so the scan runs once the stream goes quiet) for CLOSED ``` fences.
// Extraction semantics live in `lib/fenced-code.ts`.

import { type RefObject, useEffect, useState } from "react";
import { type BufferLike, extractFencedBlocks, type FencedBlock } from "@/lib/fenced-code";

/** Structural subset of `xterm.Terminal` — real terminals satisfy it, tests
 *  can pass a plain fake. */
export interface FenceScanTerminal {
  readonly cols: number;
  readonly buffer: { readonly active: BufferLike };
  onWriteParsed(listener: () => void): { dispose(): void };
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void };
}

const SCAN_DEBOUNCE_MS = 400;

export function useFencedCodeBlocks(
  terminalRef: RefObject<FenceScanTerminal | null>,
  agentId: string | null,
): FencedBlock[] {
  const [blocks, setBlocks] = useState<FencedBlock[]>([]);

  // `agentId` is a dep although unused in the body: `useTerminal` rebuilds
  // its Terminal instance when the agent changes, and this effect must
  // re-subscribe on the NEW instance (both hooks live in the same component,
  // so by call order the ref is already repopulated when this re-runs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: agentId is the re-subscribe trigger
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) {
      setBlocks([]);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scan = () => {
      const next = extractFencedBlocks(term.buffer.active, term.cols);
      // Keep the previous array identity when nothing changed so dependent
      // renders don't churn on every quiet period.
      setBlocks((prev) => (sameBlocks(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        scan();
      }, SCAN_DEBOUNCE_MS);
    };

    scan();
    const writeSub = term.onWriteParsed(schedule);
    // Resize reflows soft-wrap boundaries without any write — rescan so the
    // joined sources stay consistent with the new grid.
    const resizeSub = term.onResize(schedule);
    return () => {
      writeSub.dispose();
      resizeSub.dispose();
      if (timer !== null) clearTimeout(timer);
    };
  }, [terminalRef, agentId]);

  return blocks;
}

function sameBlocks(a: FencedBlock[], b: FencedBlock[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.source === b[i].source && x.info === b[i].info);
}
