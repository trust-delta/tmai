/**
 * Agent node configuration panel (v3).
 */

import type { AgentNodeConfig } from "@/lib/api";

// Available tmai MCP tools grouped by category
const MCP_TOOL_GROUPS: { label: string; tools: { name: string; description: string }[] }[] = [
  {
    label: "Agent Control",
    tools: [
      { name: "list_agents", description: "List monitored agents" },
      { name: "get_agent", description: "Get agent details" },
      { name: "get_agent_output", description: "Get terminal output" },
      { name: "approve", description: "Approve pending permission" },
      { name: "send_text", description: "Send text input" },
      { name: "send_prompt", description: "Send prompt (queue if busy)" },
      { name: "kill_agent", description: "Kill an agent" },
    ],
  },
  {
    label: "Spawn",
    tools: [
      { name: "spawn_agent", description: "Spawn new agent" },
      { name: "spawn_worktree", description: "Spawn in worktree" },
      { name: "dispatch_issue", description: "Dispatch GitHub issue" },
    ],
  },
  {
    label: "GitHub",
    tools: [
      { name: "list_prs", description: "List open PRs" },
      { name: "list_issues", description: "List issues" },
      { name: "get_ci_status", description: "CI check results" },
      { name: "get_ci_failure_log", description: "CI failure logs" },
      { name: "review_pr", description: "Review a PR" },
      { name: "merge_pr", description: "Merge a PR" },
      { name: "rerun_ci", description: "Rerun failed CI" },
      { name: "git_diff_stat", description: "Diff stats for branch" },
    ],
  },
  {
    label: "Flow",
    tools: [
      { name: "run_flow", description: "Start a named flow" },
      { name: "list_flows", description: "List flow definitions" },
      { name: "list_flow_runs", description: "List flow runs" },
      { name: "cancel_flow", description: "Cancel a flow run" },
    ],
  },
];

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
  const isAllTools = agent.tools === "*";
  const selectedTools = new Set(Array.isArray(agent.tools) ? agent.tools : []);

  const toggleTool = (toolName: string) => {
    if (isAllTools) return;
    const next = new Set(selectedTools);
    if (next.has(toolName)) {
      next.delete(toolName);
    } else {
      next.add(toolName);
    }
    onChange({ ...agent, tools: Array.from(next) });
  };

  const toggleAll = () => {
    if (isAllTools) {
      onChange({ ...agent, tools: [] });
    } else {
      onChange({ ...agent, tools: "*" });
    }
  };

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

      <label className="block">
        <span className={labelCls}>Agent Type</span>
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

      {/* Tools — checkbox list */}
      <div>
        <div className="flex items-center justify-between">
          <span className={labelCls}>tmai MCP Tools</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={isAllTools}
              onChange={toggleAll}
              className="h-3 w-3 rounded border-zinc-600 bg-zinc-800 text-violet-500 accent-violet-500"
            />
            <span className="text-[10px] text-zinc-400">All (*)</span>
          </label>
        </div>

        {!isAllTools && (
          <div className="mt-1.5 max-h-48 space-y-2 overflow-y-auto rounded border border-white/[0.06] bg-white/[0.02] p-2">
            {MCP_TOOL_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                  {group.label}
                </div>
                {group.tools.map((tool) => (
                  <label
                    key={tool.name}
                    className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-white/[0.03]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTools.has(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                      className="h-3 w-3 rounded border-zinc-600 bg-zinc-800 accent-cyan-500"
                    />
                    <span className="font-mono text-[10px] text-zinc-300">{tool.name}</span>
                    <span className="text-[9px] text-zinc-600">{tool.description}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        {isAllTools && (
          <div className="mt-1 text-[10px] text-violet-400/60">
            All tmai MCP tools are available
          </div>
        )}
      </div>
    </div>
  );
}
