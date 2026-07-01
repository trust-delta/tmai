// Resignation inventory — the pure computation behind the done-set view
// (issue #811; aim node `aim-resolution-outcome` — the console resignation
//  inventory ported from the archived `aim-resignation-inventory`, tmai-core #528).
//
// done = the human's 満足と諦め status; the weight is on 諦め — accepting the
// uninspected remainder WITHOUT knowing it. tmai does NOT mechanize done; it
// mechanizes making the OBJECTS of resignation visible: at done-set, the
// boundary between what is satisfied and what is being parked must be a
// visible object, not darkness.
//
// Operator-ratified invariants this module embodies:
//   - ZERO new asserted fields — everything here is computed client-side from
//     data already on the wire: the node's PROCESS (手段) checklist parsed out
//     of `body`, plus the `state` + `parent` edges of its descendants. If a
//     computation seems to need a new field or endpoint, the computation is
//     wrong, not the wire.
//   - Facts, not appraisals — this module buckets and lists; it never scores,
//     ranks by severity, or judges. The PROCESS items keep their authored
//     status (done / todo) AND order.
//   - The enumerable buckets end at a CONSTANT frontier line: the unwritten
//     remainder is not enumerable; the inventory shows the boundary, the dark
//     stays dark but the BOUNDARY is visible.

import type { AimWire } from "@/types/generated/AimWire";
import { type MeansItem, parseAimBody, parseMeans } from "./aim-body-parse";
import { buildChildren, bySlugMap, descendantsOf } from "./aim-tree";

// The quiet frontier line — constant and unconditional: it renders verbatim
// whether the enumerable buckets are full or empty, because the unwritten
// remainder exists either way.
export const RESIGNATION_FRONTIER = "この先は書かれていない残余 — 諦めはそこにも届く";

export interface ResignationInventory {
  /** 満足 — the node's own `[done]` (実装済) PROCESS items, authored order. */
  satisfied: MeansItem[];
  /** 諦め (a) — the node's own `[todo]` (未実装) PROCESS items (the means it
   *  has named but not yet reached), authored order. done parks that debt, it
   *  does not settle it. */
  parkedTodos: MeansItem[];
  /** 諦め (b) — descendants still `open` (subtree via `parent` edges, ANY
   *  depth, including under a done/dead intermediate). done/dead descendants
   *  are NOT here — they are settled or abandoned, not parked. A drifted open
   *  descendant keeps its wire `drift` (the renderer badges it with the
   *  existing convention). Slug-sorted for a stable listing. */
  parkedOpenDescendants: AimWire[];
}

// Collect the node's PROCESS (手段) items from its body — the progress-bearing
// checklist. Items without a status marker (plain bullets) carry no done/todo
// judgment, so they land in NEITHER bucket, intentionally: an unmarked item is
// not 満足 (nothing was reached) and not a named-but-unreached 諦め (no
// status was authored).
function meansItems(node: AimWire): MeansItem[] {
  return parseAimBody(node.body)
    .filter((s) => s.kind === "means")
    .flatMap((s) => parseMeans(s.content).items);
}

// Compute the inventory for `node` against its repo's loaded node set.
export function resignationInventory(
  node: AimWire,
  nodes: readonly AimWire[],
): ResignationInventory {
  const childrenOf = buildChildren(nodes);
  const bySlug = bySlugMap(nodes);
  const parkedOpenDescendants = [...descendantsOf(node.slug, childrenOf)]
    .map((slug) => bySlug.get(slug))
    .filter((n): n is AimWire => n !== undefined && n.state === "open")
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const items = meansItems(node);
  return {
    satisfied: items.filter((m) => m.status === "done"),
    parkedTodos: items.filter((m) => m.status === "todo"),
    parkedOpenDescendants,
  };
}
