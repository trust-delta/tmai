import { useCallback, useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type OrchestratorSettings } from "@/lib/api";
import { GuardrailsSection } from "./GuardrailsSection";
import { NotifySettingsSection } from "./NotifySettingsSection";
import { PrMonitorSection } from "./PrMonitorSection";
import { SaveStatus } from "./SaveStatus";

const ROW_INPUT_CLS =
  "w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y";

const RULE_FIELDS = [
  {
    key: "branch",
    label: "Branch rules",
    placeholder: "Rules for branch naming and strategy...",
    rows: 2,
  },
  {
    key: "merge",
    label: "Merge rules",
    placeholder: "Rules for merge strategy and conflict resolution...",
    rows: 2,
  },
  {
    key: "review",
    label: "Review rules",
    placeholder: "Rules for code review process...",
    rows: 2,
  },
  {
    key: "custom",
    label: "Custom rules",
    placeholder: "Additional custom rules for the orchestrator...",
    rows: 3,
  },
] as const satisfies ReadonlyArray<{
  key: keyof OrchestratorSettings["rules"];
  label: string;
  placeholder: string;
  rows: number;
}>;

interface OrchestrationSectionProps {
  /** Project paths registered globally — needed by the scope selector to
   *  list per-project overrides alongside `Global (default)`. */
  projects: string[];
}

/**
 * Settings section that hosts the orchestrator agent's full configuration:
 * scope (global vs per-project override), enabled toggle, role + workflow
 * rule textareas, and the three composed sub-sections (PR Monitor, Notify,
 * Guardrails).
 *
 * Owns its own state (`orchestrator`, `orchScope`, `orchestratorSave`) and
 * load — the parent SettingsPanel does not need to refresh this section.
 * Switching `orchScope` re-fetches the merged settings for that scope.
 */
export function OrchestrationSection({ projects }: OrchestrationSectionProps) {
  const [orchestrator, setOrchestrator] = useState<OrchestratorSettings | null>(null);
  const [orchScope, setOrchScope] = useState<string>("global");
  const save = useSaveTracker();

  const orchProject = orchScope === "global" ? undefined : orchScope;
  const refreshOrchestrator = useCallback(() => {
    api.getOrchestratorSettings(orchProject).then(setOrchestrator).catch(console.error);
  }, [orchProject]);

  useEffect(() => {
    refreshOrchestrator();
  }, [refreshOrchestrator]);

  if (!orchestrator) return null;

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Orchestration</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Configure the orchestrator agent that coordinates sub-agents for parallel development
        workflows.
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-4">
        {/* Scope selector */}
        <div>
          <span className="block text-xs text-zinc-400 mb-1">Scope</span>
          <select
            value={orchScope}
            onChange={(e) => setOrchScope(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
            aria-label="Orchestration scope"
          >
            <option value="global">Global (default)</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {orchScope !== "global" && (
            <p className="mt-1 text-[10px] text-zinc-600">
              {orchestrator.is_project_override
                ? "Project-level override active"
                : "Using global settings (no project override)"}
            </p>
          )}
        </div>

        {/* Enable toggle */}
        <label className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <span className="text-sm text-zinc-300">Enabled</span>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Enable orchestrator workflow features.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !orchestrator.enabled;
              setOrchestrator({ ...orchestrator, enabled: next });
              void save.track(
                async () => {
                  await api.updateOrchestratorSettings({ enabled: next }, orchProject);
                  refreshOrchestrator();
                },
                { onError: () => setOrchestrator({ ...orchestrator, enabled: !next }) },
              );
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              orchestrator.enabled ? "bg-cyan-500/40" : "bg-white/10"
            }`}
            aria-label="Orchestrator enabled"
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                orchestrator.enabled
                  ? "translate-x-[18px] bg-cyan-400"
                  : "translate-x-0.5 bg-zinc-500"
              }`}
            />
          </button>
        </label>

        {orchestrator.enabled && (
          <div className="space-y-3 border-t border-white/5 pt-3">
            <OrchestrationRuleTextarea
              label="Role"
              placeholder="Describe the orchestrator's role and persona..."
              rows={2}
              value={orchestrator.role}
              save={save}
              onDraft={(role) => setOrchestrator({ ...orchestrator, role })}
              onCommit={(role) => api.updateOrchestratorSettings({ role }, orchProject)}
            />

            <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Workflow Rules
            </p>

            {RULE_FIELDS.map(({ key, label, placeholder, rows }) => (
              <OrchestrationRuleTextarea
                key={key}
                label={label}
                placeholder={placeholder}
                rows={rows}
                value={orchestrator.rules[key]}
                save={save}
                onDraft={(value) =>
                  setOrchestrator({
                    ...orchestrator,
                    rules: { ...orchestrator.rules, [key]: value },
                  })
                }
                onCommit={(value) =>
                  api.updateOrchestratorSettings({ rules: { [key]: value } }, orchProject)
                }
              />
            ))}

            <PrMonitorSection
              orchestrator={orchestrator}
              setOrchestrator={setOrchestrator}
              orchProject={orchProject}
              save={save}
            />

            <NotifySettingsSection
              orchestrator={orchestrator}
              setOrchestrator={setOrchestrator}
              orchProject={orchProject}
              save={save}
            />

            <GuardrailsSection
              orchestrator={orchestrator}
              setOrchestrator={setOrchestrator}
              orchProject={orchProject}
              save={save}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Auto-saved textarea used by the orchestration role / workflow-rule fields.
 * Local edits stream through `onDraft`; on blur (or Cmd/Ctrl+Enter) the value
 * is committed via `onCommit`, routed through the section's save tracker so
 * Saving / Saved / error indicators stay in sync. Mid-typing keystrokes clear
 * a stale error so the inline message doesn't linger after the user starts
 * correcting it.
 */
function OrchestrationRuleTextarea({
  label,
  placeholder,
  rows,
  value,
  save,
  onDraft,
  onCommit,
}: {
  label: string;
  placeholder: string;
  rows: number;
  value: string;
  save: ReturnType<typeof useSaveTracker>;
  onDraft: (value: string) => void;
  onCommit: (value: string) => Promise<unknown>;
}) {
  return (
    <div>
      <span className="block text-xs text-zinc-400 mb-1">{label}</span>
      <textarea
        value={value}
        onChange={(e) => {
          save.clearError();
          onDraft(e.target.value);
        }}
        onBlur={() => {
          const commit = value;
          void save.track(() => onCommit(commit));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
        rows={rows}
        placeholder={placeholder}
        className={ROW_INPUT_CLS}
        aria-label={label}
      />
    </div>
  );
}
