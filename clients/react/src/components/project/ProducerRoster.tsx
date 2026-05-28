import { AgentCard } from "@/components/agent/AgentCard";
import type { AgentSnapshot } from "@/lib/api";
import { findProducerForUnit } from "@/lib/producer";

interface ProducerRosterProps {
  // All agents that belong to this unit (one project group's agents).
  agents: AgentSnapshot[];
  // The unit's repo path (the group key) — feeds `findProducerForUnit`.
  unitPath: string;
  // `selection.id` from App; matched against both `id` and `target` since a
  // selection may have been stored under either (the canonical id re-keys
  // provisional→canonical, the target is stable across that swap).
  selectedTarget: string | null;
  onSelect: (target: string) => void;
}

// Highlight when the row's agent is the current selection, tolerating
// either id or target as the stored selection key (cf. App's `selectedAgent`
// resolver, which also matches on both).
function isSelected(agent: AgentSnapshot, selectedTarget: string | null): boolean {
  if (selectedTarget === null) return false;
  return agent.id === selectedTarget || agent.target === selectedTarget;
}

// Producer-rooted roster for a single unit (DR
// `2026-05-23-producer-rooted-left-panel.md`). The left panel is the unit
// **addressing surface**, not an attention feed:
//
//   • Producer = headline. The single live Producer (resolved via
//     `findProducerForUnit`) is the first-class "who am I talking to" row.
//     Selecting it addresses the Producer (§A — operator addresses Producer).
//   • Workers = subordinate children. The unit's other agents render as
//     muted, status-oriented child rows beneath the Producer — its roster,
//     not co-equal peers. They stay click-selectable: the emergency
//     direct-worker path §A explicitly preserves
//     (`feedback_pty_emergency_terminal_access`).
//   • No single Producer → degrade honestly (simulated-onboarded posture):
//     show the agents with a 1-line "no single Producer resolved" note;
//     never fabricate a headline.
//
// Role split: this is "who" (structure/identity). It must NOT grow into an
// inventory feed — the artifact inventory lives in the right
// R panel. A per-worker status dot is fine; a full inventory is
// not. The roster is a dumb structural list (no priority/anomaly re-ranking).
export function ProducerRoster({
  agents,
  unitPath,
  selectedTarget,
  onSelect,
}: ProducerRosterProps) {
  const producer = findProducerForUnit(agents, unitPath);

  // Degradation: zero or ambiguous Producer. Show the agents flat (still
  // selectable) under an honest note — no fabricated headline.
  if (producer === null) {
    return (
      <div className="flex flex-col gap-1">
        <p className="px-2 py-1 text-[10px] leading-tight text-subtle-foreground">
          No single Producer resolved — showing agents directly.
        </p>
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={isSelected(agent, selectedTarget)}
            onClick={() => onSelect(agent.target)}
          />
        ))}
      </div>
    );
  }

  // Workers = everything in this unit that isn't the Producer. Structural
  // order preserved from the caller (no judgment sort, DR §No-judgment).
  const workers = agents.filter((a) => a.id !== producer.id);

  return (
    <div className="flex flex-col gap-1">
      <AgentCard
        agent={producer}
        variant="headline"
        selected={isSelected(producer, selectedTarget)}
        onClick={() => onSelect(producer.target)}
      />
      {workers.length > 0 && (
        <div className="ml-2 flex flex-col gap-0.5 border-l border-hairline pl-2">
          {workers.map((worker) => (
            <AgentCard
              key={worker.id}
              agent={worker}
              variant="worker"
              selected={isSelected(worker, selectedTarget)}
              onClick={() => onSelect(worker.target)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
