// Pure aim-forest model — the attention-economical projection the destination
// Aim panel (Stage B convergence, #791) renders. No React, no DOM, so the
// owed/frontier ranking, the per-repo rollups, the ledger counts, the
// overview-ruler order, and the ought-ancestry walk are unit-testable in
// isolation.
//
// The load-bearing thesis (approach `2026-06-09-aim-console-destination-
// convergence`): the panel does NOT render the whole tree. Default = the owed
// FRONTIER worklist; the full tree is a collapsed navigator + branch rollups +
// an overview ruler. So this module's center of gravity is "what is OWED" —
// `isOwed` / `frontierRows` / `ledgerCounts` — not 2D layout (the prototype's
// tidy-tree geometry retired with the canvas it served).
//
// Progress-driven (the formalised body model, `doc/aims/aim-body`): the owed
// signal comes from the body's `# PROCESS` section — each implementation unit
// carries a per-unit `[done]` / `[todo]` marker. `meansProgress` parses that
// (client-side, via `aim-body-parse`) into done/todo counts; the ledger, the
// Frontier worklist, the tones, and the rollups all derive owed-ness from
// `todo` (an unfinished unit is owed). This SUPERSEDES the retired `is[]`
// claimed/confirmed marks: the engine still ships `is[]` for any legacy node
// that still carries marks, but the new bodies express progress in PROCESS, so
// this module reads progress, not marks. We never re-judge — `[done]`/`[todo]`
// are facts the author wrote.

import type { AimState } from "@/types/generated/AimState";
import type { AimsResponse } from "@/types/generated/AimsResponse";
import type { AimWire } from "@/types/generated/AimWire";
import type { AimWorkingDeltaWire } from "@/types/generated/AimWorkingDeltaWire";
import type { RepoAimsWire } from "@/types/generated/RepoAimsWire";
import { parseAimBody, parseMeans } from "./aim-body-parse";

// ── Glyphs / labels ───────────────────────────────────────────────────
//
// Lifecycle glyph — SHAPE, paired with one calm hue at the call site, never a
// heat ramp (the machine marks, it never appraises — `AimState` doc). `done` =
// reached/confirmed (✓), `dead` = self-death (neutral struck circle, NOT a
// warning glyph — the lineage stays, the parent is untouched).
export const AIM_GLYPH: Record<AimState, string> = {
  open: "○",
  done: "✓",
  dead: "⊘",
};

export const AIM_STATE_LABEL: Record<AimState, string> = {
  open: "open",
  done: "done",
  dead: "dead",
};

// Flatten the per-repo wire response into a single cross-repo node set — used
// by the ledger and ruler, which span the whole forest. The per-repo grouping
// (Frontier sections / Tree navigator) keeps `RepoAimsWire` intact instead
// (`repoForests`); flattening is for the forest-wide aggregates only.
export function flattenRepos(res: AimsResponse | null): AimWire[] {
  if (res === null) return [];
  return res.repos.flatMap((r) => r.aims);
}

// The per-repo slices, untouched — the panel groups by these (un-flatten),
// highlighting the primary repo. `[]` for a null response.
export function repoForests(res: AimsResponse | null): RepoAimsWire[] {
  return res?.repos ?? [];
}

// ── Owed-status predicates (the attention economy) ────────────────────

// Drift fact: the node carries a stale-from-ancestor verdict from the wire
// (`drift !== null`) AND is not abandoned. A `dead` node is self-death — its
// lineage is kept but the means failed, so a stale ancestor anchor is noise,
// not owed work. A `done` node that drifted is NOT filtered here: that is the
// pin-#2 case (surface it, see `isDoneDrifted` / `aimTone`).
export function isDrifted(n: AimWire): boolean {
  return n.drift !== null && n.state !== "dead";
}

// A node's PROCESS progress — the per-unit done / todo counts parsed from its
// body's `# PROCESS` (means) section. Client-side parse (the body grammar is
// still settling, so it is not frozen into the wire); a node with no PROCESS
// section is {0, 0}. This is the owed-signal source that replaced `is[]`.
export interface MeansProgress {
  done: number;
  todo: number;
}

