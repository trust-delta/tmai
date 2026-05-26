import { useCallback, useEffect, useMemo, useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type OrchestratorSettings, withOrchestratorDefaults } from "@/lib/api";
import { PrMonitorSection } from "./PrMonitorSection";
import { SaveStatus } from "./SaveStatus";

const ROW_INPUT_CLS =
  "w-full rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder-subtle-foreground outline-none focus:border-primary/30 resize-y";

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
  /** Project paths derived from currently active agents — used to seed the
   *  scope dropdown so the common case (override the project I'm working
   *  on) is one click. Arbitrary paths can still be picked via the Browse
   *  button, which lets users edit overrides for projects with no live
   *  agent without us needing a separate "list configured overrides" API. */
  projects: string[];
}

/**
 * Settings section that hosts the orchestrator agent's full configuration:
 * scope (global vs per-project override), enabled toggle, role + workflow
 * rule textareas, and the composed PR Monitor sub-section.
 *
 * Owns its own state (`orchestrator`, `orchScope`, `orchestratorSave`) and
 * load — the parent SettingsPanel does not need to refresh this section.
 * Switching `orchScope` re-fetches the merged settings for that scope.
 */
export function OrchestrationSection({ projects }: OrchestrationSectionProps) {
  const [orchestrator, setOrchestrator] = useState<OrchestratorSettings | null>(null);
  const [orchScope, setOrchScope] = useState<string>("global");
  const [browsing, setBrowsing] = useState(false);
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  // Browse-picked paths persist for the session so switching scope back to
  // global doesn't drop them from the dropdown — CodeRabbit caught this on
  // PR #615 review.
  const [pickedPaths, setPickedPaths] = useState<Set<string>>(() => new Set());
  const save = useSaveTracker();

  const refreshDefaultRoot = useCallback(() => {
    api
      .getGeneralSettings()
      .then((g) => setDefaultRoot(g.default_project_root))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshDefaultRoot();
  }, [refreshDefaultRoot]);

  const orchProject = orchScope === "global" ? undefined : orchScope;
  const refreshOrchestrator = useCallback(() => {
    // Coalesce wire-omitted sub-tables (notify / rules) to their engine
    // defaults here at the boundary so the sub-sections never deref an
    // `undefined` object and black out the panel.
    api
      .getOrchestratorSettings(orchProject)
      .then((s) => setOrchestrator(withOrchestratorDefaults(s)))
      .catch(console.error);
  }, [orchProject]);

  useEffect(() => {
    refreshOrchestrator();
  }, [refreshOrchestrator]);

  // Dropdown options = active projects ∪ session-picked paths ∪ current
  // scope, so a path picked via Browse stays visible across scope toggles
  // for the rest of the session.
  const scopeOptions = useMemo(() => {
    const set = new Set(projects);
    for (const p of pickedPaths) set.add(p);
    if (orchScope !== "global") set.add(orchScope);
    return [...set];
  }, [projects, pickedPaths, orchScope]);

  if (!orchestrator) return null;

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Orchestration</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">
        Configure the orchestrator agent that coordinates sub-agents for parallel development
        workflows.
      </p>

      <div className="mt-3 rounded-lg border border-hairline-strong bg-surface p-3 space-y-4">
        {/* Scope selector */}
        <div>
          <span className="block text-xs text-muted-foreground mb-1">Scope</span>
          <div className="flex gap-1.5">
            <select
              value={orchScope}
              onChange={(e) => setOrchScope(e.target.value)}
              className="flex-1 min-w-0 rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/30"
              aria-label="Orchestration scope"
            >
              <option value="global">Global (default)</option>
              {scopeOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                // Re-fetch so an edit made in GeneralSection within the same
                // SettingsPanel session is reflected before opening the
                // browser — this section does not unmount on its own.
                refreshDefaultRoot();
                setBrowsing(true);
              }}
              className="shrink-0 rounded-md border border-hairline-strong px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
              aria-label="Browse for project directory"
            >
              Browse
            </button>
          </div>
          {orchScope !== "global" && (
            <p className="mt-1 text-[10px] text-subtle-foreground">
              {orchestrator.is_project_override
                ? "Project-level override active"
                : "Using global settings (no project override)"}
            </p>
          )}
        </div>

        {browsing && (
          <DirBrowser
            startPath={defaultRoot ?? undefined}
            onSelect={(path) => {
              setOrchScope(path);
              setPickedPaths((prev) => {
                if (prev.has(path)) return prev;
                const next = new Set(prev);
                next.add(path);
                return next;
              });
              setBrowsing(false);
            }}
            onCancel={() => setBrowsing(false)}
          />
        )}

        {/* Enable toggle */}
        <label className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <span className="text-sm text-foreground">Enabled</span>
            <p className="text-[11px] text-subtle-foreground mt-0.5">
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
              orchestrator.enabled ? "bg-primary/40" : "bg-surface-strong"
            }`}
            aria-label="Orchestrator enabled"
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                orchestrator.enabled
                  ? "translate-x-[18px] bg-primary"
                  : "translate-x-0.5 bg-muted-foreground"
              }`}
            />
          </button>
        </label>

        {orchestrator.enabled && (
          <div className="space-y-3 border-t border-hairline pt-3">
            <OrchestrationRuleTextarea
              label="Role"
              placeholder="Describe the orchestrator's role and persona..."
              rows={2}
              value={orchestrator.role}
              save={save}
              onDraft={(role) => setOrchestrator({ ...orchestrator, role })}
              onCommit={(role) => api.updateOrchestratorSettings({ role }, orchProject)}
            />

            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
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
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
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
