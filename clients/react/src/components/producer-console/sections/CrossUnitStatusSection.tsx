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
//
// TODO(tmai-core#340): when multi-repo / dormant-unit wire lands,
// replace the live-agent derivation with a proper unit list. The
// `singleUnitOnly` posture notice below is part of the
// simulated-onboarded posture DR (`doc/decisions/2026-05-14-webui-
// simulated-onboarded-posture.md`) and should be removed in the
// same change.

import type { CrossUnitStatus, MissingPreconditions, UnitState } from "@/hooks/useHandover";

interface CrossUnitStatusSectionProps {
  data: CrossUnitStatus;
  activePath: string | null;
  onSelectUnit: (path: string, name: string) => void;
  /** Weak posture signals — see `MissingPreconditions` doc.
   *  When omitted, no notice is rendered (back-compat for existing
   *  tests / older callers). */
  preconditions?: MissingPreconditions;
}

export function CrossUnitStatusSection({
  data,
  activePath,
  onSelectUnit,
  preconditions,
}: CrossUnitStatusSectionProps) {
  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-primary">⬢</span>
        <h3 className="text-sm font-semibold text-foreground">Cross-unit status</h3>
        <span className="text-xs text-muted-foreground">
          {data.units.length} unit{data.units.length === 1 ? "" : "s"} derived from live agents
        </span>
      </header>

      {data.units.length === 0 ? (
        <p className="pl-6 text-xs text-muted-foreground">
          No active units. Spawn an agent on any project to populate this list — dormant configured
          units aren't surfaced here yet.
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

      {preconditions?.singleUnitOnly && (
        // TODO(tmai-core#340): remove this notice once multi-repo /
        // dormant-unit reconciliation lands.
        <p className="mt-2 pl-6 text-[11px] text-subtle-foreground">
          Showing one unit only — a tmai project can span multiple repos and have dormant configured
          units, but that view isn't wired yet.
        </p>
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
