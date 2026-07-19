// Hook for the Producer handoff-and-restart ritual (aim `handoff-non-blocking`
// — WebUI surface). Drives the conversation panel's in-progress overlay and
// the 4-choice failure dialog.
//
// Lifecycle (PER UNIT — see the state model note below):
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
//     │ dismiss(unit) | retry(unit, body)
//     ▼
//   idle
//
// State model — ONE ENTRY PER UNIT, keyed by unit name (`states`,
// `retryCount`, `retryRefused` are all `Record<unit, …>`). This mirrors the
// backend, whose review gate + ritual lock are per-unit HashMaps: a handoff
// parked at `awaiting_review` on unit A stays armed server-side while the
// operator triggers/completes a handoff on unit B. A single app-global
// `state` used to hold only ONE unit's ritual, so triggering unit B's handoff
// overwrote unit A's `in_progress`, and unit B's `ready`/`dismiss` cleared it
// — so switching back to unit A found its review-gate overlay silently gone
// even though the backend gate was still armed (operator-reported 2026-07-19).
// Keying by unit is the front-side half of that fix: `trigger(B)` writes only
// `states.B`, `dismiss(B)` clears only `states.B`, and `states.A` survives.
//
// The hook ignores SSE events whose `ritual_id` does not match the unit's own
// live `ritual_id` so concurrent rituals across units (or operator retries
// against the same unit) never cross-talk into each other's overlay — with ONE
// exception: an unsolicited supervisor crash-respawn (synthetic
// `slot-supervisor:<unit>` id, tmai-core #540 / #546) is ADOPTED from idle, so
// a Producer that the engine auto-relaunches surfaces the same overlay without
// an operator trigger. It is adopted only from that unit's idle, so it never
// clobbers a live operator handoff or an open failure dialog.
//
// Retry budget (DR §E): the dialog refuses a third retry from the hook side —
// "second rejection is a hard escalate (no further automatic retry)". The hook
// does not silently swallow the third retry; it surfaces a `retryRefused` flag
// (per unit) the dialog can read so the operator gets a clear reason for the
// disabled Retry button.

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
  /** Ritual UI state per unit, keyed by unit name. An absent key means idle.
   *  The in-progress overlay reads the FOCUSED unit's entry; the app-global
   *  failure dialog derives its escalated unit from this map. Keeping this
   *  per-unit (not a single app-global state) is what lets a non-focused
   *  unit's handoff survive another unit's concurrent ritual. */
  states: Record<string, RitualUiState>;
  /** Latest handoff-ritual phase observed per unit, across ALL units on the
   *  global `handoff_ritual` SSE stream — not just the units with an adopted
   *  `states` entry. Lets a non-focused unit's `awaiting_review` surface as a
   *  cross-unit tab signal (aim `cross-unit-operator-owed`): the operator,
   *  working in unit X, learns unit Y owes a handoff review. Retains only the
   *  LATEST phase per unit, so a forward phase (killed/…/ready) or `escalate`
   *  supersedes `awaiting_review` and the owe clears mechanically. */
  unitPhases: Record<string, HandoffRitualEvent["phase"]>;
  /** Retries already attempted this session, per unit. Used by the dialog to
   *  disable the Retry button after the 2nd rejection. Absent key means 0. */
  retryCount: Record<string, number>;
  /** True (per unit) after the 3rd `trigger`/`retry` attempt is refused.
   *  Absent key means false. */
  retryRefused: Record<string, boolean>;
  trigger: (unit: string, body: TriggerHandoffRitualRequest) => Promise<void>;
  retry: (unit: string, body: TriggerHandoffRitualRequest) => Promise<void>;
  /** Clear the given unit back to idle and reset its retry budget. */
  dismiss: (unit: string) => void;
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

// Advance ONE unit's ritual UI state by a single SSE event. Pure function so
// the per-unit map updater stays trivial. Two routes:
//
//   1. An OPERATOR ritual that this hook dispatched: events whose `ritual_id`
//      matches the unit's live `in_progress` ritual advance it.
//   2. An UNSOLICITED supervisor crash-respawn (synthetic `slot-supervisor:
//      <unit>` id, tmai-core #540 / #546): adopted ONLY from that unit's
//      `idle`, so it surfaces the same overlay without an operator trigger but
//      never clobbers a live operator handoff or an open failure dialog. The
//      supervisor stream begins at `launching` (no prompted/validated/killed
//      FRONT) and may also arrive as a bare `escalate` (`crash_loop_halted`)
//      if the hook attaches mid-loop — adoption handles every phase from idle.
//
// Returns `prev` unchanged when the event does not apply (the caller skips the
// state write on referential equality).
function advanceRitualState(prev: RitualUiState, event: HandoffRitualEvent): RitualUiState {
  const isSupervisor = event.ritual_id.startsWith(SUPERVISOR_RITUAL_PREFIX);

  // Adopt a supervisor respawn from idle, landing in whatever phase the first
  // observed event carries.
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

  // Otherwise only the unit's live in-progress ritual's own events advance it;
  // a mismatched `ritual_id` (a concurrent ritual / cross-unit respawn) never
  // cross-talks into this unit's overlay.
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
  // Intermediate phases — append (dedupe on exact phase if the server were to
  // re-emit, though tmai-core PR #352 only emits each phase once).
  const lastPhase = prev.phases[prev.phases.length - 1]?.phase;
  if (lastPhase === event.phase) return prev;
  return {
    ...prev,
    phases: [...prev.phases, event],
  };
}

