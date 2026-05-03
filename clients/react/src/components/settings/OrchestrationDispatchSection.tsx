import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DispatchBundle } from "@/types/generated/DispatchBundle";
import type { WorkerDispatchMap } from "@/types/generated/WorkerDispatchMap";
import { DispatchBundleEditor } from "./DispatchBundleEditor";

interface DispatchState {
  orchestrator: DispatchBundle | null;
  dispatch: WorkerDispatchMap;
}

/**
 * Settings section that exposes per-role dispatch bundle editing for
 * orchestrator / implementer / reviewer.
 *
 * Reads the bundles from `GET /settings/orchestrator` (the global settings
 * endpoint that carries the dispatch fields alongside notify/guardrails/...)
 * and saves them via the same endpoint's PUT — server-side `OrchestrationSettings`
 * is the single source of truth, so this component only roundtrips the dispatch
 * subset of fields.
 *
 * Surfaces validation errors from the backend as inline error text (the server
 * returns 400 with a descriptive message when the vendor×model×permission_mode
 * triple is invalid).
 */
export function OrchestrationDispatchSection() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getOrchestratorSettings()
      .then((s) =>
        setState({
          orchestrator: s.orchestrator ?? null,
          dispatch: s.dispatch,
        }),
      )
      .catch(console.error);
  }, []);

  if (!state) return null;

  const handleOrchestratorChange = (bundle: DispatchBundle | null) => {
    setState({ ...state, orchestrator: bundle });
    setSaved(false);
  };

  const handleImplementerChange = (bundle: DispatchBundle | null) => {
    setState({
      ...state,
      dispatch: { ...state.dispatch, implementer: bundle },
    });
    setSaved(false);
  };

  const handleReviewerChange = (bundle: DispatchBundle | null) => {
    setState({
      ...state,
      dispatch: { ...state.dispatch, reviewer: bundle },
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateOrchestratorSettings({
        orchestrator: state.orchestrator,
        dispatch: state.dispatch,
      });
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-zinc-300">Orchestration dispatch</h3>
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
          onChange={handleOrchestratorChange}
        />
        <DispatchBundleEditor
          title="Implementer"
          subtitle="dispatch_issue / spawn_worktree"
          bundle={state.dispatch.implementer ?? null}
          onChange={handleImplementerChange}
        />
        <DispatchBundleEditor
          title="Reviewer"
          subtitle="dispatch_review"
          bundle={state.dispatch.reviewer ?? null}
          onChange={handleReviewerChange}
        />

        {saveError && (
          <p className="text-xs text-red-400 break-words" role="alert">
            {saveError}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-xs font-medium bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && !saving && <span className="text-xs text-zinc-500">Saved</span>}
        </div>
      </div>
    </section>
  );
}
