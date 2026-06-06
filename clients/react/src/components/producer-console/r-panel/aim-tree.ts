// Pure aim-tree layout + traversal — the view machinery validated in the
// throwaway prototype #778 (`RAimTreePrototype`), graduated and rewired onto
// the LIVE wire model (`AimWire`: `slug` / `aim` / `parent` / `state` /
// `depends_on` / `serves` / `related` / `body`). Kept framework-free so the
// tidy-tree layout, blast-radius traversal, and edge-path geometry are
// unit-testable without rendering React.
//
// Wire-vs-prototype rewire (the real work of #780): the prototype was a
// hardcoded fixture with its OWN model (`id` / `label` / `means-done` /
// `dependsOn` single). This module follows the wire: identity is `slug`, the
// anchor is `aim`, the state enum is `open | done | dead` (no `means-done`;
// `dead` exists), and `depends_on` is an ARRAY of slugs.

import type { AimState } from "@/types/generated/AimState";
import type { AimsResponse } from "@/types/generated/AimsResponse";
import type { AimWire } from "@/types/generated/AimWire";

// ── Layout constants ──────────────────────────────────────────────────
//
// Tuned smaller than the prototype's full-screen values (it had COL_W 232 /
// NODE_W 200) so a shallow tree fits the NARROW R-panel section without
// scrolling; a deep/wide tree overflows into the canvas's `overflow-auto`.
export const COL_W = 196; // horizontal distance per depth level
export const ROW_H = 48; // vertical slot per leaf row
export const NODE_W = 168; // fixed node-box width (labels wrap within)
const PAD_L = 16;
const PAD_T = 16;
const PAD_R = 28;
const PAD_B = 16;
const GAP_BETWEEN_TREES = 1; // blank leaf-slots inserted between roots

// Per-node state glyph — SHAPE ONLY, one neutral hue, no heat / severity
// color (the machine marks, it never appraises — `AimState` doc + brief).
// `dead` is the wire's third state (self-death: the means failed, the lineage
// stays, the parent is untouched); it gets a neutral struck circle, NOT a
// warning glyph. The prototype's `◐` (`means-done`) is dropped — it was a
// fixture invention, absent from the wire.
export const AIM_GLYPH: Record<AimState, string> = {
  open: "○",
  done: "●",
  dead: "⊘",
};

export const AIM_STATE_LABEL: Record<AimState, string> = {
  open: "open",
  done: "done",
  dead: "dead",
};

// Flatten the per-repo wire response into a single node set. Aims currently
// live only in the `tmai-core` repo (one repo), but the wire is already
// multi-repo (`RepoAimsWire[]`); concatenating keeps it correct if a second
// repo ever carries aims. Slugs are unique within a repo and the corpus is
// single-repo today, so no cross-repo slug-collision handling is needed yet.
export function flattenRepos(res: AimsResponse | null): AimWire[] {
  if (res === null) return [];
  return res.repos.flatMap((r) => r.aims);
}

export interface NodePos {
  slug: string;
  /** Left edge x of the node box. */
  x: number;
  /** Vertical CENTER of the node (edges anchor here; the box itself is
   *  centered on this y via a translateY(-50%), so multi-line labels grow
   *  symmetrically and never shift the edge anchor). */
  cy: number;
  depth: number;
}

export interface AimLayout {
  positions: Map<string, NodePos>;
  roots: AimWire[];
  width: number;
  height: number;
}

// Index helper — children grouped by parent slug, preserving array order.
export function buildChildren(nodes: readonly AimWire[]): Map<string, AimWire[]> {
  const childrenOf = new Map<string, AimWire[]>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    const list = childrenOf.get(n.parent) ?? [];
    list.push(n);
    childrenOf.set(n.parent, list);
  }
  return childrenOf;
}

// Classic tidy tree: leaves get sequential vertical slots; an internal node
// is centered on the midpoint of its first and last child. Roots are stacked
// top-to-bottom (a blank gap-slot between them).
export function computeLayout(nodes: readonly AimWire[]): AimLayout {
  const childrenOf = buildChildren(nodes);
  const bySlug = new Set(nodes.map((n) => n.slug));
  const positions = new Map<string, NodePos>();
  let leafCursor = 0;
  let maxDepth = 0;

  function assign(slug: string, depth: number): number {
    maxDepth = Math.max(maxDepth, depth);
    const children = childrenOf.get(slug) ?? [];
    let cy: number;
    if (children.length === 0) {
      cy = PAD_T + leafCursor * ROW_H + ROW_H / 2;
      leafCursor += 1;
    } else {
      const childCenters = children.map((c) => assign(c.slug, depth + 1));
      cy = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }
    positions.set(slug, { slug, x: PAD_L + depth * COL_W, cy, depth });
    return cy;
  }

  // Roots = explicit roots (`parent === null`) PLUS orphans whose `parent`
  // slug isn't a known node — so a dangling parent ref (a half-written /
  // cross-repo reference) still renders rather than silently vanishing from
  // the canvas.
  const roots = nodes.filter((n) => n.parent === null || !bySlug.has(n.parent));
  roots.forEach((root, i) => {
    if (i > 0) leafCursor += GAP_BETWEEN_TREES;
    assign(root.slug, 0);
  });

  return {
    positions,
    roots,
    width: PAD_L + maxDepth * COL_W + NODE_W + PAD_R,
    height: PAD_T + leafCursor * ROW_H + PAD_B,
  };
}

// The blast radius: every descendant of `slug` reachable through `parent`
// edges (NOT through `depends_on` — the cross-edge is a shared-means link,
// drawn distinct, deliberately kept OUT of the descendant set a change would
// cascade down). The `seen` guard makes the walk safe even against a
// malformed `parent` cycle (the corpus is acyclic by construction, but a
// read-only projection should never hang on bad data).
export function descendantsOf(slug: string, childrenOf: Map<string, AimWire[]>): Set<string> {
  const out = new Set<string>();
  const stack = [...(childrenOf.get(slug) ?? [])];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) continue;
    if (out.has(n.slug)) continue;
    out.add(n.slug);
    for (const c of childrenOf.get(n.slug) ?? []) stack.push(c);
  }
  return out;
}

// Smooth horizontal connector from a parent's right edge to a child's left
// edge (S-curve via a cubic with control points at the x-midpoint).
export function parentEdgePath(parent: NodePos, child: NodePos): string {
  const x1 = parent.x + NODE_W;
  const y1 = parent.cy;
  const x2 = child.x;
  const y2 = child.cy;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

// A `depends_on` cross-edge bows out to the RIGHT of both endpoints (where
// the node's right side is whitespace), so the dashed cross-edge never reads
// as one of the leftward solid parent connectors.
export function dependsEdgePath(src: NodePos, tgt: NodePos): string {
  const x1 = src.x + NODE_W;
  const y1 = src.cy;
  const x2 = tgt.x + NODE_W;
  const y2 = tgt.cy;
  const bow = Math.max(x1, x2) + 48;
  return `M ${x1} ${y1} C ${bow} ${y1}, ${bow} ${y2}, ${x2} ${y2}`;
}
