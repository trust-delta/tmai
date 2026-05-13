// ▶ Where you left off — first hand-over section.
//
// Surfaces the operator's currently-scoped project: its worktrees (with
// branch + dirty + agent count) and any agents waiting on the user.
// Empty states are explicit — a blank section reads as "no project
// selected yet" rather than as a broken render.

import type { AttentionAgentBrief, WhereYouLeftOff, WorktreeBrief } from "@/hooks/useHandover";

interface WhereYouLeftOffSectionProps {
  data: WhereYouLeftOff;
}

export function WhereYouLeftOffSection({ data }: WhereYouLeftOffSectionProps) {
  const { activeProjectName, worktrees, attentionAgents } = data;

  return (
    <section>
      <header className="mb-2 flex items-baseline gap-2">
        <span className="text-base text-cyan-400">▶</span>
        <h3 className="text-sm font-semibold text-zinc-200">Where you left off</h3>
        {activeProjectName && (
          <span className="text-xs text-zinc-500">
            on <code className="text-zinc-300">{activeProjectName}</code>
          </span>
        )}
      </header>

      {!activeProjectName ? (
        <EmptyProject />
      ) : (
        <div className="space-y-3 pl-6">
          <WorktreeList worktrees={worktrees} />
          <AttentionAgentsList agents={attentionAgents} />
        </div>
      )}
    </section>
  );
}

function EmptyProject() {
  return (
    <p className="pl-6 text-xs text-zinc-500">
      No project scoped yet. Click + on a project in the sidebar to spawn an agent, or pick an
      existing project to focus this view.
    </p>
  );
}

function WorktreeList({ worktrees }: { worktrees: WorktreeBrief[] }) {
  if (worktrees.length === 0) {
    return <p className="text-xs text-zinc-500">No worktrees discovered yet.</p>;
  }
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">Worktrees</p>
      <ul className="mt-1 space-y-0.5 text-xs text-zinc-300">
        {worktrees.map((wt) => (
          <li key={`${wt.path}-${wt.name}`} className="flex items-baseline gap-2">
            <code className="text-zinc-200">
              {wt.isMain ? "main" : wt.name}
              {wt.dirty && <span className="ml-1 text-amber-400">●</span>}
            </code>
            {wt.branch && <span className="text-zinc-500">({wt.branch})</span>}
            <span className="text-zinc-600">
              {wt.agentCount} agent{wt.agentCount === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttentionAgentsList({ agents }: { agents: AttentionAgentBrief[] }) {
  if (agents.length === 0) {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-wider text-zinc-500">Attention</p>
        <p className="mt-1 text-xs text-zinc-500">
          No agent is waiting on you on this project. <span className="text-zinc-600">✓</span>
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">Attention</p>
      <ul className="mt-1 space-y-0.5 text-xs text-zinc-300">
        {agents.map((a) => (
          <li key={a.target} className="flex items-baseline gap-2">
            <AttentionGlyph kind={a.attention} />
            <code className="text-zinc-200">{a.displayName}</code>
            {a.isOrchestrator && (
              <span className="rounded bg-cyan-500/10 px-1 text-[10px] text-cyan-300">orch</span>
            )}
            <span className="text-zinc-600">{a.cwd}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Decision tmai-core@2026-05-09 Phase 4: flat attention enum on the
// wire. Glyphs match the sidebar-collapsed pill set so the operator
// reads the same shape in both surfaces.
function AttentionGlyph({ kind }: { kind: AttentionAgentBrief["attention"] }) {
  switch (kind) {
    case "halted":
      return (
        <span className="text-amber-400" title="permission/selection prompt">
          ◐
        </span>
      );
    case "started":
      return (
        <span className="text-cyan-300" title="just spawned, awaiting first prompt">
          ○
        </span>
      );
    case "completed":
      return (
        <span className="text-zinc-300" title="turn finished, awaiting your next move">
          ○
        </span>
      );
  }
}