export function meansProgress(n: AimWire): MeansProgress {
  const section = parseAimBody(n.body).find((s) => s.kind === "means");
  if (section === undefined) return { done: 0, todo: 0 };
  const m = parseMeans(section.content);
  return { done: m.done, todo: m.todo };
}

// Has at least one unfinished (`[todo]`) PROCESS unit — an implementation step
// still owed. Progress-driven: we read the marker the author wrote.
export function hasTodo(n: AimWire): boolean {
  return meansProgress(n).todo > 0;
}

// Has at least one finished (`[done]`) PROCESS unit.
export function hasDone(n: AimWire): boolean {
  return meansProgress(n).done > 0;
}

// Owed = an OPEN node that drifted or carries a `[todo]` PROCESS unit — the
// Frontier worklist eligibility. `done` / `dead` are never "owed": a `done`
// node's drift is surfaced distinctly but NOT folded into the worklist (pin #2:
// "not folded into plain owed").
export function isOwed(n: AimWire): boolean {
  return n.state === "open" && (isDrifted(n) || hasTodo(n));
}

// Pin #2: a `done` node that is ALSO drifted — reached against an OLD ought,
// and an ancestor's anchor has since moved, so a re-confirm is owed. Surfaced
// distinctly (see `aimTone`), never suppressed, never treated as plain owed.
export function isDoneDrifted(n: AimWire): boolean {
  return n.state === "done" && n.drift !== null;
}

// The row's dominant tone — a single discriminated value the renderer maps to a
// glyph + hue. UNLIKE a naive priority cascade, a `done` node that also drifted
// resolves to `done-drift` (pin #2): a tone DISTINCT from plain `done` and from
// open `drift`, so done-and-drifted is surfaced rather than swallowed by the
// `done` check.
export type AimTone =
  | "done-drift" // pin #2 — reached, but an ancestor moved → re-confirm owed
  | "done"
  | "dead"
  | "drift" // open + drifted
  | "todo" // open + an unfinished PROCESS unit (owed)
  | "progress" // open + a finished PROCESS unit, none owed (calm)
  | "root"
  | "neutral";

export function aimTone(n: AimWire): AimTone {
  if (n.state === "dead") return "dead";
  if (n.state === "done") return n.drift !== null ? "done-drift" : "done";
  if (isDrifted(n)) return "drift";
  if (hasTodo(n)) return "todo";
  if (hasDone(n)) return "progress";
  if (n.parent === null) return "root";
  return "neutral";
}

// ── Working-tree presence facts (#817) ────────────────────────────────
//
// Design B of tmai-core's `doc/aims/drift-git.md` (the working-delta concept,
// ported from the archived `aim-drift-commit-boundary`): the
// committed layer (`drift`) states ORDER judgments; `working_delta` states
// PRESENCE only. The one fact it surfaces to the operator: "the drift verdict
// on screen is HEAD-based and does not see your uncommitted edit yet" —
// honesty-of-the-instrument, NOT owed work. So these helpers feed a SEPARATE
// glyph (△, never restyled as the drift ⚠) and an inspector fact line, and
// deliberately touch NOTHING else: not `isOwed`, not `ledgerCounts`, not
// `aimTone`, not the rollups.

export type WorkingDeltaKind = "untracked" | "uncommitted-anchor" | "uncommitted";

// One kind per node, the compose-prose precedence (tmai-core render.rs):
// `untracked` is mutually exclusive with `uncommitted` on the wire; an anchor
// change implies `uncommitted` and is the ratification-relevant presence (the
// anchor on screen is not the anchor in HEAD), so it outranks the plain edit.
// An all-false struct states no fact → null, same as a null wire.
export function workingDeltaKind(n: AimWire): WorkingDeltaKind | null {
  const wd: AimWorkingDeltaWire | null = n.working_delta;
  if (wd === null) return null;
  if (wd.untracked) return "untracked";
  if (wd.uncommitted_anchor_change) return "uncommitted-anchor";
  if (wd.uncommitted) return "uncommitted";
  return null;
}

export const WORKING_DELTA_GLYPH = "△";

