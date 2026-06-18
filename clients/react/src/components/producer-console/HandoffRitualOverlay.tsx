// In-progress overlay for the Producer slot-restart rituals.
//
// Hosts TWO ritual shapes over the same `HandoffRitualEvent` wire (the core
// reused the wire deliberately — no new SSE variant):
//
//   • OPERATOR HANDOFF (`ritual_id` is a UUID) — the full forward sequence
//     per DR `2026-05-14-handoff-lifecycle-and-kill-ux.md` §E:
//       prompted → validated → killed → launching → ready
//
//   • SUPERVISOR CRASH-RESPAWN (`ritual_id` starts `slot-supervisor:`,
//     tmai-core #540 / #546) — the absent Producer just VANISHED, so there
//     is no prompted/validated/killed FRONT; the supervisor's auto-respawn
//     begins at `launching`:
//       launching → ready
//
// Each phase row carries one of four marks:
//
//   ✓ done    — the phase was observed
//   ⟳ current — the most-recent observed phase (or "starting…" when
//               we've fired the POST but no SSE event has arrived yet)
//   ◌ pending — not reached yet
//
// The terminal-failure path (`escalate`) is handled by a dedicated
// dialog component — this overlay never renders it.

import { type HandoffRitualEvent, SUPERVISOR_RITUAL_PREFIX } from "@/lib/api";

interface HandoffRitualOverlayProps {
  unitName: string;
  ritualId: string | null;
  /** Ordered list of HandoffRitualEvents received so far. Empty during
   *  the brief window between POST and first SSE event. */
  phases: HandoffRitualEvent[];
}

type ForwardPhaseKey = "prompted" | "validated" | "killed" | "launching" | "ready";

interface PhaseRow {
  key: ForwardPhaseKey;
  label: string;
  detail: string;
}

// Operator handoff — the canonical 5-phase forward sequence.
const HANDOFF_PHASES: PhaseRow[] = [
  { key: "prompted", label: "Prompted", detail: "ritual prompt delivered" },
  { key: "validated", label: "Validated", detail: "HANDOFF READY observed + file valid" },
  { key: "killed", label: "Killed", detail: "old Producer terminated" },
  { key: "launching", label: "Launching", detail: "spawning fresh Producer..." },
  { key: "ready", label: "Ready", detail: "" },
];

// Supervisor crash-respawn — no FRONT (the Producer vanished, nothing to
// prompt/validate/kill); the auto-respawn starts at `launching`.
const RESPAWN_PHASES: PhaseRow[] = [
  { key: "launching", label: "Launching", detail: "supervisor respawning the Producer..." },
  { key: "ready", label: "Ready", detail: "" },
];

function phaseStatus(
  rows: PhaseRow[],
  current: ForwardPhaseKey | null,
  rowKey: ForwardPhaseKey,
): "done" | "current" | "pending" {
  if (current === null) {
    return "pending";
  }
  const currentIdx = rows.findIndex((p) => p.key === current);
  const rowIdx = rows.findIndex((p) => p.key === rowKey);
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
  // A supervisor crash-respawn carries the synthetic `slot-supervisor:<unit>`
  // id; an operator handoff carries a UUID. The id picks the phase set + copy.
  const isRespawn = ritualId?.startsWith(SUPERVISOR_RITUAL_PREFIX) ?? false;
  const phaseRows = isRespawn ? RESPAWN_PHASES : HANDOFF_PHASES;

  // The most-recent forward phase observed that belongs to THIS ritual's phase
  // set (escalate is filtered upstream; a respawn never sees prompted/validated/
  // killed, but guard anyway against a stray FRONT event leaking into the
  // respawn row list).
  const lastForwardPhase: ForwardPhaseKey | null = (() => {
    for (let i = phases.length - 1; i >= 0; i--) {
      const p = phases[i]?.phase;
      if (p !== undefined && p !== "escalate" && phaseRows.some((r) => r.key === p)) {
        return p;
      }
    }
    // No event yet — show the FIRST row of this ritual's set as current so the
    // operator sees motion immediately (handoff: "prompted"; respawn:
    // "launching").
    return phases.length === 0 ? (phaseRows[0]?.key ?? null) : null;
  })();

  const heading = isRespawn ? "Producer crash-respawn" : "Handoff & restart";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        isRespawn ? "Producer crash-respawn in progress" : "Handoff and restart in progress"
      }
      className="fixed inset-0 z-50 flex items-center justify-center bg-background backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-xl border border-hairline-strong bg-surface-strong p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-foreground">
          {heading} — unit <code className="text-primary">{unitName}</code>
        </h3>
        {isRespawn && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            The slot supervisor detected the Producer was gone and is relaunching it automatically —
            no operator handoff was run.
          </p>
        )}
        <ul className="mt-4 space-y-2">
          {phaseRows.map((row) => {
            const status = phaseStatus(phaseRows, lastForwardPhase, row.key);
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
