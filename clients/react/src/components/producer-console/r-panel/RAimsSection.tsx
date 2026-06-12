// ◎ Aims — the destination Aim panel (Stage B convergence, #791). Rebuilt from
// the read-only tidy-tree view into the attention-economical WRITE surface the
// mock (`origin/mock/aim-ui-sample`) compose: a segmented Frontier⊥Tree panel
// with a ledger strip, a per-repo collapsible navigator + branch rollups, an
// overview ruler, and an inspector that carries drift + the interior `is[]`.
//
// LOAD-BEARING THESIS (do not lose this): the panel does NOT render the whole
// tree. Default = the owed FRONTIER worklist (drifted OR carrying a `claimed`
// mark, drift-first, breadcrumbed); the full tree is a collapsed Tree
// navigator with branch-level rollups + an overview ruler. This is the "scale
// answer" — the panel stays a write surface, never a passive full-tree dump
// (the approach's named failure-signal). Pure model in `./aim-tree`.
//
// Design pins honoured:
//   #1 mark-only — the `is[]` marks (confirmed / claimed / pruned) render as
//      the author wrote them; we never re-judge / re-order / appraise (only the
//      wire's `kind` drives styling).
//   #2 done+drift distinct — a `state: done` node that is ALSO drifted gets the
//      `done-drift` tone (a done ✓ AND a drift ⚠ badge), surfaced in its own
//      Frontier cluster + the Tree, never suppressed or folded into plain owed.
//   #3 drift mirrors the engine — after an ought edit we REFETCH the forest and
//      render whatever drift the wire reports; there is NO client-side
//      transitive cascade (the engine is the single source of truth).
//
// Theme: the mock is the STRUCTURE/BEHAVIOUR reference, not its raw CSS. The
// panel speaks the app's design tokens — drift = `warning`, claimed = `warning`
// hollow (◌ vs ⚠ + gutter weight distinguish the two owed kinds), confirmed /
// done = `success` (calm), root / selection = `info` / `primary`, pruned =
// neutral/subtle (negative-calm: an adjudicated rejection is never owed and
// never counted, #814).
//
// UI-only state: the mode (Frontier/Tree) persists in `ui-prefs` (browser-side,
// not tmai-core config). The expanded-branch set + the search filter stay
// component-local — a persisted filter would silently hide rows on next open,
// and the branch set re-seeds to the mock's default (repos + roots open) each
// session.

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useUnitAims } from "@/hooks/useUnitAims";
import { type AimsResponse, api } from "@/lib/api";
import { useUIPref } from "@/lib/ui-prefs-provider";
import type { AimDriftWire } from "@/types/generated/AimDriftWire";
import type { AimInteriorKind } from "@/types/generated/AimInteriorKind";
import type { AimInteriorWire } from "@/types/generated/AimInteriorWire";
import type { AimState } from "@/types/generated/AimState";
import type { AimWire } from "@/types/generated/AimWire";
import type { RepoAimsWire } from "@/types/generated/RepoAimsWire";
import {
  AIM_STATE_LABEL,
  type AimTone,
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
  type LedgerCounts,
  ledgerCounts,
  type RollupStats,
  type RulerTick,
  repoForests,
  repoStats,
  rulerOrder,
  subtreeStats,
  WORKING_DELTA_FACT,
  WORKING_DELTA_GLYPH,
  type WorkingDeltaKind,
  workingDeltaKind,
} from "./aim-tree";
import { Section } from "./Section";

// Lifecycle states the operator can set, in glyph-legend order. Drives the
// edit + create `state` selects. `AimState` is the generated wire enum.
const AIM_STATES: readonly AimState[] = ["open", "done", "dead"];

// Stable identity key for a repo group (root is unique per unit).
const repoKey = (r: RepoAimsWire): string => `repo:${r.repo_root}`;

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

// ── tone → presentation (mark-only: only the wire-derived tone drives this) ──

const TONE_GLYPH: Record<AimTone, string> = {
  "done-drift": "✓",
  done: "✓",
  dead: "⊘",
  drift: "⚠",
  claimed: "◌",
  confirmed: "○",
  root: "○",
  neutral: "○",
};

const TONE_GLYPH_CLASS: Record<AimTone, string> = {
  "done-drift": "text-success",
  done: "text-success",
  dead: "text-subtle-foreground",
  drift: "text-warning",
  claimed: "text-warning",
  confirmed: "text-subtle-foreground",
  root: "text-info",
  neutral: "text-subtle-foreground",
};

// Left gutter colour. done-drift uses the warning gutter (surfacing the owed
// drift) even though its glyph is the done ✓ — together with the trailing ⚠
// badge that is what makes done+drift read DISTINCTLY from plain done (pin #2).
const TONE_GUTTER: Record<AimTone, string> = {
  "done-drift": "bg-warning",
  done: "bg-success/40",
  dead: "bg-subtle-foreground/40",
  drift: "bg-warning",
  claimed: "bg-warning/55",
  confirmed: "bg-success/30",
  root: "bg-info/60",
  neutral: "bg-hairline-strong",
};

