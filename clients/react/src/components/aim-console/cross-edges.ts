// Cross-edge graph — the pure computation behind the per-node cross-edge
// inspector (aim node `aim-cross-edge-link`: `[todo] body link を抽出して DAG を
// 構成（computed 導出）` + `[todo] per-node cross-edge inspector（inbound/
// outbound）`).
//
// The aim's bearing (its IS): a tree-crossing dependency is expressed in the
// body prose as a `[[slug]]` link — in the BODY (the knowing side), NOT the
// frontmatter (pure bearing). So the DAG is not an authored structure; the
// machine EXTRACTS the links and DERIVES the graph (the resolver / close-act
// pattern). This module is that derivation, client-side — the same surface
// that already renders `[[slug]]` as an in-tree cross-ref (`AimBody`), read the
// other way to answer "what links here?".
//
// Operator-ratified invariants this module embodies (mirrors `resignation.ts`):
//   - ZERO new asserted fields — the edges are read out of `body`, already on
//     the wire. The frontmatter `depends_on` / `serves` / `related` arrays are
//     deliberately NOT used: the aim puts the edge in the body, and the live
//     corpus authors it there (a `# DAG` bullet), leaving those arrays empty.
//   - Facts, not appraisals — this lists adjacency; it never scores, ranks by
//     importance, or judges an edge. First-appearance / wire (slug-sorted)
//     order is preserved.
//   - Nothing vanishes — an outbound link to a slug absent from the loaded
//     forest (a dangling / cross-repo-unloaded target) is surfaced as an
//     unresolved edge, the same honesty `findRoots` gives a dangling parent.
//
// Scope note: `[todo] 抽出した辺を drift-git の wavefront へ供給` is the OTHER
// consumer of these edges and lives in core (drift propagation over the graph);
// this module only supplies the read-side inspector view of the same edges.

import type { AimWire } from "@/types/generated/AimWire";

// The body cross-edge syntax — a `[[slug]]` wikilink. The SAME shape `AimBody`
// renders as a cross-ref; kept as a separate regex instance on purpose (that
// one is a stateful `/g` used in `.replace`). Keep the two in sync — together
// they define what a body cross-edge IS.
const WIKILINK = /\[\[([^[\]]+)\]\]/g;

// The distinct `[[slug]]` cross-edge targets in an aim body, first-appearance
// order, deduped and trimmed. EVERY section counts: a `[[slug]]` in IS or
// HISTORY is as much a node→node reference as one under `# DAG`, and reading
// the whole body is what makes the inverse ("referenced by") complete.
export function extractBodyLinks(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(WIKILINK)) {
    const target = m[1].trim();
    if (target === "" || seen.has(target)) continue;
    seen.add(target);
    out.push(target);
  }
  return out;
}

// The forest-wide cross-edge adjacency, both directions keyed by slug:
//   - `outbound`: slug → the distinct slugs its body links to (body order).
//   - `inbound`:  slug → the distinct slugs whose body links to it (wire order).
// Forest-wide because a DAG edge crosses the tree AND the repo boundary; the
// caller passes the flattened forest (`flattenRepos`), not one repo. A node's
// self-link is dropped — a node is not its own cross-edge.
export interface CrossEdgeGraph {
  outbound: Map<string, string[]>;
  inbound: Map<string, string[]>;
}

export function buildCrossEdges(nodes: readonly AimWire[]): CrossEdgeGraph {
  const outbound = new Map<string, string[]>();
  const inbound = new Map<string, string[]>();
  for (const n of nodes) {
    const targets = extractBodyLinks(n.body).filter((t) => t !== n.slug);
    outbound.set(n.slug, targets);
    for (const t of targets) {
      const sources = inbound.get(t) ?? [];
      sources.push(n.slug);
      inbound.set(t, sources);
    }
  }
  return { outbound, inbound };
}

// A cross-edge decorated for render: the target slug + the node it resolves to
// (`null` when the slug names nothing in the loaded forest — a dangling edge,
// surfaced not hidden). `aim` is lifted for the row title without the caller
// re-deriving it.
export interface CrossEdge {
  slug: string;
  node: AimWire | null;
}

// Resolve a direction's slug list against the forest index — the trivial
// decorate step the inspector renders from. Order is preserved.
export function resolveEdges(
  slugs: readonly string[],
  bySlug: ReadonlyMap<string, AimWire>,
): CrossEdge[] {
  return slugs.map((slug) => ({ slug, node: bySlug.get(slug) ?? null }));
}
