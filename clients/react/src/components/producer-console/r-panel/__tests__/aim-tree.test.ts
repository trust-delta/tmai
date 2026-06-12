// Pure aim-forest model — no React, no DOM. Covers the owed/frontier ranking,
// the per-repo + subtree rollups, the ledger counts, the ought-ancestry walk,
// the overview-ruler order, and the pin-#2 done+drift tone. (The retired
// tidy-tree geometry's tests retired with the canvas it served — Stage B's
// panel is row-based, not a 2D canvas.)

import { describe, expect, it } from "vitest";
import type { AimsResponse } from "@/lib/api";
import type { AimDriftWire } from "@/types/generated/AimDriftWire";
import type { AimInteriorWire } from "@/types/generated/AimInteriorWire";
import type { AimWire } from "@/types/generated/AimWire";
import type { AimWorkingDeltaWire } from "@/types/generated/AimWorkingDeltaWire";
import {
  aimTone,
  ancestry,
  breadcrumbText,
  buildChildren,
  bySlugMap,
  descendantsOf,
  doneDriftedRows,
  findRoots,
  flattenRepos,
  frontierRows,
  hasClaimed,
  hasConfirmed,
  isDoneDrifted,
  isDrifted,
  isOwed,
  ledgerCounts,
  repoForests,
  repoStats,
  rulerOrder,
  subtreeStats,
  workingDeltaKind,
} from "../aim-tree";

const DRIFT: AimDriftWire = {
  stale_from_ancestor_slug: "amplify-human-judgment",
  ancestor_change_sha: "abc1234",
  ancestor_change_date: "2026-06-01",
  aim_change_date: "2026-05-01",
};

function claimed(text = "owed"): AimInteriorWire {
  return { kind: "claimed", text, ref: null };
}
function confirmed(text = "done", ref: string | null = "PR#1"): AimInteriorWire {
  return { kind: "confirmed", text, ref };
}
function pruned(text = "rejected", ref: string | null = "wrong premise"): AimInteriorWire {
  return { kind: "pruned", text, ref };
}
function wd(overrides: Partial<AimWorkingDeltaWire> = {}): AimWorkingDeltaWire {
  return { uncommitted: false, uncommitted_anchor_change: false, untracked: false, ...overrides };
}

function aim(overrides: Partial<AimWire> & Pick<AimWire, "slug">): AimWire {
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
    is: [],
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
    expect(childrenOf.get("grand-1")).toBeUndefined();
    expect(childrenOf.get("root-b")).toBeUndefined();
  });

  it("does not turn a depends_on edge into a parent edge", () => {
    const childrenOf = buildChildren(NODES);
    // child-2 depends_on child-1, but only `parent` builds the tree.
    expect(childrenOf.get("child-1")?.map((n) => n.slug)).toEqual(["grand-1"]);
  });
});

describe("findRoots", () => {
  it("returns explicit roots (parent === null)", () => {
    expect(findRoots(NODES).map((r) => r.slug)).toEqual(["root-a", "root-b"]);
  });

  it("treats an orphan with a missing parent as a root (renders, never vanishes)", () => {
    const orphan = aim({ slug: "lonely", parent: "ghost" });
    expect(findRoots([aim({ slug: "root-a" }), orphan]).map((r) => r.slug)).toContain("lonely");
  });
});

describe("descendantsOf (the re-parent cycle guard)", () => {
  it("returns the whole descendant subtree through parent edges", () => {
    const childrenOf = buildChildren(NODES);
    expect(descendantsOf("root-a", childrenOf)).toEqual(new Set(["child-1", "grand-1", "child-2"]));
  });

  it("does NOT follow depends_on cross-edges", () => {
    const childrenOf = buildChildren(NODES);
    expect(descendantsOf("child-2", childrenOf)).toEqual(new Set());
  });
});

