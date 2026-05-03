import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";
import { api } from "@/lib/api";
import type { DispatchBundle } from "@/types/generated/DispatchBundle";
import type { WorkerDispatchMap } from "@/types/generated/WorkerDispatchMap";
import { DispatchBundleEditor } from "./DispatchBundleEditor";
import { SaveStatus } from "./SaveStatus";

interface DispatchState {
  orchestrator: DispatchBundle | null;
  dispatch: WorkerDispatchMap;
}

/**
 * Settings section that exposes per-role dispatch bundle editing for
 * orchestrator / implementer / reviewer (#578 — auto-save).
 *
 * Atomic fields (vendor / permission_mode / effort dropdowns and the "Use
 * vendor CLI default" checkbox) persist on change; the model text field
 * persists on blur or Enter so we do not flicker validation errors mid-typing.
 *
 * Reads the bundles from `GET /settings/orchestrator` (the global settings
 * endpoint that carries the dispatch fields alongside notify/guardrails/...)
 * and saves them via the same endpoint's PUT — server-side `OrchestrationSettings`
 * is the single source of truth, so this component only roundtrips the dispatch
 * subset of fields.
 *
 * Backend 400s surface as inline error text. For atomic changes we roll back
 * to the last-saved bundle; for text-commit errors we leave the user's draft
 * in place so they can correct it.
 */
export function OrchestrationDispatchSection() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef<DispatchState | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .getOrchestratorSettings()
      .then((s) => {
        const initial = {
          orchestrator: s.orchestrator ?? null,
          dispatch: s.dispatch,
        };
        setState(initial);
        lastSavedRef.current = initial;
      })
      .catch(console.error);
    return () => {
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
    };
  }, []);

  const persist = useCallback(
    async (next: DispatchState, options: { rollbackOnError: boolean }) => {
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
      setStatus("saving");
      setError(null);
      try {
        await api.updateOrchestratorSettings({
          orchestrator: next.orchestrator,
          dispatch: next.dispatch,
        });
        lastSavedRef.current = next;
        setStatus("saved");
        fadeRef.current = setTimeout(() => {
          fadeRef.current = null;
          setStatus((s) => (s === "saved" ? "idle" : s));
        }, 1000);
      } catch (e) {
        if (options.rollbackOnError && lastSavedRef.current) {
          setState(lastSavedRef.current);
        }
        setStatus("error");
        setError(e instanceof Error ? e.message : "Save failed");
      }
    },
    [],
  );

  if (!state) return null;

  // ── Orchestrator role ──────────────────────────────────────────
  const handleOrchestratorAtomic = (bundle: DispatchBundle | null) => {
    const next = { ...state, orchestrator: bundle };
    setState(next);
    void persist(next, { rollbackOnError: true });
  };
  const handleOrchestratorTextDraft = (bundle: DispatchBundle | null) => {
    setState({ ...state, orchestrator: bundle });
    if (status === "error") {
      setStatus("idle");
      setError(null);
    }
  };
  const handleOrchestratorTextCommit = (bundle: DispatchBundle | null) => {
    const next = { ...state, orchestrator: bundle };
    setState(next);
    void persist(next, { rollbackOnError: false });
  };

  // ── Implementer role ───────────────────────────────────────────
  const handleImplementerAtomic = (bundle: DispatchBundle | null) => {
    const next = { ...state, dispatch: { ...state.dispatch, implementer: bundle } };
    setState(next);
    void persist(next, { rollbackOnError: true });
  };
  const handleImplementerTextDraft = (bundle: DispatchBundle | null) => {
    setState({ ...state, dispatch: { ...state.dispatch, implementer: bundle } });
    if (status === "error") {
      setStatus("idle");
      setError(null);
    }
  };
  const handleImplementerTextCommit = (bundle: DispatchBundle | null) => {
    const next = { ...state, dispatch: { ...state.dispatch, implementer: bundle } };
    setState(next);
    void persist(next, { rollbackOnError: false });
  };

  // ── Reviewer role ──────────────────────────────────────────────
  const handleReviewerAtomic = (bundle: DispatchBundle | null) => {
    const next = { ...state, dispatch: { ...state.dispatch, reviewer: bundle } };
    setState(next);
    void persist(next, { rollbackOnError: true });
  };
  const handleReviewerTextDraft = (bundle: DispatchBundle | null) => {
    setState({ ...state, dispatch: { ...state.dispatch, reviewer: bundle } });
    if (status === "error") {
      setStatus("idle");
      setError(null);
    }
  };
  const handleReviewerTextCommit = (bundle: DispatchBundle | null) => {
    const next = { ...state, dispatch: { ...state.dispatch, reviewer: bundle } };
    setState(next);
    void persist(next, { rollbackOnError: false });
  };

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Orchestration dispatch</h3>
        <SaveStatus status={status} error={error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Per-role dispatch bundles: vendor, model, permission mode, and effort for each agent role.
        Leave "Use vendor CLI default" checked to launch that role with the vendor CLI's own
        defaults (no <code>--model</code> / <code>--permission-mode</code> flags injected).
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
        <DispatchBundleEditor
          title="Orchestrator"
          subtitle="the agent you attach to"
          bundle={state.orchestrator}
          onAtomicChange={handleOrchestratorAtomic}
          onTextDraft={handleOrchestratorTextDraft}
          onTextCommit={handleOrchestratorTextCommit}
        />
        <DispatchBundleEditor
          title="Implementer"
          subtitle="dispatch_issue / spawn_worktree"
          bundle={state.dispatch.implementer ?? null}
          onAtomicChange={handleImplementerAtomic}
          onTextDraft={handleImplementerTextDraft}
          onTextCommit={handleImplementerTextCommit}
        />
        <DispatchBundleEditor
          title="Reviewer"
          subtitle="dispatch_review"
          bundle={state.dispatch.reviewer ?? null}
          onAtomicChange={handleReviewerAtomic}
          onTextDraft={handleReviewerTextDraft}
          onTextCommit={handleReviewerTextCommit}
        />
      </div>
    </section>
  );
}
