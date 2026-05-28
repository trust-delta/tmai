// ⬢ Cross-unit status — second hand-over section.
//
// One line per unit, reconciled from two sources by `useHandover`:
// configured membership comes from `GET /api/units` (tmai-core #460,
// wire half of #439); the state pill is derived client-side from the
// live agent list. A unit configured but currently dormant (no live
// agent) renders here with state `quiet`.
//
// State pill semantics:
//
// - 🔴 needs-you   — at least one agent has non-null `attention`
// - 🟡 in-progress — agents present, none on the attention axis
// - ⚪ quiet       — no agents (dormant configured unit, or a unit
//                   whose every live agent has exited)

import type { CrossUnitStatus, MissingPreconditions, UnitState } from "@/hooks/useHandover";

interface CrossUnitStatusSectionProps {
  data: CrossUnitStatus;
  activePath: string | null;
  onSelectUnit: (path: string, name: string) => void;
  /** Weak posture signals — see `MissingPreconditions` doc.
   *  Currently unused by this section (the `singleUnitOnly` notice
   *  retired with the units-wire reconciliation); kept on the prop
   *  surface so callers can continue forwarding `missingPreconditions`
   *  uniformly across all four sections without conditional plumbing. */
  preconditions?: MissingPreconditions;
}

export function CrossUnitStatusSection({
  data,
  activePath,
  onSelectUnit,
}: CrossUnitStatusSectionProps) {
  // Configured vs live split: the count line stays honest about which
  // half of the reconciled list is reading from where. A dormant
  // configured unit lands in `data.units` with `agentCount === 0` so
  // the difference is exactly the dormant-unit count.
  const total = data.units.length;
  const live = data.units.filter((u) => u.agentCount > 0).length;

  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-primary">⬢</span>
        <h3 className="text-sm font-semibold text-foreground">Cross-unit status</h3>
        <span className="text-xs text-muted-foreground">
          {total} configured / {live} live
        </span>
      </header>

      {data.units.length === 0 ? (
        <p className="pl-6 text-xs text-muted-foreground">
          No configured units yet. Add a <code>[[unit]]</code> in config.toml or spawn an agent on
          any project to populate this list.
        </p>
      ) : (
        <ul className="space-y-0.5 pl-6 text-xs text-foreground">
          {data.units.map((u) => {
            const isActive = u.path === activePath;
            return (
              <li key={u.path}>
                <button
                  type="button"
                  onClick={() => onSelectUnit(u.path, u.name)}
                  className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-surface ${
                    isActive ? "bg-surface" : ""
                  }`}
                >
                  <StatePill state={u.state} />
                  <code className="text-foreground">{u.name}</code>
                  <span className="text-subtle-foreground">
                    {u.attentionCount > 0 && (
                      <span className="text-warning">{u.attentionCount}↑ </span>
                    )}
                    {u.agentCount} agent{u.agentCount === 1 ? "" : "s"}
                  </span>
                  {isActive && (
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-primary">
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
        <span className="text-destructive" title="agent(s) on the attention axis">
          🔴
        </span>
      );
    case "in-progress":
      return (
        <span className="text-warning" title="agents present, none waiting on you">
          🟡
        </span>
      );
    case "quiet":
      return (
        <span className="text-muted-foreground" title="no agents">
          ⚪
        </span>
      );
  }
}
