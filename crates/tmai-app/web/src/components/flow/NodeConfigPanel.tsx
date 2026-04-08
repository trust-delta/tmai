/**
 * Agent node configuration panel (v2) with delete button.
 */

import type { AgentNodeConfig } from "@/lib/api";

interface AgentConfigPanelProps {
  agent: AgentNodeConfig;
  onChange: (updated: AgentNodeConfig) => void;
  onDelete: () => void;
}

const inputCls =
  "mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-500/50";
const selectCls =
  "mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-zinc-300 outline-none focus:border-cyan-500/50";
const labelCls = "text-[10px] text-zinc-500";

export function AgentConfigPanel({ agent, onChange, onDelete }: AgentConfigPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
          Agent
        </h4>
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-1.5 py-0.5 text-[10px] text-red-400/50 hover:bg-red-500/10 hover:text-red-400"
        >
          Delete
        </button>
      </div>

      <label className="block">
        <span className={labelCls}>ID</span>
        <input
          type="text"
          value={agent.id}
          onChange={(e) => onChange({ ...agent, id: e.target.value.trim() })}
          className={inputCls}
        />
      </label>

      <div className="flex gap-2">
        <label className="block flex-1">
          <span className={labelCls}>Mode</span>
          <select
            value={agent.mode}
            onChange={(e) => onChange({ ...agent, mode: e.target.value as "spawn" | "persistent" })}
            className={selectCls}
          >
            <option value="spawn">spawn</option>
            <option value="persistent">persistent</option>
          </select>
        </label>
        <label className="block flex-1">
          <span className={labelCls}>Type</span>
          <select
            value={agent.agent_type}
            onChange={(e) =>
              onChange({ ...agent, agent_type: e.target.value as "claude" | "codex" | "gemini" })
            }
            className={selectCls}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className={labelCls}>Prompt Template</span>
        <textarea
          value={agent.prompt_template}
          onChange={(e) => onChange({ ...agent, prompt_template: e.target.value })}
          rows={4}
          placeholder="Resolve #{{issue_number}}"
          className={`${inputCls} resize-y`}
        />
      </label>

      <label className="block">
        <span className={labelCls}>Tools (* for all)</span>
        <input
          type="text"
          value={Array.isArray(agent.tools) ? agent.tools.join(", ") : agent.tools}
          onChange={(e) => {
            const val = e.target.value.trim();
            onChange({
              ...agent,
              tools:
                val === "*"
                  ? "*"
                  : val
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
            });
          }}
          placeholder="list_agents, get_ci_status"
          className={inputCls}
        />
      </label>
    </div>
  );
}
