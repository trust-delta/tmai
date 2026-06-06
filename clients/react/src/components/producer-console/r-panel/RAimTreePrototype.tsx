// ⚠ THROWAWAY TRIAL ARTIFACT — NOT a production feature. ⚠
//
// A frontend-only, fixture-driven prototype of an R-panel "aim-tree"
// visual view. It exists ONLY to evaluate whether a visual structural
// tree-view (plus the "blast radius" interaction below) is a useful
// read-surface for the aim-tree records model. There is NO backend, NO
// API call, NO generated-types usage, NO RPanel accordion wiring — pure
// hardcoded fixture + view. Mounted dev-only at `#aim-tree` (see
// `main.tsx`). Delete this file (and its mount) when the eval concludes.
//
// What it demonstrates:
//   - a recursive purpose=means tree of "aim" nodes laid out by `parent`
//     edges (two roots);
//   - one `depends_on` cross-edge rendered VISUALLY DISTINCT (dashed,
//     curved, info-hued) from the solid parent connectors;
//   - per-node state glyph: open `○` / done `●` / means-done-but-
//     purpose-open `◐`;
//   - THE KEY INTERACTION: clicking a node highlights its entire
//     descendant subtree — the "blast radius" = the set that would become
//     drift-possible if that node's aim changed. The *visible size* of the
//     highlight is the whole point: the root lights up the whole tree
//     (heavy change), a leaf lights up nothing below it (light change).
//
// Styling reuses the surrounding R-panel Tailwind tokens (foreground /
// muted-foreground / subtle-foreground / surface / hairline / primary /
// info) — no new design system.

import { useMemo, useState } from "react";

// ── Fixture data ──────────────────────────────────────────────────────
//
// A node is `open` (means+purpose still open), `done` (both reached), or
// `means-done` (its means are all done but its own purpose is still open —
// the ◐ asymmetry). `parent` gives the purpose=means tree edge; the lone
// `dependsOn` is the shared-means cross-edge.

type AimState = "open" | "done" | "means-done";

interface AimNode {
  id: string;
  label: string;
  state: AimState;
  parent: string | null;
  /** Cross-edge to another aim this one leans on (drawn distinct). */
  dependsOn?: string;
}

const FIXTURE: readonly AimNode[] = [
  // Tree 1 — amplify-human-judgment
  {
    id: "amplify-human-judgment",
    label: "人間の判断を増幅する",
    state: "open",
    parent: null,
  },
  {
    id: "dev-loop-completes-in-tmai",
    label: "開発ループを tmai 内で閉じる",
    state: "open",
    parent: "amplify-human-judgment",
  },
  {
    id: "attention-per-artifact",
    label: "注意を per-artifact attention に",
    state: "means-done",
    parent: "dev-loop-completes-in-tmai",
  },
  {
    id: "attention-backend",
    label: "storage+wire+null-on-change",
    state: "done",
    parent: "attention-per-artifact",
  },
  {
    id: "attention-ui",
    label: "R-panel markers + section reshape",
    state: "done",
    parent: "attention-per-artifact",
  },
  {
    id: "observation-section",
    label: "Observation を 5th artifact に",
    state: "done",
    parent: "attention-per-artifact",
  },

  // Tree 2 — aim-system
  {
    id: "aim-system",
    label: "records を write 構造(aim-tree)に",
    state: "open",
    parent: null,
  },
  {
    id: "aim-write-first-relieves-friction",
    label: "anchor を低摩擦で書ける",
    state: "open",
    parent: "aim-system",
  },
  {
    id: "aim-operator-write-front-matter",
    label: "人間 frontmatter / Producer body",
    state: "open",
    parent: "aim-write-first-relieves-friction",
  },
  {
    id: "aim-node-shape",
    label: "anchor⊥interior + purpose=means 再帰",
    state: "open",
    parent: "aim-system",
  },
  {
    id: "aim-honesty-confirmed-claimed-drift",
    label: "confirmed⊥claimed + drift 非対称",
    state: "open",
    parent: "aim-system",
  },
  {
    id: "aim-authority-event-driven-amendment",
    label: "authority = event-driven aim-amendment",
    state: "open",
    parent: "aim-system",
    dependsOn: "aim-honesty-confirmed-claimed-drift",
  },
  {
    id: "aim-shared-means-dag",
    label: "共有手段を home 維持 cross-edge",
    state: "open",
    parent: "aim-system",
  },
  {
    id: "aim-file-holding-scheme-a",
    label: "1 node=1 file",
    state: "done",
    parent: "aim-system",
  },
  {
    id: "aim-trial-discipline",
    label: "fresh 名 coexist・可逆・lived",
    state: "open",
    parent: "aim-system",
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
  width: number;
  height: number;
}

// Index helpers — children grouped by parent, preserving fixture order.
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
// node is centered on the midpoint of its first and last child. Two roots
// are stacked (a blank gap-slot between them).
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
    width: PAD_L + maxDepth * COL_W + NODE_W + PAD_R,
    height: PAD_T + leafCursor * ROW_H + PAD_B,
  };
}

