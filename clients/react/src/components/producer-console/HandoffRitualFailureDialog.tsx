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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-xl border border-red-500/30 bg-zinc-900 p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-red-200">
          Handoff ritual rejected — unit <code className="text-cyan-300">{unitName}</code>
        </h3>

        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-zinc-500">reason:</dt>
          <dd className="font-mono text-zinc-300">{reason}</dd>
          {message !== null && (
            <>
              <dt className="text-zinc-500">detail:</dt>
              <dd className="whitespace-pre-wrap break-words text-zinc-300">{message}</dd>
            </>
          )}
        </dl>

        <p className="mt-3 text-[12px] leading-relaxed text-zinc-400">
          Producer rejected the handoff ritual (tmai tier-1: Producer's obligation to obey
          instructions). Decide how to proceed:
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onForceKill}
            disabled={producerAgentId === null}
            className="rounded-md bg-red-500/15 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="rounded-md bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="rounded-md bg-white/[0.04] px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-white/[0.08]"
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
            className="rounded-md bg-white/[0.04] px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
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
          <div className="mt-4 rounded-md border border-white/10 bg-black/40 p-3 text-[12px]">
            <p className="text-zinc-400">
              Run this in a separate terminal where you have <code>claude</code> on PATH:
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-cyan-300">
              claude --resume {resumeUuid}
            </pre>
            <button
              type="button"
              onClick={onDismiss}
              className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300"
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
