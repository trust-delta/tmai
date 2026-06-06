// ⚠ THROWAWAY TRIAL ARTIFACT — NOT a production feature. ⚠
//
// A frontend-only, fixture-driven prototype of an R-panel "aim-tree"
// visual view. It exists ONLY to evaluate a few read/write hypotheses
// about the aim-tree records model. There is NO backend, NO API call, NO
// persistence, NO generated-types usage, NO RPanel accordion wiring —
// pure hardcoded fixture held in component state. Mounted dev-only at
// `#aim-tree` (see `main.tsx`). Delete this file (and its mount) when the
// eval concludes.
//
// What it demonstrates:
//   - a recursive purpose=means tree of "aim" nodes laid out by `parent`
//     edges (two roots);
//   - one `depends_on` cross-edge rendered VISUALLY DISTINCT (dashed,
//     curved, info-hued) from the solid parent connectors;
//   - per-node state glyph: open `○` / done `●` / means-done-but-
//     purpose-open `◐`;
//   - BLAST RADIUS: clicking a node highlights its entire descendant
//     subtree — the set that would become drift-possible if that aim
//     changed. Root = whole tree (heavy), leaf = nothing below (light);
//     the visible size of the highlight is the read.
//   - BODY-ON-SELECT: selecting a node also opens its interior in a side
//     detail pane. Body lines tagged `[confirmed: <ref>]` vs `[claimed]`
//     render with a NEUTRAL shape-only distinction (✓ vs ○) — no severity
//     / heat color, because the machine must not appraise.
//   - FRONTMATTER-ONLY WRITE: the operator can edit a selected node's
//     `aim` / `parent` / `state`, and create a new child node (pick
//     parent, type an `aim`), all IN-MEMORY (lost on reload). The body is
//     the Producer's — the write affordance never asks the human to write
//     it; a new node's body shows empty / "Producer fills this". This
//     embodies the frontmatter ⊥ body division.
//
// Styling reuses the surrounding R-panel Tailwind tokens (foreground /
// muted-foreground / subtle-foreground / surface / hairline / primary /
// info) — no new design system.

import { useCallback, useMemo, useState } from "react";

// ── Data model ────────────────────────────────────────────────────────
//
// A node is `open` (means+purpose still open), `done` (both reached), or
// `means-done` (its means are all done but its own purpose is still open —
// the ◐ asymmetry). `parent` gives the purpose=means tree edge (frontmatter,
// human-written); the lone `dependsOn` is the shared-means cross-edge.
//
// `body` is the node's INTERIOR — the Producer's prose. It is intentionally
// NOT something the write affordance lets the human author: frontmatter
// (`aim`/`parent`/`state`) is the human's, the body is the Producer's.

type AimState = "open" | "done" | "means-done";

// A body line is plain prose, or an honesty-tagged claim. `confirmed`
// carries a `ref` (the evidence pointer); `claimed` is asserted but not yet
// evidenced. The distinction is rendered shape-only (✓ vs ○), never weighted.
type BodyLine =
  | { kind: "text"; text: string }
  | { kind: "confirmed"; text: string; ref: string }
  | { kind: "claimed"; text: string };

interface AimNode {
  id: string;
  /** The 1-line aim (= frontmatter `aim:`). Editable by the human. */
  label: string;
  state: AimState;
  parent: string | null;
  /** Cross-edge to another aim this one leans on (drawn distinct). */
  dependsOn?: string;
  /** Producer-owned interior. Empty array = "Producer fills this". */
  body: BodyLine[];
}