describe("owed-status predicates", () => {
  it("isDrifted: true when the wire carries drift and the node is not dead", () => {
    expect(isDrifted(aim({ slug: "x", drift: DRIFT }))).toBe(true);
    expect(isDrifted(aim({ slug: "x" }))).toBe(false);
    // A dead node's drift is noise (lineage abandoned).
    expect(isDrifted(aim({ slug: "x", drift: DRIFT, state: "dead" }))).toBe(false);
    // A done node's drift still counts as drift (pin #2 surfacing).
    expect(isDrifted(aim({ slug: "x", drift: DRIFT, state: "done" }))).toBe(true);
  });

  it("hasClaimed / hasConfirmed read the author's mark kind (mark-only)", () => {
    const n = aim({ slug: "x", is: [confirmed(), claimed()] });
    expect(hasClaimed(n)).toBe(true);
    expect(hasConfirmed(n)).toBe(true);
    expect(hasClaimed(aim({ slug: "y", is: [confirmed()] }))).toBe(false);
    // pruned (#814) is neither: an adjudicated rejection trips no predicate.
    const p = aim({ slug: "z", is: [pruned()] });
    expect(hasClaimed(p)).toBe(false);
    expect(hasConfirmed(p)).toBe(false);
  });

  it("isOwed: an OPEN node that drifted or carries a claimed mark", () => {
    expect(isOwed(aim({ slug: "d", drift: DRIFT }))).toBe(true);
    expect(isOwed(aim({ slug: "k", is: [claimed()] }))).toBe(true);
    // A purely confirmed open node is calm, not owed.
    expect(isOwed(aim({ slug: "c", is: [confirmed()] }))).toBe(false);
    // A purely pruned open node is negative-calm — NEVER owed (#814).
    expect(isOwed(aim({ slug: "p", is: [pruned()] }))).toBe(false);
    // done / dead are never owed, even when drifted.
    expect(isOwed(aim({ slug: "dn", drift: DRIFT, state: "done" }))).toBe(false);
    expect(isOwed(aim({ slug: "dd", drift: DRIFT, state: "dead" }))).toBe(false);
  });

  it("isDoneDrifted: only a done node whose wire carries drift (pin #2)", () => {
    expect(isDoneDrifted(aim({ slug: "x", state: "done", drift: DRIFT }))).toBe(true);
    expect(isDoneDrifted(aim({ slug: "x", state: "open", drift: DRIFT }))).toBe(false);
    expect(isDoneDrifted(aim({ slug: "x", state: "done" }))).toBe(false);
  });
});

describe("aimTone — pin #2: done+drift is distinct, not suppressed", () => {
  it("resolves done+drift to its OWN tone, distinct from done and from drift", () => {
    const doneDrift = aimTone(aim({ slug: "x", state: "done", drift: DRIFT }));
    expect(doneDrift).toBe("done-drift");
    // Distinct from the two tones it must never collapse into.
    expect(doneDrift).not.toBe("done");
    expect(doneDrift).not.toBe("drift");
  });

  it("plain done (no drift) is `done`; open+drift is `drift`", () => {
    expect(aimTone(aim({ slug: "x", state: "done" }))).toBe("done");
    expect(aimTone(aim({ slug: "x", drift: DRIFT }))).toBe("drift");
  });

  it("orders open tones drift › claimed › confirmed › root › neutral", () => {
    expect(aimTone(aim({ slug: "x", drift: DRIFT, is: [claimed()] }))).toBe("drift");
    expect(aimTone(aim({ slug: "x", is: [claimed(), confirmed()] }))).toBe("claimed");
    expect(aimTone(aim({ slug: "x", is: [confirmed()] }))).toBe("confirmed");
    expect(aimTone(aim({ slug: "x", parent: null }))).toBe("root");
    expect(aimTone(aim({ slug: "x", parent: "root-a" }))).toBe("neutral");
    // pruned (#814) contributes NO tone of its own — a pruned-only child reads
    // neutral, exactly as if unmarked.
    expect(aimTone(aim({ slug: "x", parent: "root-a", is: [pruned()] }))).toBe("neutral");
  });

  it("dead always reads `dead`, even if the wire still carries drift", () => {
    expect(aimTone(aim({ slug: "x", state: "dead", drift: DRIFT }))).toBe("dead");
  });
});

describe("frontierRows — owed worklist, drift-first", () => {
  const set: AimWire[] = [
    aim({ slug: "calm", is: [confirmed()] }), // not owed
    aim({ slug: "claim-b", is: [claimed()] }),
    aim({ slug: "drift-z", drift: DRIFT }),
    aim({ slug: "claim-a", is: [claimed()] }),
    aim({ slug: "drift-a", drift: DRIFT }),
    aim({ slug: "done-drift", state: "done", drift: DRIFT }), // pin #2 — excluded
  ];

  it("includes only owed nodes (drops calm + done+drift)", () => {
    const slugs = frontierRows(set).map((n) => n.slug);
    expect(slugs).not.toContain("calm");
    expect(slugs).not.toContain("done-drift");
  });

  it("ranks drift before claimed, then stable by slug", () => {
    expect(frontierRows(set).map((n) => n.slug)).toEqual([
      "drift-a",
      "drift-z",
      "claim-a",
      "claim-b",
    ]);
  });

  it("doneDriftedRows surfaces the pin-#2 nodes separately", () => {
    expect(doneDriftedRows(set).map((n) => n.slug)).toEqual(["done-drift"]);
  });
});