// The blast radius: every descendant of `id` reachable through `parent`
// edges (NOT through `dependsOn` — the cross-edge is deliberately kept
// out of the descendant set; it is a shared-means link, drawn distinct,
// not part of the purpose=means subtree a change would cascade down).
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

// Smooth horizontal connector from a parent's right edge to a child's
// left edge (S-curve via a cubic with control points at the x-midpoint).
function parentEdgePath(parent: NodePos, child: NodePos): string {
  const x1 = parent.x + NODE_W;
  const y1 = parent.cy;
  const x2 = child.x;
  const y2 = child.cy;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

// The depends_on cross-edge bows out to the RIGHT of both endpoints
// (the right side of these depth-1 nodes is whitespace), so it never gets
// confused with the leftward solid parent connectors.
function dependsEdgePath(src: NodePos, tgt: NodePos): string {
  const x1 = src.x + NODE_W;
  const y1 = src.cy;
  const x2 = tgt.x + NODE_W;
  const y2 = tgt.cy;
  const bow = Math.max(x1, x2) + 56;
  return `M ${x1} ${y1} C ${bow} ${y1}, ${bow} ${y2}, ${x2} ${y2}`;
}

export function RAimTreePrototype() {
  const [selected, setSelected] = useState<string | null>(null);

  const childrenOf = useMemo(() => buildChildren(FIXTURE), []);
  const layout = useMemo(() => computeLayout(FIXTURE), []);

  // Highlight set = the selected node plus its whole descendant subtree.
  // Empty when nothing is selected (the tree renders at full contrast).
  const blast = useMemo(() => descendantsOf(selected ?? "", childrenOf), [selected, childrenOf]);
  const highlighted = useMemo(() => {
    if (selected === null) return new Set<string>();
    return new Set<string>([selected, ...blast]);
  }, [selected, blast]);

  const hasSelection = selected !== null;
  const inHighlight = (id: string) => highlighted.has(id);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-hairline px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-semibold">R · Aim-tree</h1>
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning">
            prototype · throwaway
          </span>
          <span className="text-[11px] text-subtle-foreground">
            fixture data — no backend, not for merge
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Click a node to light up its <span className="text-foreground">blast radius</span> — the
          descendant subtree that would become drift-possible if that aim changed. The size of the
          highlight is the read: root = heavy, leaf = light.
        </p>
        <Legend selected={selected} blastCount={blast.size} onClear={() => setSelected(null)} />
      </header>

      <div className="flex-1 overflow-auto p-4">
        {/* Relative canvas: SVG edges underneath, clickable node boxes on
            top. A background click clears the selection. */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: dev-only canvas backdrop */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: dev-only canvas backdrop */}
        <div
          className="relative"
          style={{ width: layout.width, height: layout.height }}
          onClick={() => setSelected(null)}
        >
          <Edges layout={layout} highlighted={highlighted} hasSelection={hasSelection} />
          {FIXTURE.map((node) => {
            const pos = layout.positions.get(node.id);
            if (!pos) return null;
            const isSelected = selected === node.id;
            const lit = inHighlight(node.id);
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
  layout,
  highlighted,
  hasSelection,
}: {
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
      {FIXTURE.map((node) => {
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
      {FIXTURE.map((node) => {
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
  // Tier the styling: the selected node gets a solid primary ring; the
  // rest of its blast radius gets a softer primary tint; everything else
  // dims out when a selection is active so the highlighted region's size
  // reads at a glance.
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
