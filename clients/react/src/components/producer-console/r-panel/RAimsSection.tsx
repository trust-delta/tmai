// ◎ Aims — R panel's aim-tree read view (graduation Stage 1-B, #780 + #782).
// The read-view validated in throwaway prototype #778 (`RAimTreePrototype`),
// graduated into a real R-panel section backed by the live
// `GET /api/units/{unit}/aims` endpoint (tmai-core #500).
//
// ONE job, READ-ONLY. No write affordance (frontmatter edit / new node —
// Stage 2), no drift-mark (Stage 3). The prototype's `CreateForm` /
// `patchNode` / `commitCreate` / in-memory mutation are deliberately NOT
// carried.
//
// CONTAINER (#782): a 2D spatial tree of long-text nodes does not fit the
// narrow R-panel accordion column, and widening the column would fight the
// console-rebuild "central conversation primary" constraint. So the section
// itself stays a thin accordion entry — a compact `N aims · M roots` summary +
// the glyph legend + an ⤢ "open" affordance — and the actual tree lives in a
// DEDICATED FULL-WINDOW OVERLAY (`AimTreeOverlay`, mounted via `createPortal`,
// dismissible by ✕ and Esc). The overlay uses the prototype's SIDE-BY-SIDE
// 2-pane layout (wide canvas + side detail), with the room to let the variable-
// height tidy-tree (`computeLayout`, the #782 overlap fix) breathe.
//
// The view machinery carried intact from the prototype: the variable-height
// tidy-tree layout, the blast-radius highlight (select a node → light its whole
// descendant subtree, the set that would become drift-possible if that aim
// changed), `depends_on` drawn as a visually distinct dashed cross-edge (NOT
// part of any blast radius), the per-node state glyph, and the body-on-select
// detail pane. The pure layout / traversal lives in `./aim-tree` (unit-tested
// separately); this file is the React rendering.
//
// `body` is rendered as raw markdown, read-only: line breaks preserved,
// monospace so inline refs / markers stay legible. There is intentionally no
// `[confirmed]` / `[claimed]` honesty-tag parser — those markers are free-form
// prose in the wire body, not a structured field (the prototype's `BodyLine`
// was a fixture invention).

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useUnitAims } from "@/hooks/useUnitAims";
import { type AimState, type AimWire, api } from "@/lib/api";
import {
  AIM_GLYPH,
  AIM_STATE_LABEL,
  type AimLayout,
  buildChildren,
  computeLayout,
  dependsEdgePath,
  descendantsOf,
  findRoots,
  flattenRepos,
  NODE_W,
  type NodePos,
  parentEdgePath,
} from "./aim-tree";
import { Section } from "./Section";

// Lifecycle states the operator can set, in glyph-legend order. Drives the
// edit + create `state` selects. `AimState` is the generated wire enum.
const AIM_STATES: readonly AimState[] = ["open", "done", "dead"];

// Client-side slug validation for the create form — a fast-feedback MIRROR of
// the backend's `validate_new_aim_slug` (tmai-core #501): non-empty, lowercase
// kebab / filename-safe (`[a-z0-9-]`, no leading/trailing/doubled `-`), and
// NON-dated (a `YYYY-MM-DD-` prefix is the decision/approach convention; aim
// slugs are dateless stable identities). Returns an error string, or `null`
// when valid. The backend stays authoritative (it owns the `409`/`422`); this
// only spares the operator a round-trip on the obvious cases.
export function validateAimSlug(slug: string): string | null {
  if (slug === "") return "slug must not be empty";
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return "lowercase kebab-case only ([a-z0-9-])";
  }
  if (slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) {
    return "no leading / trailing / doubled '-'";
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(slug)) {
    return "must be NON-dated (no YYYY-MM-DD prefix)";
  }
  return null;
}

