/**
 * Node configuration panel — shown when a node is selected in the flow editor.
 *
 * Allows editing role properties: mode, prompt template, tools, agent type.
 */

import type { FlowNodeConfig } from "@/lib/api";

interface NodeConfigPanelProps {
  node: FlowNodeConfig;
  onChange: (updated: FlowNodeConfig) => void;
}

/** Config panel for a selected flow node */
export function NodeConfigPanel({ node, onChange }: NodeConfigPanelProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Node: {node.role}
      </h4>

      {/* Mode */}
      <label className="block">
        <span className="text-[10px] text-zinc-500">Mode</span>
        <select
          value={node.mode}
          onChange={(e) => onChange({ ...node, mode: e.target.value as "spawn" | "persistent" })}
          className="mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
        >
          <option value="spawn">spawn (new agent per trigger)</option>
          <option value="persistent">persistent (reuse idle agent)</option>
        </select>
      </label>

      {/* Agent type */}
      <label className="block">
        <span className="text-[10px] text-zinc-500">Agent Type</span>
        <select
          value={node.agent_type}
          onChange={(e) =>
            onChange({
              ...node,
              agent_type: e.target.value as "claude" | "codex" | "gemini",
            })
          }
          className="mt-0.5 block w-full rounded border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="gemini">Gemini</option>
        </select>
      </label>

      {/* Prompt template */}
      <label className="block">
        <span className="text-[10px] text-zinc-500">Prompt Template</span>
        <textarea
          value={node.prompt_template}
          onChange={(e) => onChange({ ...node, prompt_template: e.target.value })}
          rows={5}
          placeholder="Resolve #{{issue_number}}: {{issue_title}}"
          className="mt-0.5 block w-full resize-y rounded border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-cyan-500/50"
        />
      </label>

      {/* Tools */}
      <label className="block">
        <span className="text-[10px] text-zinc-500">Tools (comma-separated, or * for all)</span>
        <input
          type="text"
          value={Array.isArray(node.tools) ? node.tools.join(", ") : node.tools}
          onChange={(e) => {
            const val = e.target.value.trim();
            onChange({
              ...node,
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
