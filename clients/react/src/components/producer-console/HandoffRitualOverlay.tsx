// In-progress overlay for the Producer slot-restart rituals.
//
// Hosts TWO ritual shapes over the same `HandoffRitualEvent` wire (the core
// reused the wire deliberately — no new SSE variant):
//
//   • OPERATOR HANDOFF (`ritual_id` is a UUID) — the full forward sequence
//     per DR `2026-05-14-handoff-lifecycle-and-kill-ux.md` §E + the #547
//     operator review gate (tmai-core #549):
//       prompted → validated → awaiting_review → killed → launching → ready
//     At `awaiting_review` the ritual PAUSES for the operator's decision —
//     Approve (→ kill + respawn) or Request rewrite (→ re-prompt the
//     still-alive old Producer; the gate re-opens on the regenerated baton).
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

import { useEffect, useState } from "react";
import {
  api,
  HandoffReviewError,
  type HandoffRitualEvent,
  SUPERVISOR_RITUAL_PREFIX,
} from "@/lib/api";

interface HandoffRitualOverlayProps {
  unitName: string;
  ritualId: string | null;
  /** Ordered list of HandoffRitualEvents received so far. Empty during
   *  the brief window between POST and first SSE event. */
  phases: HandoffRitualEvent[];
}

type ForwardPhaseKey =
  | "prompted"
  | "validated"
  | "awaiting_review"
  | "killed"
  | "launching"
  | "ready";

interface PhaseRow {
  key: ForwardPhaseKey;
  label: string;
  detail: string;
}

// Operator handoff — the canonical forward sequence. The `awaiting_review`
// row (tmai-core #547 / #549) sits between `validated` and `killed`: the
// ritual PAUSES there for the operator review gate before the irreversible
// kill (Approve → kill + respawn; Request rewrite → re-prompt the still-alive
// old Producer, gate re-opens on the regenerated baton).
const HANDOFF_PHASES: PhaseRow[] = [
  { key: "prompted", label: "Prompted", detail: "ritual prompt delivered" },
  { key: "validated", label: "Validated", detail: "HANDOFF READY observed + file valid" },
  {
    key: "awaiting_review",
    label: "Awaiting review",
    detail: "operator review gate — approve or request a rewrite",
  },
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

// Render an operator-review-gate decision failure as a short, non-fatal
// message. A 409 is the expected race (the gate already advanced / the
// ritual_id is stale), so it gets friendly copy rather than the raw body.
function reviewErrorMessage(err: unknown): string {
  if (err instanceof HandoffReviewError) {
    if (err.status === 409) {
      return "No review gate is armed — the ritual may have already advanced or this decision is stale.";
    }
    return err.detail || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

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

  // Operator review gate (#547). Only an operator handoff (UUID ritual) ever
  // pauses at `awaiting_review`; a supervisor respawn has no FRONT and never
  // reaches it. The decision endpoints need a real `ritual_id`.
  const atReviewGate = !isRespawn && lastForwardPhase === "awaiting_review" && ritualId !== null;

  const [feedback, setFeedback] = useState("");
  // A single in-flight flag for either decision — the operator acts once.
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The proposed (just-validated) baton, fetched out-of-band so the operator
  // can review it before deciding. `null` until loaded; `batonError` flags a
  // fetch failure (non-fatal — the decision controls still work).
  const [baton, setBaton] = useState<string | null>(null);
  const [batonError, setBatonError] = useState(false);

  useEffect(() => {
    if (!atReviewGate) return;
    let cancelled = false;
    setBaton(null);
    setBatonError(false);
    // The validated baton is the unit's ACTIVE hand-over file at this point
    // (`validated` means HANDOFF READY observed + file valid).
    api
      .unitHandoff(unitName, "active")
      .then((res) => {
        if (!cancelled) setBaton(res.content);
      })
      .catch(() => {
        if (!cancelled) setBatonError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [atReviewGate, unitName]);

  const handleApprove = async () => {
    if (ritualId === null) return;
    setActionError(null);
    setBusy(true);
    try {
      await api.approveHandoff(unitName, ritualId);
      // No client-side phase bookkeeping — the SSE stream advances the overlay
      // (killed → launching → ready) and unmounts these controls.
    } catch (err) {
      setActionError(reviewErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRequestRewrite = async () => {
    if (ritualId === null) return;
    const trimmed = feedback.trim();
    if (trimmed === "") return;
    setActionError(null);
    setBusy(true);
    try {
      await api.requestHandoffRewrite(unitName, ritualId, trimmed);
      // Clear so the textarea can't be re-submitted with stale feedback; the
      // empty-feedback disable then blocks a no-op resubmit until the operator
      // types again. The SSE stream re-opens the gate on the regenerated baton
      // (a fresh prompted → validated → awaiting_review round).
      setFeedback("");
    } catch (err) {
      setActionError(reviewErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

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
        {atReviewGate && (
          <div
            data-testid="awaiting-review-controls"
            className="mt-4 border-t border-hairline-strong pt-4"
          >
            <p className="text-[12px] font-medium text-foreground">Operator review gate</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              The regenerated baton is validated, but the old Producer is still alive. Approve to
              kill it and launch the fresh Producer, or request a rewrite to re-prompt the current
              Producer with your feedback.
            </p>

            <div className="mt-3">
              <p className="text-[11px] font-medium text-muted-foreground">Proposed baton</p>
              {baton !== null ? (
                <pre
                  data-testid="awaiting-review-baton"
                  className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-hairline-strong bg-background p-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
                >
                  {baton}
                </pre>
              ) : batonError ? (
                <p className="mt-1 text-[10px] text-subtle-foreground">
                  (could not load the baton preview — review it from the hand-over view before
                  deciding)
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-subtle-foreground">Loading baton…</p>
              )}
            </div>

            {actionError !== null && (
              <p
                role="alert"
                data-testid="awaiting-review-error"
                className="mt-3 text-[11px] text-destructive"
              >
                {actionError}
              </p>
            )}

            <div className="mt-3 flex flex-col gap-2">
              <textarea
                aria-label="Rewrite feedback"
                data-testid="awaiting-review-feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={busy}
                rows={3}
                placeholder="Feedback for the rewrite (what to change before approving)…"
                className="w-full resize-y rounded border border-hairline-strong bg-background p-2 text-[12px] text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  data-testid="awaiting-review-request-rewrite"
                  onClick={() => void handleRequestRewrite()}
                  disabled={busy || feedback.trim() === ""}
                  className="rounded-md bg-surface px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Request rewrite
                </button>
                <button
                  type="button"
                  data-testid="awaiting-review-approve"
                  onClick={() => void handleApprove()}
                  disabled={busy}
                  className="rounded-md bg-primary/15 px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        )}
        {ritualId !== null && (
          <p className="mt-4 font-mono text-[10px] text-subtle-foreground">ritual_id: {ritualId}</p>
        )}
      </div>
    </div>
  );
}
