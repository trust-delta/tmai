import { useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type WorkflowSettings } from "@/lib/api";
import { SaveStatus } from "./SaveStatus";

/**
 * Workflow automation settings — currently a single toggle for auto-rebase
 * on PR merge. Kept as its own section so future workflow tunables (queue
 * caps, branch-protection retries, etc.) drop in alongside without
 * crowding `SettingsPanel`.
 */
export function WorkflowSection() {
  const [workflow, setWorkflow] = useState<WorkflowSettings | null>(null);
  const save = useSaveTracker();

  useEffect(() => {
    api
      .getWorkflowSettings()
      .then(setWorkflow)
      .catch(() => {});
  }, []);

  if (!workflow) return null;

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Workflow</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">Workflow automation settings.</p>

      <div className="mt-3 rounded-lg border border-hairline-strong bg-surface p-3">
        <label className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <span className="text-sm text-foreground">Auto-rebase on merge</span>
            <p className="text-[11px] text-subtle-foreground mt-0.5">
              Automatically rebase open worktree branches onto main after a PR merge.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !workflow.auto_rebase_on_merge;
              setWorkflow({ ...workflow, auto_rebase_on_merge: next });
              void save.track(() => api.updateWorkflowSettings({ auto_rebase_on_merge: next }), {
                onError: () => setWorkflow({ ...workflow, auto_rebase_on_merge: !next }),
              });
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              workflow.auto_rebase_on_merge ? "bg-primary/40" : "bg-surface-strong"
            }`}
            aria-label="Auto-rebase on merge"
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                workflow.auto_rebase_on_merge
                  ? "translate-x-[18px] bg-primary"
                  : "translate-x-0.5 bg-muted-foreground"
              }`}
            />
          </button>
        </label>
      </div>
    </section>
  );
}
