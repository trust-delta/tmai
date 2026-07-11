// Cross-edge graph — pure model, no React, no DOM. Covers the body `[[slug]]`
// extraction (dedup, order, whole-body, self-drop), the forest-wide inbound /
// outbound adjacency, and the dangling-target honesty. Fixtures author a body
// with cross-links via `linkBody`.

import { describe, expect, it } from "vitest";
import type { AimWire } from "@/types/generated/AimWire";
import { bySlugMap } from "../aim-tree";
import { buildCrossEdges, extractBodyLinks, resolveEdges } from "../cross-edges";

function aim(overrides: Partial<AimWire> & Pick<AimWire, "slug">): AimWire {
  return {
    aim: `aim ${overrides.slug}`,
    parent: null,
    state: "open",
    body: "",
    drift: null,
    working_delta: null,
    ...overrides,
  };
}

// A body that links to each of `slugs` — spread across sections (IS + DAG) so
// the whole-body extraction (not DAG-only) is exercised.
function linkBody(slugs: string[]): string {
  const [first, ...rest] = slugs;
  const is = first ? `# IS\nleans on [[${first}]] here.\n` : "";
  const dag =
    rest.length > 0 ? `# DAG\n${rest.map((s) => `- 依存: [[${s}]] — 説明`).join("\n")}` : "";
  return `${is}${dag}`;
}

describe("extractBodyLinks", () => {
  it("pulls distinct `[[slug]]` targets in first-appearance order", () => {
    const body = "# IS\nsee [[a]] then [[b]].\n# DAG\n- 依存: [[c]] — x";
    expect(extractBodyLinks(body)).toEqual(["a", "b", "c"]);
  });

  it("dedupes a slug that appears more than once", () => {
    const body = "[[a]] and again [[a]] and [[b]]";
    expect(extractBodyLinks(body)).toEqual(["a", "b"]);
  });

  it("trims whitespace inside the brackets", () => {
    expect(extractBodyLinks("[[ spaced-slug ]]")).toEqual(["spaced-slug"]);
  });

  it("returns [] for a body with no links (empty or pure prose)", () => {
    expect(extractBodyLinks("")).toEqual([]);
    expect(extractBodyLinks("# IS\njust prose, no links.")).toEqual([]);
  });
});

// A small forest:
//   a  — body links to b, c
//   b  — body links to c
//   c  — no links
//   d  — body links to a and to `ghost` (a dangling / cross-repo target)
const NODES: AimWire[] = [
  aim({ slug: "a", body: linkBody(["b", "c"]) }),
  aim({ slug: "b", body: linkBody(["c"]) }),
  aim({ slug: "c" }),
  aim({ slug: "d", body: linkBody(["a", "ghost"]) }),
];

describe("buildCrossEdges", () => {
  const { outbound, inbound } = buildCrossEdges(NODES);

  it("maps each node to the distinct slugs its body links to", () => {
    expect(outbound.get("a")).toEqual(["b", "c"]);
    expect(outbound.get("b")).toEqual(["c"]);
    expect(outbound.get("c")).toEqual([]);
    expect(outbound.get("d")).toEqual(["a", "ghost"]);
  });

  it("inverts to inbound — who links to each node, in wire order", () => {
    expect(inbound.get("c")).toEqual(["a", "b"]);
    expect(inbound.get("a")).toEqual(["d"]);
    expect(inbound.get("b")).toEqual(["a"]);
  });

  it("has no inbound entry for a node nothing links to", () => {
    expect(inbound.get("d")).toBeUndefined();
  });

  it("records a dangling outbound target on inbound too (surfaced, not dropped)", () => {
    // `ghost` names no node in the forest, but the edge is real and inverted.
    expect(inbound.get("ghost")).toEqual(["d"]);
  });

  it("drops a self-link (a node is not its own cross-edge)", () => {
    const g = buildCrossEdges([aim({ slug: "selfy", body: "refs [[selfy]] and [[a]]" })]);
    expect(g.outbound.get("selfy")).toEqual(["a"]);
    expect(g.inbound.get("selfy")).toBeUndefined();
  });
});

describe("resolveEdges", () => {
  const bySlug = bySlugMap(NODES);

  it("resolves known slugs to their node", () => {
    const edges = resolveEdges(["b", "c"], bySlug);
    expect(edges.map((e) => e.slug)).toEqual(["b", "c"]);
    expect(edges.every((e) => e.node !== null)).toBe(true);
  });

  it("leaves an unknown slug's node null (dangling), preserving order", () => {
    const edges = resolveEdges(["ghost", "a"], bySlug);
    expect(edges[0]).toEqual({ slug: "ghost", node: null });
    expect(edges[1]?.node?.slug).toBe("a");
  });
});