const INITIAL_NODES: readonly AimNode[] = [
  // Tree 1 — amplify-human-judgment
  {
    id: "amplify-human-judgment",
    label: "人間の判断を増幅する",
    state: "open",
    parent: null,
    body: [{ kind: "text", text: "tmai の上位目的。機械が人間の判断を肩代わりせず、増幅する。" }],
  },
  {
    id: "dev-loop-completes-in-tmai",
    label: "開発ループを tmai 内で閉じる",
    state: "open",
    parent: "amplify-human-judgment",
    body: [
      { kind: "text", text: "観測 → 判断 → dispatch → 検証 のループを tmai 内で閉じる。" },
      { kind: "claimed", text: "console + R-panel で読みの側が閉じる" },
    ],
  },
  {
    id: "attention-per-artifact",
    label: "注意を per-artifact attention に",
    state: "means-done",
    parent: "dev-loop-completes-in-tmai",
    // Representative fuller body — confirmed/claimed mix.
    body: [
      { kind: "text", text: "注意を Δ-stream でなく per-artifact の attention field に畳む。" },
      { kind: "confirmed", text: "backend storage + wire + null-on-change", ref: "#769" },
      { kind: "confirmed", text: "R-panel per-row markers + section reshape", ref: "#772/#773" },
      { kind: "claimed", text: "observation を 5th artifact に統合して注意モデルが閉じる" },
      {
        kind: "text",
        text: "means は done だが purpose（注意が実際に per-artifact で回るか）は未確定 → ◐。",
      },
    ],
  },
  {
    id: "attention-backend",
    label: "storage+wire+null-on-change",
    state: "done",
    parent: "attention-per-artifact",
    body: [{ kind: "confirmed", text: "storage + wire + null-on-change landed", ref: "#769" }],
  },
  {
    id: "attention-ui",
    label: "R-panel markers + section reshape",
    state: "done",
    parent: "attention-per-artifact",
    body: [{ kind: "confirmed", text: "R-panel markers + section reshape", ref: "#772/#773" }],
  },
  {
    id: "observation-section",
    label: "Observation を 5th artifact に",
    state: "done",
    parent: "attention-per-artifact",
    body: [{ kind: "confirmed", text: "Observation を 5th attention-artifact に", ref: "#777" }],
  },

  // Tree 2 — aim-system
  {
    id: "aim-system",
    label: "records を write 構造(aim-tree)に",
    state: "open",
    parent: null,
    body: [{ kind: "text", text: "records を read の山でなく write の構造（aim-tree）にする。" }],
  },
  {
    id: "aim-write-first-relieves-friction",
    label: "anchor を低摩擦で書ける",
    state: "open",
    parent: "aim-system",
    body: [
      { kind: "text", text: "anchor を低摩擦で書けることが aim-tree 成立の要。" },
      { kind: "claimed", text: "write-first が記録の friction を下げる" },
    ],
  },
  {
    id: "aim-operator-write-front-matter",
    label: "人間 frontmatter / Producer body",
    state: "open",
    parent: "aim-write-first-relieves-friction",
    // Representative fuller body — confirmed/claimed mix.
    body: [
      {
        kind: "text",
        text: "human が frontmatter（aim/parent/state）を書き、Producer が body を埋める。",
      },
      { kind: "confirmed", text: "frontmatter ⊥ body の分割を prototype で体感", ref: "PR #778" },
      { kind: "claimed", text: "UI からの write は file 編集よりさらに軽い" },
      { kind: "claimed", text: "anchor を低摩擦で置ければ aim-tree が write 構造として成立する" },
    ],
  },
  {
    id: "aim-node-shape",
    label: "anchor⊥interior + purpose=means 再帰",
    state: "open",
    parent: "aim-system",
    body: [{ kind: "text", text: "anchor ⊥ interior。purpose=means の再帰で木を成す。" }],
  },
  {
    id: "aim-honesty-confirmed-claimed-drift",
    label: "confirmed⊥claimed + drift 非対称",
    state: "open",
    parent: "aim-system",
    body: [
      { kind: "text", text: "confirmed ⊥ claimed を分け、drift を非対称に扱う。" },
      {
        kind: "confirmed",
        text: "neutral な shape-only 区別（✓/○）を prototype に実装",
        ref: "PR #778",
      },
    ],
  },
  {
    id: "aim-authority-event-driven-amendment",
    label: "authority = event-driven aim-amendment",
    state: "open",
    parent: "aim-system",
    dependsOn: "aim-honesty-confirmed-claimed-drift",
    body: [
      { kind: "text", text: "authority = event-driven な aim の修正（amendment）。" },
      { kind: "claimed", text: "depends_on 先（honesty）の変化が amendment を駆動する" },
    ],
  },
  {
    id: "aim-shared-means-dag",
    label: "共有手段を home 維持 cross-edge",
    state: "open",
    parent: "aim-system",
    body: [{ kind: "text", text: "共有手段は home を保ちつつ cross-edge（depends_on）で表す。" }],
  },
  {
    id: "aim-file-holding-scheme-a",
    label: "1 node=1 file",
    state: "done",
    parent: "aim-system",
    body: [{ kind: "confirmed", text: "1 node = 1 file の保持方式", ref: "scheme A" }],
  },
  {
    id: "aim-trial-discipline",
    label: "fresh 名 coexist・可逆・lived",
    state: "open",
    parent: "aim-system",
    body: [{ kind: "text", text: "fresh 名で旧構造と coexist・可逆・lived に試す。" }],
  },
];

