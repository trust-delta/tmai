// ◎ Aims — R panel's aim-tree read view (graduation Stage 1-B, #780). The
// read-view validated in throwaway prototype #778 (`RAimTreePrototype`),
// graduated into a real R-panel section backed by the live
// `GET /api/units/{unit}/aims` endpoint (tmai-core #500).
//
// ONE job, READ-ONLY. No write affordance (frontmatter edit / new node —
// Stage 2), no drift-mark (Stage 3). The prototype's `CreateForm` /
// `patchNode` / `commitCreate` / in-memory mutation are deliberately NOT
// carried.
//
// The view machinery carried intact from the prototype: the tidy-tree layout,
// the blast-radius highlight (select a node → light its whole descendant
// subtree, the set that would become drift-possible if that aim changed),
// `depends_on` drawn as a visually distinct dashed cross-edge (NOT part of any
// blast radius), the per-node state glyph, and the body-on-select detail pane.
// The pure layout / traversal lives in `./aim-tree` (unit-tested separately);
// this file is the React rendering, adapted from the prototype's full-screen
// 2-pane layout to STACK (canvas above, detail below) so it fits the narrow
// R-panel section column.
//
// `body` is rendered as raw markdown, read-only: line breaks preserved,
// monospace so inline refs / markers stay legible. There is intentionally no
// `[confirmed]` / `[claimed]` honesty-tag parser — those markers are free-form
// prose in the wire body, not a structured field (the prototype's `BodyLine`
// was a fixture invention).

import { useMemo, useState } from "react";
import { useUnitAims } from "@/hooks/useUnitAims";
import type { AimWire } from "@/lib/api";
import {
  AIM_GLYPH,
  AIM_STATE_LABEL,
  type AimLayout,
  buildChildren,
  computeLayout,
  dependsEdgePath,
  descendantsOf,
  flattenRepos,
  NODE_W,
  type NodePos,
  parentEdgePath,
} from "./aim-tree";
import { Section } from "./Section";

interface RAimsSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RAimsSection({ unitName, expanded, onToggle }: RAimsSectionProps) {
  const { data, loading, error } = useUnitAims(unitName);
  // Flattened node set drives both the header count and the tree body.
  const nodes = useMemo(() => flattenRepos(data), [data]);

