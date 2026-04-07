/**
 * Custom React Flow node component for flow editor.
 *
 * Renders agent role nodes with mode indicator and tool access info.
 */

import { Handle, type NodeProps, Position } from "@xyflow/react";

interface FlowNodeData {
  label: string;
  mode: "spawn" | "persistent";
  promptTemplate: string;
  tools: string[] | string;
  agentType: string;
}

/** Custom node component for flow roles */
export function FlowNodeComponent({ data, selected }: NodeProps) {
  const { label, mode, tools } = data as unknown as FlowNodeData;
  const isAllTools = tools === "*";
  const toolCount = Array.isArray(tools) ? tools.length : 0;

  return (
    <div
      className={`rounded-lg border px-4 py-3 shadow-lg transition-colors ${
        selected
          ? "border-cyan-500/60 bg-cyan-950/40"
          : "border-white/10 bg-zinc-900/80 hover:border-white/20"
      }`}
      style={{ minWidth: 140 }}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-700 !bg-cyan-500"
      />

      {/* Node content */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            mode === "persistent" ? "bg-emerald-400" : "bg-cyan-400"
          }`}
          title={mode}
        />
        <span className="text-sm font-medium text-zinc-200">{label}</span>
      </div>

      <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
        <span>{mode}</span>
        <span>{isAllTools ? "all tools" : `${toolCount} tool${toolCount !== 1 ? "s" : ""}`}</span>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-zinc-700 !bg-cyan-500"
      />
    </div>
  );
}
