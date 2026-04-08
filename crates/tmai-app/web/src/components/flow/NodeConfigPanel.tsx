/**
 * Agent node configuration panel (v2).
 */

import type { AgentNodeConfig } from "@/lib/api";

interface AgentConfigPanelProps {
  agent: AgentNodeConfig;
  onChange: (updated: AgentNodeConfig) => void;
}

export function AgentConfigPanel({ agent, onChange }: AgentConfigPanelProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
        <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
        Agent: {agent.id}
      </h4>

      <label className="block">
        <span className="text-[10px] text-zinc-500">ID</span>
        <input
          type="text"
          value={agent.id}
          onChange={(e) => onChange({ ...agent, id: e.target.value.trim() })}
          className="mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
        />
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-500">Mode</span>
        <select
          value={agent.mode}
          onChange={(e) => onChange({ ...agent, mode: e.target.value as "spawn" | "persistent" })}
          className="mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
        >
          <option value="spawn">spawn</option>
          <option value="persistent">persistent</option>
        </select>
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-500">Agent Type</span>
        <select
          value={agent.agent_type}
          onChange={(e) =>
            onChange({ ...agent, agent_type: e.target.value as "claude" | "codex" | "gemini" })
          }
          className="mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="gemini">Gemini</option>
        </select>
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-500">Prompt Template</span>
        <textarea
          value={agent.prompt_template}
          onChange={(e) => onChange({ ...agent, prompt_template: e.target.value })}
          rows={4}
          placeholder="Resolve #{{issue_number}}"
          className="mt-0.5 block w-full resize-y rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-cyan-500/50"
        />
      </label>

      <label className="block">
        <span className="text-[10px] text-zinc-500">Tools (* for all)</span>
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
          className="mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-cyan-500/50"
        />
      </label>
    </div>
  );
}
