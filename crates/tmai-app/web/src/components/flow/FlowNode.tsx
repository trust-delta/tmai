/**
 * Custom React Flow node components for flow editor v2.
 *
 * Vertical layout: inputs on top, outputs on bottom.
 * AgentFlowNode (cyan) — LLM agent with initial/queue inputs and stop/error outputs
 * GateFlowNode (amber) — tmai judgment with input and then/else outputs
 */

import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { AgentNodeConfig, GateNodeConfig } from "@/lib/api";

/** Agent node — cyan accent */
export function AgentFlowNode({ data, selected }: NodeProps) {
  const config = data.config as AgentNodeConfig;

  return (
    <div
      className={`rounded-lg border px-4 py-3 shadow-lg transition-colors ${
        selected
          ? "border-cyan-500/60 bg-cyan-950/40"
          : "border-cyan-500/20 bg-zinc-900/80 hover:border-cyan-500/40"
      }`}
      style={{ minWidth: 150 }}
    >
      {/* Input handles (top) */}
      <Handle
        type="target"
        id="initial"
        position={Position.Top}
        style={{ left: "30%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-700 !bg-cyan-400"
        title="initial prompt (spawn)"
      />
      <Handle
        type="target"
        id="queue"
        position={Position.Top}
        style={{ left: "70%" }}
        className="!h-2 !w-2 !border-2 !border-zinc-700 !bg-cyan-600"
        title="queue prompt (send_message)"
      />

      {/* Content */}
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-400" />
        <span className="text-sm font-medium text-zinc-200">{config.id}</span>
      </div>
      <div className="mt-1 text-[10px] text-zinc-500">
        <span className="text-cyan-500/60">{config.agent_type}</span>
      </div>

      {/* Output handles (bottom) */}
      <Handle
        type="source"
        id="stop"
        position={Position.Bottom}
        style={{ left: "30%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-700 !bg-red-400"
        title="stop hook"
      />
      <Handle
        type="source"
        id="error"
        position={Position.Bottom}
        style={{ left: "70%" }}
        className="!h-2 !w-2 !border-2 !border-zinc-700 !bg-red-600"
        title="error hook"
      />
    </div>
  );
}

/** Gate node — amber accent */
export function GateFlowNode({ data, selected }: NodeProps) {
  const config = data.config as GateNodeConfig;
  const hasElse = config.else_action !== null;

  return (
    <div
      className={`rounded-lg border px-4 py-3 shadow-lg transition-colors ${
        selected
          ? "border-amber-500/60 bg-amber-950/30"
          : "border-amber-500/20 bg-zinc-900/80 hover:border-amber-500/40"
      }`}
      style={{ minWidth: 150 }}
    >
      {/* Input handle (top) */}
      <Handle
        type="target"
        id="input"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-700 !bg-amber-400"
        title="input (from hook or passthrough)"
      />

      {/* Content */}
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rotate-45 bg-amber-400" />
        <span className="text-sm font-medium text-zinc-200">{config.id}</span>
      </div>
      <div className="mt-1 max-w-[160px] truncate font-mono text-[10px] text-zinc-500">
        {config.condition}
      </div>
      <div className="mt-0.5 text-[10px] text-zinc-600">
        then: {config.then_action.action}
        {hasElse ? ` / else: ${config.else_action?.action}` : ""}
      </div>

      {/* Output handles (bottom) */}
      <Handle
        type="source"
        id="then"
        position={Position.Bottom}
        style={{ left: hasElse ? "30%" : "50%" }}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-700 !bg-emerald-400"
        title="then (condition true)"
      />
      {hasElse && (
        <Handle
          type="source"
          id="else"
          position={Position.Bottom}
          style={{ left: "70%" }}
          className="!h-2 !w-2 !border-2 !border-zinc-700 !bg-rose-400"
          title="else (condition false)"
        />
      )}
    </div>
  );
}

/** Orchestrator node — purple/violet, fixed at top */
export function OrchestratorFlowNode({ data, selected }: NodeProps) {
  const flowNames = (data.flowNames ?? []) as string[];

  return (
    <div
      className={`rounded-xl border-2 px-5 py-3 shadow-xl transition-colors ${
        selected
          ? "border-violet-500/60 bg-violet-950/40"
          : "border-violet-500/30 bg-zinc-900/90 hover:border-violet-500/50"
      }`}
      style={{ minWidth: 180 }}
    >
      {/* Queue input (from gate send_message) */}
      <Handle
        type="target"
        id="queue"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-zinc-700 !bg-violet-400"
        title="notifications from flows"
      />

      <div className="flex items-center gap-2">
        <span className="text-base">🎯</span>
        <span className="text-sm font-bold text-violet-300">Orchestrator</span>
      </div>
      <div className="mt-1 text-[10px] text-zinc-500">
        {flowNames.length} flow{flowNames.length !== 1 ? "s" : ""}
      </div>

      {/* Output handles: one per flow */}
      {flowNames.map((name, i) => {
        const count = flowNames.length;
        const pct = count === 1 ? 50 : 20 + (60 * i) / Math.max(count - 1, 1);
        return (
          <Handle
            key={name}
            type="source"
            id={`flow-${name}`}
            position={Position.Bottom}
            style={{ left: `${pct}%` }}
            className="!h-2.5 !w-2.5 !border-2 !border-zinc-700 !bg-violet-400"
            title={`flow: ${name}`}
          />
        );
      })}
    </div>
  );
}
