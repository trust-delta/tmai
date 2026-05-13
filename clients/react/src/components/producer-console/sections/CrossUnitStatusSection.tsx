// ⬢ Cross-unit status — second hand-over section.
//
// One line per unit (= project derived from active agents). State pill
// is read off `useHandover`'s `UnitStatus.state`:
//
// - 🔴 needs-you   — at least one agent has non-null `attention`
// - 🟡 in-progress — agents present, none on the attention axis
// - ⚪ quiet       — no agents (but the unit is known)
//
// Phase A note: the unit list is *derived* from live agents, not read
// from a `[[unit]]`-config endpoint, so units configured but currently
// dormant are not visible here. Phase C will reconcile against a
// `GET /api/units` endpoint and surface those too.

import type { CrossUnitStatus, UnitState } from "@/hooks/useHandover";

interface CrossUnitStatusSectionProps {
  data: CrossUnitStatus;
  activePath: string | null;
  onSelectUnit: (path: string, name: string) => void;
}

export function CrossUnitStatusSection({
  data,
  activePath,
  onSelectUnit,
}: CrossUnitStatusSectionProps) {
  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-cyan-400">⬢</span>
        <h3 className="text-sm font-semibold text-zinc-200">Cross-unit status</h3>
        <span className="text-xs text-zinc-500">
          {data.units.length} unit{data.units.length === 1 ? "" : "s"} derived from live agents
        </span>
      </header>

      {data.units.length === 0 ? (
        <p className="pl-6 text-xs text-zinc-500">
          No active units. Spawn an agent on any project to populate this list — Phase C will also
          surface dormant configured units.
        </p>
      ) : (
        <ul className="space-y-0.5 pl-6 text-xs text-zinc-300">
          {data.units.map((u) => {
            const isActive = u.path === activePath;
            return (
              <li key={u.path}>
                <button
                  type="button"
                  onClick={() => onSelectUnit(u.path, u.name)}
                  className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-white/[0.04] ${
                    isActive ? "bg-white/[0.04]" : ""
                  }`}
                >
                  <StatePill state={u.state} />
                  <code className="text-zinc-200">{u.name}</code>
                  <span className="text-zinc-600">
                    {u.attentionCount > 0 && (
                      <span className="text-amber-400">{u.attentionCount}↑ </span>
                    )}
                    {u.agentCount} agent{u.agentCount === 1 ? "" : "s"}
                  </span>
                  {isActive && (
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-cyan-400">
                      active
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StatePill({ state }: { state: UnitState }) {
  switch (state) {
    case "needs-you":
      return (
        <span className="text-red-400" title="agent(s) on the attention axis">
          🔴
        </span>
      );
    case "in-progress":
      return (
        <span className="text-amber-300" title="agents present, none waiting on you">
          🟡
        </span>
      );
    case "quiet":
      return (
        <span className="text-zinc-500" title="no agents">
          ⚪
        </span>
      );
  }
}