// The inspector fact line / glyph title — same register as the compose prose
// (`**△ Aim working delta**`): presence facts only, no urgency verbs.
export const WORKING_DELTA_FACT: Record<WorkingDeltaKind, string> = {
  untracked: "a new, uncommitted node (no committed history yet)",
  "uncommitted-anchor":
    "uncommitted edits including the `aim:` anchor line — the drift verdict is HEAD-based and does not see this yet",
  uncommitted:
    "uncommitted edits (anchor line untouched) — the drift verdict is HEAD-based and does not see this yet",
};

// ── Tree skeleton ─────────────────────────────────────────────────────

// Children grouped by parent slug, preserving array (slug-sorted wire) order.
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
// is unknown in this set — so a dangling / cross-repo parent ref still renders
// rather than silently vanishing.
export function findRoots(nodes: readonly AimWire[]): AimWire[] {
  const bySlug = new Set(nodes.map((n) => n.slug));
  return nodes.filter((n) => n.parent === null || !bySlug.has(n.parent));
}

// Index nodes by slug — the lookup the ancestry walk + selection resolve
// against.
export function bySlugMap(nodes: readonly AimWire[]): Map<string, AimWire> {
  return new Map(nodes.map((n) => [n.slug, n] as const));
}

// Every descendant of `slug` through `parent` edges (NOT `depends_on` — the
// cross-edge is a shared-means link, deliberately out of the cascade set). The
// `seen` guard keeps the walk safe against a malformed `parent` cycle. Used to
// forbid an ancestor re-parenting onto its own subtree (cycle guard in edit).
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

// The ought-ancestry chain root→node (inclusive of `slug` at the tail), via
// `parent` links. The Inspector breadcrumb and the Frontier row crumb read
// this. `seen` guards a malformed parent cycle; an unknown parent ends the
// walk (the node renders as its own root).
export function ancestry(slug: string, bySlug: ReadonlyMap<string, AimWire>): AimWire[] {
  const chain: AimWire[] = [];
  const seen = new Set<string>();
  let cur: string | null = slug;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const n = bySlug.get(cur);
    if (!n) break;
    chain.unshift(n);
    cur = n.parent;
  }
  return chain;
}

// The breadcrumb text for a Frontier row = the ought-ancestry ABOVE the node
// (root → parent), each rendered by slug, joined with `›`. Empty string for a
// root (it has no ancestry to crumb).
export function breadcrumbText(slug: string, bySlug: ReadonlyMap<string, AimWire>): string {
  return ancestry(slug, bySlug)
    .slice(0, -1)
    .map((n) => n.slug)
    .join(" › ");
}

// ── Frontier worklist ─────────────────────────────────────────────────

// Rank for the owed worklist: drift before todo (the ancestor-moved verdict
// outranks an unfinished unit), then stable by slug.
function owedRank(n: AimWire): number {
  return isDrifted(n) ? 0 : 1;
}

// The owed worklist for a node set — drift-first, then todo, stable by slug.
// done+drift is NOT here (it is surfaced separately by `doneDriftedRows`).
export function frontierRows(nodes: readonly AimWire[]): AimWire[] {
  return nodes
    .filter(isOwed)
    .sort((a, b) => owedRank(a) - owedRank(b) || a.slug.localeCompare(b.slug));
}

// Pin #2 surfacing: the done-and-drifted nodes for a set, stable by slug.
// Listed in a distinct Frontier cluster (re-confirm owed) and rendered with the
// `done-drift` tone — surfaced, not suppressed, not folded into the worklist.
export function doneDriftedRows(nodes: readonly AimWire[]): AimWire[] {
  return nodes.filter(isDoneDrifted).sort((a, b) => a.slug.localeCompare(b.slug));
}

// ── Rollups + ledger ──────────────────────────────────────────────────

export interface RollupStats {
  /** Total descendant (or repo-member) count. */
  count: number;
  /** Of those, how many are drifted-and-owed (open + drifted). */
  drift: number;
  /** Of those, how many are todo-owed (open + an unfinished PROCESS unit, not
   *  drifted). NODE count, not unit count — mirrors the row glyph. */
  todo: number;
}

