/**
 * Gate node configuration panel (v2).
 *
 * Edit condition, resolve step, then/else actions.
 */

import type { ActionType, GateNodeConfig } from "@/lib/api";

const ACTION_OPTIONS: ActionType[] = [
  "send_message",
  "spawn_agent",
  "merge_pr",
  "review_pr",
  "rerun_ci",
  "passthrough",
  "noop",
];

interface GateConfigPanelProps {
  gate: GateNodeConfig;
  onChange: (updated: GateNodeConfig) => void;
}

export function GateConfigPanel({ gate, onChange }: GateConfigPanelProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
        <span className="inline-block h-2 w-2 rotate-45 bg-amber-400" />
        Gate: {gate.id}
      </h4>

      <label className="block">
        <span className="text-[10px] text-zinc-500">ID</span>
        <input
          type="text"
          value={gate.id}
          onChange={(e) => onChange({ ...gate, id: e.target.value.trim() })}
          className="mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
        />
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-500">Condition</span>
        <input
          type="text"
          value={gate.condition}
          onChange={(e) => onChange({ ...gate, condition: e.target.value })}
          placeholder="pr != null"
          className="mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-cyan-500/50"
        />
      </label>

      {/* Resolve */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Resolve</span>
          {!gate.resolve && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...gate,
                  resolve: { name: "result", query: "", params: {}, filter: null, pick: "first" },
                })
              }
              className="text-[10px] text-cyan-400 hover:text-cyan-300"
            >
              + Add
            </button>
          )}
        </div>
        {gate.resolve && (
          <div className="mt-1 space-y-1 rounded border border-white/[0.06] bg-white/[0.03] p-2">
            <div className="flex gap-1">
              <input
                type="text"
                value={gate.resolve.name}
                onChange={(e) =>
                  onChange({ ...gate, resolve: { ...gate.resolve!, name: e.target.value } })
                }
                placeholder="var name"
                className="w-16 rounded border border-white/10 bg-white/[0.05] px-1 py-0.5 font-mono text-[10px] text-cyan-400 outline-none"
              />
              <span className="py-0.5 text-[10px] text-zinc-500">=</span>
              <input
                type="text"
                value={gate.resolve.query}
                onChange={(e) =>
                  onChange({ ...gate, resolve: { ...gate.resolve!, query: e.target.value } })
                }
                placeholder="list_prs"
                className="flex-1 rounded border border-white/10 bg-white/[0.05] px-1 py-0.5 font-mono text-[10px] text-zinc-300 outline-none"
              />
            </div>
            {gate.resolve.filter !== null && (
              <input
                type="text"
                value={gate.resolve.filter ?? ""}
                onChange={(e) =>
                  onChange({
                    ...gate,
                    resolve: { ...gate.resolve!, filter: e.target.value || null },
                  })
                }
                placeholder="item.branch == agent.git_branch"
                className="w-full rounded border border-white/10 bg-white/[0.05] px-1 py-0.5 font-mono text-[10px] text-zinc-400 outline-none"
              />
            )}
            <button
              type="button"
              onClick={() => onChange({ ...gate, resolve: null })}
              className="text-[10px] text-red-400/50 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Then action */}
      <div>
        <span className="text-[10px] text-emerald-400">Then →</span>
        <ActionEditor
          action={gate.then_action}
          onChange={(a) => onChange({ ...gate, then_action: a })}
        />
      </div>

      {/* Else action */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-rose-400">Else →</span>
          {!gate.else_action && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...gate,
                  else_action: { action: "noop", target: null, prompt: null, params: {} },
                })
              }
              className="text-[10px] text-rose-400/50 hover:text-rose-400"
            >
              + Add
            </button>
          )}
        </div>
        {gate.else_action && (
          <>
            <ActionEditor
              action={gate.else_action}
              onChange={(a) => onChange({ ...gate, else_action: a })}
            />
            <button
              type="button"
              onClick={() => onChange({ ...gate, else_action: null })}
              className="mt-1 text-[10px] text-red-400/50 hover:text-red-400"
            >
              Remove else
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Inline action editor for then/else */
function ActionEditor({
  action,
  onChange,
}: {
  action: {
    action: ActionType;
    target: string | null;
    prompt: string | null;
    params: Record<string, unknown>;
  };
  onChange: (a: typeof action) => void;
}) {
  return (
    <div className="mt-1 space-y-1 rounded border border-white/[0.06] bg-white/[0.03] p-2">
      <select
        value={action.action}
        onChange={(e) => onChange({ ...action, action: e.target.value as ActionType })}
        className="w-full rounded border border-white/10 bg-white/[0.05] px-1 py-0.5 text-[10px] text-zinc-300 outline-none"
      >
        {ACTION_OPTIONS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      {(action.action === "send_message" ||
        action.action === "spawn_agent" ||
        action.action === "passthrough") && (
        <input
          type="text"
          value={action.target ?? ""}
          onChange={(e) => onChange({ ...action, target: e.target.value || null })}
          placeholder="target node ID"
          className="w-full rounded border border-white/10 bg-white/[0.05] px-1 py-0.5 font-mono text-[10px] text-zinc-300 outline-none placeholder:text-zinc-600"
        />
      )}
      {(action.action === "send_message" || action.action === "spawn_agent") && (
        <textarea
          value={action.prompt ?? ""}
          onChange={(e) => onChange({ ...action, prompt: e.target.value || null })}
          placeholder="Prompt template..."
          rows={2}
          className="w-full resize-y rounded border border-white/10 bg-white/[0.05] px-1 py-0.5 font-mono text-[10px] text-zinc-300 outline-none placeholder:text-zinc-600"
        />
      )}
    </div>
  );
}
