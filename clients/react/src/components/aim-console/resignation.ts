// Resignation inventory — the pure computation behind the done-set view
// (issue #811; aim node `aim-resignation-inventory`, parent `aim-recoil-loop`).
//
// done = the human's 満足と諦め status; the weight is on 諦め — accepting the
// uninspected remainder WITHOUT knowing it. tmai does NOT mechanize done; it
// mechanizes making the OBJECTS of resignation visible: at done-set, the
// boundary between what is satisfied and what is being parked must be a
// visible object, not darkness.
//
// Operator-ratified invariants this module embodies:
//   - ZERO new asserted fields — everything here is computed client-side from
//     data already on the wire (`state`, the `is[]` interior-mark projection,
//     the `parent` edges). If a computation seems to need a new field or
//     endpoint, the computation is wrong, not the wire.
//   - Facts, not appraisals — this module buckets and lists; it never scores,
//     ranks by severity, or judges. Mark-only (pin #1): the interior marks
//     keep their authored kind AND order.
//   - The enumerable buckets end at a CONSTANT frontier line: the unwritten
//     remainder is not enumerable; the inventory shows the boundary, the dark
//     stays dark but the BOUNDARY is visible.

import {
  buildChildren,
  bySlugMap,
  descendantsOf,
} from "@/components/producer-console/r-panel/aim-tree";
import type { AimInteriorWire } from "@/types/generated/AimInteriorWire";
import type { AimWire } from "@/types/generated/AimWire";

// The quiet frontier line — constant and unconditional: it renders verbatim
// whether the enumerable buckets are full or empty, because the unwritten
// remainder exists either way.
export const RESIGNATION_FRONTIER = "この先は書かれていない残余 — 諦めはそこにも届く";

export interface ResignationInventory {
  /** 満足 — the node's own `confirmed` interior marks (text + ref), authored order. */
  satisfied: AimInteriorWire[];
  /** 諦め (a) — the node's own `claimed` marks (unverified; an operator confirm
   *  is owed), authored order. done parks that debt, it does not settle it. */
  parkedClaims: AimInteriorWire[];
  /** 諦め (b) — descendants still `open` (subtree via `parent` edges, ANY
   *  depth, including under a done/dead intermediate). done/dead descendants
   *  are NOT here — they are settled or abandoned, not parked. A drifted open
   *  descendant keeps its wire `drift` (the renderer badges it with the
   *  existing convention). Slug-sorted for a stable listing. */
  parkedOpenDescendants: AimWire[];
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
  // `pruned` marks land in NEITHER bucket, intentionally: an adjudicated
  // rejection is not 満足 (nothing was confirmed) and not 諦め (nothing is
  // parked — the judgment is settled, no confirm is owed). adjudicated ≠
  // satisfied ≠ parked.
  return {
    satisfied: node.is.filter((m) => m.kind === "confirmed"),
    parkedClaims: node.is.filter((m) => m.kind === "claimed"),
    parkedOpenDescendants,
  };
}
