/**
 * Flow Editor — visual node-based flow orchestration editor.
 *
 * Uses React Flow (@xyflow/react) for the node canvas.
 * Nodes represent agent roles, edges represent stop-to-kick connections.
 * Clicking a node/edge opens a config panel on the right.
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
import type { FlowConfig, FlowEdgeConfig, FlowRun } from "@/lib/api";
import { api } from "@/lib/api";
import { EdgeConfigPanel } from "./EdgeConfigPanel";
import { FlowNodeComponent } from "./FlowNode";
import { NodeConfigPanel } from "./NodeConfigPanel";

// Custom node types for React Flow
const nodeTypes = {
  flowNode: FlowNodeComponent,
};

// Dark theme colors matching tmai
const rfStyle = {
  backgroundColor: "transparent",
};

/** Convert flow config nodes/edges to React Flow format */
function configToReactFlow(config: FlowConfig): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = config.nodes.map((node, i) => ({
    id: node.role,
    type: "flowNode",
    position: { x: 250 * i, y: 100 },
    data: {
      label: node.role,
      mode: node.mode,
      promptTemplate: node.prompt_template,
      tools: node.tools,
      agentType: node.agent_type,
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));

  const edges: Edge[] = [];
  for (const edge of config.edges) {
    for (const route of edge.route) {
      if (route.target) {
        edges.push({
          id: `${edge.from}-${route.target}-${route.when}`,
          source: edge.from,
          target: route.target,
          label: route.when === "true" ? route.action : route.when,
          animated: route.action === "spawn",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#06b6d4" },
          style: { stroke: "#06b6d4", strokeWidth: 1.5 },
          labelStyle: { fill: "#a1a1aa", fontSize: 10, fontFamily: "monospace" },
          data: { edgeConfig: edge, route },
        });
      }
    }
  }

  return { nodes, edges };
}

/** Auto-layout nodes in a left-to-right flow */
function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.source) ?? [];
    list.push(e.target);
    adjacency.set(e.source, list);
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
    positions.set(id, { x: col * 280 + 40, y: row * 140 + 40 });

    for (const target of adjacency.get(id) ?? []) {
      if (!visited.has(target)) {
        queue.push({ id: target, col: col + 1 });
      }
    }
  }

  // Place any unvisited nodes below
  let extraY = (Math.max(...Array.from(colCounts.values()), 0) + 1) * 140;
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: 40, y: extraY });
      extraY += 140;
    }
  }

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
}