// Working-delta presence glyph styling (#817) — a SEPARATE glyph from the
// drift ⚠ (the two may coexist on one row); neutral-to-info, NEVER the
// warning family (presence is a fact about the instrument, not owed work).
// `uncommitted-anchor` gets the info accent (the anchor on screen is not the
// anchor in HEAD); `untracked` gets a dotted "new" reading.
const WD_GLYPH_CLASS: Record<WorkingDeltaKind, string> = {
  uncommitted: "text-subtle-foreground",
  "uncommitted-anchor": "text-info",
  untracked:
    "rounded-[2px] border border-dotted border-subtle-foreground/60 text-subtle-foreground leading-none",
};

// Ought-text styling per tone — calm for resolved/abandoned, lit for drift.
const TONE_OUGHT_CLASS: Record<AimTone, string> = {
  "done-drift": "text-warning/90",
  done: "text-subtle-foreground",
  dead: "text-subtle-foreground line-through",
  drift: "text-warning/90",
  claimed: "text-foreground",
  confirmed: "text-muted-foreground",
  root: "text-foreground",
  neutral: "text-foreground",
};

interface RAimsSectionProps {
  unitName: string | null;
  expanded: boolean;
  onToggle: () => void;
}

export function RAimsSection({ unitName, expanded, onToggle }: RAimsSectionProps) {
  const { data, loading, error, refresh } = useUnitAims(unitName);
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
      <Body
        unitName={unitName}
        data={data}
        nodes={nodes}
        loading={loading}
        error={error}
        refresh={refresh}
      />
    </Section>
  );
}

