// resignation.ts — the pure inventory computation behind the done-set view
// (issue #811). Covers: 実装済/未実装 bucketing from the node's PROCESS (手段)
// checklist parsed out of the body (authored order kept; unmarked items drop),
// open-descendant collection across multi-level subtrees via parent edges
// (done/dead descendants NOT counted, open under a done intermediate still
// counted), a drifted open descendant carrying its wire drift through, and the
// constant frontier line.

import { describe, expect, it } from "vitest";
import type { AimDriftWire } from "@/types/generated/AimDriftWire";
import type { AimWire } from "@/types/generated/AimWire";
import { RESIGNATION_FRONTIER, resignationInventory } from "../resignation";

// A 手段 (means/PROCESS) body section with the given checklist lines.
const means = (...lines: string[]): string => `# 手段\n\n${lines.join("\n")}\n`;

function driftFrom(slug: string): AimDriftWire {
  return {
    stale_from_ancestor_slug: slug,
    ancestor_change_sha: "abc1234",
    ancestor_change_date: "2026-06-01",
    aim_change_date: "2026-05-01",
  };
}

function aimStub(overrides: Partial<AimWire> & Pick<AimWire, "slug">): AimWire {
  return {
    aim: `aim ${overrides.slug}`,
    parent: null,
    state: "open",
    depends_on: [],
    serves: [],
    related: [],
    body: "",
    drift: null,
    working_delta: null,
    ...overrides,
  };
}

// node (the done candidate)
//   open-child (open, drifted)
//     open-grandchild (open)        ← multi-level: still collected
//   done-child (done)               ← settled, NOT parked
//     open-under-done (open)        ← open under a done intermediate: parked
//   dead-child (dead)               ← abandoned, NOT parked
const FOREST: AimWire[] = [
  aimStub({
    slug: "node",
    body: means(
      "- [実装済] core path",
      "- [未実装] unverified tail",
      "- [未実装] second debt",
      "- flag route", // unmarked → neither bucket
    ),
  }),
  aimStub({ slug: "open-child", parent: "node", drift: driftFrom("node") }),
  aimStub({ slug: "open-grandchild", parent: "open-child" }),
  aimStub({ slug: "done-child", parent: "node", state: "done" }),
  aimStub({ slug: "open-under-done", parent: "done-child" }),
  aimStub({ slug: "dead-child", parent: "node", state: "dead" }),
  aimStub({ slug: "outside", body: means("- [未実装] other tree") }),
];

const byslug = (s: string): AimWire => {
  const n = FOREST.find((x) => x.slug === s);
  if (!n) throw new Error(`no fixture node ${s}`);
  return n;
};

describe("resignationInventory — PROCESS done/todo bucketing", () => {
  it("buckets [実装済] → satisfied and [未実装] → parkedTodos, keeping authored order", () => {
    const inv = resignationInventory(byslug("node"), FOREST);
    expect(inv.satisfied.map((m) => m.text)).toEqual(["core path"]);
    expect(inv.satisfied[0].status).toBe("done");
    // The two todo items keep the order the author wrote them in.
    expect(inv.parkedTodos.map((m) => m.text)).toEqual(["unverified tail", "second debt"]);
  });

  it("an unmarked PROCESS item lands in NEITHER bucket — no status, no judgment", () => {
    const inv = resignationInventory(byslug("node"), FOREST);
    expect(inv.satisfied.map((m) => m.text)).not.toContain("flag route");
    expect(inv.parkedTodos.map((m) => m.text)).not.toContain("flag route");
  });

  it("a node with no 手段 section yields empty buckets (the inventory is still renderable)", () => {
    const inv = resignationInventory(byslug("done-child"), FOREST);
    expect(inv.satisfied).toEqual([]);
    expect(inv.parkedTodos).toEqual([]);
  });
});

describe("resignationInventory — open-descendant collection (parent edges)", () => {
  it("collects open descendants at any depth; done/dead descendants are not parked", () => {
    const inv = resignationInventory(byslug("node"), FOREST);
    expect(inv.parkedOpenDescendants.map((n) => n.slug)).toEqual([
      "open-child",
      "open-grandchild",
      "open-under-done",
    ]);
  });

  it("does not collect nodes outside the subtree", () => {
    const inv = resignationInventory(byslug("node"), FOREST);
    expect(inv.parkedOpenDescendants.map((n) => n.slug)).not.toContain("outside");
    expect(inv.parkedOpenDescendants.map((n) => n.slug)).not.toContain("node");
  });

  it("a drifted open descendant carries its wire drift through, untouched", () => {
    const inv = resignationInventory(byslug("node"), FOREST);
    const drifted = inv.parkedOpenDescendants.find((n) => n.slug === "open-child");
    expect(drifted?.drift?.stale_from_ancestor_slug).toBe("node");
    // The non-drifted ones stay non-drifted — no client-side cascade.
    const calm = inv.parkedOpenDescendants.find((n) => n.slug === "open-grandchild");
    expect(calm?.drift).toBeNull();
  });

  it("a leaf yields no parked descendants", () => {
    const inv = resignationInventory(byslug("open-grandchild"), FOREST);
    expect(inv.parkedOpenDescendants).toEqual([]);
  });
});

describe("RESIGNATION_FRONTIER", () => {
  it("is the constant quiet frontier line", () => {
    expect(RESIGNATION_FRONTIER).toBe("この先は書かれていない残余 — 諦めはそこにも届く");
  });
});
