/**
 * Edge configuration panel — shown when an edge is selected in the flow editor.
 *
 * Displays resolve steps and route conditions for the selected edge.
 */

import type { FlowEdgeConfig, RouteStepConfig } from "@/lib/api";

interface EdgeConfigPanelProps {
  edgeConfig: FlowEdgeConfig;
  route: RouteStepConfig;
}

/** Config panel for a selected flow edge */
export function EdgeConfigPanel({ edgeConfig, route }: EdgeConfigPanelProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Edge: {edgeConfig.from} &rarr; {route.target ?? "(direct)"}
      </h4>

      {/* Trigger */}
      <div>
        <span className="text-[10px] text-zinc-500">Trigger</span>
        <p className="text-xs text-zinc-300">{edgeConfig.event}</p>
      </div>

      {/* Resolve steps */}
      {edgeConfig.resolve.length > 0 && (
        <div>
          <span className="text-[10px] text-zinc-500">Resolve Steps</span>
          <div className="mt-1 space-y-1">
            {edgeConfig.resolve.map((r) => (
              <div
                key={r.name}
                className="rounded border border-white/[0.06] bg-white/[0.03] px-2 py-1"
              >
                <span className="font-mono text-xs text-cyan-400">{r.name}</span>
                <span className="text-[10px] text-zinc-500"> = {r.query}()</span>
                {r.filter && (
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-500">filter: {r.filter}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All routes for this edge */}
      <div>
        <span className="text-[10px] text-zinc-500">Routes ({edgeConfig.route.length})</span>
        <div className="mt-1 space-y-1">
          {edgeConfig.route.map((r) => (
            <div
              key={`${r.when}-${r.action}-${r.target ?? "direct"}`}
              className={`rounded border px-2 py-1 ${
                r === route
                  ? "border-cyan-500/30 bg-cyan-950/30"
                  : "border-white/[0.06] bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-zinc-400">when</span>
                <span className="font-mono text-xs text-zinc-200">{r.when}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-zinc-500">{r.action}</span>
                {r.target && <span className="text-[10px] text-cyan-400">&rarr; {r.target}</span>}
              </div>
              {r.prompt && (
                <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">{r.prompt}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