interface BodyProps {
  unitName: string | null;
  data: AimsResponse | null;
  nodes: AimWire[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

function Body({ unitName, data, nodes, loading, error, refresh }: BodyProps) {
  if (unitName === null) {
    return <p className="text-subtle-foreground">Pick a project to see aims.</p>;
  }
  if (error !== null) {
    return <p className="text-muted-foreground">Failed to load aims: {error.message}</p>;
  }
  // An empty tree is still actionable (the operator can author the first node),
  // so the panel is reachable at zero aims; only the very first fetch gates.
  if (nodes.length === 0 && loading) {
    return <p className="text-subtle-foreground">Loading…</p>;
  }
  return <AimsEntry unitName={unitName} data={data} nodes={nodes} refresh={refresh} />;
}

// The thin R-panel entry: a compact summary with an at-a-glance owed badge +
// an ⤢ open affordance. Opening launches the maximized panel; the open-state
// is local and the panel is portalled, so the section stays self-contained and
// the narrow column is never widened.
function AimsEntry({
  unitName,
  data,
  nodes,
  refresh,
}: {
  unitName: string;
  data: AimsResponse | null;
  nodes: AimWire[];
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const repoCount = useMemo(() => repoForests(data).length, [data]);
  const ledger = useMemo(() => ledgerCounts(nodes), [nodes]);
  const owed = ledger.drift + ledger.claimed;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-subtle-foreground">
          {nodes.length} aim{nodes.length === 1 ? "" : "s"}
          {repoCount > 0 && (
            <>
              {" · "}
              <span className="text-foreground">{repoCount}</span> repo{repoCount === 1 ? "" : "s"}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open the Aim panel (maximized)"
          aria-label="Open aim panel"
          className="flex shrink-0 items-center gap-1 rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          <span aria-hidden="true">⤢</span> Open
        </button>
      </div>
      {/* At-a-glance owed badge so the entry surfaces attention without opening. */}
      {owed > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {ledger.drift > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <span aria-hidden="true">⚠</span>
              {ledger.drift} drift
            </span>
          )}
          {ledger.claimed > 0 && (
            <span className="flex items-center gap-1 text-warning/80">
              <span aria-hidden="true">◌</span>
              {ledger.claimed} claimed
            </span>
          )}
        </div>
      ) : (
        <span className="text-[11px] text-subtle-foreground">calm — nothing owed</span>
      )}
      {open && (
        <AimPanelOverlay
          unitName={unitName}
          data={data}
          refresh={refresh}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// What the create flow is creating — a root in `repoRoot`, optionally under
// `initialParent`. (`repoRoot` scopes the parent options / slug uniqueness; the
// #501 create endpoint resolves the write repo from the unit + parent, so it
// is not on the wire — see the friction note re: a per-repo create wire gap.)
interface Creating {
  repoRoot: string;
  initialParent: string;
}

// The maximized Aim panel — a full-window surface (portalled past the R-panel
// column's clipping, dismissible by ✕ / Esc) holding the destination layout.
function AimPanelOverlay({
  unitName,
  data,
  refresh,
  onClose,
}: {
  unitName: string;
  data: AimsResponse | null;
  refresh: () => void;
  onClose: () => void;
}) {
  const repos = useMemo(() => repoForests(data), [data]);
  const allNodes = useMemo(() => flattenRepos(data), [data]);
  const ledger = useMemo(() => ledgerCounts(allNodes), [allNodes]);
  const ticks = useMemo(() => rulerOrder(repos), [repos]);

  const [mode, setMode] = useUIPref("aimMode");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);

  // Branch-expansion state, seeded once to the mock's default (every repo group
  // + every root open; deeper branches collapsed behind a rollup). Survives
  // polls; new nodes get expanded explicitly on create / reveal.
  const [expanded, setExpanded] = useState<Set<string>>(() => seedExpanded(repos));

  // Esc dismisses the whole panel. Document-level so it fires regardless of
  // focus (mirrors the prior overlay / AttentionMarker popover).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Resolve the selection against the CURRENT forest, with its repo context, so
  // a poll / unit change that drops the slug falls back to "nothing selected"
  // rather than dangling on a vanished node.
  const sel = useMemo(() => resolveSelection(selected, repos), [selected, repos]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Reveal a node in Tree mode: open its repo group + every ancestor, switch to
  // Tree, select it. (The ruler / cross-mode jumps land here.) When the slug is
  // not yet in the loaded forest — e.g. a node just created, before the refetch
  // lands — we still switch to Tree and select it; the selection resolves once
  // the refreshed wire arrives (no ancestor-expansion then, since the chain
  // isn't known yet).
  const reveal = useCallback(
    (slug: string) => {
      const found = resolveSelection(slug, repos);
      if (found) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(repoKey(found.repo));
          for (const a of ancestry(slug, found.bySlug)) next.add(a.slug);
          return next;
        });
      }
      setMode("tree");
      setSelected(slug);
    },
    [repos, setMode],
  );

  const select = useCallback((slug: string) => {
    setCreating(null);
    setSelected(slug);
  }, []);

  const openCreate = useCallback((repoRoot: string, initialParent: string) => {
    setSelected(null);
    setCreating({ repoRoot, initialParent });
  }, []);

  const primaryRepo = repos.find((r) => r.primary) ?? repos[0] ?? null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Aim panel"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-sm font-semibold text-foreground">◎ Aim</h2>
          <span className="font-mono text-[11px] text-subtle-foreground">
            {allNodes.length} aim{allNodes.length === 1 ? "" : "s"} · {repos.length} repo
            {repos.length === 1 ? "" : "s"}
          </span>
          <span
            className="rounded border border-info/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-info"
            title="The owed frontier is the panel's premise — not a full-tree dump"
          >
            owed-frontier
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close the Aim panel (Esc)"
          aria-label="Close aim panel"
          className="rounded px-2 py-0.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ✕
        </button>
      </header>

      <Ledger counts={ledger} />

      <Controls
        mode={mode}
        onMode={setMode}
        query={query}
        onQuery={setQuery}
        onNew={() => primaryRepo && openCreate(primaryRepo.repo_root, "")}
        canCreate={primaryRepo !== null}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {mode === "frontier" ? (
            <FrontierList
              repos={repos}
              query={query}
              selected={sel?.node.slug ?? null}
              onSelect={select}
            />
          ) : (
            <TreeNavigator
              repos={repos}
              query={query}
              expanded={expanded}
              selected={sel?.node.slug ?? null}
              onToggleExpanded={toggleExpanded}
              onSelect={select}
              onAddChild={(repoRoot, parent) => openCreate(repoRoot, parent)}
              onAddRoot={(repoRoot) => openCreate(repoRoot, "")}
            />
          )}
        </div>
        <OverviewRuler ticks={ticks} onReveal={reveal} />
      </div>

      {creating !== null ? (
        <CreatePanel
          unitName={unitName}
          creating={creating}
          repos={repos}
          refresh={refresh}
          onClose={() => setCreating(null)}
          onCreated={(slug) => {
            setCreating(null);
            reveal(slug);
          }}
        />
      ) : sel !== null ? (
        <Inspector
          key={sel.node.slug}
          unitName={unitName}
          sel={sel}
          refresh={refresh}
          onSelect={select}
          onAddChild={(parent) => openCreate(sel.repo.repo_root, parent)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>,
    document.body,
  );
}

// Default branch-expansion: every repo group + every root open.
function seedExpanded(repos: readonly RepoAimsWire[]): Set<string> {
  const s = new Set<string>();
  for (const r of repos) {
    s.add(repoKey(r));
    for (const root of findRoots(r.aims)) s.add(root.slug);
  }
  return s;
}

// A resolved selection: the node + the repo + the repo's index structures, so
// the inspector / reveal can walk ancestry and forbid re-parent cycles without
// re-deriving them.
interface Selection {
  node: AimWire;
  repo: RepoAimsWire;
  bySlug: Map<string, AimWire>;
  childrenOf: Map<string, AimWire[]>;
}

function resolveSelection(slug: string | null, repos: readonly RepoAimsWire[]): Selection | null {
  if (slug === null) return null;
  for (const repo of repos) {
    const node = repo.aims.find((n) => n.slug === slug);
    if (node) {
      return {
        node,
        repo,
        bySlug: bySlugMap(repo.aims),
        childrenOf: buildChildren(repo.aims),
      };
    }
  }
  return null;
}

// ── Ledger strip ──────────────────────────────────────────────────────

function Ledger({ counts }: { counts: LedgerCounts }) {
  const owed = counts.drift + counts.claimed;
  const total = owed + counts.confirmed;
  const owedPct = total === 0 ? 0 : Math.round((100 * owed) / total);
  const confirmedPct = total === 0 ? 0 : 100 - owedPct;

  return (
    <div
      data-testid="aim-ledger"
      className="flex shrink-0 items-center gap-4 border-b border-hairline px-4 py-2"
    >
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-warning">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-warning" />
        <b className="font-semibold">{counts.drift}</b> drift
      </span>
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-warning/80">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] border border-warning/80" />
        <b className="font-semibold">{counts.claimed}</b> claimed
      </span>
      <span className="flex items-center gap-1.5 font-mono text-[11px] text-subtle-foreground">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-success/70" />
        <b className="font-semibold text-muted-foreground">{counts.confirmed}</b> confirmed
      </span>
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full border border-hairline">
        <div className="bg-warning" style={{ width: `${owedPct}%` }} />
        <div className="bg-success/40" style={{ width: `${confirmedPct}%` }} />
      </div>
    </div>
  );
}

// ── Controls (mode + search + new) ────────────────────────────────────

function Controls({
  mode,
  onMode,
  query,
  onQuery,
  onNew,
  canCreate,
}: {
  mode: "frontier" | "tree";
  onMode: (m: "frontier" | "tree") => void;
  query: string;
  onQuery: (q: string) => void;
  onNew: () => void;
  canCreate: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
      <div className="flex overflow-hidden rounded border border-hairline">
        <button
          type="button"
          aria-pressed={mode === "frontier"}
          onClick={() => onMode("frontier")}
          className={`px-3 py-1 text-[11px] transition-colors ${
            mode === "frontier"
              ? "bg-surface-strong text-warning"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Frontier ⚠
        </button>
        <button
          type="button"
          aria-pressed={mode === "tree"}
          onClick={() => onMode("tree")}
          className={`border-l border-hairline px-3 py-1 text-[11px] transition-colors ${
            mode === "tree"
              ? "bg-surface-strong text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Tree
        </button>
      </div>
      <div className="flex flex-1 items-center gap-2 rounded border border-hairline px-2 py-1">
        <span aria-hidden="true" className="text-subtle-foreground">
          ⌕
        </span>
        <input
          aria-label="Filter aims"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="filter by slug / ought…"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </div>
      <button
        type="button"
        onClick={onNew}
        disabled={!canCreate}
        aria-label="New aim"
        className="shrink-0 rounded border border-info/40 bg-info/10 px-2 py-1 text-[11px] text-info transition-colors hover:bg-info/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ＋ aim
      </button>
    </div>
  );
}

// ── Frontier mode — the owed worklist ─────────────────────────────────

function FrontierList({
  repos,
  query,
  selected,
  onSelect,
}: {
  repos: readonly RepoAimsWire[];
  query: string;
  selected: string | null;
  onSelect: (slug: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const matches = (n: AimWire) =>
    q === "" || n.slug.toLowerCase().includes(q) || n.aim.toLowerCase().includes(q);

  const sections = repos
    .map((repo) => {
      const bySlug = bySlugMap(repo.aims);
      const owed = frontierRows(repo.aims).filter(matches);
      const doneDrift = doneDriftedRows(repo.aims).filter(matches);
      return { repo, bySlug, owed, doneDrift };
    })
    .filter((s) => s.owed.length > 0 || s.doneDrift.length > 0);

  if (sections.length === 0) {
    return (
      <p className="px-4 py-6 text-[11px] text-subtle-foreground">
        {q === "" ? "Nothing owed — the forest is calm." : "No owed aim matches the filter."}
      </p>
    );
  }

  return (
    <div>
      {sections.map(({ repo, bySlug, owed, doneDrift }) => {
        const driftN = owed.filter((n) => aimTone(n) === "drift").length;
        const claimedN = owed.length - driftN;
        return (
          <div key={repo.repo_root}>
            <RepoBanner repo={repo} drift={driftN} claimed={claimedN} />
            {owed.map((n) => (
              <AimRow
                key={n.slug}
                node={n}
                selected={selected === n.slug}
                crumb={breadcrumbText(n.slug, bySlug) || "root"}
                onSelect={() => onSelect(n.slug)}
              />
            ))}
            {doneDrift.length > 0 && (
              <>
                {/* Pin #2: done-and-drifted, surfaced in its OWN cluster — a
                    re-confirm is owed, but it is not active worklist. */}
                <div className="px-4 py-1 font-mono text-[9px] uppercase tracking-wide text-success">
                  done · drifted — re-confirm?
                </div>
                {doneDrift.map((n) => (
                  <AimRow
                    key={n.slug}
                    node={n}
                    selected={selected === n.slug}
                    crumb={breadcrumbText(n.slug, bySlug) || "root"}
                    onSelect={() => onSelect(n.slug)}
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// A non-collapsible repo banner used in Frontier sections (the repo is context,
// not a toggle, here). Primary repo gets the cyan/info accent.
function RepoBanner({
  repo,
  drift,
  claimed,
}: {
  repo: RepoAimsWire;
  drift: number;
  claimed: number;
}) {
  return (
    <div
      className={`flex items-center gap-2 border-y border-hairline bg-surface/40 px-3 py-1 ${
        repo.primary ? "shadow-[inset_2px_0_0_var(--color-info)]" : ""
      }`}
    >
      <span
        className={`font-mono text-[11px] font-semibold ${
          repo.primary ? "text-info" : "text-muted-foreground"
        }`}
      >
        {repo.repo_label}
      </span>
      <span className="ml-auto font-mono text-[10px]">
        {drift > 0 && <span className="text-warning">⚠{drift} </span>}
        {claimed > 0 && <span className="text-warning/80">◌{claimed}</span>}
      </span>
    </div>
  );
}

// ── Tree mode — collapsible per-repo navigator with rollups ───────────

function TreeNavigator({
  repos,
  query,
  expanded,
  selected,
  onToggleExpanded,
  onSelect,
  onAddChild,
  onAddRoot,
}: {
  repos: readonly RepoAimsWire[];
  query: string;
  expanded: Set<string>;
  selected: string | null;
  onToggleExpanded: (key: string) => void;
  onSelect: (slug: string) => void;
  onAddChild: (repoRoot: string, parent: string) => void;
  onAddRoot: (repoRoot: string) => void;
}) {
  const q = query.trim().toLowerCase();

  // A query in Tree mode shows a FLAT, repo-tagged hit list (the tree is a
  // navigator; a filter wants results, not a pruned tree).
  if (q !== "") {
    const hits = repos.flatMap((repo) =>
      repo.aims
        .filter((n) => n.slug.toLowerCase().includes(q) || n.aim.toLowerCase().includes(q))
        .map((n) => ({ repo, node: n })),
    );
    if (hits.length === 0) {
      return (
        <p className="px-4 py-6 text-[11px] text-subtle-foreground">No aim matches the filter.</p>
      );
    }
    return (
      <div>
        {hits.map(({ repo, node }) => (
          <AimRow
            key={`${repo.repo_root}:${node.slug}`}
            node={node}
            selected={selected === node.slug}
            repoTag={repo.repo_label}
            repoPrimary={repo.primary}
            onSelect={() => onSelect(node.slug)}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      {repos.map((repo) => {
        const key = repoKey(repo);
        const open = expanded.has(key);
        const stats = repoStats(repo.aims);
        const childrenOf = buildChildren(repo.aims);
        const roots = findRoots(repo.aims);
        return (
          <div key={repo.repo_root}>
            <RepoHead
              repo={repo}
              open={open}
              stats={stats}
              onToggle={() => onToggleExpanded(key)}
              onAddRoot={() => onAddRoot(repo.repo_root)}
            />
            {open &&
              roots.map((root) => (
                <TreeBranch
                  key={root.slug}
                  node={root}
                  depth={0}
                  repo={repo}
                  childrenOf={childrenOf}
                  expanded={expanded}
                  selected={selected}
                  onToggleExpanded={onToggleExpanded}
                  onSelect={onSelect}
                  onAddChild={onAddChild}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function RepoHead({
  repo,
  open,
  stats,
  onToggle,
  onAddRoot,
}: {
  repo: RepoAimsWire;
  open: boolean;
  stats: RollupStats;
  onToggle: () => void;
  onAddRoot: () => void;
}) {
  return (
    <div
      data-testid="aim-repo-head"
      data-repo={repo.repo_label}
      className={`flex items-center gap-2 border-y border-hairline bg-surface/40 px-2 py-1 ${
        repo.primary ? "shadow-[inset_2px_0_0_var(--color-info)]" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} repo ${repo.repo_label}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span aria-hidden="true" className="w-3 text-subtle-foreground">
          {open ? "▾" : "▸"}
        </span>
        <span
          className={`font-mono text-[11px] font-semibold ${
            repo.primary ? "text-info" : "text-muted-foreground"
          }`}
        >
          {repo.repo_label}
        </span>
        <span className="font-mono text-[10px] text-subtle-foreground">
          {stats.count}
          {stats.drift > 0 && <span className="text-warning"> ⚠{stats.drift}</span>}
          {stats.claimed > 0 && <span className="text-warning/80"> ◌{stats.claimed}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onAddRoot}
        title={`New root aim in ${repo.repo_label}`}
        aria-label={`New root aim in ${repo.repo_label}`}
        className="shrink-0 rounded border border-hairline px-1.5 text-[11px] text-muted-foreground transition-colors hover:border-info/40 hover:text-info"
      >
        ＋
      </button>
    </div>
  );
}

function TreeBranch({
  node,
  depth,
  repo,
  childrenOf,
  expanded,
  selected,
  onToggleExpanded,
  onSelect,
  onAddChild,
}: {
  node: AimWire;
  depth: number;
  repo: RepoAimsWire;
  childrenOf: Map<string, AimWire[]>;
  expanded: Set<string>;
  selected: string | null;
  onToggleExpanded: (key: string) => void;
  onSelect: (slug: string) => void;
  onAddChild: (repoRoot: string, parent: string) => void;
}) {
  const kids = childrenOf.get(node.slug) ?? [];
  const open = expanded.has(node.slug);
  const rollup = !open && kids.length > 0 ? subtreeStats(node.slug, childrenOf) : null;

  return (
    <>
      <AimRow
        node={node}
        depth={depth}
        selected={selected === node.slug}
        hasChildren={kids.length > 0}
        open={open}
        rollup={rollup}
        onToggle={kids.length > 0 ? () => onToggleExpanded(node.slug) : undefined}
        onSelect={() => onSelect(node.slug)}
        onAddChild={() => onAddChild(repo.repo_root, node.slug)}
      />
      {open &&
        kids.map((c) => (
          <TreeBranch
            key={c.slug}
            node={c}
            depth={depth + 1}
            repo={repo}
            childrenOf={childrenOf}
            expanded={expanded}
            selected={selected}
            onToggleExpanded={onToggleExpanded}
            onSelect={onSelect}
            onAddChild={onAddChild}
          />
        ))}
    </>
  );
}

// ── The shared row ────────────────────────────────────────────────────

function AimRow({
  node,
  depth = 0,
  selected,
  crumb,
  repoTag,
  repoPrimary,
  hasChildren = false,
  open = false,
  rollup,
  onToggle,
  onSelect,
  onAddChild,
}: {
  node: AimWire;
  depth?: number;
  selected: boolean;
  crumb?: string;
  repoTag?: string;
  repoPrimary?: boolean;
  hasChildren?: boolean;
  open?: boolean;
  rollup?: RollupStats | null;
  onToggle?: () => void;
  onSelect: () => void;
  onAddChild?: () => void;
}) {
  const tone = aimTone(node);
  const wd = workingDeltaKind(node);
  return (
    <div
      data-testid="aim-row"
      data-slug={node.slug}
      data-tone={tone}
      className={`group flex h-7 items-center gap-1.5 pr-2 ${
        selected ? "bg-surface-strong" : "hover:bg-surface/60"
      }`}
      style={{ paddingLeft: depth > 0 ? depth * 14 : undefined }}
    >
      <span
        aria-hidden="true"
        className={`h-full w-0.5 shrink-0 rounded-full ${TONE_GUTTER[tone]}`}
      />
      {/* Tree toggle (only when the node has children) sits OUTSIDE the select
          button so there is no nested-interactive markup. */}
      {hasChildren && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${open ? "Collapse" : "Expand"} ${node.slug}`}
          className="w-3 shrink-0 text-center text-[9px] text-subtle-foreground hover:text-foreground"
        >
          {open ? "▾" : "▸"}
        </button>
      ) : depth > 0 || hasChildren ? (
        <span
          aria-hidden="true"
          className="w-3 shrink-0 text-center text-[9px] text-subtle-foreground"
        >
          ·
        </span>
      ) : null}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        title={`${node.slug} · ${AIM_STATE_LABEL[node.state]}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span
          aria-hidden="true"
          className={`shrink-0 font-mono text-[11px] ${TONE_GLYPH_CLASS[tone]}`}
        >
          {TONE_GLYPH[tone]}
        </span>
        {/* Pin #2 distinct marker: a done node that ALSO drifted shows the done
            ✓ glyph AND this warning drift badge — so it never reads as plain
            done, nor as an open drift. */}
        {tone === "done-drift" && (
          <span
            data-testid="aim-drift-badge"
            aria-hidden="true"
            title="also drifted"
            className="shrink-0 font-mono text-[11px] text-warning"
          >
            ⚠
          </span>
        )}
        {/* Working-delta presence glyph (#817) — beside, never merged into,
            the drift ⚠: a node can be both drifted at HEAD and dirty in the
            working tree, and each fact keeps its own glyph. */}
        {wd !== null && (
          <span
            data-testid="aim-wd-badge"
            data-wd={wd}
            aria-hidden="true"
            title={WORKING_DELTA_FACT[wd]}
            className={`shrink-0 font-mono text-[11px] ${WD_GLYPH_CLASS[wd]}`}
          >
            {WORKING_DELTA_GLYPH}
          </span>
        )}
        <span className={`truncate text-[12px] ${TONE_OUGHT_CLASS[tone]}`}>{node.aim}</span>
        {crumb !== undefined && (
          <span className="ml-1 max-w-[34%] shrink-0 truncate font-mono text-[9px] text-subtle-foreground">
            {crumb}
          </span>
        )}
        {repoTag !== undefined && (
          <span
            className={`shrink-0 rounded border border-hairline px-1 font-mono text-[8px] ${
              repoPrimary ? "text-info" : "text-subtle-foreground"
            }`}
          >
            {repoTag}
          </span>
        )}
        {rollup && rollup.count > 0 && (
          <span
            data-testid="aim-rollup"
            className="ml-auto shrink-0 font-mono text-[9px] text-subtle-foreground"
          >
            {rollup.count}
            {rollup.drift > 0 && <span className="text-warning"> ⚠{rollup.drift}</span>}
            {rollup.claimed > 0 && <span className="text-warning/80"> ◌{rollup.claimed}</span>}
          </span>
        )}
        <InteriorDots marks={node.is} />
        <span className="shrink-0 font-mono text-[9px] text-subtle-foreground">{node.slug}</span>
      </button>
      {onAddChild && (
        <button
          type="button"
          onClick={onAddChild}
          title={`New child aim under ${node.slug}`}
          aria-label={`Add child aim under ${node.slug}`}
          className="shrink-0 rounded border border-hairline px-1 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:border-info/40 hover:text-info group-hover:opacity-100"
        >
          ＋
        </button>
      )}
    </div>
  );
}

// Tiny per-mark dots beside a row — confirmed = filled success, claimed =
// filled warning, pruned = neutral (adjudicated rejection: attention-zero,
// never owed). Mark-only: order + kind are exactly the wire's.
function InteriorDots({ marks }: { marks: readonly AimInteriorWire[] }) {
  if (marks.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {marks.map((m) => (
        // Interior lines have no id; key off the prose (mark-only — we never
        // re-order, so position is the wire's).
        <span
          key={`${m.kind}:${m.text}:${m.ref ?? ""}`}
          aria-hidden="true"
          className={`h-1 w-1 rounded-[1px] ${
            m.kind === "confirmed"
              ? "bg-success"
              : m.kind === "claimed"
                ? "bg-warning"
                : "bg-subtle-foreground/40"
          }`}
        />
      ))}
    </span>
  );
}

// ── Overview ruler ────────────────────────────────────────────────────

function OverviewRuler({
  ticks,
  onReveal,
}: {
  ticks: readonly RulerTick[];
  onReveal: (slug: string) => void;
}) {
  return (
    <div
      data-testid="aim-ruler"
      className="relative w-3.5 shrink-0 overflow-hidden border-l border-hairline bg-surface/30"
      title="Overview ruler — every node a tick, owed ones lit; click to reveal"
    >
      {ticks.map((t) => {
        const top = `${(t.pos * 100).toFixed(2)}%`;
        if (t.owed === null) {
          return (
            <span
              key={t.slug}
              data-testid="ruler-tick"
              data-slug={t.slug}
              data-owed="calm"
              aria-hidden="true"
              className="absolute right-[3px] left-[3px] h-px bg-subtle-foreground/30"
              style={{ top }}
            />
          );
        }
        const lit = t.owed === "drift" ? "bg-warning" : "bg-warning/60";
        return (
          <button
            key={t.slug}
            type="button"
            data-testid="ruler-tick"
            data-slug={t.slug}
            data-owed={t.owed}
            onClick={() => onReveal(t.slug)}
            title={`${t.owed === "drift" ? "⚠ drift" : "◌ claimed"} · ${t.repoLabel} · ${t.slug}`}
            aria-label={`Reveal ${t.slug} (${t.owed})`}
            className={`absolute right-[2px] left-[2px] rounded-[1px] ${lit} ${
              t.owed === "drift" ? "h-[3px]" : "h-[2px]"
            }`}
            style={{ top }}
          />
        );
      })}
    </div>
  );
}

// ── Inspector (replaces the old DetailPane) ───────────────────────────

function Inspector({
  unitName,
  sel,
  refresh,
  onSelect,
  onAddChild,
  onClose,
}: {
  unitName: string;
  sel: Selection;
  refresh: () => void;
  onSelect: (slug: string) => void;
  onAddChild: (parent: string) => void;
  onClose: () => void;
}) {
  const { node, bySlug, childrenOf } = sel;
  const [editing, setEditing] = useState(false);
  const chain = useMemo(() => ancestry(node.slug, bySlug), [node.slug, bySlug]);
  const parentOptions = useMemo(() => sel.repo.aims.map((n) => n.slug), [sel.repo]);
  // Forbid re-parenting onto self or any descendant (a trivial cycle).
  const forbiddenParents = useMemo(() => {
    const set = descendantsOf(node.slug, childrenOf);
    set.add(node.slug);
    return set;
  }, [node.slug, childrenOf]);

  return (
    <aside
      data-testid="aim-inspector"
      className="flex max-h-[42vh] shrink-0 flex-col overflow-y-auto border-t border-hairline bg-surface px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        {/* Ought-ancestry breadcrumb — every ancestor selectable; the node
            itself is the cyan tail. */}
        <nav className="flex min-w-0 flex-wrap items-center gap-x-1 font-mono text-[10px] text-subtle-foreground">
          {chain.map((a, i) =>
            i < chain.length - 1 ? (
              <span key={a.slug} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(a.slug)}
                  className="max-w-[14ch] truncate text-subtle-foreground hover:text-info"
                  title={a.aim}
                >
                  {a.slug}
                </button>
                <span aria-hidden="true" className="text-hairline-strong">
                  ›
                </span>
              </span>
            ) : (
              <span key={a.slug} className="text-info">
                {a.slug}
              </span>
            ),
          )}
        </nav>
        <button
          type="button"
          onClick={onClose}
          title="Close inspector"
          aria-label="Close inspector"
          className="shrink-0 rounded px-1.5 text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <p className="mt-2 text-[14px] leading-snug text-foreground">
        <span className="font-mono text-[10px] text-info">aim:</span> {node.aim}
      </p>

      <MetaPills node={node} repoLabel={sel.repo.repo_label} repoPrimary={sel.repo.primary} />

      {editing ? (
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
          <InteriorList marks={node.is} />
          <CrossEdges node={node} />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
            >
              <span aria-hidden="true">✎</span> Edit frontmatter
            </button>
            <button
              type="button"
              onClick={() => onAddChild(node.slug)}
              className="rounded border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-info/40 hover:text-info"
            >
              <span aria-hidden="true">＋</span> Add child aim
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

// The meta pill row — repo / state, plus the drift←ancestor pill when the node
// drifted (from `drift.stale_from_ancestor_slug`).
function MetaPills({
  node,
  repoLabel,
  repoPrimary,
}: {
  node: AimWire;
  repoLabel: string;
  repoPrimary: boolean;
}) {
  const wd = workingDeltaKind(node);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <span
        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
          repoPrimary ? "border-info/40 text-info" : "border-hairline text-subtle-foreground"
        }`}
      >
        repo: {repoLabel}
      </span>
      <span className="rounded border border-hairline px-1.5 py-0.5 font-mono text-[9px] text-subtle-foreground">
        state: {AIM_STATE_LABEL[node.state]}
        {node.parent === null ? " · root" : ""}
      </span>
      {node.drift !== null && <DriftPill drift={node.drift} done={node.state === "done"} />}
      {/* Working-delta fact line (#817) — presence only, beside (never inside)
          the drift pill; info tone, not the drift amber. */}
      {wd !== null && (
        <span
          data-testid="aim-wd-pill"
          data-wd={wd}
          className="rounded border border-dashed border-info/40 px-1.5 py-0.5 font-mono text-[9px] text-info"
        >
          {WORKING_DELTA_GLYPH} {WORKING_DELTA_FACT[wd]}
        </span>
      )}
    </div>
  );
}

function DriftPill({ drift, done }: { drift: AimDriftWire; done: boolean }) {
  return (
    <span
      data-testid="aim-drift-pill"
      title={`ancestor anchor moved ${drift.ancestor_change_date} (${drift.ancestor_change_sha}); this node last changed ${drift.aim_change_date}`}
      className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-mono text-[9px] text-warning"
    >
      ⚠ {done ? "done · " : ""}drift ← {drift.stale_from_ancestor_slug}
    </span>
  );
}

// The interior `is[]` list — mark-only: confirmed / claimed / pruned exactly as
// authored (order + kind off the wire), `ref` shown for confirmed (evidence)
// and pruned (rejection reason) marks.
function InteriorList({ marks }: { marks: readonly AimInteriorWire[] }) {
  return (
    <section className="mt-3">
      <h4 className="font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">
        interior — is
      </h4>
      {marks.length === 0 ? (
        <p className="mt-1 text-[11px] italic text-subtle-foreground">— a pure ought —</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {marks.map((m) => (
            // Interior lines have no id; key off the prose (mark-only — order is
            // the wire's, never re-sorted).
            <li
              key={`${m.kind}:${m.text}:${m.ref ?? ""}`}
              data-testid="aim-mark"
              data-kind={m.kind}
              className="flex items-baseline gap-2 text-[12px]"
            >
              <MarkTag kind={m.kind} />
              <span className="text-muted-foreground">
                {m.text}
                {/* `ref` carries the confirm evidence OR the pruned rejection
                    reason — same slot on the wire, same layout here. */}
                {m.kind !== "claimed" && m.ref !== null && (
                  <span className="ml-1 font-mono text-[9px] text-info">[{m.ref}]</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MarkTag({ kind }: { kind: AimInteriorKind }) {
  if (kind === "confirmed") {
    return (
      <span className="shrink-0 rounded border border-success/40 px-1 py-px font-mono text-[9px] text-success">
        ✓ confirmed
      </span>
    );
  }
  if (kind === "claimed") {
    return (
      <span className="shrink-0 rounded border border-dashed border-warning/50 px-1 py-px font-mono text-[9px] text-warning">
        ◌ claimed
      </span>
    );
  }
  // pruned — negative-calm: neutral tone, never the owed warning or the
  // success green (an adjudicated rejection is settled, not owed).
  return (
    <span className="shrink-0 rounded border border-hairline px-1 py-px font-mono text-[9px] text-subtle-foreground">
      ⊘ pruned
    </span>
  );
}

// The DAG cross-edges as slug facts (depends_on / serves / related). They are
// not drawn as edges in the row-based panel — listed here verbatim.
function CrossEdges({ node }: { node: AimWire }) {
  if (node.depends_on.length === 0 && node.serves.length === 0 && node.related.length === 0) {
    return null;
  }
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
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
  );
}

// ── Write forms (carried from Stage 2-B, integrated into the inspector) ──

// The inline frontmatter edit form: aim / parent / state ONLY. The body and the
// cross-edges are preserved server-side. Pin #3: after save we `refresh()` —
// the wire re-reports drift (the engine's parent-only verdict), and the panel
// re-renders it. There is NO client-side drift cascade here.
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
      className="mt-3 space-y-2"
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

// The create surface (root or child of an existing node), mounted in the
// inspector slot. Author `slug` / `aim` / `parent`; `state` starts `open`, the
// body starts empty, no cross-edges (the backend default). Client-side slug
// validation gives fast feedback; the backend stays authoritative.
function CreatePanel({
  unitName,
  creating,
  repos,
  refresh,
  onClose,
  onCreated,
}: {
  unitName: string;
  creating: Creating;
  repos: readonly RepoAimsWire[];
  refresh: () => void;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const repo = repos.find((r) => r.repo_root === creating.repoRoot) ?? null;
  const existingSlugs = useMemo(() => repo?.aims.map((n) => n.slug) ?? [], [repo]);

  const [slug, setSlug] = useState("");
  const [aim, setAim] = useState("");
  const [parent, setParent] = useState(creating.initialParent);
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
      className="flex max-h-[42vh] shrink-0 flex-col gap-2 overflow-y-auto border-t border-hairline bg-surface px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onCreate();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">
          ＋ New aim{" "}
          <span className="font-mono text-[10px] font-normal text-subtle-foreground">
            {creating.initialParent !== ""
              ? `child of ${creating.initialParent}`
              : `${repo?.repo_label ?? "?"} root`}
          </span>
        </h3>
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

// A stable empty set for the create form's parent select (a brand-new slug
// can't be its own ancestor). Module-level so it keeps a constant identity.
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
// `forbidden` (self + descendants, for the edit form).
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
