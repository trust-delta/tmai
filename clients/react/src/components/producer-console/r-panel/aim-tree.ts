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
// Generous full-window values — the aim-tree now lives in a maximized overlay
// (#782), not the narrow R-panel column, so labels get the room the prototype
// (#778) validated (COL_W 232 / NODE_W 200) and then some. COL_W stays wider
// than NODE_W so adjacent depth columns never overlap horizontally; that is
// what lets the no-overlap invariant reduce to a per-depth-column vertical
// check (only same-depth boxes share an x-range).
export const COL_W = 248; // horizontal distance per depth level
export const NODE_W = 216; // fixed node-box width (labels wrap within)
const PAD_L = 24;
const PAD_T = 24;
const PAD_R = 40;
const PAD_B = 24;
const ROOT_GAP = 28; // vertical gap inserted between root subtrees
const NODE_GAP = 16; // vertical breathing room between adjacent boxes

// ── Node-height estimation ────────────────────────────────────────────
//
// THE overlap fix (#782): a node's box height is NOT fixed — real `aim:`
// anchors are long sentences (up to ~132 chars) that wrap to many lines inside
// the fixed-width box. A fixed ROW_H let tall boxes overlap their neighbours.
// `computeLayout` instead lays nodes out with a CUMULATIVE vertical advance
// proportional to each box's estimated rendered height (`nodeHeight`).
//
// We can't DOM-measure in a pure function, so estimate the wrapped line count
// from label length against a CONSERVATIVE chars-per-line. The corpus is mostly
// Japanese / full-width, whose glyphs are ~1em wide (≈ the font size), so we
// assume one full-width glyph per `LABEL_FONT_PX` of inner width. That UPPER-
// bounds the line count for any Latin-or-mixed label too (Latin glyphs are
// narrower → fewer wrapped lines than estimated), so a box is never under-
// allocated and the no-overlap invariant holds regardless of script.
const LABEL_FONT_PX = 12; // text-xs label glyph advance (full-width ≈ 1em)
const LABEL_LINE_H = 18; // text-xs × leading-snug (~1.375), rounded up
const NODE_PAD_X = 16; // px-2 → 8px each side
const GLYPH_COL = 22; // state glyph + gap-1.5 gutter left of the label
const NODE_CHROME_V = 28; // py-1.5 (12) + slug line (~14) + label/slug gap (~2)
const MIN_NODE_H = 46; // floor so a 1-line box still reads comfortably

// Estimated rendered height (px) of a node box for a given `aim` label. Pure
// and deterministic — the layout's whole no-overlap guarantee rides on it.
export function nodeHeight(label: string): number {
  const textW = Math.max(LABEL_FONT_PX, NODE_W - NODE_PAD_X - GLYPH_COL);
  const charsPerLine = Math.max(1, Math.floor(textW / LABEL_FONT_PX));
  const lines = Math.max(1, Math.ceil(label.length / charsPerLine));
  return Math.max(MIN_NODE_H, NODE_CHROME_V + lines * LABEL_LINE_H);
}

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
  /** Estimated rendered box height (`nodeHeight`). The box's vertical extent
   *  is `[cy - height/2, cy + height/2]`; the layout spaces siblings so these
   *  ranges never overlap within a depth column. */
  height: number;
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

// Roots = explicit roots (`parent === null`) PLUS orphans whose `parent` slug
// isn't a known node — so a dangling parent ref (a half-written / cross-repo
// reference) still renders rather than silently vanishing from the canvas.
// Shared by `computeLayout` and the R-panel thin-entry root count.
export function findRoots(nodes: readonly AimWire[]): AimWire[] {
  const bySlug = new Set(nodes.map((n) => n.slug));
  return nodes.filter((n) => n.parent === null || !bySlug.has(n.parent));
}

// Variable-height tidy tree (the #782 overlap fix). Each node reserves vertical
// room proportional to its estimated box height (`nodeHeight`) instead of a
// fixed ROW_H, so long-label boxes never overlap their neighbours.
//
// The walk lays each subtree into a contiguous, non-overlapping vertical band:
//   - a LEAF occupies exactly its own box height;
//   - an INTERNAL node lays its children out sequentially (each child's band +
//     a gap), centres itself on the midpoint of its first/last child as the
//     classic tidy tree does, then — if its OWN (possibly tall) box would stick
//     out above the band — shifts the whole subtree down so the parent's top
//     aligns with the band's top. The subtree's reported bottom is the max of
//     the children's bottom and the parent box's bottom.
// Because each subtree owns a disjoint vertical band and adjacent depth columns
// are >NODE_W apart horizontally, no two boxes that share a depth column can
// overlap, regardless of label length.
export function computeLayout(nodes: readonly AimWire[]): AimLayout {
  const childrenOf = buildChildren(nodes);
  const bySlug = new Map(nodes.map((n) => [n.slug, n] as const));
  const positions = new Map<string, NodePos>();
  let maxDepth = 0;

  // Translate a whole subtree's `cy` by `delta` (used for the parent-overhang
  // correction). `seen` guards against a malformed `parent` cycle.
  function shiftSubtree(slug: string, delta: number, seen: Set<string>): void {
    if (seen.has(slug)) return;
    seen.add(slug);
    const p = positions.get(slug);
    if (p) p.cy += delta;
    for (const c of childrenOf.get(slug) ?? []) shiftSubtree(c.slug, delta, seen);
  }

  // Lay `slug`'s subtree starting at vertical `top`; set positions and return
  // the subtree's center y and the next free y below it.
  function layout(slug: string, depth: number, top: number): { cy: number; bottom: number } {
    maxDepth = Math.max(maxDepth, depth);
    const node = bySlug.get(slug);
    const h = nodeHeight(node?.aim ?? slug);
    const x = PAD_L + depth * COL_W;
    const children = childrenOf.get(slug) ?? [];

    if (children.length === 0) {
      const cy = top + h / 2;
      positions.set(slug, { slug, x, cy, height: h, depth });
      return { cy, bottom: top + h };
    }

    let cursor = top;
    let firstCy = 0;
    let lastCy = 0;
    children.forEach((c, i) => {
      if (i > 0) cursor += NODE_GAP;
      const r = layout(c.slug, depth + 1, cursor);
      if (i === 0) firstCy = r.cy;
      lastCy = r.cy;
      cursor = r.bottom;
    });
    let childrenBottom = cursor;
    let cy = (firstCy + lastCy) / 2;
    positions.set(slug, { slug, x, cy, height: h, depth });

    // Parent-overhang correction: if this box (centred on its children) would
    // stick out above the band top, push the whole subtree down so nothing
    // crosses into the previous sibling's band.
    const overhang = top - (cy - h / 2);
    if (overhang > 0) {
      shiftSubtree(slug, overhang, new Set<string>());
      cy += overhang;
      childrenBottom += overhang;
    }
    // The band extends to whichever is lower: the last child or this box.
    return { cy, bottom: Math.max(childrenBottom, cy + h / 2) };
  }

  const roots = findRoots(nodes);
  let cursor = PAD_T;
  roots.forEach((root, i) => {
    if (i > 0) cursor += ROOT_GAP;
    const r = layout(root.slug, 0, cursor);
    cursor = r.bottom;
  });

  return {
    positions,
    roots,
    width: PAD_L + maxDepth * COL_W + NODE_W + PAD_R,
    height: cursor + PAD_B,
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