// Normalize a thrown API error into a short, operator-readable message. The
// HTTP client throws `Error` whose message carries the backend's `409` / `422`
// / `404` text; surface it verbatim, trimmed.
function writeErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface RAimsSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RAimsSection({ unitName, expanded, onToggle }: RAimsSectionProps) {
  const { data, loading, error, refresh } = useUnitAims(unitName);
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
      <Body unitName={unitName} nodes={nodes} loading={loading} error={error} refresh={refresh} />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  nodes: AimWire[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

function Body({ unitName, nodes, loading, error, refresh }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see aims.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load aims: {error.message}</p>;
  }
  // Unlike the read-only Stage 1-B, an empty tree is still actionable: the
  // operator can author the first node. So the overlay (with its create
  // affordance) is reachable even at zero aims — the thin entry shows the
  // count and the ⤢ open, and the loading state only gates the very first
  // fetch (nodes empty AND loading).
  if (nodes.length === 0 && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  return <AimsEntry unitName={unitName} nodes={nodes} refresh={refresh} />;
}

// The thin R-panel entry: a compact summary + the glyph legend + an ⤢ open
// affordance. Clicking open launches the maximized overlay; the open-state is
// local and the overlay is portalled, so the section stays self-contained and
// the narrow column is never widened.
function AimsEntry({
  unitName,
  nodes,
  refresh,
}: {
  unitName: string;
  nodes: AimWire[];
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootCount = useMemo(() => findRoots(nodes).length, [nodes]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-subtle-foreground">
          {nodes.length} aim{nodes.length === 1 ? "" : "s"} ·{" "}
          <span className="text-foreground">{rootCount}</span> root{rootCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open aim-tree (maximized)"
          aria-label="Open aim-tree"
          className="flex shrink-0 items-center gap-1 rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          <span aria-hidden="true">⤢</span> Open
        </button>
      </div>
      <GlyphLegend />
      {open && (
        <AimTreeOverlay
          unitName={unitName}
          nodes={nodes}
          refresh={refresh}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// The maximized aim-tree overlay — a full-window surface modelled on
// `HelpOverlay` / `HandoffRitualOverlay`, mounted via `createPortal` so it
// escapes the R-panel column's clipping/stacking. Dismissible by ✕ and Esc
// (the Esc convention reused from `AttentionMarker` / `ConfirmDialog`).
// Layout: the prototype's side-by-side 2-pane — a wide scrollable tree canvas
// on the left, the body-on-select detail pane on the right.
function AimTreeOverlay({
  unitName,
  nodes,
  refresh,
  onClose,
}: {
  unitName: string;
  nodes: AimWire[];
  refresh: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Stage 2-B: the create form. Mutually exclusive with the detail pane (both
  // live in the right aside) — opening it deselects so the operator authors a
  // fresh node rather than reading one.
  const [creating, setCreating] = useState(false);
  const childrenOf = useMemo(() => buildChildren(nodes), [nodes]);
  const layout = useMemo(() => computeLayout(nodes), [nodes]);
  const rootCount = layout.roots.length;
  const allSlugs = useMemo(() => nodes.map((n) => n.slug), [nodes]);

  // Esc dismisses the whole overlay (the detail pane's ✕ / the legend's clear
  // handle deselect). Listener is document-level so it fires regardless of
  // focus, mirroring AttentionMarker's popover.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Aim-tree"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-sm font-semibold text-foreground">◎ Aims · aim-tree</h2>
          <span className="text-[11px] text-subtle-foreground">
            {nodes.length} aim{nodes.length === 1 ? "" : "s"} · {rootCount} root
            {rootCount === 1 ? "" : "s"}
          </span>
          <SelectionStatus
            selectedSlug={selectedNode?.slug ?? null}
            blastCount={blast.size}
            onClear={() => setSelected(null)}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Stage 2-B create affordance. Opening the form clears any selection
              so the right pane shows the form, not a node's body. */}
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setCreating(true);
            }}
            title="Create a new aim node"
            aria-label="New aim node"
            className="rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            <span aria-hidden="true">＋</span> New node
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close aim-tree (Esc)"
            aria-label="Close aim-tree"
            className="rounded px-2 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: the tree canvas. The tidy-tree lays out horizontally by depth
            and variable-height vertically (the #782 overlap fix); SVG edges sit
            underneath, clickable node boxes on top. The wide window lets it
            overflow into this scroller without cramping. */}
        <div className="min-w-0 flex-1 overflow-auto p-4">
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

        {/* Right: the create form (Stage 2-B), the body-on-select detail pane
            (with the inline edit affordance), or the click hint — in that
            precedence. */}
        <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-hairline">
          {creating ? (
            <CreateForm
              unitName={unitName}
              existingSlugs={allSlugs}
              refresh={refresh}
              onClose={() => setCreating(false)}
              onCreated={(slug) => {
                setCreating(false);
                setSelected(slug);
              }}
            />
          ) : selectedNode !== null ? (
            <DetailPane
              key={selectedNode.slug}
              unitName={unitName}
              node={selectedNode}
              blastCount={blast.size}
              parentOptions={allSlugs}
              forbiddenParents={highlighted}
              refresh={refresh}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="p-6 text-xs text-subtle-foreground">
              Click a node to read its body and light its{" "}
              <span className="text-foreground">blast radius</span> — the descendant subtree that
              would become drift-possible if that aim changed. Or{" "}
              <span className="text-foreground">＋ New node</span> to author one.
            </p>
          )}
        </aside>
      </div>

      <footer className="shrink-0 border-t border-hairline px-4 py-2">
        <GlyphLegend />
      </footer>
    </div>,
    document.body,
  );
}

// The static glyph key — open / done / dead state glyphs + the dashed
// `depends_on` swatch. Shown in both the thin entry and the overlay footer.
function GlyphLegend() {
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
    </div>
  );
}

// The selection status — blast-radius count + a clear button when a node is
// selected, or a hint to click otherwise. Lives in the overlay header.
function SelectionStatus({
  selectedSlug,
  blastCount,
  onClear,
}: {
  selectedSlug: string | null;
  blastCount: number;
  onClear: () => void;
}) {
  if (selectedSlug === null) {
    return (
      <span className="text-[11px] text-subtle-foreground">
        click a node to light its blast radius
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
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

// Body-on-select detail pane. Stage 2-B adds an inline frontmatter EDIT
// affordance (aim / parent / state only — cross-edges + body are preserved
// server-side). When not editing, the frontmatter facts show as a plain
// definition list (cross-edges as slug text) with an ✎ Edit button; the body
// always renders raw, read-only (editing it is out of scope — the Producer
// writes the body via normal file editing).
function DetailPane({
  unitName,
  node,
  blastCount,
  parentOptions,
  forbiddenParents,
  refresh,
  onClose,
}: {
  unitName: string;
  node: AimWire;
  blastCount: number;
  parentOptions: readonly string[];
  forbiddenParents: ReadonlySet<string>;
  refresh: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div data-testid="aim-detail" className="space-y-3 p-4">
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

      {editing ? (
        // Remount per node (`key`) so the draft always seeds from the current
        // node, never a stale prior selection.
        <AimEditForm
          key={node.slug}
          unitName={unitName}
          node={node}
          parentOptions={parentOptions}
          forbiddenParents={forbiddenParents}
          refresh={refresh}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
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
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            <span aria-hidden="true">✎</span> Edit frontmatter
          </button>
        </>
      )}

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

// The inline frontmatter edit form (Stage 2-B): aim / parent / state ONLY. The
// body and the cross-edges (`depends_on` / `serves` / `related`) are NOT touched
// here — the backend preserves them byte-for-byte. Authority is operator-only,
// soft: a plain Save, no draft/accept gate. The `parent` select excludes the
// node itself and its descendants (`forbiddenParents`) so the operator can't
// form a trivial cycle.
function AimEditForm({
  unitName,
  node,
  parentOptions,
  forbiddenParents,
  refresh,
  onDone,
}: {
  unitName: string;
  node: AimWire;
  parentOptions: readonly string[];
  forbiddenParents: ReadonlySet<string>;
  refresh: () => void;
  onDone: () => void;
}) {
  const [aim, setAim] = useState(node.aim);
  const [parent, setParent] = useState<string>(node.parent ?? "");
  const [state, setState] = useState<AimState>(node.state);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedAim = aim.trim();
  const canSave = trimmedAim !== "" && !submitting;

  async function onSave() {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.editAim(unitName, node.slug, {
        aim: trimmedAim,
        parent: parent === "" ? null : parent,
        state,
      });
      refresh();
      onDone();
    } catch (e) {
      setError(writeErrorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      <AimField label="aim" htmlFor="aim-edit-aim">
        <textarea
          id="aim-edit-aim"
          value={aim}
          onChange={(e) => setAim(e.target.value)}
          rows={2}
          className="w-full resize-y rounded border border-hairline bg-surface px-2 py-1 text-xs text-foreground"
        />
      </AimField>
      <AimField label="parent" htmlFor="aim-edit-parent">
        <ParentSelect
          id="aim-edit-parent"
          value={parent}
          onChange={setParent}
          options={parentOptions}
          forbidden={forbiddenParents}
        />
      </AimField>
      <AimField label="state" htmlFor="aim-edit-state">
        <StateSelect id="aim-edit-state" value={state} onChange={setState} />
      </AimField>

      {error !== null && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="rounded border border-primary bg-primary/15 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={submitting}
          className="rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// The create form (Stage 2-B): author a new node — slug / aim / parent. `state`
// starts `open`, the body starts empty, no cross-edges (the backend default).
// Client-side slug validation gives fast feedback; the backend stays
// authoritative (it owns the `409` duplicate / `422` dangling-parent verdicts,
// surfaced inline). On success the parent re-fetches and selects the new node.
function CreateForm({
  unitName,
  existingSlugs,
  refresh,
  onClose,
  onCreated,
}: {
  unitName: string;
  existingSlugs: readonly string[];
  refresh: () => void;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [slug, setSlug] = useState("");
  const [aim, setAim] = useState("");
  const [parent, setParent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedSlug = slug.trim();
  const trimmedAim = aim.trim();
  const slugError = trimmedSlug === "" ? null : validateAimSlug(trimmedSlug);
  const duplicate = existingSlugs.includes(trimmedSlug);
  const canCreate =
    trimmedSlug !== "" && trimmedAim !== "" && slugError === null && !duplicate && !submitting;

  async function onCreate() {
    if (!canCreate) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createAim(unitName, {
        slug: trimmedSlug,
        aim: trimmedAim,
        parent: parent === "" ? null : parent,
      });
      refresh();
      onCreated(created.slug);
    } catch (e) {
      setError(writeErrorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <form
      data-testid="aim-create"
      className="space-y-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onCreate();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">＋ New aim node</h3>
        <button
          type="button"
          onClick={onClose}
          title="Cancel create"
          aria-label="Cancel create"
          className="shrink-0 rounded px-1.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <AimField label="slug" htmlFor="aim-create-slug">
        <input
          id="aim-create-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="kebab-case-identity"
          className="w-full rounded border border-hairline bg-surface px-2 py-1 font-mono text-xs text-foreground"
        />
        {slugError !== null && <p className="mt-0.5 text-[10px] text-destructive">{slugError}</p>}
        {slugError === null && duplicate && (
          <p className="mt-0.5 text-[10px] text-destructive">slug already exists</p>
        )}
      </AimField>
      <AimField label="aim" htmlFor="aim-create-aim">
        <textarea
          id="aim-create-aim"
          value={aim}
          onChange={(e) => setAim(e.target.value)}
          rows={2}
          placeholder="the human bearing, one line."
          className="w-full resize-y rounded border border-hairline bg-surface px-2 py-1 text-xs text-foreground"
        />
      </AimField>
      <AimField label="parent" htmlFor="aim-create-parent">
        <ParentSelect
          id="aim-create-parent"
          value={parent}
          onChange={setParent}
          options={existingSlugs}
          forbidden={EMPTY_FORBIDDEN}
        />
      </AimField>

      {error !== null && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canCreate}
          className="rounded border border-primary bg-primary/15 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// A stable empty set for the create form's parent select (no node to forbid —
// a brand-new slug can't be its own ancestor). Module-level so it keeps a
// constant identity across renders.
const EMPTY_FORBIDDEN: ReadonlySet<string> = new Set<string>();

// A labelled field row shared by the edit + create forms.
function AimField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <label
        htmlFor={htmlFor}
        className="block text-[10px] uppercase tracking-wide text-subtle-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// Parent slug select: "(root)" + every existing slug except those in
// `forbidden` (self + descendants, for the edit form). A `value` not present in
// the options still renders (the current parent is shown even if it were, in
// some edge case, filtered) — but normal parents are always selectable.
function ParentSelect({
  id,
  value,
  onChange,
  options,
  forbidden,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  forbidden: ReadonlySet<string>;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-hairline bg-surface px-2 py-1 font-mono text-xs text-foreground"
    >
      <option value="">(root)</option>
      {options
        .filter((slug) => !forbidden.has(slug))
        .map((slug) => (
          <option key={slug} value={slug}>
            {slug}
          </option>
        ))}
    </select>
  );
}

// State select — the three lifecycle states, labelled.
function StateSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: AimState;
  onChange: (next: AimState) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as AimState)}
      className="w-full rounded border border-hairline bg-surface px-2 py-1 text-xs text-foreground"
    >
      {AIM_STATES.map((s) => (
        <option key={s} value={s}>
          {AIM_STATE_LABEL[s]}
        </option>
      ))}
    </select>
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
    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-surface/40 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
      {body}
    </pre>
  );
}
