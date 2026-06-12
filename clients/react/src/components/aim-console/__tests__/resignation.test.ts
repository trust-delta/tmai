// resignation.ts — the pure inventory computation behind the done-set view
// (issue #811). Covers: confirmed/claimed bucketing from the interior marks
// (mark-only — authored order kept), open-descendant collection across
// multi-level subtrees via parent edges (done/dead descendants NOT counted,
// open under a done intermediate still counted), a drifted open descendant
// carrying its wire drift through, and the constant frontier line.

import { describe, expect, it } from "vitest";
import type { AimDriftWire } from "@/types/generated/AimDriftWire";
import type { AimInteriorWire } from "@/types/generated/AimInteriorWire";
import type { AimWire } from "@/types/generated/AimWire";
import { RESIGNATION_FRONTIER, resignationInventory } from "../resignation";

const claimed = (text: string): AimInteriorWire => ({ kind: "claimed", text, ref: null });
const confirmed = (text: string, ref: string): AimInteriorWire => ({
  kind: "confirmed",
  text,
  ref,
});
const pruned = (text: string, ref: string | null = null): AimInteriorWire => ({
  kind: "pruned",
  text,
  ref,
});

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
    is: [],
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
    is: [
      claimed("unverified tail"),
      confirmed("core path", "PR#1"),
      claimed("second debt"),
      pruned("flag route", "wrong premise"),
    ],
  }),
  aimStub({ slug: "open-child", parent: "node", drift: driftFrom("node") }),
  aimStub({ slug: "open-grandchild", parent: "open-child" }),
  aimStub({ slug: "done-child", parent: "node", state: "done" }),
  aimStub({ slug: "open-under-done", parent: "done-child" }),
  aimStub({ slug: "dead-child", parent: "node", state: "dead" }),
  aimStub({ slug: "outside", is: [claimed("other tree")] }),
];

const byslug = (s: string): AimWire => {
  const n = FOREST.find((x) => x.slug === s);
  if (!n) throw new Error(`no fixture node ${s}`);
  return n;
};

describe("resignationInventory — interior-mark bucketing (mark-only)", () => {
  it("buckets confirmed → satisfied and claimed → parked, keeping authored order", () => {
    const inv = resignationInventory(byslug("node"), FOREST);
    expect(inv.satisfied.map((m) => m.text)).toEqual(["core path"]);
    expect(inv.satisfied[0].ref).toBe("PR#1");
    // The two claimed marks keep the order the author wrote them in.
    expect(inv.parkedClaims.map((m) => m.text)).toEqual(["unverified tail", "second debt"]);
  });

  it("a pruned mark lands in NEITHER bucket — adjudicated ≠ satisfied ≠ parked (#814)", () => {
    const inv = resignationInventory(byslug("node"), FOREST);
    expect(inv.satisfied.map((m) => m.text)).not.toContain("flag route");
    expect(inv.parkedClaims.map((m) => m.text)).not.toContain("flag route");
  });

  it("a markless node yields empty buckets (the inventory is still renderable)", () => {
    const inv = resignationInventory(byslug("done-child"), FOREST);
    expect(inv.satisfied).toEqual([]);
    expect(inv.parkedClaims).toEqual([]);
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