// ── Layout constants ──────────────────────────────────────────────────
const COL_W = 232; // horizontal distance per depth level
const ROW_H = 54; // vertical slot per leaf row
const NODE_W = 200; // fixed node-box width (labels wrap within)
const PAD_L = 24;
const PAD_T = 24;
const PAD_R = 36;
const PAD_B = 24;
const GAP_BETWEEN_TREES = 1; // blank leaf-slots inserted between roots

interface NodePos {
  id: string;
  /** Left edge x of the node box. */
  x: number;
  /** Vertical CENTER of the node (edges anchor here; the box itself is
   *  centered on this y via a translateY(-50%), so multi-line labels grow
   *  symmetrically and never shift the edge anchor). */
  cy: number;
  depth: number;
}

interface Layout {
  positions: Map<string, NodePos>;
  roots: AimNode[];
  width: number;
  height: number;
}

// Index helpers — children grouped by parent, preserving array order.
function buildChildren(nodes: readonly AimNode[]): Map<string, AimNode[]> {
  const childrenOf = new Map<string, AimNode[]>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    const list = childrenOf.get(n.parent) ?? [];
    list.push(n);
    childrenOf.set(n.parent, list);
  }
  return childrenOf;
}

// Classic tidy tree: leaves get sequential vertical slots; an internal
// node is centered on the midpoint of its first and last child. Roots are
// stacked top-to-bottom (a blank gap-slot between them).
function computeLayout(nodes: readonly AimNode[]): Layout {
  const childrenOf = buildChildren(nodes);
  const positions = new Map<string, NodePos>();
  let leafCursor = 0;
  let maxDepth = 0;

  function assign(id: string, depth: number): number {
    maxDepth = Math.max(maxDepth, depth);
    const children = childrenOf.get(id) ?? [];
    let cy: number;
    if (children.length === 0) {
      cy = PAD_T + leafCursor * ROW_H + ROW_H / 2;
      leafCursor += 1;
    } else {
      const childCenters = children.map((c) => assign(c.id, depth + 1));
      cy = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }
    positions.set(id, { id, x: PAD_L + depth * COL_W, cy, depth });
    return cy;
  }

  const roots = nodes.filter((n) => n.parent === null);
  roots.forEach((root, i) => {
    if (i > 0) leafCursor += GAP_BETWEEN_TREES;
    assign(root.id, 0);
  });

  return {
    positions,
    roots,
    width: PAD_L + maxDepth * COL_W + NODE_W + PAD_R,
    height: PAD_T + leafCursor * ROW_H + PAD_B,
  };
}

// The blast radius: every descendant of `id` reachable through `parent`
// edges (NOT through `dependsOn` — the cross-edge is deliberately kept out
// of the descendant set; it is a shared-means link, drawn distinct, not
// part of the purpose=means subtree a change would cascade down).
function descendantsOf(id: string, childrenOf: Map<string, AimNode[]>): Set<string> {
  const out = new Set<string>();
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) continue;
    out.add(n.id);
    for (const c of childrenOf.get(n.id) ?? []) stack.push(c);
  }
  return out;
}

const GLYPH: Record<AimState, string> = {
  open: "○",
  done: "●",
  "means-done": "◐",
};

const STATE_LABEL: Record<AimState, string> = {
  open: "open",
  done: "done",
  "means-done": "means-done / purpose-open",
};

