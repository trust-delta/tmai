/**
 * Flow Editor v2 — typed agent/gate nodes with wire connections.
 *
 * Agent nodes (cyan) = LLM execution, ports: initial, queue, stop, error
 * Gate nodes (amber) = tmai judgment, ports: input, then, else
 */

import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MarkerType,
  type Node,
  type NodeChange,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import type { FlowConfig, FlowRun, PortType } from "@/lib/api";
import { api } from "@/lib/api";
import { GateConfigPanel } from "./EdgeConfigPanel";
import { AgentFlowNode, GateFlowNode } from "./FlowNode";
import { AgentConfigPanel } from "./NodeConfigPanel";

const nodeTypes = {
  agent: AgentFlowNode,
  gate: GateFlowNode,
};

const rfStyle = { backgroundColor: "transparent" };

/** Convert v2 flow config to React Flow nodes and edges */
function configToReactFlow(config: FlowConfig): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];

  // Agent nodes
  for (const agent of config.agents) {
    nodes.push({
      id: agent.id,
      type: "agent",
      position: { x: 0, y: 0 }, // auto-laid out below
      data: { config: agent, nodeKind: "agent" as const },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
  }

  // Gate nodes
  for (const gate of config.gates) {
    nodes.push({
      id: gate.id,
      type: "gate",
      position: { x: 0, y: 0 },
      data: { config: gate, nodeKind: "gate" as const },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
  }

  // Wires → edges
  const edges: Edge[] = config.wires.map((wire, i) => ({
    id: `wire-${i}-${wire.from.node}-${wire.from.port}-${wire.to.node}-${wire.to.port}`,
    source: wire.from.node,
    sourceHandle: wire.from.port,
    target: wire.to.node,
    targetHandle: wire.to.port,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#06b6d4" },
    style: { stroke: "#06b6d4", strokeWidth: 1.5 },
    label: `${wire.from.port} → ${wire.to.port}`,
    labelStyle: { fill: "#71717a", fontSize: 9, fontFamily: "monospace" },
    data: { wire },
  }));

  return { nodes: autoLayout(nodes, edges), edges };
}

/** BFS auto-layout */
function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }

  const visited = new Set<string>();
  const positions = new Map<string, { x: number; y: number }>();
  const queue: { id: string; col: number }[] = [{ id: nodes[0].id, col: 0 }];
  const colCounts = new Map<number, number>();

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { id, col } = item;
    if (visited.has(id)) continue;
    visited.add(id);

    const row = colCounts.get(col) ?? 0;
    colCounts.set(col, row + 1);
    positions.set(id, { x: col * 280 + 40, y: row * 160 + 40 });

    for (const target of adj.get(id) ?? []) {
      if (!visited.has(target)) {
        queue.push({ id: target, col: col + 1 });
      }
    }
  }

  let extraY = (Math.max(...Array.from(colCounts.values()), 0) + 1) * 160;
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: 40, y: extraY });
      extraY += 160;
    }
  }

  return nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? n.position,
  }));
}

/** Create empty flow */
function createEmptyFlow(): FlowConfig {
  return {
    description: "",
    entry_params: [],
    entry_node: "agent_1",
    agents: [
      {
        id: "agent_1",
        agent_type: "claude",
        mode: "spawn",
        prompt_template: "",
        tools: [],
      },
    ],
    gates: [],
    wires: [],
  };
}

interface FlowEditorProps {
  projectPath?: string;
}

