import { useEffect, useState } from "react";
import type { IdleNotificationConfig } from "@/hooks/useIdleNotification";
import { api } from "@/lib/api";

const DEFAULT_CONFIG: IdleNotificationConfig = { enabled: true, thresholdSecs: 10 };

/**
 * Subscribe to the browser-notification config from `/settings/notifications`.
 *
 * The Settings UI mutates this server-side and tmai-core hot-reloads it (see
 * tmai-core PR #255). Without re-fetching here the App's idle-notification
 * behaviour goes stale — toggling "Notify on idle" off in Settings doesn't
 * actually quiet the browser notifications until the tab reloads. This hook
 * refetches on:
 *
 * - **mount** (initial load),
 * - **window focus** (the user just came back from the Settings tab and may
 *   have toggled the value; a click into the window re-syncs immediately),
 * - **visibility change to visible** (same idea for tab restores from
 *   background).
 *
 * A periodic poll is intentionally NOT added — the focus/visibility hooks
 * cover the realistic write paths. If a future use case needs cross-window
 * sync (e.g. a CLI mutating the file directly), add a small `setInterval`
 * here or move the channel to SSE.
 */
export function useNotificationConfig(): IdleNotificationConfig {
  const [config, setConfig] = useState<IdleNotificationConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      api
        .getNotificationSettings()
        .then((s) => {
          if (cancelled) return;
          setConfig({
            enabled: s.notify_on_idle,
            thresholdSecs: s.notify_idle_threshold_secs,
          });
        })
        .catch(() => {});
    };

    refresh();
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return config;
}