const STATE_OPTIONS: readonly AimState[] = ["open", "means-done", "done"];

// Smooth horizontal connector from a parent's right edge to a child's left
// edge (S-curve via a cubic with control points at the x-midpoint).
function parentEdgePath(parent: NodePos, child: NodePos): string {
  const x1 = parent.x + NODE_W;
  const y1 = parent.cy;
  const x2 = child.x;
  const y2 = child.cy;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

// The depends_on cross-edge bows out to the RIGHT of both endpoints (the
// right side of these depth-1 nodes is whitespace), so it never gets
// confused with the leftward solid parent connectors.
function dependsEdgePath(src: NodePos, tgt: NodePos): string {
  const x1 = src.x + NODE_W;
  const y1 = src.cy;
  const x2 = tgt.x + NODE_W;
  const y2 = tgt.cy;
  const bow = Math.max(x1, x2) + 56;
  return `M ${x1} ${y1} C ${bow} ${y1}, ${bow} ${y2}, ${x2} ${y2}`;
}

interface CreateDraft {
  parent: string;
  aim: string;
}

export function RAimTreePrototype() {
  // The fixture is held in state so the frontmatter-write affordance can
  // mutate it in-memory (lost on reload — that's the point: feel the WRITE,
  // no persistence).
  const [nodes, setNodes] = useState<AimNode[]>(() => INITIAL_NODES.map((n) => ({ ...n })));
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreateDraft | null>(null);
  // Monotonic counter for generated child ids (never reused; no deletes).
  const [seq, setSeq] = useState(1);

  const childrenOf = useMemo(() => buildChildren(nodes), [nodes]);
  const layout = useMemo(() => computeLayout(nodes), [nodes]);

  // Highlight set = the selected node plus its whole descendant subtree.
  // Empty when nothing is selected (the tree renders at full contrast).
  const blast = useMemo(() => descendantsOf(selected ?? "", childrenOf), [selected, childrenOf]);
  const highlighted = useMemo(() => {
    if (selected === null) return new Set<string>();
    return new Set<string>([selected, ...blast]);
  }, [selected, blast]);

  const hasSelection = selected !== null;
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selected) ?? null,
    [nodes, selected],
  );

  // ── Frontmatter write (in-memory) ──
  const patchNode = useCallback(
    (id: string, patch: Partial<Pick<AimNode, "label" | "parent" | "state">>) => {
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    },
    [],
  );

  const startCreateChild = useCallback((parentId: string) => {
    setCreating({ parent: parentId, aim: "" });
  }, []);

  const commitCreate = useCallback(
    (draft: CreateDraft) => {
      const aim = draft.aim.trim();
      if (aim === "") return;
      const id = `aim-new-${seq}`;
      // New node: human supplies aim + parent (+ default state open); the
      // body is the Producer's, so it starts EMPTY ("Producer fills this").
      const node: AimNode = { id, label: aim, state: "open", parent: draft.parent, body: [] };
      setNodes((prev) => [...prev, node]);
      setSeq((s) => s + 1);
      setCreating(null);
      setSelected(id); // jump to the freshly written node
    },
    [seq],
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-hairline px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold">R · Aim-tree</h1>
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning">
            prototype · throwaway
          </span>
          <span className="text-[11px] text-subtle-foreground">
            fixture / in-memory — no backend, not for merge
          </span>
          <button
            type="button"
            onClick={() => setCreating({ parent: selected ?? layout.roots[0]?.id ?? "", aim: "" })}
            className="ml-auto rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            ＋ New node
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Click a node to light up its <span className="text-foreground">blast radius</span> (the
          descendant subtree that would become drift-possible if that aim changed) and read its{" "}
          <span className="text-foreground">body</span> in the side pane. Root = heavy, leaf =
          light.
        </p>
        <Legend selected={selected} blastCount={blast.size} onClear={() => setSelected(null)} />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: the tree canvas. Relative canvas with SVG edges underneath
            and clickable node boxes on top; a background click clears the
            selection. */}
        <div className="min-w-0 flex-1 overflow-auto p-4">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: dev-only canvas backdrop */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: dev-only canvas backdrop */}
          <div
            className="relative"
            style={{ width: layout.width, height: layout.height }}
            onClick={() => setSelected(null)}
          >
            <Edges
              nodes={nodes}
              layout={layout}
              highlighted={highlighted}
              hasSelection={hasSelection}
            />
            {nodes.map((node) => {
              const pos = layout.positions.get(node.id);
              if (!pos) return null;
              const isSelected = selected === node.id;
              const lit = highlighted.has(node.id);
              return (
                <NodeBox
                  key={node.id}
                  node={node}
                  pos={pos}
                  isSelected={isSelected}
                  lit={lit}
                  dimmed={hasSelection && !lit}
                  onSelect={() => setSelected(node.id)}
                />
              );
            })}
          </div>
        </div>

        {/* Right: the detail pane — body-on-select + frontmatter-only write.
            Either the create form (when creating) or the selected node's
            interior + editable frontmatter, or a hint when idle. */}
        <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-hairline">
          {creating ? (
            <CreateForm
              draft={creating}
              nodes={nodes}
              onChange={setCreating}
              onCancel={() => setCreating(null)}
              onCommit={commitCreate}
            />
          ) : selectedNode ? (
            <DetailPane
              node={selectedNode}
              nodes={nodes}
              childrenOf={childrenOf}
              blastCount={blast.size}
              onPatch={patchNode}
              onAddChild={() => startCreateChild(selectedNode.id)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="p-6 text-xs text-subtle-foreground">
              Select a node to read its body and edit its frontmatter, or use{" "}
              <span className="text-foreground">＋ New node</span> to write a new aim.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Legend({
  selected,
  blastCount,
  onClear,
}: {
  selected: string | null;
  blastCount: number;
  onClear: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-subtle-foreground">
      <span className="flex items-center gap-1">
        <span className="text-foreground">○</span> open
      </span>
      <span className="flex items-center gap-1">
        <span className="text-foreground">●</span> done
      </span>
      <span className="flex items-center gap-1">
        <span className="text-foreground">◐</span> means-done / purpose-open
      </span>
      <span className="flex items-center gap-1">
        <svg width="26" height="8" aria-hidden="true">
          <title>depends_on</title>
          <line
            x1="0"
            y1="4"
            x2="26"
            y2="4"
            stroke="var(--color-info)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        </svg>
        depends_on (cross-edge)
      </span>
      {selected !== null ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <span>
            blast radius: <span className="text-foreground">{blastCount}</span> descendant
            {blastCount === 1 ? "" : "s"} drift-possible
          </span>
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            clear
          </button>
        </span>
      ) : (
        <span className="text-subtle-foreground">nothing selected</span>
      )}
    </div>
  );
}

function Edges({
  nodes,
  layout,
  highlighted,
  hasSelection,
}: {
  nodes: readonly AimNode[];
  layout: Layout;
  highlighted: Set<string>;
  hasSelection: boolean;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={layout.width}
      height={layout.height}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="aim-depends-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L8 4 L0 8 z" fill="var(--color-info)" />
        </marker>
      </defs>

      {/* Solid parent=means edges. An edge is "in the blast radius" when
          both endpoints are highlighted — then it shares the accent. */}
      {nodes.map((node) => {
        if (node.parent === null) return null;
        const parent = layout.positions.get(node.parent);
        const child = layout.positions.get(node.id);
        if (!parent || !child) return null;
        const lit = highlighted.has(node.parent) && highlighted.has(node.id);
        const dimmed = hasSelection && !lit;
        return (
          <path
            key={`p-${node.id}`}
            d={parentEdgePath(parent, child)}
            fill="none"
            stroke={lit ? "var(--color-primary)" : "var(--color-hairline-strong)"}
            strokeWidth={lit ? 2 : 1.5}
            opacity={dimmed ? 0.2 : 1}
          />
        );
      })}

      {/* The lone depends_on cross-edge: dashed, info-hued, arrow-headed —
          deliberately NOT part of any blast radius (kept constant). */}
      {nodes.map((node) => {
        if (!node.dependsOn) return null;
        const src = layout.positions.get(node.id);
        const tgt = layout.positions.get(node.dependsOn);
        if (!src || !tgt) return null;
        return (
          <path
            key={`d-${node.id}`}
            d={dependsEdgePath(src, tgt)}
            fill="none"
            stroke="var(--color-info)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            markerEnd="url(#aim-depends-arrow)"
            opacity={hasSelection ? 0.55 : 0.9}
          />
        );
      })}
    </svg>
  );
}

function NodeBox({
  node,
  pos,
  isSelected,
  lit,
  dimmed,
  onSelect,
}: {
  node: AimNode;
  pos: NodePos;
  isSelected: boolean;
  lit: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  // Tier the styling: the selected node gets a solid primary ring; the rest
  // of its blast radius gets a softer primary tint; everything else dims out
  // when a selection is active so the highlighted region's size reads at a
  // glance.
  const tone = isSelected
    ? "border-primary bg-primary/15 ring-1 ring-primary"
    : lit
      ? "border-primary/40 bg-primary/10"
      : "border-hairline bg-surface";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // don't let the backdrop clear it
        onSelect();
      }}
      aria-pressed={isSelected}
      title={`${node.id} · ${STATE_LABEL[node.state]}`}
      className={`absolute flex items-start gap-1.5 rounded border px-2 py-1.5 text-left transition-all ${tone} ${
        dimmed ? "opacity-35" : "opacity-100"
      }`}
      style={{
        left: pos.x,
        top: pos.cy,
        width: NODE_W,
        transform: "translateY(-50%)",
      }}
    >
      <span aria-hidden="true" className="pt-px font-mono text-sm leading-none text-foreground">
        {GLYPH[node.state]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs leading-snug text-foreground">{node.label}</span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-subtle-foreground">
          {node.id}
        </span>
      </span>
    </button>
  );
}

// ── Detail pane: body-on-select + frontmatter-only edit ──────────────────
function DetailPane({
  node,
  nodes,
  childrenOf,
  blastCount,
  onPatch,
  onAddChild,
  onClose,
}: {
  node: AimNode;
  nodes: readonly AimNode[];
  childrenOf: Map<string, AimNode[]>;
  blastCount: number;
  onPatch: (id: string, patch: Partial<Pick<AimNode, "label" | "parent" | "state">>) => void;
  onAddChild: () => void;
  onClose: () => void;
}) {
  // A node can't be its own ancestor: exclude itself + its descendants from
  // the parent options so re-parenting can't form a cycle.
  const invalidParents = useMemo(() => {
    const s = descendantsOf(node.id, childrenOf);
    s.add(node.id);
    return s;
  }, [node.id, childrenOf]);
  const parentOptions = nodes.filter((n) => !invalidParents.has(n.id));

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[10px] text-subtle-foreground">{node.id}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close detail"
          aria-label="Close detail"
          className="shrink-0 rounded px-1.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {/* Frontmatter — the human's. Edits apply live to the in-memory tree. */}
      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          Frontmatter — yours (editable)
        </h2>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-subtle-foreground">aim</span>
          <input
            type="text"
            value={node.label}
            onChange={(e) => onPatch(node.id, { label: e.target.value })}
            className="w-full rounded border border-hairline bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-subtle-foreground">parent</span>
          <select
            value={node.parent ?? ""}
            onChange={(e) =>
              onPatch(node.id, { parent: e.target.value === "" ? null : e.target.value })
            }
            className="w-full rounded border border-hairline bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          >
            <option value="">(root — no parent)</option>
            {parentOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} · {n.id}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-subtle-foreground">state</span>
          <select
            value={node.state}
            onChange={(e) => onPatch(node.id, { state: e.target.value as AimState })}
            className="w-full rounded border border-hairline bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          >
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {GLYPH[s]} {STATE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* Body — the Producer's. Read-only here: the write affordance never
          asks the human to author the interior (frontmatter ⊥ body). */}
      <section className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] uppercase tracking-wide text-subtle-foreground">
            Body — Producer's (read-only)
          </h2>
          <span className="text-[10px] text-subtle-foreground">✓ confirmed · ○ claimed</span>
        </div>
        <BodyView body={node.body} />
      </section>

      <div className="border-t border-hairline pt-3 text-[11px] text-subtle-foreground">
        blast radius from here: <span className="text-foreground">{blastCount}</span> descendant
        {blastCount === 1 ? "" : "s"}
        <button
          type="button"
          onClick={onAddChild}
          className="ml-3 rounded border border-hairline px-2 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ＋ Add child
        </button>
      </div>
    </div>
  );
}