export function useHandoffRitual(): UseHandoffRitualResult {
  const [states, setStates] = useState<Record<string, RitualUiState>>({});
  const [retryCount, setRetryCount] = useState<Record<string, number>>({});
  const [retryRefused, setRetryRefused] = useState<Record<string, boolean>>({});
  // Latest phase per unit, fed by EVERY handoff_ritual event (not gated by any
  // adopted `states` entry). This is the cross-unit owed-signal source: the
  // per-unit `states` above are scoped to adopted rituals for the overlay, but
  // the tab dots need every unit's current phase.
  const [unitPhases, setUnitPhases] = useState<Record<string, HandoffRitualEvent["phase"]>>({});

  // State-driven event router (no ref mirror — the updater reads the latest
  // map, so the SSE handler can register once and never go stale). Routes the
  // event to its own unit's slot and advances just that slot.
  const applyEvent = useCallback((event: HandoffRitualEvent) => {
    setStates((all) => {
      const prev = all[event.unit] ?? { kind: "idle" as const };
      const next = advanceRitualState(prev, event);
      if (next === prev) return all;
      return { ...all, [event.unit]: next };
    });
  }, []);

  useSSE({
    onEvent: (eventName, data) => {
      if (eventName !== "handoff_ritual") return;
      if (!looksLikeHandoffRitualEvent(data)) return;
      // Track the latest phase for EVERY unit (cross-unit owed signal),
      // independent of which rituals `applyEvent` adopts for the overlay.
      setUnitPhases((prev) =>
        prev[data.unit] === data.phase ? prev : { ...prev, [data.unit]: data.phase },
      );
      applyEvent(data);
    },
  });

  const dispatchRitual = useCallback(async (unit: string, body: TriggerHandoffRitualRequest) => {
    setStates((all) => ({ ...all, [unit]: { kind: "dispatching" } }));
    try {
      const { ritual_id } = await api.triggerHandoffRitual(unit, body);
      setStates((all) => ({
        ...all,
        [unit]: { kind: "in_progress", ritualId: ritual_id, unit, phases: [] },
      }));
    } catch (err) {
      // Surface 400/404/etc. as an `escalated` terminal — the dialog
      // can render the reason verbatim. We use a synthetic ritualId
      // since the server never minted one for this call.
      const isTyped = err instanceof HandoffRitualRequestError;
      const reason = isTyped ? `http_${err.status}` : "request_failed";
      const message = isTyped ? err.detail : err instanceof Error ? err.message : String(err);
      setStates((all) => ({
        ...all,
        [unit]: { kind: "escalated", ritualId: "", unit, reason, message },
      }));
    }
  }, []);

  const trigger = useCallback(
    async (unit: string, body: TriggerHandoffRitualRequest) => {
      // A fresh `trigger` starts a new session for this unit: reset its budget.
      setRetryCount((m) => ({ ...m, [unit]: 0 }));
      setRetryRefused((m) => ({ ...m, [unit]: false }));
      await dispatchRitual(unit, body);
    },
    [dispatchRitual],
  );

  const retry = useCallback(
    async (unit: string, body: TriggerHandoffRitualRequest) => {
      // DR §E: second rejection is a hard escalate. After the 2nd retry
      // (i.e. the 3rd attempt total counting the initial trigger), refuse.
      if ((retryCount[unit] ?? 0) >= MAX_RETRIES) {
        setRetryRefused((m) => ({ ...m, [unit]: true }));
        return;
      }
      setRetryCount((m) => ({ ...m, [unit]: (m[unit] ?? 0) + 1 }));
      await dispatchRitual(unit, body);
    },
    [dispatchRitual, retryCount],
  );

  const dismiss = useCallback((unit: string) => {
    setStates((all) => {
      if (!(unit in all)) return all;
      const next = { ...all };
      delete next[unit];
      return next;
    });
    setRetryCount((m) => {
      if (!(unit in m)) return m;
      const next = { ...m };
      delete next[unit];
      return next;
    });
    setRetryRefused((m) => {
      if (!(unit in m)) return m;
      const next = { ...m };
      delete next[unit];
      return next;
    });
  }, []);

  return { states, unitPhases, retryCount, retryRefused, trigger, retry, dismiss };
}
