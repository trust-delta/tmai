import { useCallback, useEffect, useState } from "react";
import { api, subscribeSSE, type UsageSnapshot } from "@/lib/api";

// Color class based on usage percentage
function meterColor(percent: number): string {
  if (percent >= 80) return "text-red-400";
  if (percent >= 50) return "text-amber-400";
  return "text-cyan-400";
}

// Bar gradient class based on usage percentage
function barGradient(percent: number): string {
  if (percent >= 80) return "from-red-500 to-red-400";
  if (percent >= 50) return "from-amber-500 to-amber-400";
  return "from-cyan-500 to-blue-500";
}

// Format "fetched_at" as relative time
function timeAgo(fetchedAt: string | null): string {
  if (!fetchedAt) return "Never";
  const diff = Date.now() - new Date(fetchedAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

// Sidebar usage panel showing subscription usage meters
export function UsagePanel() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Initial load
  useEffect(() => {
    api.getUsage().then(setUsage).catch(console.error);
  }, []);

  // SSE subscription for real-time updates
  useEffect(() => {
    const { unlisten } = subscribeSSE({
      onEvent: (eventName, data) => {
        if (eventName === "usage") {
          setUsage(data as UsageSnapshot);
          setFetching(false);
        }
      },
    });
    return unlisten;
  }, []);

  // Trigger a fetch
  const handleFetch = useCallback(() => {
    setFetching(true);
    api.fetchUsage().catch(() => setFetching(false));
  }, []);

  // Nothing to show if no usage data and not fetching
  const hasData = usage && usage.meters.length > 0;

  return (
    <div className="border-t border-white/5">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-white/5"
      >
        <span className="text-[10px] font-semibold tracking-wider text-zinc-500">USAGE</span>

        {/* Collapsed: show top 2 meters as badges */}
        {!expanded && hasData && (
          <div className="flex flex-1 items-center gap-2">
            {usage.meters.slice(0, 2).map((m) => (
              <span key={m.label} className={`text-[11px] font-medium ${meterColor(m.percent)}`}>
                {m.percent}%
              </span>
            ))}
          </div>
        )}

        {!expanded && !hasData && <span className="flex-1 text-[11px] text-zinc-600">—</span>}

        {/* Refresh button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleFetch();
          }}
          className={`text-xs text-zinc-500 transition-colors hover:text-zinc-300 ${
            fetching ? "animate-spin" : ""
          }`}
        >
          ↻
        </button>
      </button>

      {/* Expanded: show full meters */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3">
          {hasData ? (
            <>
              {usage.meters.map((m) => (
                <div key={m.label} className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-zinc-400">{m.label}</span>
                    <span className={`text-[11px] font-medium ${meterColor(m.percent)}`}>
                      {m.percent}%
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${barGradient(m.percent)} transition-all duration-500`}
                      style={{ width: `${Math.min(m.percent, 100)}%` }}
                    />
                  </div>
                  {/* Reset info / spending */}
                  {(m.reset_info || m.spending) && (
                    <p className="text-[10px] text-zinc-600">
                      {m.spending && <span>{m.spending}</span>}
                      {m.spending && m.reset_info && <span> · </span>}
                      {m.reset_info && <span>{m.reset_info}</span>}
                    </p>
                  )}
                </div>
              ))}
              {/* Updated timestamp */}
              <p className="text-[10px] text-zinc-600">Updated {timeAgo(usage.fetched_at)}</p>
            </>
          ) : (
            <p className="text-[11px] text-zinc-600">
              {fetching ? "Fetching usage..." : "Click ↻ to fetch usage data"}
            </p>
          )}

          {usage?.error && <p className="text-[10px] text-red-400/70">{usage.error}</p>}
        </div>
      )}
    </div>
  );
}
