import { useEffect, useState } from "react";
import type { OrchestrationSettings } from "@/lib/api";
import { api } from "@/lib/api";
import type { DispatchBundle } from "@/types/generated/DispatchBundle";
import { DispatchBundleEditor } from "./DispatchBundleEditor";

/**
 * Settings section that exposes per-role dispatch bundle editing for
 * orchestrator / implementer / reviewer.
 *
 * Sends PUT /settings/orchestration on save; surfaces validation errors
 * from the backend as inline error text (the server returns 400 with a
 * descriptive message when the vendor×model×permission_mode triple is invalid).
 */
export function OrchestrationDispatchSection() {
  const [settings, setSettings] = useState<OrchestrationSettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getOrchestrationSettings().then(setSettings).catch(console.error);
  }, []);

  if (!settings) return null;

  const handleOrchestratorChange = (bundle: DispatchBundle | null) => {
    setSettings({ ...settings, orchestrator: bundle });
    setSaved(false);
  };

  const handleImplementerChange = (bundle: DispatchBundle | null) => {
    setSettings({
      ...settings,
      dispatch: { ...settings.dispatch, implementer: bundle },
    });
    setSaved(false);
  };

  const handleReviewerChange = (bundle: DispatchBundle | null) => {
    setSettings({
      ...settings,
      dispatch: { ...settings.dispatch, reviewer: bundle },
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateOrchestrationSettings({
        orchestrator: settings.orchestrator,
        dispatch: settings.dispatch,
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
      <h3 className="text-sm font-medium text-zinc-300">Orchestration</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Per-role dispatch bundles: vendor, model, permission mode, and effort for each agent role.
        Leave "Use legacy" checked to fall back to the <code>[spawn.*]</code> config.
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
        <DispatchBundleEditor
          title="Orchestrator"
          subtitle="the agent you attach to"
          bundle={settings.orchestrator}
          onChange={handleOrchestratorChange}
        />
        <DispatchBundleEditor
          title="Implementer"
          subtitle="dispatch_issue / spawn_worktree"
          bundle={settings.dispatch.implementer ?? null}
          onChange={handleImplementerChange}
        />
        <DispatchBundleEditor
          title="Reviewer"
          subtitle="dispatch_review"
          bundle={settings.dispatch.reviewer ?? null}
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
