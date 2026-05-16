// Failure dialog for a rejected / errored handoff-and-restart ritual.
//
// Renders the 4-choice surface from DR
// `tmai-core/doc/decisions/2026-05-14-handoff-lifecycle-and-kill-ux.md`
// §E. Behaviors (PR4 — intentionally narrow):
//
//   ┌──────────────────────┬─────────────────────────────────────────┐
//   │ Force kill           │ POST /api/agents/{id}/kill on the live  │
//   │                      │ Producer. Operator relaunches manually  │
//   │                      │ via `Open Producer terminal`.           │
//   │                      │                                         │
//   │                      │ TODO(handoff-followup): the DR §E       │
//   │                      │ "archive partial handover + start       │
//   │                      │ fresh" composite needs a dedicated      │
//   │                      │ backend endpoint; deferred.             │
//   ├──────────────────────┼─────────────────────────────────────────┤
//   │ Retry                │ Re-POST the same body. DR caps at 2     │
//   │                      │ retries — the hook refuses the 3rd and  │
//   │                      │ this button disables when               │
//   │                      │ `retryRefused === true`.                │
//   ├──────────────────────┼─────────────────────────────────────────┤
//   │ Continue with stale  │ Dismiss the dialog with no backend op.  │
//   │                      │ Producer is still alive (most escalate  │
//   │                      │ paths don't kill).                      │
//   ├──────────────────────┼─────────────────────────────────────────┤
//   │ Resume in CC         │ Surface the live Producer's `claude:`   │
//   │                      │ UUID so the operator can `/resume`      │
//   │                      │ in a separate terminal, then dismiss.   │
//   └──────────────────────┴─────────────────────────────────────────┘

import { useState } from "react";

interface HandoffRitualFailureDialogProps {
  unitName: string;
  reason: string;
  message: string | null;
  /** Canonical AgentId of the live Producer (e.g. `claude:UUID`).
   *  `null` when no live Producer is observable — disables the
   *  Force-kill and Resume-in-CC choices. */
  producerAgentId: string | null;
  retryCount: number;
  retryRefused: boolean;
  onForceKill: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

function uuidFromAgentId(agentId: string): string | null {
  // Canonical agent id is `<scheme>:<uuid>` per detection canonicalization
  // (2026-05-09). The Resume-in-CC affordance shows only the UUID half.
  const idx = agentId.indexOf(":");
  if (idx < 0 || idx === agentId.length - 1) return null;
  return agentId.slice(idx + 1);
}

export function HandoffRitualFailureDialog({
  unitName,
  reason,
  message,
  producerAgentId,
  retryCount,
  retryRefused,
  onForceKill,
  onRetry,
  onDismiss,
}: HandoffRitualFailureDialogProps) {
  // Resume-in-CC surfaces the UUID inline rather than copying through a
  // toast/clipboard call — keeps the operator-visible action explicit.
  const [resumeRevealed, setResumeRevealed] = useState(false);
  const resumeUuid = producerAgentId ? uuidFromAgentId(producerAgentId) : null;

  const retryDisabled = retryRefused || retryCount >= 2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Handoff ritual rejected"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-xl border border-destructive/30 bg-surface-strong p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-destructive">
          Handoff ritual rejected — unit <code className="text-primary">{unitName}</code>
        </h3>

        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-muted-foreground">reason:</dt>
          <dd className="font-mono text-foreground">{reason}</dd>
          {message !== null && (
            <>
              <dt className="text-muted-foreground">detail:</dt>
              <dd className="whitespace-pre-wrap break-words text-foreground">{message}</dd>
            </>
          )}
        </dl>

        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          Producer rejected the handoff ritual (tmai tier-1: Producer's obligation to obey
          instructions). Decide how to proceed:
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onForceKill}
            disabled={producerAgentId === null}
            className="rounded-md bg-destructive/15 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/25 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              producerAgentId === null
                ? "No live Producer to kill"
                : "Kill the current Producer. Relaunch manually via Open Producer terminal."
            }
          >
            Force kill
          </button>

          <button
            type="button"
            onClick={onRetry}
            disabled={retryDisabled}
            className="rounded-md bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              retryDisabled
                ? "DR §E: second rejection is a hard escalate — no further automatic retry"
                : "Re-POST handoff-and-restart with the same body"
            }
          >
            Retry{retryCount > 0 ? ` (${retryCount}/2)` : ""}
          </button>

          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md bg-surface px-3 py-2 text-xs text-foreground transition-colors hover:bg-surface"
            title="Producer is still alive; next manual handoff or session-end will re-surface this state"
          >
            Continue with stale
          </button>

          <button
            type="button"
            onClick={() => {
              if (!resumeRevealed) setResumeRevealed(true);
              else onDismiss();
            }}
            disabled={resumeUuid === null}
            className="rounded-md bg-surface px-3 py-2 text-xs text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            title={
              resumeUuid === null
                ? "No live Producer's session id available"
                : "Show the session UUID so you can /resume in a separate terminal"
            }
          >
            Resume in CC
          </button>
        </div>

        {resumeRevealed && resumeUuid !== null && (
          <div className="mt-4 rounded-md border border-hairline-strong bg-background p-3 text-[12px]">
            <p className="text-muted-foreground">
              Run this in a separate terminal where you have <code>claude</code> on PATH:
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-primary">
              claude --resume {resumeUuid}
            </pre>
            <button
              type="button"
              onClick={onDismiss}
              className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
        )}

        {/* TODO(handoff-followup): the DR §E "Force kill = archive partial
            handover + start fresh" composite needs a dedicated backend
            endpoint; until then Force kill only POSTs to /agents/{id}/kill
            and the operator relaunches manually. */}
      </div>
    </div>
  );
}
