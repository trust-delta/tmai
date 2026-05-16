import { useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api, type UsageSettings } from "@/lib/api";
import { SaveStatus } from "./SaveStatus";

const DEFAULT_INTERVAL_MIN = 30;
const MIN_INTERVAL_MIN = 5;
const MAX_INTERVAL_MIN = 1440;

/**
 * Usage monitoring settings: enabled toggle + auto-refresh interval (in
 * minutes). When enabled, tmai-core periodically spawns a temporary
 * Claude Code instance (Haiku) to fetch the subscription usage.
 */
export function UsageSection() {
  const [usage, setUsage] = useState<UsageSettings | null>(null);
  const save = useSaveTracker();

  useEffect(() => {
    api.getUsageSettings().then(setUsage).catch(console.error);
  }, []);

  if (!usage) return null;

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Usage Monitoring</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-subtle-foreground">
        Periodically fetch Claude Code subscription usage. Spawns a temporary Claude Code instance
        (Haiku) for each refresh.
      </p>

      <div className="mt-3 rounded-lg border border-hairline-strong bg-surface p-3 space-y-3">
        <label className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <span className="text-sm text-foreground">Auto-refresh</span>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !usage.enabled;
              setUsage({ ...usage, enabled: next });
              void save.track(() => api.updateUsageSettings({ enabled: next }), {
                onError: () => setUsage({ ...usage, enabled: !next }),
              });
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              usage.enabled ? "bg-primary/40" : "bg-surface-strong"
            }`}
            aria-label="Usage auto-refresh"
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                usage.enabled
                  ? "translate-x-[18px] bg-primary"
                  : "translate-x-0.5 bg-muted-foreground"
              }`}
            />
          </button>
        </label>

        {usage.enabled && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Interval</span>
            <input
              type="number"
              min={MIN_INTERVAL_MIN}
              max={MAX_INTERVAL_MIN}
              value={usage.auto_refresh_min || DEFAULT_INTERVAL_MIN}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  save.clearError();
                  setUsage({ ...usage, auto_refresh_min: val });
                }
              }}
              onBlur={() => {
                const val = Math.max(
                  MIN_INTERVAL_MIN,
                  usage.auto_refresh_min || DEFAULT_INTERVAL_MIN,
                );
                void save.track(() => api.updateUsageSettings({ auto_refresh_min: val }));
              }}
              className="w-20 rounded-md border border-hairline-strong bg-surface px-2.5 py-1 text-xs text-foreground outline-none focus:border-primary/30"
              aria-label="Usage auto-refresh interval"
            />
            <span className="text-xs text-muted-foreground">minutes</span>
          </div>
        )}
      </div>
    </section>
  );
}
