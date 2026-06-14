// Pure aim-forest model — no React, no DOM. Covers the owed/frontier ranking,
// the per-repo + subtree rollups, the ledger counts, the ought-ancestry walk,
// the overview-ruler order, and the pin-#2 done+drift tone. The owed signal is
// the body's `# PROCESS` done/todo (not the retired `is[]` marks), so the
// fixtures author a PROCESS section via `procBody`.

import { describe, expect, it } from "vitest";
import type { AimsResponse } from "@/lib/api";
import type { AimDriftWire } from "@/types/generated/AimDriftWire";
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
  hasDone,
  hasTodo,
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

// A body with a `# PROCESS` section carrying `n` todo + `m` done units — the
// owed-signal source (`meansProgress`). An empty spec yields no body.
function procBody({ todo = 0, done = 0 }: { todo?: number; done?: number } = {}): string {
  const items = [
    ...Array.from({ length: todo }, (_, i) => `- [todo] todo unit ${i}`),
    ...Array.from({ length: done }, (_, i) => `- [done] done unit ${i}`),
  ];
  return items.length === 0 ? "" : `# PROCESS\n${items.join("\n")}`;
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

  it("hasTodo / hasDone read the body's PROCESS done/todo units", () => {
    const n = aim({ slug: "x", body: procBody({ done: 1, todo: 1 }) });
    expect(hasTodo(n)).toBe(true);
    expect(hasDone(n)).toBe(true);
    expect(hasTodo(aim({ slug: "y", body: procBody({ done: 1 }) }))).toBe(false);
    // No PROCESS section → neither.
    const p = aim({ slug: "z", body: "" });
    expect(hasTodo(p)).toBe(false);
    expect(hasDone(p)).toBe(false);
  });

  it("isOwed: an OPEN node that drifted or carries a todo unit", () => {
    expect(isOwed(aim({ slug: "d", drift: DRIFT }))).toBe(true);
    expect(isOwed(aim({ slug: "k", body: procBody({ todo: 1 }) }))).toBe(true);
    // A purely done open node is calm, not owed.
    expect(isOwed(aim({ slug: "c", body: procBody({ done: 1 }) }))).toBe(false);
    // A no-progress open node is calm.
    expect(isOwed(aim({ slug: "p", body: "" }))).toBe(false);
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
    expect(doneDrift).not.toBe("done");
    expect(doneDrift).not.toBe("drift");
  });

  it("plain done (no drift) is `done`; open+drift is `drift`", () => {
    expect(aimTone(aim({ slug: "x", state: "done" }))).toBe("done");
    expect(aimTone(aim({ slug: "x", drift: DRIFT }))).toBe("drift");
  });

  it("orders open tones drift › todo › progress › root › neutral", () => {
    expect(aimTone(aim({ slug: "x", drift: DRIFT, body: procBody({ todo: 1 }) }))).toBe("drift");
    expect(aimTone(aim({ slug: "x", body: procBody({ todo: 1, done: 1 }) }))).toBe("todo");
    expect(aimTone(aim({ slug: "x", body: procBody({ done: 1 }) }))).toBe("progress");
    expect(aimTone(aim({ slug: "x", parent: null }))).toBe("root");
    expect(aimTone(aim({ slug: "x", parent: "root-a" }))).toBe("neutral");
    // A no-progress non-root child reads neutral.
    expect(aimTone(aim({ slug: "x", parent: "root-a", body: "" }))).toBe("neutral");
  });

  it("dead always reads `dead`, even if the wire still carries drift", () => {
    expect(aimTone(aim({ slug: "x", state: "dead", drift: DRIFT }))).toBe("dead");
  });
});

describe("frontierRows — owed worklist, drift-first", () => {
  const set: AimWire[] = [
    aim({ slug: "calm", body: procBody({ done: 1 }) }), // not owed
    aim({ slug: "claim-b", body: procBody({ todo: 1 }) }),
    aim({ slug: "drift-z", drift: DRIFT }),
    aim({ slug: "claim-a", body: procBody({ todo: 1 }) }),
    aim({ slug: "drift-a", drift: DRIFT }),
    aim({ slug: "done-drift", state: "done", drift: DRIFT }), // pin #2 — excluded
  ];

  it("includes only owed nodes (drops calm + done+drift)", () => {
    const slugs = frontierRows(set).map((n) => n.slug);
    expect(slugs).not.toContain("calm");
    expect(slugs).not.toContain("done-drift");
  });

  it("ranks drift before todo, then stable by slug", () => {
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
    expect(ancestry("a", cyclic).length).toBeLessThanOrEqual(2);
  });
});

