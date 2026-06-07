// Pure aim-tree layout + traversal — no React, no DOM. Covers the tree-build
// (parent/slug grouping + tidy layout) and the blast-radius walk graduated
// from prototype #778 and rewired onto the live `AimWire` model.

import { describe, expect, it } from "vitest";
import type { AimsResponse } from "@/lib/api";
import type { AimWire } from "@/types/generated/AimWire";
import {
  buildChildren,
  computeLayout,
  dependsEdgePath,
  descendantsOf,
  findRoots,
  flattenRepos,
  NODE_W,
  nodeHeight,
  parentEdgePath,
} from "../aim-tree";

function aim(overrides: Partial<AimWire> & Pick<AimWire, "slug">): AimWire {
  return {
    aim: `aim ${overrides.slug}`,
    parent: null,
    state: "open",
    depends_on: [],
    serves: [],
    related: [],
    body: "",
    ...overrides,
  };
}

// A two-root tree:
//   root-a
//     child-1
//       grand-1
//     child-2  (depends_on: [child-1])
//   root-b
const NODES: AimWire[] = [
  aim({ slug: "root-a" }),
  aim({ slug: "child-1", parent: "root-a" }),
  aim({ slug: "grand-1", parent: "child-1" }),
  aim({ slug: "child-2", parent: "root-a", depends_on: ["child-1"] }),
  aim({ slug: "root-b" }),
];

describe("buildChildren", () => {
  it("groups nodes by parent slug, preserving array order", () => {
    const childrenOf = buildChildren(NODES);
    expect(childrenOf.get("root-a")?.map((n) => n.slug)).toEqual(["child-1", "child-2"]);
    expect(childrenOf.get("child-1")?.map((n) => n.slug)).toEqual(["grand-1"]);
    // Leaves and roots have no children entry.
    expect(childrenOf.get("grand-1")).toBeUndefined();
    expect(childrenOf.get("root-b")).toBeUndefined();
  });

  it("does not turn a depends_on edge into a parent edge", () => {
    const childrenOf = buildChildren(NODES);
    // child-2 depends_on child-1, but that must NOT make child-2 a child of
    // child-1 — only `parent` builds the tree.
    expect(childrenOf.get("child-1")?.map((n) => n.slug)).toEqual(["grand-1"]);
  });
});