// Descendant rollup for a collapsed branch — total descendants + the owed
// breakdown, so a folded branch can show `⚠N ◌M` without expanding. drift and
// todo are disjoint (drift wins) to mirror the row glyph.
export function subtreeStats(slug: string, childrenOf: Map<string, AimWire[]>): RollupStats {
  let count = 0;
  let drift = 0;
  let todo = 0;
  const seen = new Set<string>();
  const stack = [...(childrenOf.get(slug) ?? [])];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n || seen.has(n.slug)) continue;
    seen.add(n.slug);
    count++;
    if (n.state === "open") {
      if (isDrifted(n)) drift++;
      else if (hasTodo(n)) todo++;
    }
    for (const c of childrenOf.get(n.slug) ?? []) stack.push(c);
  }
  return { count, drift, todo };
}

// Repo-wide rollup (every node in the repo) — drives the Tree repo-header
// badge and the Frontier repo-section badge.
export function repoStats(aims: readonly AimWire[]): RollupStats {
  let drift = 0;
  let todo = 0;
  for (const n of aims) {
    if (n.state !== "open") continue;
    if (isDrifted(n)) drift++;
    else if (hasTodo(n)) todo++;
  }
  return { count: aims.length, drift, todo };
}

export interface LedgerCounts {
  /** Drifted nodes across the forest (engine-honest: includes done+drift,
   *  excludes abandoned `dead` — see `isDrifted`). */
  drift: number;
  /** Total unfinished (`[todo]`) PROCESS units across the forest. */
  todo: number;
  /** Total finished (`[done]`) PROCESS units across the forest. */
  done: number;
}

// The ledger strip's three counts, from the forest's `drift` + body PROCESS.
// drift counts NODES (a node drifts); todo/done count UNITS (a node's PROCESS
// can carry several). Engine-honest per pin #2: a done-and-drifted node still
// counts as drift — it is surfaced, not suppressed.
export function ledgerCounts(nodes: readonly AimWire[]): LedgerCounts {
  let drift = 0;
  let todo = 0;
  let done = 0;
  for (const n of nodes) {
    if (n.drift !== null && n.state !== "dead") drift++;
    const p = meansProgress(n);
    todo += p.todo;
    done += p.done;
  }
  return { drift, todo, done };
}

// ── Overview ruler ────────────────────────────────────────────────────

export interface RulerTick {
  slug: string;
  repoLabel: string;
  /** `drift` / `todo` light the tick (owed); `null` is calm forest texture. */
  owed: "drift" | "todo" | null;
  /** Fractional position 0..1 down the whole-forest DFS order. */
  pos: number;
  /** True at the first tick of a repo after the first — a repo boundary line. */
  repoBoundary: boolean;
}

// The overview-ruler ticks: a repo-grouped DFS over every forest, each node a
// tick, owed ones (drift / todo) lit. The minimap proves "you are not looking
// at the whole tree" while keeping the whole forest's owed density in
// peripheral view; clicking a lit tick reveals the node in Tree mode.
export function rulerOrder(repos: readonly RepoAimsWire[]): RulerTick[] {
  const flat: { slug: string; repoLabel: string; owed: "drift" | "todo" | null }[] = [];
  for (const repo of repos) {
    const childrenOf = buildChildren(repo.aims);
    const bySlug = bySlugMap(repo.aims);
    const seen = new Set<string>();
    const visit = (slug: string): void => {
      if (seen.has(slug)) return;
      seen.add(slug);
      const n = bySlug.get(slug);
      if (!n) return;
      const owed: "drift" | "todo" | null = isDrifted(n) ? "drift" : isOwed(n) ? "todo" : null;
      flat.push({ slug, repoLabel: repo.repo_label, owed });
      for (const c of childrenOf.get(slug) ?? []) visit(c.slug);
    };
    for (const root of findRoots(repo.aims)) visit(root.slug);
  }

  const n = flat.length;
  let prevLabel: string | null = null;
  return flat.map((t, i) => {
    const repoBoundary = prevLabel !== null && t.repoLabel !== prevLabel;
    prevLabel = t.repoLabel;
    return {
      slug: t.slug,
      repoLabel: t.repoLabel,
      owed: t.owed,
      // Position by index over the count (clientHeight-independent), so the
      // ruler re-scales with the panel without re-measuring.
      pos: n <= 1 ? 0 : i / n,
      repoBoundary,
    };
  });
}