describe("ancestry + breadcrumb", () => {
  const bySlug = bySlugMap(NODES);

  it("walks parent links root→node inclusive", () => {
    expect(ancestry("grand-1", bySlug).map((n) => n.slug)).toEqual([
      "root-a",
      "child-1",
      "grand-1",
    ]);
  });

  it("breadcrumb is the ancestry ABOVE the node (empty for a root)", () => {
    expect(breadcrumbText("grand-1", bySlug)).toBe("root-a › child-1");
    expect(breadcrumbText("root-a", bySlug)).toBe("");
  });

  it("does not hang on a malformed parent cycle", () => {
    const cyclic = bySlugMap([aim({ slug: "a", parent: "b" }), aim({ slug: "b", parent: "a" })]);
    // Terminates; the exact chain is unimportant, the guard is.
    expect(ancestry("a", cyclic).length).toBeLessThanOrEqual(2);
  });
});

describe("rollups", () => {
  // root with two owed descendants (one drift, one claimed) + one calm.
  const branch: AimWire[] = [
    aim({ slug: "root" }),
    aim({ slug: "d", parent: "root", drift: DRIFT }),
    aim({ slug: "k", parent: "root", is: [claimed()] }),
    aim({ slug: "c", parent: "root", is: [confirmed()] }),
    aim({ slug: "deep", parent: "d", drift: DRIFT }),
  ];

  it("subtreeStats counts descendants + the disjoint owed breakdown", () => {
    const childrenOf = buildChildren(branch);
    const st = subtreeStats("root", childrenOf);
    expect(st.count).toBe(4); // d, k, c, deep
    expect(st.drift).toBe(2); // d, deep
    expect(st.claimed).toBe(1); // k
  });

  it("repoStats rolls the whole repo (drift wins over claimed per node)", () => {
    const st = repoStats(branch);
    expect(st.count).toBe(5);
    expect(st.drift).toBe(2);
    expect(st.claimed).toBe(1);
  });
});

describe("ledgerCounts — straight off drift + is[]", () => {
  const forest: AimWire[] = [
    aim({ slug: "a", drift: DRIFT, is: [confirmed(), claimed()] }),
    aim({ slug: "b", is: [claimed(), pruned()] }), // pruned rides along, uncounted (#814)
    aim({ slug: "c", is: [confirmed()] }),
    aim({ slug: "d", state: "done", drift: DRIFT, is: [confirmed()] }), // pin #2: still drift
    aim({ slug: "e", state: "dead", drift: DRIFT }), // dead drift = noise, excluded
  ];

  it("counts drift nodes (incl. done+drift, excl. dead) and is[] marks", () => {
    // pruned marks are in NO bucket — not claimed, not confirmed, not owed.
    expect(ledgerCounts(forest)).toEqual({ drift: 2, claimed: 2, confirmed: 3 });
  });
});

