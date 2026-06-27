import type { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type ProducerSettings } from "@/lib/api";

/** PR Monitor settings — automatic PR/CI status monitoring */
export function PrMonitorSection({
  orchestrator,
  setOrchestrator,
  orchProject,
  save,
}: {
  orchestrator: ProducerSettings;
  setOrchestrator: (v: ProducerSettings) => void;
  orchProject: string | undefined;
  save: ReturnType<typeof useSaveTracker>;
}) {
  const updateInterval = (value: number) => {
    const clamped = Math.max(10, Math.min(3600, value));
    setOrchestrator({ ...orchestrator, pr_monitor_interval_secs: clamped });
    void save.track(() =>
      api.updateProducerSettings({ pr_monitor_interval_secs: clamped }, orchProject),
    );
  };

  return (
    <>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">
        PR Monitor
      </h4>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-xs text-foreground">Enable PR monitoring</span>
            <p className="text-[10px] text-subtle-foreground leading-tight">
              Automatically poll PR/CI status and send notifications
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !orchestrator.pr_monitor_enabled;
              setOrchestrator({ ...orchestrator, pr_monitor_enabled: next });
              void save.track(
                () => api.updateProducerSettings({ pr_monitor_enabled: next }, orchProject),
                {
                  onError: () => setOrchestrator({ ...orchestrator, pr_monitor_enabled: !next }),
                },
              );
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              orchestrator.pr_monitor_enabled ? "bg-primary/40" : "bg-surface-strong"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-foreground transition-transform ${
                orchestrator.pr_monitor_enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {!orchestrator.pr_monitor_enabled && (
          <div
            role="alert"
            className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] leading-snug text-warning"
          >
            ⚠ PR Monitor is disabled. CI-pass / PR-comment / agent-stopped events that rely on PR
            state polling will not reach the orchestrator.
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-xs text-foreground">Poll interval (seconds)</span>
            <p className="text-[10px] text-subtle-foreground leading-tight">
              How often to check PR/CI status (10–3600)
            </p>
          </div>
          <input
            type="number"
            min={10}
            max={3600}
            value={orchestrator.pr_monitor_interval_secs}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                save.clearError();
                setOrchestrator({ ...orchestrator, pr_monitor_interval_secs: val });
              }
            }}
            onBlur={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                updateInterval(val);
              }
            }}
            className="w-16 rounded-md border border-hairline-strong bg-surface px-2 py-1 text-xs text-foreground text-center outline-none focus:border-primary/30"
          />
        </div>
      </div>
    </>
  );
}