describe("rollups", () => {
  // root with two owed descendants (one drift, one todo) + one calm.
  const branch: AimWire[] = [
    aim({ slug: "root" }),
    aim({ slug: "d", parent: "root", drift: DRIFT }),
    aim({ slug: "k", parent: "root", body: procBody({ todo: 1 }) }),
    aim({ slug: "c", parent: "root", body: procBody({ done: 1 }) }),
    aim({ slug: "deep", parent: "d", drift: DRIFT }),
  ];

  it("subtreeStats counts descendants + the disjoint owed breakdown", () => {
    const childrenOf = buildChildren(branch);
    const st = subtreeStats("root", childrenOf);
    expect(st.count).toBe(4); // d, k, c, deep
    expect(st.drift).toBe(2); // d, deep
    expect(st.todo).toBe(1); // k
  });

  it("repoStats rolls the whole repo (drift wins over todo per node)", () => {
    const st = repoStats(branch);
    expect(st.count).toBe(5);
    expect(st.drift).toBe(2);
    expect(st.todo).toBe(1);
  });
});

describe("ledgerCounts — drift nodes + PROCESS done/todo units", () => {
  const forest: AimWire[] = [
    aim({ slug: "a", drift: DRIFT, body: procBody({ done: 1, todo: 1 }) }),
    aim({ slug: "b", body: procBody({ todo: 1 }) }),
    aim({ slug: "c", body: procBody({ done: 1 }) }),
    aim({ slug: "d", state: "done", drift: DRIFT, body: procBody({ done: 1 }) }), // pin #2: still drift
    aim({ slug: "e", state: "dead", drift: DRIFT }), // dead drift = noise, excluded
  ];

  it("counts drift nodes (incl. done+drift, excl. dead) and PROCESS units", () => {
    // drift = a, d (nodes). todo = a, b (units). done = a, c, d (units).
    expect(ledgerCounts(forest)).toEqual({ drift: 2, todo: 2, done: 3 });
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
    expect(workingDeltaKind(aim({ slug: "x", working_delta: wd() }))).toBeNull();
  });

  it("NEVER makes a node owed — isOwed / frontierRows are untouched by presence", () => {
    const dirty = aim({
      slug: "dirty",
      working_delta: wd({ uncommitted: true, uncommitted_anchor_change: true }),
    });
    expect(isOwed(dirty)).toBe(false);
    expect(frontierRows([dirty])).toEqual([]);
    const driftedDirty = aim({
      slug: "dd",
      drift: DRIFT,
      working_delta: wd({ uncommitted: true }),
    });
    expect(frontierRows([driftedDirty, dirty]).map((n) => n.slug)).toEqual(["dd"]);
  });

  it("NEVER counts into the ledger — drift/todo/done identical with and without presence", () => {
    const clean: AimWire[] = [
      aim({ slug: "a", drift: DRIFT, body: procBody({ done: 1, todo: 1 }) }),
      aim({ slug: "b", body: procBody({ todo: 1 }) }),
    ];
    const dirty: AimWire[] = [
      aim({
        slug: "a",
        drift: DRIFT,
        body: procBody({ done: 1, todo: 1 }),
        working_delta: wd({ uncommitted: true, uncommitted_anchor_change: true }),
      }),
      aim({ slug: "b", body: procBody({ todo: 1 }), working_delta: wd({ untracked: true }) }),
    ];
    expect(ledgerCounts(dirty)).toEqual(ledgerCounts(clean));
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
          aim({ slug: "r1b", parent: "r1", body: procBody({ todo: 1 }) }),
        ],
      },
      {
        repo_label: "ui",
        repo_root: "/p/ui",
        primary: false,
        repo_head: null,
        aims: [aim({ slug: "u1", body: procBody({ done: 1 }) })],
      },
    ],
  };

  it("emits one tick per node in repo-grouped DFS order", () => {
    expect(rulerOrder(res.repos).map((t) => t.slug)).toEqual(["r1", "r1a", "r1b", "u1"]);
  });

  it("lights owed ticks (drift / todo), leaves calm ticks null", () => {
    const ticks = rulerOrder(res.repos);
    expect(ticks.find((t) => t.slug === "r1a")?.owed).toBe("drift");
    expect(ticks.find((t) => t.slug === "r1b")?.owed).toBe("todo");
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
