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
import type { FlowConfig, FlowDefinitionSummary, FlowEdgeConfig, FlowRun } from "@/lib/api";
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
  // Simple DAG layout: BFS from first node
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

interface FlowEditorProps {
  /** Optional: project path for per-project flow config */
  projectPath?: string;
}

export function FlowEditor(_props: FlowEditorProps) {
  // Flow definitions from API
  const [_flowDefs, setFlowDefs] = useState<FlowDefinitionSummary[]>([]);
  const [flowConfigs, setFlowConfigs] = useState<Record<string, FlowConfig>>({});
  const [selectedFlow, setSelectedFlow] = useState<string>("");
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([]);

  // React Flow state
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Selection state for config panels
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // Load flow definitions and configs on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run only on mount
  useEffect(() => {
    api.listFlows().then(setFlowDefs).catch(console.error);
    api
      .getFlowConfig()
      .then((configs) => {
        setFlowConfigs(configs);
        const names = Object.keys(configs);
        if (names.length > 0) {
          setSelectedFlow((prev) => prev || names[0]);
        }
      })
      .catch(console.error);
    api.listFlowRuns().then(setFlowRuns).catch(console.error);
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

      // Add a new edge to the flow config
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
      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2">
        <h3 className="text-sm font-medium text-zinc-300">Orchestration</h3>

        {/* Flow selector */}
        <select
          value={selectedFlow}
          onChange={(e) => setSelectedFlow(e.target.value)}
          className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-xs text-zinc-300 outline-none focus:border-cyan-500/50"
        >
          <option value="">Select flow...</option>
          {Object.keys(flowConfigs).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {currentConfig && (
          <span className="text-xs text-zinc-500">{currentConfig.description}</span>
        )}

        {/* Active runs indicator */}
        {activeRuns.length > 0 && (
          <span className="ml-auto rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400">
            {activeRuns.length} running
          </span>
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
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-zinc-500">
                {Object.keys(flowConfigs).length === 0
                  ? "No flow definitions found. Add [flow.*] sections to config.toml."
                  : "Select a flow to view"}
              </p>
            </div>
          )}
        </div>

        {/* Config panel (right side) */}
        {(selectedNode || selectedEdge) && currentConfig && (
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
      </div>
    </div>
  );
}