describe("workingDeltaKind — presence facts, compose precedence (#817)", () => {
  it("maps each wire shape to its kind (untracked › anchor › plain)", () => {
    expect(workingDeltaKind(aim({ slug: "x" }))).toBeNull();
    expect(workingDeltaKind(aim({ slug: "x", working_delta: wd({ uncommitted: true }) }))).toBe(
      "uncommitted",
    );
    expect(
      workingDeltaKind(
        aim({
          slug: "x",
          working_delta: wd({ uncommitted: true, uncommitted_anchor_change: true }),
        }),
      ),
    ).toBe("uncommitted-anchor");
    expect(workingDeltaKind(aim({ slug: "x", working_delta: wd({ untracked: true }) }))).toBe(
      "untracked",
    );
    // An all-false struct states no fact — same as a null wire.
    expect(workingDeltaKind(aim({ slug: "x", working_delta: wd() }))).toBeNull();
  });

  it("NEVER makes a node owed — isOwed / frontierRows are untouched by presence", () => {
    const dirty = aim({
      slug: "dirty",
      working_delta: wd({ uncommitted: true, uncommitted_anchor_change: true }),
    });
    expect(isOwed(dirty)).toBe(false);
    expect(frontierRows([dirty])).toEqual([]);
    // Presence beside a real owed fact changes nothing about the worklist.
    const driftedDirty = aim({
      slug: "dd",
      drift: DRIFT,
      working_delta: wd({ uncommitted: true }),
    });
    expect(frontierRows([driftedDirty, dirty]).map((n) => n.slug)).toEqual(["dd"]);
  });

  it("NEVER counts into the ledger — drift/claimed/confirmed identical with and without presence", () => {
    const clean: AimWire[] = [
      aim({ slug: "a", drift: DRIFT, is: [confirmed(), claimed()] }),
      aim({ slug: "b", is: [claimed()] }),
    ];
    const dirty: AimWire[] = [
      aim({
        slug: "a",
        drift: DRIFT,
        is: [confirmed(), claimed()],
        working_delta: wd({ uncommitted: true, uncommitted_anchor_change: true }),
      }),
      aim({ slug: "b", is: [claimed()], working_delta: wd({ untracked: true }) }),
    ];
    expect(ledgerCounts(dirty)).toEqual(ledgerCounts(clean));
    // The repo/subtree rollups are presence-blind too.
    expect(repoStats(dirty)).toEqual(repoStats(clean));
  });

  it("NEVER changes the tone — presence facts ride beside the tone, not into it", () => {
    const presence = wd({ uncommitted: true, uncommitted_anchor_change: true });
    expect(aimTone(aim({ slug: "x", parent: "root-a", working_delta: presence }))).toBe("neutral");
    expect(aimTone(aim({ slug: "x", drift: DRIFT, working_delta: presence }))).toBe("drift");
    expect(aimTone(aim({ slug: "x", state: "done", working_delta: presence }))).toBe("done");
    expect(aimTone(aim({ slug: "x", state: "done", drift: DRIFT, working_delta: presence }))).toBe(
      "done-drift",
    );
    expect(aimTone(aim({ slug: "x", working_delta: wd({ untracked: true }) }))).toBe("root");
  });
});

describe("rulerOrder — repo-grouped DFS minimap", () => {
  const res: AimsResponse = {
    unit: "u",
    composed_at: "2026-06-07T00:00:00Z",
    repos: [
      {
        repo_label: "core",
        repo_root: "/p/core",
        primary: true,
        repo_head: null,
        aims: [
          aim({ slug: "r1" }),
          aim({ slug: "r1a", parent: "r1", drift: DRIFT }),
          aim({ slug: "r1b", parent: "r1", is: [claimed()] }),
        ],
      },
      {
        repo_label: "ui",
        repo_root: "/p/ui",
        primary: false,
        repo_head: null,
        aims: [aim({ slug: "u1", is: [confirmed()] })],
      },
    ],
  };

  it("emits one tick per node in repo-grouped DFS order", () => {
    expect(rulerOrder(res.repos).map((t) => t.slug)).toEqual(["r1", "r1a", "r1b", "u1"]);
  });

  it("lights owed ticks (drift / claimed), leaves calm ticks null", () => {
    const ticks = rulerOrder(res.repos);
    expect(ticks.find((t) => t.slug === "r1a")?.owed).toBe("drift");
    expect(ticks.find((t) => t.slug === "r1b")?.owed).toBe("claimed");
    expect(ticks.find((t) => t.slug === "u1")?.owed).toBeNull();
  });

  it("marks the first tick of a new repo as a boundary", () => {
    const ticks = rulerOrder(res.repos);
    expect(ticks.find((t) => t.slug === "r1")?.repoBoundary).toBe(false);
    expect(ticks.find((t) => t.slug === "u1")?.repoBoundary).toBe(true);
  });
});

describe("flattenRepos / repoForests", () => {
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

  it("flattenRepos concatenates aims across repos; [] for null", () => {
    expect(flattenRepos(res).map((n) => n.slug)).toEqual(["a", "b", "c"]);
    expect(flattenRepos(null)).toEqual([]);
  });

  it("repoForests keeps the per-repo grouping intact; [] for null", () => {
    expect(repoForests(res).map((r) => r.repo_label)).toEqual(["core", "ui"]);
    expect(repoForests(null)).toEqual([]);
  });
});