describe("computeLayout", () => {
  it("identifies the explicit roots (parent === null)", () => {
    const layout = computeLayout(NODES);
    expect(layout.roots.map((r) => r.slug)).toEqual(["root-a", "root-b"]);
  });

  it("positions every node and assigns depth by tree level", () => {
    const layout = computeLayout(NODES);
    for (const n of NODES) {
      expect(layout.positions.has(n.slug)).toBe(true);
    }
    expect(layout.positions.get("root-a")?.depth).toBe(0);
    expect(layout.positions.get("child-1")?.depth).toBe(1);
    expect(layout.positions.get("grand-1")?.depth).toBe(2);
    expect(layout.positions.get("child-2")?.depth).toBe(1);
    expect(layout.positions.get("root-b")?.depth).toBe(0);
  });

  it("centers an internal node between its first and last child", () => {
    const layout = computeLayout(NODES);
    const rootA = layout.positions.get("root-a");
    const child1 = layout.positions.get("child-1");
    const child2 = layout.positions.get("child-2");
    expect(rootA && child1 && child2).toBeTruthy();
    if (rootA && child1 && child2) {
      expect(rootA.cy).toBeCloseTo((child1.cy + child2.cy) / 2);
    }
  });

  it("sizes the canvas to the deepest column", () => {
    const layout = computeLayout(NODES);
    // maxDepth is 2 (grand-1); width includes one node width past the last col.
    expect(layout.width).toBeGreaterThan(NODE_W);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("treats an orphan with a missing parent as a root (renders, never vanishes)", () => {
    const orphan = aim({ slug: "lonely", parent: "does-not-exist" });
    const layout = computeLayout([aim({ slug: "root-a" }), orphan]);
    expect(layout.roots.map((r) => r.slug)).toContain("lonely");
    expect(layout.positions.has("lonely")).toBe(true);
    expect(layout.positions.get("lonely")?.depth).toBe(0);
  });

  it("returns empty roots/positions for an empty node set", () => {
    const layout = computeLayout([]);
    expect(layout.roots).toEqual([]);
    expect(layout.positions.size).toBe(0);
  });

  it("gives every node a positive estimated height", () => {
    const layout = computeLayout(NODES);
    for (const n of NODES) {
      expect((layout.positions.get(n.slug)?.height ?? 0) > 0).toBe(true);
    }
  });
});

describe("findRoots", () => {
  it("returns explicit roots (parent === null)", () => {
    expect(findRoots(NODES).map((r) => r.slug)).toEqual(["root-a", "root-b"]);
  });

  it("treats an orphan with a missing parent as a root", () => {
    const orphan = aim({ slug: "lonely", parent: "ghost" });
    expect(findRoots([aim({ slug: "root-a" }), orphan]).map((r) => r.slug)).toContain("lonely");
  });
});

describe("nodeHeight (the variable-height estimate)", () => {
  it("is taller for a longer label (more wrapped lines)", () => {
    const short = nodeHeight("短い");
    const long = nodeHeight("あ".repeat(130));
    expect(long).toBeGreaterThan(short);
  });

  it("floors a 1-line label at a comfortable minimum", () => {
    // A short label must still get a readable box, not collapse to one line of
    // text height.
    expect(nodeHeight("x")).toBeGreaterThanOrEqual(40);
  });
});

// THE #782 overlap fix. Adjacent depth columns are >NODE_W apart horizontally
// (COL_W > NODE_W), so two boxes can only share screen space when they share a
// depth. Assert that within every depth column, the `[cy ± height/2]` vertical
// ranges never overlap — for any node set, including long-label and tall-
// internal-node fixtures that broke the old fixed-ROW_H layout.
function assertNoColumnOverlap(layout: ReturnType<typeof computeLayout>) {
  const byDepth = new Map<number, { cy: number; height: number; slug: string }[]>();
  for (const pos of layout.positions.values()) {
    const list = byDepth.get(pos.depth) ?? [];
    list.push(pos);
    byDepth.set(pos.depth, list);
  }
  for (const list of byDepth.values()) {
    const sorted = [...list].sort((a, b) => a.cy - b.cy);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const prevBottom = prev.cy + prev.height / 2;
      const curTop = cur.cy - cur.height / 2;
      // curTop must sit at or below prevBottom — no vertical overlap.
      expect(curTop).toBeGreaterThanOrEqual(prevBottom);
    }
  }
}

describe("computeLayout — variable-height no-overlap invariant (#782)", () => {
  it("never overlaps nodes in a depth column for the canonical tree", () => {
    assertNoColumnOverlap(computeLayout(NODES));
  });

  it("never overlaps leaf siblings even with a 130+ char label", () => {
    const longLabel = "あ".repeat(135); // 135 full-width chars — wraps to many lines
    expect(longLabel.length).toBeGreaterThanOrEqual(130);
    const set: AimWire[] = [
      aim({ slug: "root" }),
      aim({ slug: "leaf-long", parent: "root", aim: longLabel }),
      aim({ slug: "leaf-short", parent: "root", aim: "x" }),
      aim({ slug: "leaf-mid", parent: "root", aim: "あ".repeat(40) }),
      aim({ slug: "leaf-long2", parent: "root", aim: "drift-possible ".repeat(9) }),
    ];
    assertNoColumnOverlap(computeLayout(set));
  });

  it("keeps a tall internal node (long label, one short child) clear of its sibling", () => {
    // The overhang case: an internal node whose OWN box is taller than its
    // single child's span must not bleed into the adjacent depth-1 sibling.
    const set: AimWire[] = [
      aim({ slug: "root" }),
      aim({ slug: "tall-internal", parent: "root", aim: "あ".repeat(135) }),
      aim({ slug: "tiny-child", parent: "tall-internal", aim: "x" }),
      aim({ slug: "sibling-leaf", parent: "root", aim: "あ".repeat(50) }),
    ];
    assertNoColumnOverlap(computeLayout(set));
  });
});

describe("descendantsOf (blast radius)", () => {
  it("returns the whole descendant subtree through parent edges", () => {
    const childrenOf = buildChildren(NODES);
    expect(descendantsOf("root-a", childrenOf)).toEqual(new Set(["child-1", "grand-1", "child-2"]));
  });

  it("does NOT include the other root's subtree", () => {
    const childrenOf = buildChildren(NODES);
    expect(descendantsOf("root-a", childrenOf).has("root-b")).toBe(false);
  });

  it("is empty for a leaf", () => {
    const childrenOf = buildChildren(NODES);
    expect(descendantsOf("grand-1", childrenOf)).toEqual(new Set());
  });

  it("does NOT follow depends_on cross-edges", () => {
    const childrenOf = buildChildren(NODES);
    // child-2 depends_on child-1; the blast radius of child-2 is its
    // descendant subtree only (empty), NOT child-1.
    expect(descendantsOf("child-2", childrenOf)).toEqual(new Set());
  });
});

describe("flattenRepos", () => {
  it("returns [] for a null response", () => {
    expect(flattenRepos(null)).toEqual([]);
  });

  it("concatenates aims across repos", () => {
    const res: AimsResponse = {
      unit: "u",
      composed_at: "2026-06-07T00:00:00Z",
      repos: [
        {
          repo_label: "core",
          repo_root: "/p/core",
          primary: true,
          repo_head: null,
          aims: [aim({ slug: "a" }), aim({ slug: "b" })],
        },
        {
          repo_label: "ui",
          repo_root: "/p/ui",
          primary: false,
          repo_head: null,
          aims: [aim({ slug: "c" })],
        },
      ],
    };
    expect(flattenRepos(res).map((n) => n.slug)).toEqual(["a", "b", "c"]);
  });
});

describe("edge-path geometry", () => {
  it("parentEdgePath starts at the parent's right edge and ends at the child's left edge", () => {
    const layout = computeLayout(NODES);
    const parent = layout.positions.get("root-a");
    const child = layout.positions.get("child-1");
    expect(parent && child).toBeTruthy();
    if (parent && child) {
      const d = parentEdgePath(parent, child);
      expect(d.startsWith(`M ${parent.x + NODE_W} ${parent.cy}`)).toBe(true);
      expect(d).toContain(`${child.x} ${child.cy}`);
    }
  });

  it("dependsEdgePath bows out to the right of both endpoints", () => {
    const layout = computeLayout(NODES);
    const src = layout.positions.get("child-2");
    const tgt = layout.positions.get("child-1");
    expect(src && tgt).toBeTruthy();
    if (src && tgt) {
      const d = dependsEdgePath(src, tgt);
      // Both anchors are on the right edge (x + NODE_W).
      expect(d.startsWith(`M ${src.x + NODE_W} ${src.cy}`)).toBe(true);
      expect(d).toContain(`${tgt.x + NODE_W} ${tgt.cy}`);
    }
  });
});
