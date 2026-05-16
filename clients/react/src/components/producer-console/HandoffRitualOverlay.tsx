// In-progress overlay for the Producer handoff-and-restart ritual.
//
// Shows a phase tracker per DR `2026-05-14-handoff-lifecycle-and-kill-ux.md`
// §E (WebUI overlay). The five forward phases are pinned in their
// canonical order (`prompted → validated → killed → launching →
// ready`); each row carries one of four marks:
//
//   ✓ done    — the phase was observed
//   ⟳ current — the most-recent observed phase (or "starting…" when
//               we've fired the POST but no SSE event has arrived yet)
//   ◌ pending — not reached yet
//
// The terminal-failure path (`escalate`) is handled by a dedicated
// dialog component — this overlay never renders it.

import type { HandoffRitualEvent } from "@/lib/api";

interface HandoffRitualOverlayProps {
  unitName: string;
  ritualId: string | null;
  /** Ordered list of HandoffRitualEvents received so far. Empty during
   *  the brief window between POST and first SSE event. */
  phases: HandoffRitualEvent[];
}

const FORWARD_PHASES = [
  { key: "prompted", label: "Prompted", detail: "ritual prompt delivered" },
  { key: "validated", label: "Validated", detail: "HANDOFF READY observed + file valid" },
  { key: "killed", label: "Killed", detail: "old Producer terminated" },
  { key: "launching", label: "Launching", detail: "spawning fresh Producer..." },
  { key: "ready", label: "Ready", detail: "" },
] as const;

type ForwardPhaseKey = (typeof FORWARD_PHASES)[number]["key"];

function phaseStatus(
  current: ForwardPhaseKey | null,
  rowKey: ForwardPhaseKey,
): "done" | "current" | "pending" {
  if (current === null) {
    return "pending";
  }
  const currentIdx = FORWARD_PHASES.findIndex((p) => p.key === current);
  const rowIdx = FORWARD_PHASES.findIndex((p) => p.key === rowKey);
  if (rowIdx < currentIdx) return "done";
  if (rowIdx === currentIdx) return "current";
  return "pending";
}

const STATUS_MARK = {
  done: "✓",
  current: "⟳",
  pending: "◌",
} as const;

const STATUS_CLASS = {
  done: "text-success",
  current: "text-primary",
  pending: "text-subtle-foreground",
} as const;

export function HandoffRitualOverlay({ unitName, ritualId, phases }: HandoffRitualOverlayProps) {
  // The most-recent forward phase observed (escalate is filtered upstream).
  const lastForwardPhase: ForwardPhaseKey | null = (() => {
    for (let i = phases.length - 1; i >= 0; i--) {
      const p = phases[i]?.phase;
      if (
        p === "prompted" ||
        p === "validated" ||
        p === "killed" ||
        p === "launching" ||
        p === "ready"
      ) {
        return p;
      }
    }
    // No event yet — show "prompted" as the current row so the operator
    // sees motion immediately after clicking.
    return phases.length === 0 ? "prompted" : null;
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Handoff and restart in progress"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-xl border border-hairline-strong bg-surface-strong p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-foreground">
          Handoff & restart — unit <code className="text-primary">{unitName}</code>
        </h3>
        <ul className="mt-4 space-y-2">
          {FORWARD_PHASES.map((row) => {
            const status = phaseStatus(lastForwardPhase, row.key);
            return (
              <li
                key={row.key}
                data-testid={`phase-row-${row.key}`}
                data-status={status}
                className="flex items-center gap-3 text-[13px]"
              >
                <span className={`w-4 text-center ${STATUS_CLASS[status]}`}>
                  {STATUS_MARK[status]}
                </span>
                <span
                  className={
                    status === "done"
                      ? "text-foreground"
                      : status === "current"
                        ? "text-primary"
                        : "text-muted-foreground"
                  }
                >
                  {row.label}
                </span>
                {row.detail && (
                  <span className="text-[11px] text-muted-foreground">— {row.detail}</span>
                )}
              </li>
            );
          })}
        </ul>
        {ritualId !== null && (
          <p className="mt-4 font-mono text-[10px] text-subtle-foreground">ritual_id: {ritualId}</p>
        )}
      </div>
    </div>
  );
}