// Render the body interior. Confirmed vs claimed are distinguished by SHAPE
// ONLY (✓ vs ○), in the SAME subtle hue — no severity / heat color, because
// the machine must not appraise. Empty body = the Producer hasn't written it.
function BodyView({ body }: { body: readonly BodyLine[] }) {
  if (body.length === 0) {
    return (
      <p className="rounded border border-dashed border-hairline px-2 py-3 text-center text-[11px] italic text-subtle-foreground">
        (empty — Producer fills this)
      </p>
    );
  }
  return (
    <div className="space-y-1.5 text-xs leading-snug">
      {body.map((line) => {
        // Content-based key: body lines are static fixture prose and unique
        // within a node, so kind+text is a stable key (avoids array-index keys).
        const key = `${line.kind}:${line.text}`;
        if (line.kind === "text") {
          return (
            <p key={key} className="text-muted-foreground">
              {line.text}
            </p>
          );
        }
        const glyph = line.kind === "confirmed" ? "✓" : "○";
        return (
          <p key={key} className="flex items-start gap-1.5 text-foreground">
            <span aria-hidden="true" className="pt-px font-mono text-subtle-foreground">
              {glyph}
            </span>
            <span className="min-w-0 flex-1">
              {line.text}
              {line.kind === "confirmed" ? (
                <span className="ml-1 font-mono text-[10px] text-subtle-foreground">
                  [confirmed: {line.ref}]
                </span>
              ) : (
                <span className="ml-1 font-mono text-[10px] text-subtle-foreground">[claimed]</span>
              )}
            </span>
          </p>
        );
      })}
    </div>
  );
}

