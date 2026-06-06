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
  flattenRepos,
  NODE_W,
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
