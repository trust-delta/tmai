/**
 * Flow Editor v3 — Orchestrator-centric single canvas.
 *
 * One page per project. Orchestrator node fixed at top.
 * Multiple named flows branch out from it.
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
import { AgentFlowNode, GateFlowNode, OrchestratorFlowNode } from "./FlowNode";
import { AgentConfigPanel } from "./NodeConfigPanel";

const nodeTypes = {
  agent: AgentFlowNode,
  gate: GateFlowNode,
  orchestrator: OrchestratorFlowNode,
};

const rfStyle = { backgroundColor: "transparent" };

/** Build the complete canvas from all flows + orchestrator */
function buildCanvas(flows: Record<string, FlowConfig>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Orchestrator node (fixed, always present)
  nodes.push({
    id: "__orch__",
    type: "orchestrator",
    position: { x: 300, y: 20 },
    data: { flowNames: Object.keys(flows) },
    draggable: true,
  });

  // Layout each flow as a column
  const flowNames = Object.keys(flows).sort();
  const colWidth = 280;

  for (let fi = 0; fi < flowNames.length; fi++) {
    const flowName = flowNames[fi];
    const config = flows[flowName];
    const offsetX = fi * colWidth * 2 + 40;
    const offsetY = 160;

    // Orch → first agent edge
    if (config.entry_node) {
      edges.push({
        id: `orch->${flowName}`,
        source: "__orch__",
        sourceHandle: `flow-${flowName}`,
        target: `${flowName}::${config.entry_node}`,
        targetHandle: "initial",
        label: flowName,
        labelStyle: { fill: "#a1a1aa", fontSize: 10, fontFamily: "monospace", fontWeight: 600 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#06b6d4" },
        style: { stroke: "#06b6d4", strokeWidth: 2 },
        animated: true,
      });
    }

    // BFS layout for this flow
    const adj = new Map<string, string[]>();
    for (const w of config.wires) {
      const list = adj.get(w.from.node) ?? [];
      list.push(w.to.node);
      adj.set(w.from.node, list);
    }

    const visited = new Set<string>();
    const positions = new Map<string, { x: number; y: number }>();
    const queue: { id: string; depth: number }[] = [
      { id: config.entry_node || config.agents[0]?.id || "", depth: 0 },
    ];
    const depthCounts = new Map<number, number>();

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item || !item.id) break;
      const { id, depth } = item;
      if (visited.has(id)) continue;
      visited.add(id);

      const col = depthCounts.get(depth) ?? 0;
      depthCounts.set(depth, col + 1);
      positions.set(id, { x: offsetX + col * colWidth, y: offsetY + depth * 150 });

      for (const t of adj.get(id) ?? []) {
        if (!visited.has(t)) queue.push({ id: t, depth: depth + 1 });
      }
    }

    // Place unvisited nodes
    let extraY = offsetY + (Math.max(...Array.from(depthCounts.values()), 0) + 1) * 150;
    const allNodeIds = [...config.agents.map((a) => a.id), ...config.gates.map((g) => g.id)];
    for (const nid of allNodeIds) {
      if (!positions.has(nid)) {
        positions.set(nid, { x: offsetX, y: extraY });
        extraY += 150;
      }
    }

    // Agent nodes
    for (const agent of config.agents) {
      const pos = positions.get(agent.id) ?? { x: offsetX, y: offsetY };
      nodes.push({
        id: `${flowName}::${agent.id}`,
        type: "agent",
        position: pos,
        data: { config: agent, flowName, nodeKind: "agent" as const },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
    }

    // Gate nodes
    for (const gate of config.gates) {
      const pos = positions.get(gate.id) ?? { x: offsetX, y: offsetY };
      nodes.push({
        id: `${flowName}::${gate.id}`,
        type: "gate",
        position: pos,
        data: { config: gate, flowName, nodeKind: "gate" as const },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
    }

    // Wires → edges (prefix node IDs with flow name)
    for (let wi = 0; wi < config.wires.length; wi++) {
      const w = config.wires[wi];
      const sourceId = w.from.node === "__orch__" ? "__orch__" : `${flowName}::${w.from.node}`;
      const targetId = w.to.node === "__orch__" ? "__orch__" : `${flowName}::${w.to.node}`;
      edges.push({
        id: `${flowName}-wire-${wi}`,
        source: sourceId,
        sourceHandle: w.from.port,
        target: targetId,
        targetHandle: w.to.port,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#06b6d4" },
        style: { stroke: "#06b6d4", strokeWidth: 1.5 },
        data: { flowName, wireIndex: wi },
      });
    }

    // Gate actions targeting __orch__ → visible edges to orch node
    for (const gate of config.gates) {
      const addOrchEdge = (branch: "then" | "else", target: string | null) => {
        if (target === "__orch__") {
          edges.push({
            id: `${flowName}-${gate.id}-${branch}->orch`,
            source: `${flowName}::${gate.id}`,
            sourceHandle: branch,
            target: "__orch__",
            targetHandle: "queue",
            markerEnd: { type: MarkerType.ArrowClosed, color: "#a78bfa" },
            style: { stroke: "#a78bfa", strokeWidth: 1.5, strokeDasharray: "4 2" },
            label: branch === "then" ? "notify orch" : "else → orch",
            labelStyle: { fill: "#a78bfa", fontSize: 9, fontFamily: "monospace" },
          });
        }
      };
      addOrchEdge("then", gate.then_action.target);
      if (gate.else_action) {
        addOrchEdge("else", gate.else_action.target);
      }
    }
  }

  return { nodes, edges };
}

interface FlowEditorProps {
  projectPath?: string;
}

export function FlowEditor(_props: FlowEditorProps) {
  const [flowConfigs, setFlowConfigs] = useState<Record<string, FlowConfig>>({});
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Selection: "flowName::nodeId" or null
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showNewFlow, setShowNewFlow] = useState(false);
  const [newFlowName, setNewFlowName] = useState("");

  // Load on mount
  useEffect(() => {
    api
      .getFlowConfig()
      .then((configs: Record<string, FlowConfig>) => setFlowConfigs(configs))
      .catch(() => setFlowConfigs({}));
    api
      .listFlowRuns()
      .then(setFlowRuns)
      .catch(() => {});
  }, []);

  // Rebuild canvas when configs change
  useEffect(() => {
    const { nodes: n, edges: e } = buildCanvas(flowConfigs);
    setNodes(n);
    setEdges(e);
  }, [flowConfigs]);

  // Helpers
  const updateConfig = useCallback(
    (flowName: string, updater: (config: FlowConfig) => FlowConfig) => {
      if (!flowConfigs[flowName]) return;
      setFlowConfigs({
        ...flowConfigs,
        [flowName]: updater({ ...flowConfigs[flowName] }),
      });
      setDirty(true);
    },
    [flowConfigs],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const fromPort = (connection.sourceHandle ?? "stop") as PortType;
      const toPort = (connection.targetHandle ?? "input") as PortType;

      // Parse flow name from node IDs (format: "flowName::nodeId")
      const srcFlow = connection.source.split("::")[0];
      const tgtFlow = connection.target.split("::")[0];
      if (srcFlow !== tgtFlow) return; // cross-flow wires not allowed

      const srcNode = connection.source.split("::")[1];
      const tgtNode = connection.target.split("::")[1];
      if (!srcNode || !tgtNode) return;

      updateConfig(srcFlow, (c) => {
        c.wires.push({
          from: { node: srcNode, port: fromPort },
          to: { node: tgtNode, port: toPort },
        });
        return c;
      });
    },
    [updateConfig],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id === "__orch__") return; // orch settings handled separately
    setSelectedNodeId(node.id);
  }, []);
  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  // Parse selected node
  const selectedFlowName = selectedNodeId?.split("::")[0];
  const selectedLocalId = selectedNodeId?.split("::")[1];
  const selectedFlowConfig = selectedFlowName ? flowConfigs[selectedFlowName] : null;
  const selectedAgentConfig = selectedFlowConfig?.agents.find((a) => a.id === selectedLocalId);
  const selectedGateConfig = selectedFlowConfig?.gates.find((g) => g.id === selectedLocalId);

  // New flow
  const handleCreateFlow = useCallback(() => {
    const name = newFlowName.trim().toLowerCase().replace(/\s+/g, "_");
    if (!name || flowConfigs[name]) return;
    setFlowConfigs({
      ...flowConfigs,
      [name]: {
        description: "",
        entry_params: [],
        entry_node: "agent_1",
        agents: [{ id: "agent_1", agent_type: "claude", prompt_template: "", tools: [] }],
        gates: [],
        wires: [],
      },
    });
    setShowNewFlow(false);
    setNewFlowName("");
    setDirty(true);
  }, [newFlowName, flowConfigs]);

  // Add agent/gate to a specific flow (uses selectedFlowName or first flow)
  const targetFlow = selectedFlowName ?? Object.keys(flowConfigs)[0];

  const handleAddAgent = useCallback(() => {
    if (!targetFlow) return;
    updateConfig(targetFlow, (c) => {
      let id = "agent_1";
      let i = 1;
      while (c.agents.some((a) => a.id === id) || c.gates.some((g) => g.id === id)) {
        i++;
        id = `agent_${i}`;
      }
      c.agents.push({ id, agent_type: "claude", prompt_template: "", tools: [] });
      return c;
    });
  }, [targetFlow, updateConfig]);

  const handleAddGate = useCallback(() => {
    if (!targetFlow) return;
    updateConfig(targetFlow, (c) => {
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
  }, [targetFlow, updateConfig]);

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

  const activeRuns = useMemo(() => flowRuns.filter((r) => r.status === "running"), [flowRuns]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <h3 className="text-sm font-medium text-zinc-300">Orchestration</h3>

        {showNewFlow ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newFlowName}
              onChange={(e) => setNewFlowName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFlow()}
              placeholder="flow name"
              className="w-24 rounded border border-white/10 bg-white/[0.05] px-2 py-0.5 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
              // biome-ignore lint/a11y/noAutofocus: UX
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
            + Flow
          </button>
        )}

        <button
          type="button"
          onClick={handleAddAgent}
          disabled={!targetFlow}
          className="rounded bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-30"
        >
          + Agent
        </button>
        <button
          type="button"
          onClick={handleAddGate}
          disabled={!targetFlow}
          className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-500/20 disabled:opacity-30"
        >
          + Gate
        </button>

        {targetFlow && <span className="text-[10px] text-zinc-600">adding to: {targetFlow}</span>}

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
        </div>

        {/* Config panel */}
        {selectedFlowName && selectedLocalId && selectedFlowConfig && (
          <div className="w-72 shrink-0 overflow-y-auto border-l border-white/[0.06] bg-zinc-900/50 p-3">
            <div className="mb-2 text-[10px] text-zinc-600">Flow: {selectedFlowName}</div>
            {selectedAgentConfig && (
              <AgentConfigPanel
                agent={selectedAgentConfig}
                onChange={(updated) =>
                  updateConfig(selectedFlowName, (c) => {
                    c.agents = c.agents.map((a) => (a.id === selectedLocalId ? updated : a));
                    return c;
                  })
                }
                onDelete={() => {
                  updateConfig(selectedFlowName, (c) => {
                    c.agents = c.agents.filter((a) => a.id !== selectedLocalId);
                    c.wires = c.wires.filter(
                      (w) => w.from.node !== selectedLocalId && w.to.node !== selectedLocalId,
                    );
                    if (c.entry_node === selectedLocalId) {
                      c.entry_node = c.agents[0]?.id ?? "";
                    }
                    return c;
                  });
                  setSelectedNodeId(null);
                }}
              />
            )}
            {selectedGateConfig && (
              <GateConfigPanel
                gate={selectedGateConfig}
                onChange={(updated) =>
                  updateConfig(selectedFlowName, (c) => {
                    c.gates = c.gates.map((g) => (g.id === selectedLocalId ? updated : g));
                    return c;
                  })
                }
                onDelete={() => {
                  updateConfig(selectedFlowName, (c) => {
                    c.gates = c.gates.filter((g) => g.id !== selectedLocalId);
                    c.wires = c.wires.filter(
                      (w) => w.from.node !== selectedLocalId && w.to.node !== selectedLocalId,
                    );
                    return c;
                  });
                  setSelectedNodeId(null);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