// ── Create form: frontmatter-only, in-memory ─────────────────────────────
// The human writes ONLY the aim + parent (state defaults to open). The body
// is deliberately not authored here — it's the Producer's, shown as an empty
// placeholder so the frontmatter ⊥ body division is felt at write time.
function CreateForm({
  draft,
  nodes,
  onChange,
  onCancel,
  onCommit,
}: {
  draft: CreateDraft;
  nodes: readonly AimNode[];
  onChange: (draft: CreateDraft) => void;
  onCancel: () => void;
  onCommit: (draft: CreateDraft) => void;
}) {
  const canCreate = draft.aim.trim() !== "" && draft.parent !== "";
  return (
    <form
      className="flex flex-col gap-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canCreate) onCommit(draft);
      }}
    >
      <h2 className="text-[11px] uppercase tracking-wide text-subtle-foreground">
        New node — frontmatter only
      </h2>
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-subtle-foreground">aim (you write)</span>
        <input
          type="text"
          // biome-ignore lint/a11y/noAutofocus: dev-only form, focus the single write field
          autoFocus
          value={draft.aim}
          onChange={(e) => onChange({ ...draft, aim: e.target.value })}
          placeholder="1-line aim…"
          className="w-full rounded border border-hairline bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-subtle-foreground">parent (pick)</span>
        <select
          value={draft.parent}
          onChange={(e) => onChange({ ...draft, parent: e.target.value })}
          className="w-full rounded border border-hairline bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label} · {n.id}
            </option>
          ))}
        </select>
      </label>
      <div className="text-[10px] text-subtle-foreground">
        state defaults to <span className="text-foreground">○ open</span>.
      </div>

      {/* Body is the Producer's — not authored at create time. */}
      <section className="space-y-1.5">
        <h2 className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          Body — Producer's
        </h2>
        <p className="rounded border border-dashed border-hairline px-2 py-3 text-center text-[11px] italic text-subtle-foreground">
          (empty — Producer fills this)
        </p>
      </section>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canCreate}
          className="rounded border border-primary/50 bg-primary/15 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-hairline px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
