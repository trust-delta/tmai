// Hook for the Producer handoff-and-restart ritual (aim `handoff-non-blocking`
// — WebUI surface). Drives the conversation panel's in-progress overlay and
// the 4-choice failure dialog.
//
// Lifecycle:
//
//   idle
//     │ trigger(unit, body)                       (kicks POST)
//     ▼
//   in_progress (carries ritual_id + ordered phases)
//     │ phase: prompted/validated/killed/launching
//     │ phase: ready                              ─► ready
//     │ phase: escalate                           ─► escalated
//     ▼
//   { ready | escalated }
//     │ dismiss() | retry(unit, body)
//     ▼
//   idle
//
// The hook ignores SSE events whose `ritual_id` does not match the
// currently live `ritual_id` so concurrent rituals across units
// (or operator retries against the same unit) never cross-talk into
// the overlay — with ONE exception: an unsolicited supervisor
// crash-respawn (synthetic `slot-supervisor:<unit>` id, tmai-core
// #540 / #546) is ADOPTED from idle, so a Producer that the engine
// auto-relaunches surfaces the same overlay without an operator
// trigger. It is adopted only from idle, so it never clobbers a live
// operator handoff or an open failure dialog.
//
// Retry budget (DR §E): the dialog refuses a third retry from the
// hook side — "second rejection is a hard escalate (no further
// automatic retry)". The hook does not silently swallow the third
// retry; it surfaces a `retryRefused` flag the dialog can read so
// the operator gets a clear reason for the disabled Retry button.

import { useCallback, useState } from "react";
import {
  api,
  type HandoffRitualEvent,
  HandoffRitualRequestError,
  SUPERVISOR_RITUAL_PREFIX,
  type TriggerHandoffRitualRequest,
} from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";

/**
 * `dispatching` is the brief window between calling
 * `api.triggerHandoffRitual` and receiving the `ritual_id` back from
 * the server. It exists so the overlay can show a "starting…" state
 * without colliding with `in_progress` (which assumes a ritual_id).
 */
export type RitualUiState =
  | { kind: "idle" }
  | { kind: "dispatching" }
  | { kind: "in_progress"; ritualId: string; unit: string; phases: HandoffRitualEvent[] }
  | { kind: "ready"; ritualId: string; unit: string; newAgentId: string | null }
  | { kind: "escalated"; ritualId: string; unit: string; reason: string; message: string | null };

export interface UseHandoffRitualResult {
  state: RitualUiState;
  /** Latest handoff-ritual phase observed per unit, across ALL units on the
   *  global `handoff_ritual` SSE stream — not just the single adopted
   *  `state`. Lets a non-focused unit's `awaiting_review` surface as a
   *  cross-unit tab signal (aim `cross-unit-operator-owed`): the operator,
   *  working in unit X, learns unit Y owes a handoff review. Retains only the
   *  LATEST phase per unit, so a forward phase (killed/…/ready) or `escalate`
   *  supersedes `awaiting_review` and the owe clears mechanically. */
  unitPhases: Record<string, HandoffRitualEvent["phase"]>;
  /** Number of retries already attempted in this session. Used by the
   *  dialog to disable the Retry button after the 2nd rejection. */
  retryCount: number;
  /** True after the 3rd `trigger`/`retry` attempt is refused. */
  retryRefused: boolean;
  trigger: (unit: string, body: TriggerHandoffRitualRequest) => Promise<void>;
  retry: (unit: string, body: TriggerHandoffRitualRequest) => Promise<void>;
  /** Clear back to `idle` and reset the retry budget. */
  dismiss: () => void;
}

const MAX_RETRIES = 2;

function looksLikeHandoffRitualEvent(data: unknown): data is HandoffRitualEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as { ritual_id?: unknown; phase?: unknown; unit?: unknown };
  return (
    typeof obj.ritual_id === "string" &&
    typeof obj.phase === "string" &&
    typeof obj.unit === "string"
  );
}

