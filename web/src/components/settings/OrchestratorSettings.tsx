import { useCallback, useEffect, useState } from "react";
import {
  fetchProjects,
  getOrchestratorSettings,
  updateOrchestratorSettings,
  type OrchestratorSettings as OrchestratorSettingsType,
} from "../../api/client";

interface OrchestratorSettingsProps {
  onClose: () => void;
}

/** Panel for editing per-project orchestrator settings */
export function OrchestratorSettingsPanel({ onClose }: OrchestratorSettingsProps) {
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>("global");
  const [settings, setSettings] = useState<OrchestratorSettingsType | null>(null);
  const [saving, setSaving] = useState(false);

  // Load project list
  useEffect(() => {
    fetchProjects().then(setProjects).catch(console.error);
  }, []);

  // Resolve project param from scope selector
  const projectParam = selectedScope === "global" ? undefined : selectedScope;

  // Load settings when scope changes
  const refresh = useCallback(() => {
    getOrchestratorSettings(projectParam)
      .then(setSettings)
      .catch(console.error);
  }, [projectParam]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Save a partial update */
  const save = async (patch: Parameters<typeof updateOrchestratorSettings>[0]) => {
    setSaving(true);
    try {
      await updateOrchestratorSettings(patch, projectParam);
      refresh();
    } catch (e) {
      console.error("Failed to save orchestrator settings", e);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-lg border border-neutral-300 bg-white p-6 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Orchestrator Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            &times;
          </button>
        </div>

        {/* Scope selector */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-400">
            Scope
          </label>
          <select
            value={selectedScope}
            onChange={(e) => setSelectedScope(e.target.value)}
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
          >
            <option value="global">Global (default)</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {settings.is_project_override && selectedScope !== "global" && (
            <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
              Project-level override active
            </p>
          )}
          {!settings.is_project_override && selectedScope !== "global" && (
            <p className="mt-1 text-xs text-neutral-500">
              Using global settings (no project override)
            </p>
          )}
        </div>

        <div className="space-y-4">
          {/* Enable toggle */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => save({ enabled: e.target.checked })}
              className="h-4 w-4"
              disabled={saving}
            />
            <span className="text-sm">Enable orchestrator</span>
          </label>

          {settings.enabled && (
            <>
              {/* Role */}
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-400">
                  Role
                </label>
                <textarea
                  value={settings.role}
                  onChange={(e) =>
                    setSettings({ ...settings, role: e.target.value })
                  }
                  onBlur={() => save({ role: settings.role })}
                  rows={3}
                  className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
                  disabled={saving}
                />
              </div>

              {/* Rules */}
              <fieldset className="space-y-3 rounded border border-neutral-200 p-3 dark:border-neutral-700">
                <legend className="px-1 text-sm font-medium">Workflow Rules</legend>

                <div>
                  <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">
                    Branch
                  </label>
                  <input
                    type="text"
                    value={settings.rules.branch}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        rules: { ...settings.rules, branch: e.target.value },
                      })
                    }
                    onBlur={() =>
                      save({ rules: { branch: settings.rules.branch } })
                    }
                    placeholder="e.g. {issue_number}-{slug}"
                    className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
                    disabled={saving}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">
                    Merge
                  </label>
                  <input
                    type="text"
                    value={settings.rules.merge}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        rules: { ...settings.rules, merge: e.target.value },
                      })
                    }
                    onBlur={() =>
                      save({ rules: { merge: settings.rules.merge } })
                    }
                    placeholder="e.g. squash merge to main"
                    className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
                    disabled={saving}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">
                    Review
                  </label>
                  <input
                    type="text"
                    value={settings.rules.review}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        rules: { ...settings.rules, review: e.target.value },
                      })
                    }
                    onBlur={() =>
                      save({ rules: { review: settings.rules.review } })
                    }
                    placeholder="e.g. check CI before merge"
                    className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
                    disabled={saving}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">
                    Custom
                  </label>
                  <textarea
                    value={settings.rules.custom}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        rules: { ...settings.rules, custom: e.target.value },
                      })
                    }
                    onBlur={() =>
                      save({ rules: { custom: settings.rules.custom } })
                    }
                    rows={2}
                    placeholder="Free-form rules..."
                    className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800"
                    disabled={saving}
                  />
                </div>
              </fieldset>
            </>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