export function FlowEditor(_props: FlowEditorProps) {
  const [flowConfigs, setFlowConfigs] = useState<Record<string, FlowConfig>>({});
  const [selectedFlow, setSelectedFlow] = useState<string>("");
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showNewFlow, setShowNewFlow] = useState(false);
  const [newFlowName, setNewFlowName] = useState("");

  // Load on mount
  useEffect(() => {
    api
      .getFlowConfig()
      .then((configs: Record<string, FlowConfig>) => {
        setFlowConfigs(configs);
        const names = Object.keys(configs);
        if (names.length > 0) {
          setSelectedFlow((prev) => prev || names[0]);
        }
      })
      .catch(() => setFlowConfigs({}));
    api
      .listFlowRuns()
      .then(setFlowRuns)
      .catch(() => {});
  }, []);

  // Update canvas
  useEffect(() => {
    if (!selectedFlow || !flowConfigs[selectedFlow]) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const { nodes: n, edges: e } = configToReactFlow(flowConfigs[selectedFlow]);
    setNodes(n);
    setEdges(e);
    setSelectedNode(null);
  }, [selectedFlow, flowConfigs]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  // Wire creation via drag-connect
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !selectedFlow) return;
      const config = flowConfigs[selectedFlow];
      if (!config) return;

      const fromPort = (connection.sourceHandle ?? "stop") as PortType;
      const toPort = (connection.targetHandle ?? "input") as PortType;

      config.wires.push({
        from: { node: connection.source, port: fromPort },
        to: { node: connection.target, port: toPort },
      });

      setFlowConfigs({ ...flowConfigs, [selectedFlow]: { ...config } });
      setDirty(true);
    },
    [flowConfigs, selectedFlow],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  // Mutate helpers
  const updateConfig = useCallback(
    (updater: (config: FlowConfig) => FlowConfig) => {
      if (!selectedFlow || !flowConfigs[selectedFlow]) return;
      setFlowConfigs({
        ...flowConfigs,
        [selectedFlow]: updater({ ...flowConfigs[selectedFlow] }),
      });
      setDirty(true);
    },
    [flowConfigs, selectedFlow],
  );

  const handleCreateFlow = useCallback(() => {
    const name = newFlowName.trim().toLowerCase().replace(/\s+/g, "_");
    if (!name || flowConfigs[name]) return;
    setFlowConfigs({ ...flowConfigs, [name]: createEmptyFlow() });
    setSelectedFlow(name);
    setShowNewFlow(false);
    setNewFlowName("");
    setDirty(true);
  }, [newFlowName, flowConfigs]);

  const handleAddAgent = useCallback(() => {
    updateConfig((c) => {
      let id = "agent_1";
      let i = 1;
      while (c.agents.some((a) => a.id === id) || c.gates.some((g) => g.id === id)) {
        i++;
        id = `agent_${i}`;
      }
      c.agents.push({
        id,
        agent_type: "claude",
        mode: "spawn",
        prompt_template: "",
        tools: [],
      });
      return c;
    });
  }, [updateConfig]);

  const handleAddGate = useCallback(() => {
    updateConfig((c) => {
      let id = "gate_1";
      let i = 1;
      while (c.agents.some((a) => a.id === id) || c.gates.some((g) => g.id === id)) {
        i++;
        id = `gate_${i}`;
      }
      c.gates.push({
        id,
        resolve: null,
        condition: "true",
        then_action: { action: "noop", target: null, prompt: null, params: {} },
        else_action: null,
      });
      return c;
    });
  }, [updateConfig]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.updateFlowConfig(flowConfigs);
      setDirty(false);
    } catch (e) {
      console.error("Failed to save:", e);
    } finally {
      setSaving(false);
    }
  }, [flowConfigs]);

  const handleDeleteFlow = useCallback(() => {
    if (!selectedFlow) return;
    const updated = { ...flowConfigs };
    delete updated[selectedFlow];
    setFlowConfigs(updated);
    setSelectedFlow(Object.keys(updated)[0] ?? "");
    setDirty(true);
  }, [flowConfigs, selectedFlow]);

  const currentConfig = selectedFlow ? flowConfigs[selectedFlow] : null;

  // Find selected node config
  const selectedAgentConfig = currentConfig?.agents.find((a) => a.id === selectedNode);
  const selectedGateConfig = currentConfig?.gates.find((g) => g.id === selectedNode);

  const activeRuns = useMemo(
    () => flowRuns.filter((r) => r.flow_name === selectedFlow && r.status === "running"),
    [flowRuns, selectedFlow],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <h3 className="text-sm font-medium text-zinc-300">Flow</h3>

        <select
          value={selectedFlow}
          onChange={(e) => setSelectedFlow(e.target.value)}
          className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
        >
          {Object.keys(flowConfigs).length === 0 && <option value="">No flows</option>}
          {Object.keys(flowConfigs).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {showNewFlow ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newFlowName}
              onChange={(e) => setNewFlowName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFlow()}
              placeholder="flow name"
              className="w-24 rounded border border-white/10 bg-white/[0.05] px-2 py-0.5 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
              // biome-ignore lint/a11y/noAutofocus: UX requires focus
              autoFocus
            />
            <button
              type="button"
              onClick={handleCreateFlow}
              className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400 hover:bg-cyan-500/30"
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => setShowNewFlow(false)}
              className="px-1 text-xs text-zinc-500"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewFlow(true)}
            className="rounded bg-white/[0.05] px-2 py-0.5 text-xs text-zinc-400 hover:bg-white/10"
          >
            + New
          </button>
        )}

        {currentConfig && (
          <>
            <button
              type="button"
              onClick={handleAddAgent}
              className="rounded bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400 hover:bg-cyan-500/20"
            >
              + Agent
            </button>
            <button
              type="button"
              onClick={handleAddGate}
              className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-500/20"
            >
              + Gate
            </button>
            <input
              type="text"
              value={currentConfig.description}
              onChange={(e) =>
                updateConfig((c) => {
                  c.description = e.target.value;
                  return c;
                })
              }
              placeholder="Description..."
              className="w-32 rounded border border-white/10 bg-transparent px-2 py-0.5 text-xs text-zinc-500 outline-none placeholder:text-zinc-600 focus:border-cyan-500/50 focus:text-zinc-300"
            />
            <button
              type="button"
              onClick={handleDeleteFlow}
              className="rounded px-1.5 py-0.5 text-[10px] text-red-400/50 hover:bg-red-500/10 hover:text-red-400"
            >
              Delete
            </button>
          </>
        )}

        <div className="flex-1" />

        {activeRuns.length > 0 && (
          <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400">
            {activeRuns.length} running
          </span>
        )}

        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        )}
      </div>

      {/* Canvas + config panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          {currentConfig ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              fitView
              colorMode="dark"
              style={rfStyle}
              defaultEdgeOptions={{
                markerEnd: { type: MarkerType.ArrowClosed, color: "#06b6d4" },
                style: { stroke: "#06b6d4", strokeWidth: 1.5 },
              }}
            >
              <Background color="#27272a" gap={20} />
              <Controls
                showInteractive={false}
                className="[&_button]:!border-white/10 [&_button]:!bg-zinc-900/80 [&_button]:!text-zinc-400 [&_button]:hover:!bg-zinc-800"
              />
            </ReactFlow>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-zinc-500">
                {Object.keys(flowConfigs).length === 0 ? "No flows defined yet" : "Select a flow"}
              </p>
              {Object.keys(flowConfigs).length === 0 && (
                <button
                  type="button"
                  onClick={() => setShowNewFlow(true)}
                  className="rounded-lg bg-cyan-500/20 px-4 py-2 text-sm text-cyan-400 hover:bg-cyan-500/30"
                >
                  Create your first flow
                </button>
              )}
            </div>
          )}
        </div>

        {/* Config panel */}
        {selectedNode && currentConfig && (selectedAgentConfig || selectedGateConfig) && (
          <div className="w-72 shrink-0 overflow-y-auto border-l border-white/[0.06] bg-zinc-900/50 p-3">
            {selectedAgentConfig && (
              <AgentConfigPanel
                agent={selectedAgentConfig}
                onChange={(updated) =>
                  updateConfig((c) => {
                    c.agents = c.agents.map((a) => (a.id === updated.id ? updated : a));
                    return c;
                  })
                }
              />
            )}
            {selectedGateConfig && (
              <GateConfigPanel
                gate={selectedGateConfig}
                onChange={(updated) =>
                  updateConfig((c) => {
                    c.gates = c.gates.map((g) => (g.id === updated.id ? updated : g));
                    return c;
                  })
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