export function useHandoffRitual(): UseHandoffRitualResult {
  const [state, setState] = useState<RitualUiState>({ kind: "idle" });
  const [retryCount, setRetryCount] = useState(0);
  const [retryRefused, setRetryRefused] = useState(false);
  // Latest phase per unit, fed by EVERY handoff_ritual event (not gated by the
  // adopted `state`'s ritual_id). This is the cross-unit owed-signal source:
  // the single `state` above is scoped to one adopted ritual for the overlay,
  // but the tab dots need every unit's current phase.
  const [unitPhases, setUnitPhases] = useState<Record<string, HandoffRitualEvent["phase"]>>({});

  // Single state-driven event router (no ref mirror — matching reads `prev`
  // inside the updater, so the SSE handler can register once and never go
  // stale). Two routes:
  //
  //   1. An OPERATOR ritual that this hook dispatched: events whose
  //      `ritual_id` matches the live `in_progress` ritual advance it.
  //   2. An UNSOLICITED supervisor crash-respawn (synthetic
  //      `slot-supervisor:<unit>` id, tmai-core #540 / #546): adopted ONLY
  //      from `idle`, so it surfaces the same overlay without an operator
  //      trigger but never clobbers a live operator handoff or an open
  //      failure dialog. The supervisor stream begins at `launching` (no
  //      prompted/validated/killed FRONT) and may also arrive as a bare
  //      `escalate` (`crash_loop_halted`) if the hook attaches mid-loop —
  //      adoption handles every phase from idle, not just `launching`.
  const applyEvent = useCallback((event: HandoffRitualEvent) => {
    setState((prev) => {
      const isSupervisor = event.ritual_id.startsWith(SUPERVISOR_RITUAL_PREFIX);

      // Adopt a supervisor respawn from idle, landing in whatever phase the
      // first observed event carries.
      if (prev.kind === "idle") {
        if (!isSupervisor) return prev; // operator events require a live ritual
        if (event.phase === "ready") {
          return {
            kind: "ready",
            ritualId: event.ritual_id,
            unit: event.unit,
            newAgentId: event.new_agent_id ?? null,
          };
        }
        if (event.phase === "escalate") {
          return {
            kind: "escalated",
            ritualId: event.ritual_id,
            unit: event.unit,
            reason: event.reason,
            message: event.message ?? null,
          };
        }
        return {
          kind: "in_progress",
          ritualId: event.ritual_id,
          unit: event.unit,
          phases: [event],
        };
      }

      // Otherwise only the live in-progress ritual's own events advance it;
      // a mismatched `ritual_id` (a concurrent ritual / cross-unit respawn)
      // never cross-talks into this overlay.
      if (prev.kind !== "in_progress") return prev;
      if (event.ritual_id !== prev.ritualId) return prev;

      if (event.phase === "ready") {
        return {
          kind: "ready",
          ritualId: event.ritual_id,
          unit: prev.unit,
          newAgentId: event.new_agent_id ?? null,
        };
      }
      if (event.phase === "escalate") {
        return {
          kind: "escalated",
          ritualId: event.ritual_id,
          unit: prev.unit,
          reason: event.reason,
          message: event.message ?? null,
        };
      }
      // Intermediate phases — append (dedupe on exact phase if the
      // server were to re-emit, though tmai-core PR #352 only emits
      // each phase once).
      const lastPhase = prev.phases[prev.phases.length - 1]?.phase;
      if (lastPhase === event.phase) return prev;
      return {
        ...prev,
        phases: [...prev.phases, event],
      };
    });
  }, []);

  useSSE({
    onEvent: (eventName, data) => {
      if (eventName !== "handoff_ritual") return;
      if (!looksLikeHandoffRitualEvent(data)) return;
      // Track the latest phase for EVERY unit (cross-unit owed signal),
      // independent of which single ritual `applyEvent` adopts for the overlay.
      setUnitPhases((prev) =>
        prev[data.unit] === data.phase ? prev : { ...prev, [data.unit]: data.phase },
      );
      applyEvent(data);
    },
  });

  const dispatchRitual = useCallback(async (unit: string, body: TriggerHandoffRitualRequest) => {
    setState({ kind: "dispatching" });
    try {
      const { ritual_id } = await api.triggerHandoffRitual(unit, body);
      setState({ kind: "in_progress", ritualId: ritual_id, unit, phases: [] });
    } catch (err) {
      // Surface 400/404/etc. as an `escalated` terminal — the dialog
      // can render the reason verbatim. We use a synthetic ritualId
      // since the server never minted one for this call.
      const isTyped = err instanceof HandoffRitualRequestError;
      const reason = isTyped ? `http_${err.status}` : "request_failed";
      const message = isTyped ? err.detail : err instanceof Error ? err.message : String(err);
      setState({
        kind: "escalated",
        ritualId: "",
        unit,
        reason,
        message,
      });
    }
  }, []);

  const trigger = useCallback(
    async (unit: string, body: TriggerHandoffRitualRequest) => {
      // A fresh `trigger` starts a new session: reset the retry budget.
      setRetryCount(0);
      setRetryRefused(false);
      await dispatchRitual(unit, body);
    },
    [dispatchRitual],
  );

  const retry = useCallback(
    async (unit: string, body: TriggerHandoffRitualRequest) => {
      // DR §E: second rejection is a hard escalate. After the 2nd retry
      // (i.e. the 3rd attempt total counting the initial trigger), refuse.
      if (retryCount >= MAX_RETRIES) {
        setRetryRefused(true);
        return;
      }
      setRetryCount((n) => n + 1);
      await dispatchRitual(unit, body);
    },
    [dispatchRitual, retryCount],
  );

  const dismiss = useCallback(() => {
    setState({ kind: "idle" });
    setRetryCount(0);
    setRetryRefused(false);
  }, []);

  return { state, unitPhases, retryCount, retryRefused, trigger, retry, dismiss };
}
