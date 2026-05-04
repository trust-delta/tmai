import { useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { api } from "@/lib/api";
import { SaveStatus } from "./SaveStatus";

const MIN_THRESHOLD_SECS = 0;
const MAX_THRESHOLD_SECS = 300;
const DEFAULT_THRESHOLD_SECS = 10;

/**
 * Browser-notification settings: notify-on-idle toggle + idle threshold
 * (seconds). Distinct from the orchestrator's per-event notification
 * routing (`NotifySettingsSection`) — this controls whether the browser
 * itself raises a notification on the idle transition.
 */
export function NotificationSection() {
  const [notifyOnIdle, setNotifyOnIdle] = useState(true);
  const [thresholdSecs, setThresholdSecs] = useState(DEFAULT_THRESHOLD_SECS);
  const save = useSaveTracker();

  useEffect(() => {
    api
      .getNotificationSettings()
      .then((s) => {
        setNotifyOnIdle(s.notify_on_idle);
        setThresholdSecs(s.notify_idle_threshold_secs);
      })
      .catch(() => {});
  }, []);

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Notifications</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Browser notifications when agents finish processing and become idle.
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
        <label className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <span className="text-sm text-zinc-300">Notify on idle</span>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Send a browser notification when an agent transitions from Processing to Idle.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const prev = notifyOnIdle;
              const next = !prev;
              setNotifyOnIdle(next);
              void save.track(() => api.updateNotificationSettings({ notify_on_idle: next }), {
                onError: () => setNotifyOnIdle(prev),
              });
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              notifyOnIdle ? "bg-cyan-500/40" : "bg-white/10"
            }`}
            aria-label="Notify on idle"
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                notifyOnIdle ? "translate-x-[18px] bg-cyan-400" : "translate-x-0.5 bg-zinc-500"
              }`}
            />
          </button>
        </label>

        {notifyOnIdle && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-zinc-500">Idle threshold</span>
            <input
              type="number"
              min={MIN_THRESHOLD_SECS}
              max={MAX_THRESHOLD_SECS}
              value={thresholdSecs}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  save.clearError();
                  setThresholdSecs(val);
                }
              }}
              onBlur={() => {
                const val = Math.max(MIN_THRESHOLD_SECS, thresholdSecs);
                void save.track(() =>
                  api.updateNotificationSettings({ notify_idle_threshold_secs: val }),
                );
              }}
              className="w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
              aria-label="Idle threshold seconds"
            />
            <span className="text-xs text-zinc-500">seconds</span>
          </div>
        )}

        {notifyOnIdle && (
          <p className="text-[10px] text-zinc-600">
            Hook-detected (◈) agents notify immediately. Capture-pane (●) agents wait the full
            threshold to filter out transient state flickers.
          </p>
        )}
      </div>
    </section>
  );
}