/** Create an empty flow config */
function createEmptyFlow(_name: string): FlowConfig {
  return {
    description: "",
    entry_params: [],
    nodes: [
      {
        role: "implement",
        mode: "spawn",
        prompt_template: "",
        tools: [],
        agent_type: "claude",
      },
    ],
    edges: [],
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

  // React Flow state
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Selection state for config panels
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // New flow dialog
  const [showNewFlow, setShowNewFlow] = useState(false);
  const [newFlowName, setNewFlowName] = useState("");

  // Load flow configs on mount
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
      .catch(() => {
        // Flow config endpoint may not exist yet — start with empty
        setFlowConfigs({});
      });
    api
      .listFlowRuns()
      .then(setFlowRuns)
      .catch(() => {});
  }, []);

  // Update canvas when selected flow changes
  useEffect(() => {
    if (!selectedFlow || !flowConfigs[selectedFlow]) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const config = flowConfigs[selectedFlow];
    const { nodes: rfNodes, edges: rfEdges } = configToReactFlow(config);
    const laid = autoLayout(rfNodes, rfEdges);
    setNodes(laid);
    setEdges(rfEdges);
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [selectedFlow, flowConfigs]);

  // React Flow callbacks
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
      if (!connection.source || !connection.target || !selectedFlow) return;
      const config = flowConfigs[selectedFlow];
      if (!config) return;

      const existingEdge = config.edges.find((e) => e.from === connection.source);
      if (existingEdge) {
        existingEdge.route.push({
          when: "true",
          action: "send_prompt",
          target: connection.target,
          prompt: null,
          params: {},
        });
      } else {
        config.edges.push({
          from: connection.source,
          event: "stop",
          resolve: [],
          route: [
            {
              when: "true",
              action: "send_prompt",
              target: connection.target,
              prompt: null,
              params: {},
            },
          ],
        });
      }

      setFlowConfigs({ ...flowConfigs, [selectedFlow]: { ...config } });
      setDirty(true);
    },
    [flowConfigs, selectedFlow],
  );

  // Node/edge click handlers
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id);
    setSelectedEdge(null);
  }, []);
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge.id);
    setSelectedNode(null);
  }, []);
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  // Create new flow
  const handleCreateFlow = useCallback(() => {
    const name = newFlowName.trim().toLowerCase().replace(/\s+/g, "_");
    if (!name || flowConfigs[name]) return;

    const newConfig = createEmptyFlow(name);
    const updated = { ...flowConfigs, [name]: newConfig };
    setFlowConfigs(updated);
    setSelectedFlow(name);
    setShowNewFlow(false);
    setNewFlowName("");
    setDirty(true);
  }, [newFlowName, flowConfigs]);

  // Add node to current flow
  const handleAddNode = useCallback(() => {
    if (!selectedFlow || !flowConfigs[selectedFlow]) return;
    const config = flowConfigs[selectedFlow];

    // Generate a unique role name
    let roleName = "worker";
    let i = 1;
    while (config.nodes.some((n) => n.role === roleName)) {
      roleName = `worker_${i}`;
      i++;
    }

    config.nodes.push({
      role: roleName,
      mode: "spawn",
      prompt_template: "",
      tools: [],
      agent_type: "claude",
    });

    setFlowConfigs({ ...flowConfigs, [selectedFlow]: { ...config } });
    setDirty(true);
  }, [flowConfigs, selectedFlow]);

  // Save flow config to backend
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.updateFlowConfig(flowConfigs);
      setDirty(false);
    } catch (e) {
      console.error("Failed to save flow config:", e);
    } finally {
      setSaving(false);
    }
  }, [flowConfigs]);

  // Delete current flow
  const handleDeleteFlow = useCallback(() => {
    if (!selectedFlow) return;
    const updated = { ...flowConfigs };
    delete updated[selectedFlow];
    setFlowConfigs(updated);
    setSelectedFlow(Object.keys(updated)[0] ?? "");
    setDirty(true);
  }, [flowConfigs, selectedFlow]);

  // Get current flow config
  const currentConfig = selectedFlow ? flowConfigs[selectedFlow] : null;
  const selectedNodeConfig = currentConfig?.nodes.find((n) => n.role === selectedNode) ?? null;
  const selectedEdgeData = edges.find((e) => e.id === selectedEdge)?.data as
    | { edgeConfig: FlowEdgeConfig; route: FlowEdgeConfig["route"][number] }
    | undefined;

  // Active runs for this flow
  const activeRuns = useMemo(
    () => flowRuns.filter((r) => r.flow_name === selectedFlow && r.status === "running"),
    [flowRuns, selectedFlow],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <h3 className="text-sm font-medium text-zinc-300">Flow</h3>

        {/* Flow selector */}
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

        {/* New flow button */}
        {showNewFlow ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newFlowName}
              onChange={(e) => setNewFlowName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFlow()}
              placeholder="flow name"
              className="w-24 rounded border border-white/10 bg-white/[0.05] px-2 py-0.5 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
              // biome-ignore lint/a11y/noAutofocus: UX requires focus on new flow name input
              autoFocus
            />
            <button
              type="button"
              onClick={handleCreateFlow}
              className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400 hover:bg-cyan-500/30"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewFlow(false)}
              className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewFlow(true)}
            className="rounded bg-white/[0.05] px-2 py-0.5 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            title="Create new flow"
          >
            + New
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Active runs indicator */}
        {activeRuns.length > 0 && (
          <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400">
            {activeRuns.length} running
          </span>
        )}

        {/* Save button */}
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

      {/* Main content: canvas + optional config panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* React Flow canvas */}
        <div className="flex-1">
          {currentConfig ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
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
                {Object.keys(flowConfigs).length === 0
                  ? "No flows defined yet"
                  : "Select a flow to edit"}
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

        {/* Config panel (right side) */}
        {currentConfig && (selectedNode || selectedEdge) && (
          <div className="w-72 shrink-0 overflow-y-auto border-l border-white/[0.06] bg-zinc-900/50 p-3">
            {selectedNodeConfig && (
              <NodeConfigPanel
                node={selectedNodeConfig}
                onChange={(updated) => {
                  const newNodes = currentConfig.nodes.map((n) =>
                    n.role === updated.role ? updated : n,
                  );
                  setFlowConfigs({
                    ...flowConfigs,
                    [selectedFlow]: { ...currentConfig, nodes: newNodes },
                  });
                  setDirty(true);
                }}
              />
            )}
            {selectedEdgeData && (
              <EdgeConfigPanel
                edgeConfig={selectedEdgeData.edgeConfig}
                route={selectedEdgeData.route}
              />
            )}
          </div>
        )}

        {/* Toolbar (bottom of canvas when flow is selected) */}
        {currentConfig && !selectedNode && !selectedEdge && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/[0.06] bg-zinc-900/90 px-3 py-1.5 shadow-lg backdrop-blur">
            <button
              type="button"
              onClick={handleAddNode}
              className="rounded bg-white/[0.05] px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            >
              + Node
            </button>
            {currentConfig.description !== undefined && (
              <input
                type="text"
                value={currentConfig.description}
                onChange={(e) => {
                  setFlowConfigs({
                    ...flowConfigs,
                    [selectedFlow]: { ...currentConfig, description: e.target.value },
                  });
                  setDirty(true);
                }}
                placeholder="Flow description..."
                className="w-48 rounded border border-white/10 bg-transparent px-2 py-0.5 text-xs text-zinc-400 outline-none placeholder:text-zinc-600 focus:border-cyan-500/50"
              />
            )}
            <button
              type="button"
              onClick={handleDeleteFlow}
              className="rounded px-2 py-1 text-xs text-red-400/60 hover:bg-red-500/10 hover:text-red-400"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