  return (
    <Section
      id="aims"
      glyph="◎"
      label="Aims"
      count={`${nodes.length}`}
      expanded={expanded}
      onToggle={onToggle}
    >
      <Body unitName={unitName} nodes={nodes} loading={loading} error={error} />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  nodes: AimWire[];
  loading: boolean;
  error: Error | null;
}

function Body({ unitName, nodes, loading, error }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see aims.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load aims: {error.message}</p>;
  }
  if (nodes.length === 0 && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  if (nodes.length === 0) {
    return <p className="text-subtle-foreground">No aims.</p>;
  }
  return <AimTree nodes={nodes} />;
}

function AimTree({ nodes }: { nodes: AimWire[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const childrenOf = useMemo(() => buildChildren(nodes), [nodes]);
  const layout = useMemo(() => computeLayout(nodes), [nodes]);

  // Resolve the selection against the CURRENT node set: if a poll / unit
  // change dropped the selected slug, the detail pane and highlight fall back
  // to "nothing selected" rather than dangling on a vanished node.
  const selectedNode = useMemo(
    () => nodes.find((n) => n.slug === selected) ?? null,
    [nodes, selected],
  );

  // Highlight set = the selected node plus its whole descendant subtree.
  const blast = useMemo(
    () =>
      selectedNode === null ? new Set<string>() : descendantsOf(selectedNode.slug, childrenOf),
    [selectedNode, childrenOf],
  );
  const highlighted = useMemo(() => {
    if (selectedNode === null) return new Set<string>();
    return new Set<string>([selectedNode.slug, ...blast]);
  }, [selectedNode, blast]);
  const hasSelection = selectedNode !== null;

  return (
    <div className="space-y-2">
      <Legend
        selectedSlug={selectedNode?.slug ?? null}
        blastCount={blast.size}
        onClear={() => setSelected(null)}
      />
      {/* The tree canvas. The tidy-tree lays out horizontally by depth, so in
          the narrow R-panel column it overflows into this scroller rather than
          cramping. SVG edges sit underneath; clickable node boxes on top. */}
      <div className="max-h-[420px] overflow-auto rounded border border-hairline bg-surface/30">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <Edges
            nodes={nodes}
            layout={layout}
            highlighted={highlighted}
            hasSelection={hasSelection}
          />
          {nodes.map((node) => {
            const pos = layout.positions.get(node.slug);
            if (!pos) return null;
            const lit = highlighted.has(node.slug);
            return (
              <NodeBox
                key={node.slug}
                node={node}
                pos={pos}
                isSelected={selectedNode?.slug === node.slug}
                lit={lit}
                dimmed={hasSelection && !lit}
                onSelect={() => setSelected(node.slug)}
              />
            );
          })}
        </div>
      </div>
      {selectedNode !== null && (
        <DetailPane node={selectedNode} blastCount={blast.size} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function Legend({
  selectedSlug,
  blastCount,
  onClear,
}: {
  selectedSlug: string | null;
  blastCount: number;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle-foreground">
      <span className="flex items-center gap-1">
        <span className="font-mono text-foreground">{AIM_GLYPH.open}</span> open
      </span>
      <span className="flex items-center gap-1">
        <span className="font-mono text-foreground">{AIM_GLYPH.done}</span> done
      </span>
      <span className="flex items-center gap-1">
        <span className="font-mono text-foreground">{AIM_GLYPH.dead}</span> dead
      </span>
      <span className="flex items-center gap-1">
        <svg width="22" height="8" aria-hidden="true">
          <title>depends_on</title>
          <line
            x1="0"
            y1="4"
            x2="22"
            y2="4"
            stroke="var(--color-info)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        </svg>
        depends_on
      </span>
      {selectedSlug !== null ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <span>
            blast radius: <span className="text-foreground">{blastCount}</span> descendant
            {blastCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            clear
          </button>
        </span>
      ) : (
        <span>click a node to light its blast radius</span>
      )}
    </div>
  );
}

function Edges({
  nodes,
  layout,
  highlighted,
  hasSelection,
}: {
  nodes: readonly AimWire[];
  layout: AimLayout;
  highlighted: Set<string>;
  hasSelection: boolean;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={layout.width}
      height={layout.height}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="aim-depends-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L8 4 L0 8 z" fill="var(--color-info)" />
        </marker>
      </defs>

      {/* Solid parent=means edges. An edge is "in the blast radius" when both
          endpoints are highlighted — then it shares the accent. */}
      {nodes.map((node) => {
        if (node.parent === null) return null;
        const parent = layout.positions.get(node.parent);
        const child = layout.positions.get(node.slug);
        if (!parent || !child) return null;
        const lit = highlighted.has(node.parent) && highlighted.has(node.slug);
        const dimmed = hasSelection && !lit;
        return (
          <path
            key={`p-${node.slug}`}
            d={parentEdgePath(parent, child)}
            fill="none"
            stroke={lit ? "var(--color-primary)" : "var(--color-hairline-strong)"}
            strokeWidth={lit ? 2 : 1.5}
            opacity={dimmed ? 0.2 : 1}
          />
        );
      })}

      {/* `depends_on` cross-edges (an ARRAY per node on the wire): dashed,
          info-hued, arrow-headed — deliberately NOT part of any blast radius
          (kept constant). `serves` / `related` are intentionally NOT drawn
          (listed as slug text in the detail pane instead). */}
      {nodes.flatMap((node) => {
        const src = layout.positions.get(node.slug);
        if (!src) return [];
        return node.depends_on.flatMap((targetSlug) => {
          const tgt = layout.positions.get(targetSlug);
          if (!tgt) return [];
          return [
            <path
              key={`d-${node.slug}-${targetSlug}`}
              d={dependsEdgePath(src, tgt)}
              fill="none"
              stroke="var(--color-info)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              markerEnd="url(#aim-depends-arrow)"
              opacity={hasSelection ? 0.55 : 0.9}
            />,
          ];
        });
      })}
    </svg>
  );
}

function NodeBox({
  node,
  pos,
  isSelected,
  lit,
  dimmed,
  onSelect,
}: {
  node: AimWire;
  pos: NodePos;
  isSelected: boolean;
  lit: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  // Tier the styling: the selected node gets a solid primary ring; the rest of
  // its blast radius gets a softer primary tint; everything else dims out when
  // a selection is active so the highlighted region's size reads at a glance.
  const tone = isSelected
    ? "border-primary bg-primary/15 ring-1 ring-primary"
    : lit
      ? "border-primary/40 bg-primary/10"
      : "border-hairline bg-surface";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      title={`${node.slug} · ${AIM_STATE_LABEL[node.state]}`}
      className={`absolute flex items-start gap-1.5 rounded border px-2 py-1.5 text-left transition-all ${tone} ${
        dimmed ? "opacity-35" : "opacity-100"
      }`}
      style={{ left: pos.x, top: pos.cy, width: NODE_W, transform: "translateY(-50%)" }}
    >
      <span aria-hidden="true" className="pt-px font-mono text-sm leading-none text-foreground">
        {AIM_GLYPH[node.state]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs leading-snug text-foreground">{node.aim}</span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-subtle-foreground">
          {node.slug}
        </span>
      </span>
    </button>
  );
}

// Body-on-select detail pane — READ-ONLY. The prototype's editable frontmatter
// inputs + create form are dropped (write is Stage 2). Frontmatter facts show
// as a plain definition list; cross-edges (`depends_on` / `serves` / `related`)
// list as slug text; the body renders raw.
function DetailPane({
  node,
  blastCount,
  onClose,
}: {
  node: AimWire;
  blastCount: number;
  onClose: () => void;
}) {
  return (
    <div
      data-testid="aim-detail"
      className="space-y-3 rounded border border-hairline bg-surface/30 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="flex items-baseline gap-1.5">
            <span aria-hidden="true" className="font-mono text-foreground">
              {AIM_GLYPH[node.state]}
            </span>
            <span className="text-foreground">{node.aim}</span>
          </span>
          <span className="mt-0.5 block font-mono text-[10px] text-subtle-foreground">
            {node.slug}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close detail"
          aria-label="Close detail"
          className="shrink-0 rounded px-1.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {/* Frontmatter facts — read-only (the write affordance is Stage 2). */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-subtle-foreground">state</dt>
        <dd className="text-foreground">{AIM_STATE_LABEL[node.state]}</dd>
        <dt className="text-subtle-foreground">parent</dt>
        <dd className="font-mono text-muted-foreground">{node.parent ?? "(root)"}</dd>
        {node.depends_on.length > 0 && (
          <>
            <dt className="text-subtle-foreground">depends_on</dt>
            <dd className="font-mono text-muted-foreground">{node.depends_on.join(", ")}</dd>
          </>
        )}
        {node.serves.length > 0 && (
          <>
            <dt className="text-subtle-foreground">serves</dt>
            <dd className="font-mono text-muted-foreground">{node.serves.join(", ")}</dd>
          </>
        )}
        {node.related.length > 0 && (
          <>
            <dt className="text-subtle-foreground">related</dt>
            <dd className="font-mono text-muted-foreground">{node.related.join(", ")}</dd>
          </>
        )}
      </dl>

      <section className="space-y-1">
        <h4 className="text-[10px] uppercase tracking-wide text-subtle-foreground">Body</h4>
        <AimBody body={node.body} />
      </section>

      <p className="border-t border-hairline pt-2 text-[11px] text-subtle-foreground">
        blast radius from here: <span className="text-foreground">{blastCount}</span> descendant
        {blastCount === 1 ? "" : "s"} drift-possible
      </p>
    </div>
  );
}

// Render the raw markdown body verbatim, read-only: `whitespace-pre-wrap`
// preserves the authored line breaks and `font-mono` keeps refs / paths /
// inline `[confirmed: …]` / `[claimed]` markers legible. No markdown→HTML and
// NO honesty-tag parsing (brief): the body is free-form prose. An empty body
// is a valid frontmatter-only node.
function AimBody({ body }: { body: string }) {
  if (body.trim() === "") {
    return (
      <p className="rounded border border-dashed border-hairline px-2 py-3 text-center text-[11px] italic text-subtle-foreground">
        (frontmatter-only — no body)
      </p>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-surface/40 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
      {body}
    </pre>
  );
}
