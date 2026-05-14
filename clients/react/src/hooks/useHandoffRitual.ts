// Hook for the Producer handoff-and-restart ritual (DR
// `tmai-core/doc/decisions/2026-05-14-handoff-lifecycle-and-kill-ux.md`
// §E — WebUI surface). Drives the ProducerConsole's in-progress
// overlay and the 4-choice failure dialog.
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
// the overlay.
//
// Retry budget (DR §E): the dialog refuses a third retry from the
// hook side — "second rejection is a hard escalate (no further
// automatic retry)". The hook does not silently swallow the third
// retry; it surfaces a `retryRefused` flag the dialog can read so
// the operator gets a clear reason for the disabled Retry button.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type HandoffRitualEvent,
  HandoffRitualRequestError,
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
  | { kind: "in_progress"; ritualId: string; phases: HandoffRitualEvent[] }
  | { kind: "ready"; ritualId: string; newAgentId: string | null }
  | { kind: "escalated"; ritualId: string; reason: string; message: string | null };

export interface UseHandoffRitualResult {
  state: RitualUiState;
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

  // Ref mirror so the SSE handler reads the current ritualId without
  // needing to re-subscribe on every state transition.
  const liveRitualIdRef = useRef<string | null>(null);

  const applyEvent = useCallback((event: HandoffRitualEvent) => {
    if (event.ritual_id !== liveRitualIdRef.current) return;

    setState((prev) => {
      if (prev.kind !== "in_progress") return prev;
      if (event.phase === "ready") {
        return {
          kind: "ready",
          ritualId: event.ritual_id,
          newAgentId: event.new_agent_id ?? null,
        };
      }
      if (event.phase === "escalate") {
        return {
          kind: "escalated",
          ritualId: event.ritual_id,
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
      applyEvent(data);
    },
  });

  // Clear the live id ref whenever we leave `in_progress` so a stale
  // event from a prior ritual can't reanimate the overlay.
  useEffect(() => {
    if (state.kind === "in_progress") {
      liveRitualIdRef.current = state.ritualId;
    } else if (state.kind === "idle" || state.kind === "dispatching") {
      liveRitualIdRef.current = null;
    }
  }, [state]);

  const dispatchRitual = useCallback(async (unit: string, body: TriggerHandoffRitualRequest) => {
    setState({ kind: "dispatching" });
    try {
      const { ritual_id } = await api.triggerHandoffRitual(unit, body);
      liveRitualIdRef.current = ritual_id;
      setState({ kind: "in_progress", ritualId: ritual_id, phases: [] });
    } catch (err) {
      // Surface 400/404/etc. as an `escalated` terminal — the dialog
      // can render the reason verbatim. We use a synthetic ritualId
      // since the server never minted one for this call.
      const isTyped = err instanceof HandoffRitualRequestError;
      const reason = isTyped ? `http_${err.status}` : "request_failed";
      const message = isTyped ? err.detail : err instanceof Error ? err.message : String(err);
      liveRitualIdRef.current = null;
      setState({
        kind: "escalated",
        ritualId: "",
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
    liveRitualIdRef.current = null;
    setState({ kind: "idle" });
    setRetryCount(0);
    setRetryRefused(false);
  }, []);

  return { state, retryCount, retryRefused, trigger, retry, dismiss };
}
