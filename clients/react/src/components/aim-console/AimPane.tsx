// AimPane — the aim-console's Aim (left) pane (S2). A FAITHFUL reproduction of
// the destination mock (`origin/mock/aim-ui-sample` → `assets/ui-sample.html`,
// the `.aim` section + the create-aim modal) in the aim-console's scoped
// dev-tool tokens (`.ac-*` family, `styles/aim-console.css`). Serves aim node
// `aim-project-artifact` (`tmai-core:doc/aims/aim-project-artifact.md`; the old
// `aim-ui` node was archived in the corpus rebuild, tmai-core #528).
//
// THE KEY MOVE — REUSE the logic, REPRODUCE the presentation. The entire aim
// data + owed/frontier/rollup/ledger/ruler model already exists, built against
// the REAL wire in Stage B (`r-panel/aim-tree.ts`); this pane imports it
// wholesale and only ports the mock's markup/classes. The write path is the
// same too (`api.createAim` / `api.editAim`, `hooks/useUnitAims`). So this file
// is NOT a re-implementation of the worklist algorithms — it is the
// presentation port. `RAimsSection.tsx` is the behavioural reference (refetch
// on edit, the done-drift tone, the three design pins); we do NOT import its
// markup — that speaks the existing console's Tailwind tokens, this speaks the
// dev-tool tokens.
//
// Design pins honoured (same as RAimsSection):
//   #2 done+drift distinct — a `done` node that is ALSO drifted gets the
//      `done-drift` tone (a ✓ glyph AND a ⚠ badge), surfaced in its own
//      Frontier cluster, never folded into plain owed.
//   #3 drift mirrors the engine — after a create / edit we `refresh()` and
//      render whatever drift the wire reports; there is NO client-side cascade.
//
// UI state: the Frontier/Tree mode persists in `ui-prefs` (browser-side, same
// `aimMode` key RAimsSection uses); the expanded-branch set + the search filter
// stay component-local (a persisted filter would silently hide rows next open).
//
// The slack artifact was frozen (tmai-core aim `slack.md` → state: dead,
// 2026-07-03): the producer conversation is the crystallization surface, so a
// pre-purpose fragment has no dwell time and needs no holding place. The #809
// two-face [AIM | SLACK] shell is therefore removed — `AimPane` renders the aim
// worklist (`AimFace`) as the sole face. `AimFace` stays a named export (the
// offline aim mode reuses it). Reversible: the slack aim's HISTORY carries the
// un-freeze condition.

import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useUnitAims } from "@/hooks/useUnitAims";
import { api } from "@/lib/api";
import {
  AIM_INSPECTOR_HEIGHT_DEFAULT,
  AIM_INSPECTOR_HEIGHT_MIN,
  clampAimInspectorHeight,
} from "@/lib/ui-prefs";
import { useUIPref } from "@/lib/ui-prefs-provider";
import { cn } from "@/lib/utils";
import type { AimState } from "@/types/generated/AimState";
import type { AimWire } from "@/types/generated/AimWire";
import type { RepoAimsWire } from "@/types/generated/RepoAimsWire";
import { AimBody } from "./AimBody";
import { CopyRefButton } from "./AimCopyRef";
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
import { RESIGNATION_FRONTIER, resignationInventory } from "./resignation";
import { suggestSlug, validateAimSlug } from "./slug";

// ── tone → presentation (mark-only: only the wire-derived tone drives this) ──
//
// Maps the aim-tree `AimTone` onto the mock's row class (`dr`/`cl`/`cf`/`ne`/
// `rt`/`done`/`dead`). `done-drift` reuses the `done` row tint but carries an
// extra `dd` modifier so the warning gutter + ⚠ badge surface the owed drift
// (pin #2 — it must not read as plain done).
const TONE_ROW_CLASS: Record<AimTone, string> = {
  "done-drift": "done dd",
  done: "done",
  dead: "dead",
  drift: "dr",
  todo: "cl",
  progress: "cf",
  root: "rt",
  neutral: "ne",
};

// Normalize a thrown API error into a short, operator-readable message — the
// HTTP client throws `Error` whose message carries the backend's text.
function writeErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Stable identity key for a repo group in the expanded set (root is unique per
// unit). Mirrors RAimsSection's `repoKey`.
const repoKey = (r: RepoAimsWire): string => `repo:${r.repo_root}`;

const EMPTY_FORBIDDEN: ReadonlySet<string> = new Set<string>();

// ── AimPane — the aim worklist as the sole face (slack frozen) ─────────
//
// `.ac-face` is kept as the wrapper so `AimFace`'s header(flex:none)/list(flex:1)
// layout gets the same flex-column context the #809 shell gave it.

export function AimPane({ unitName }: { unitName: string | null }) {
  return (
    <div className="ac-face">
      <AimFace unitName={unitName} />
    </div>
  );
}

// ── AIM face orchestrator ─────────────────────────────────────────────

export function AimFace({ unitName }: { unitName: string | null }) {
  const { data, loading, error, refresh } = useUnitAims(unitName);
  const repos = useMemo(() => repoForests(data), [data]);
  const allNodes = useMemo(() => flattenRepos(data), [data]);
  const ledger = useMemo(() => ledgerCounts(allNodes), [allNodes]);
  const ticks = useMemo(() => rulerOrder(repos), [repos]);

  const [mode, setMode] = useUIPref("aimMode");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => seedExpanded(repos));
  const [modal, setModal] = useState<ModalDescriptor | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Drag-resizable inspector (detail panel) height. `storedInspH` is the
  // persisted ui-pref; `dragInspH` is the live value while the top grip is
  // dragged (it overrides the stored one until pointerup commits). Mirrors the
  // footer/PR-rail drag idiom: track the pointer 1:1, commit once on release.
  const [storedInspH, setStoredInspH] = useUIPref("aimInspectorHeight");
  const [dragInspH, setDragInspH] = useState<number | null>(null);
  const inspDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const inspHeight = dragInspH ?? storedInspH ?? AIM_INSPECTOR_HEIGHT_DEFAULT;
  const onInspGripDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      inspDragRef.current = {
        startY: e.clientY,
        startH: storedInspH ?? AIM_INSPECTOR_HEIGHT_DEFAULT,
      };
      setDragInspH(inspDragRef.current.startH);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [storedInspH],
  );
  const onInspGripMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = inspDragRef.current;
    if (d === null) return;
    // Drag UP (clientY decreases) grows the inspector upward into the worklist.
    setDragInspH(clampAimInspectorHeight(d.startH + (d.startY - e.clientY)));
  }, []);
  const onInspGripUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = inspDragRef.current;
      if (d === null) return;
      inspDragRef.current = null;
      setStoredInspH(clampAimInspectorHeight(d.startH + (d.startY - e.clientY)));
      setDragInspH(null);
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [setStoredInspH],
  );

  const seededRef = useRef(false);
  const prevUnitRef = useRef(unitName);

  // A unit change invalidates the per-unit view state: the previous unit's
  // selection / open modal / filter are meaningless against the NEW forest, and
  // the expand set must re-seed to the new unit's roots. Reset them and re-arm
  // the seed gate, so the seed effect below re-seeds once the new forest lands.
  // (`useUnitAims` clears + refetches the forest on the same `unitName` change.)
  // Runs only on an actual change — mount keeps the lazy-init / first-fetch path.
  useEffect(() => {
    if (prevUnitRef.current === unitName) return;
    prevUnitRef.current = unitName;
    seededRef.current = false;
    setSelected(null);
    setModal(null);
    setQuery("");
  }, [unitName]);

  // Seed the branch-expansion set once the forest first arrives — the lazy
  // init above ran against an empty forest while the first fetch was in flight.
  // Guarded so an operator's later collapse/expand survives the 60s poll; the
  // gate is re-armed on a unit change (effect above).
  useEffect(() => {
    if (!seededRef.current && repos.length > 0) {
      seededRef.current = true;
      setExpanded(seedExpanded(repos));
    }
  }, [repos]);

  const sel = useMemo(() => resolveSelection(selected, repos), [selected, repos]);
  const primaryRepo = repos.find((r) => r.primary) ?? repos[0] ?? null;

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const select = useCallback((slug: string) => {
    setModal(null);
    setSelected(slug);
  }, []);

  // Reveal a node in Tree mode: open its repo group + every ancestor, switch to
  // Tree, select it. When the slug is not yet in the loaded forest (a just-
  // created node, before the refetch lands) we still switch + select; the
  // selection resolves once the refreshed wire arrives.
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

  const openCreate = useCallback((repoRoot: string, parent: string) => {
    setSelected(null);
    setModal({ mode: "create", repoRoot, parent });
  }, []);

  const openEdit = useCallback((slug: string) => {
    setModal({ mode: "edit", slug });
  }, []);

  // Scroll the freshly-selected row into view (centered) — reproduces the
  // mock's reveal scroll. The slug is a validated kebab identity (`[a-z0-9-]`),
  // so it needs no attribute-selector escaping. Guarded for jsdom, where
  // scrollIntoView is absent.
  useEffect(() => {
    if (selected === null) return;
    const el = listRef.current?.querySelector(`[data-slug="${selected}"]`);
    if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center" });
    }
  }, [selected]);

  let listContent: ReactNode;
  if (unitName === null) {
    listContent = <div className="ac-hint">プロジェクトを選択すると aim が表示されます。</div>;
  } else if (error !== null) {
    listContent = <div className="ac-hint">aims の読み込みに失敗: {error.message}</div>;
  } else if (loading && allNodes.length === 0) {
    listContent = <div className="ac-hint">Loading…</div>;
  } else if (mode === "tree") {
    listContent = (
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
    );
  } else {
    listContent = (
      <FrontierList
        repos={repos}
        query={query}
        selected={sel?.node.slug ?? null}
        onSelect={select}
      />
    );
  }

  return (
    <>
      <div className="ac-ahead">
        <div className="ac-arow1">
          <h1>Aim</h1>
          <span className="ac-scale">
            {allNodes.length} aims · {repos.length} repo{repos.length === 1 ? "" : "s"} (per-repo)
          </span>
          <span
            className="ac-premise"
            title="The owed frontier is the panel's premise — not a full-tree dump"
          >
            AIM-PREMISE
          </span>
        </div>

        <Ledger counts={ledger} onOwedClick={() => setMode("frontier")} />

        <div className="ac-actl">
          <div className="ac-seg">
            <button
              type="button"
              className={cn("ac-seg-btn", mode === "frontier" && "on owed")}
              aria-pressed={mode === "frontier"}
              onClick={() => setMode("frontier")}
            >
              Frontier ⚠
            </button>
            <button
              type="button"
              className={cn("ac-seg-btn", mode === "tree" && "on")}
              aria-pressed={mode === "tree"}
              onClick={() => setMode("tree")}
            >
              Tree
            </button>
          </div>
          <div className="ac-search">
            <span aria-hidden="true" className="ac-search-i">
              ⌕
            </span>
            <input
              aria-label="Filter aims"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="slug / ought を filter…"
            />
            <span className="k" aria-hidden="true">
              /
            </span>
          </div>
          <button
            type="button"
            className="ac-newbtn"
            disabled={primaryRepo === null}
            onClick={() => primaryRepo && openCreate(primaryRepo.repo_root, "")}
            title="新規 aim（root / 既存の子）"
            aria-label="New aim"
          >
            ＋ aim
          </button>
        </div>
      </div>

      <div className="ac-alist-wrap">
        <div className="ac-alist" ref={listRef}>
          {listContent}
        </div>
        <OverviewRuler ticks={ticks} onReveal={reveal} />
      </div>

      <div
        className={cn("ac-insp", sel !== null && "on", dragInspH !== null && "dragging")}
        style={{ "--ac-insp-h": `${inspHeight}px` } as CSSProperties}
      >
        {sel !== null && (
          // biome-ignore lint/a11y/useSemanticElements: a div is the draggable splitter (Gutters precedent)
          <div
            className={cn("ac-insp-grip", dragInspH !== null && "active")}
            role="separator"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label="詳細パネルの高さを調整"
            aria-valuenow={Math.round(inspHeight)}
            aria-valuemin={AIM_INSPECTOR_HEIGHT_MIN}
            title="ドラッグで詳細パネルの高さを調整"
            onPointerDown={onInspGripDown}
            onPointerMove={onInspGripMove}
            onPointerUp={onInspGripUp}
          />
        )}
        {sel !== null && (
          <Inspector
            key={sel.node.slug}
            sel={sel}
            onSelectAncestor={select}
            onEdit={() => openEdit(sel.node.slug)}
            onAddChild={(parent) => openCreate(sel.repo.repo_root, parent)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {modal !== null && unitName !== null && (
        <CreateEditModal
          descriptor={modal}
          repos={repos}
          unitName={unitName}
          refresh={refresh}
          onClose={() => setModal(null)}
          onDone={(slug) => {
            setModal(null);
            reveal(slug);
          }}
        />
      )}
    </>
  );
}

// ── selection / expansion helpers (local; aim-tree does the real work) ──

// A resolved selection: the node + its repo + the repo's index structures, so
// the inspector / reveal / modal walk ancestry + forbid cycles without
// re-deriving them. Mirrors RAimsSection's `Selection`.
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
      return { node, repo, bySlug: bySlugMap(repo.aims), childrenOf: buildChildren(repo.aims) };
    }
  }
  return null;
}

// Default branch-expansion: FULLY EXPANDED — every repo group + every node.
// Tree is the opt-in structure view (the operator deliberately switches to it
// FROM the Frontier premise to see the shape), so it opens fully; a roots-only
// default would defeat the reason for choosing Tree. Frontier stays the
// attention-economical default view; the data scan + the aim-tree compute are
// identical either way, so this is purely a render-side default the operator
// can still collapse per-branch (the rollup badges return on manual collapse).
function seedExpanded(repos: readonly RepoAimsWire[]): Set<string> {
  const s = new Set<string>();
  for (const r of repos) {
    s.add(repoKey(r));
    for (const node of r.aims) s.add(node.slug);
  }
  return s;
}

// Depth of a node (root = 0), for the modal's parent-select indentation.
function depthOf(slug: string, bySlug: ReadonlyMap<string, AimWire>): number {
  return Math.max(0, ancestry(slug, bySlug).length - 1);
}

// ── ledger strip ──────────────────────────────────────────────────────

function Ledger({ counts, onOwedClick }: { counts: LedgerCounts; onOwedClick: () => void }) {
  const owed = counts.drift + counts.todo;
  const total = owed + counts.done || 1;
  return (
    <div className="ac-ledger" data-testid="aim-ledger">
      <button type="button" className="ac-lg dr" onClick={onOwedClick}>
        <span className="sw" aria-hidden="true" />
        <b>{counts.drift}</b> drift
      </button>
      <button type="button" className="ac-lg cl" onClick={onOwedClick}>
        <span className="sw" aria-hidden="true" />
        <b>{counts.todo}</b> todo
      </button>
      <span className="ac-lg cf">
        <span className="sw" aria-hidden="true" />
        <b>{counts.done}</b> done
      </span>
      <span className="ac-lbar" aria-hidden="true">
        <span className="o" style={{ width: `${(100 * owed) / total}%` }} />
        <span className="c" style={{ width: `${(100 * counts.done) / total}%` }} />
      </span>
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
      <div className="ac-hint">
        {q === "" ? "owed なし — 盤面は calm。" : "owed に filter 一致なし。"}
      </div>
    );
  }

  return (
    <>
      {sections.map(({ repo, bySlug, owed, doneDrift }) => {
        const driftN = owed.filter((n) => aimTone(n) === "drift").length;
        const todoN = owed.length - driftN;
        return (
          <div key={repo.repo_root}>
            <RepoBanner repo={repo} drift={driftN} todo={todoN} />
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
                <div className="ac-ghead calm">
                  <span className="c">done · drifted — 再確認?</span>
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
    </>
  );
}

// A non-collapsible repo banner used in Frontier sections (the repo is context,
// not a toggle, here). Primary repo gets the cyan accent.
function RepoBanner({ repo, drift, todo }: { repo: RepoAimsWire; drift: number; todo: number }) {
  return (
    <div className={cn("ac-repohead", "frontier", repo.primary && "pri")}>
      <span className="ac-rh-name">{repo.repo_label}</span>
      <span className="ac-rh-stat">
        {drift > 0 && <span className="w">⚠{drift} </span>}
        {todo > 0 && <span className="k">◌{todo}</span>}
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
    if (hits.length === 0) return <div className="ac-hint">一致なし</div>;
    return (
      <>
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
      </>
    );
  }

  return (
    <>
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
    </>
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
      className={cn("ac-repohead", repo.primary && "pri")}
    >
      <button
        type="button"
        className="ac-repohead-main"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} repo ${repo.repo_label}`}
      >
        <span className="ac-rh-tw" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="ac-rh-name">{repo.repo_label}</span>
        <span className="ac-rh-stat">
          {stats.count}
          {stats.drift > 0 && <span className="w"> ⚠{stats.drift}</span>}
          {stats.todo > 0 && <span className="k"> ◌{stats.todo}</span>}
        </span>
      </button>
      <button
        type="button"
        className="ac-addbtn"
        onClick={onAddRoot}
        title={`${repo.repo_label} に root aim を作成`}
        aria-label={`New root aim in ${repo.repo_label}`}
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
        treeRow
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

// ── the shared row ────────────────────────────────────────────────────

function AimRow({
  node,
  depth = 0,
  treeRow = false,
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
  treeRow?: boolean;
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
      className={cn("ac-r", TONE_ROW_CLASS[tone], selected && "sel")}
      style={depth > 0 ? { paddingLeft: 12 + depth * 15 } : undefined}
    >
      <span className="ac-gut" aria-hidden="true" />
      {/* Tree toggle (children) / spacer (leaf), OUTSIDE the select button so
          there is no nested-interactive markup. Frontier rows omit it. */}
      {treeRow ? (
        hasChildren && onToggle ? (
          <button
            type="button"
            className="ac-tx has"
            onClick={onToggle}
            aria-label={`${open ? "Collapse" : "Expand"} ${node.slug}`}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="ac-tx" aria-hidden="true">
            ·
          </span>
        )
      ) : null}
      <button
        type="button"
        className="ac-r-main"
        onClick={onSelect}
        aria-pressed={selected}
        title={`${node.slug} · ${AIM_STATE_LABEL[node.state]}`}
      >
        <ToneGlyph tone={tone} />
        {wd !== null && <WorkingDeltaGlyph kind={wd} />}
        <span className="ac-ought">{node.aim}</span>
        {crumb !== undefined && <span className="ac-crumb-i">{crumb}</span>}
        {repoTag !== undefined && (
          <span className={cn("ac-repo", repoPrimary && "pri")}>{repoTag}</span>
        )}
        {rollup && rollup.count > 0 && (
          <span className="ac-roll" data-testid="aim-rollup">
            {rollup.count}
            {rollup.drift > 0 && <span className="w"> ⚠{rollup.drift}</span>}
            {rollup.todo > 0 && <span className="k"> ◌{rollup.todo}</span>}
          </span>
        )}
        <span className="ac-slug">{node.slug}</span>
      </button>
      {onAddChild && (
        <button
          type="button"
          className="ac-addbtn row"
          onClick={onAddChild}
          title={`${node.slug} に子 aim を作成`}
          aria-label={`Add child aim under ${node.slug}`}
        >
          ＋
        </button>
      )}
    </div>
  );
}

// Glyph + (for done-drift) the distinct drift badge. Mirrors the mock's `gly()`
// plus pin #2's done+drift surfacing.
function ToneGlyph({ tone }: { tone: AimTone }) {
  switch (tone) {
    case "done-drift":
      return (
        <>
          <span className="ac-gly dn" aria-hidden="true">
            ✓
          </span>
          <span
            className="ac-gly dr"
            data-testid="aim-drift-badge"
            title="also drifted"
            aria-hidden="true"
          >
            ⚠
          </span>
        </>
      );
    case "done":
      return (
        <span className="ac-gly dn" aria-hidden="true">
          ✓
        </span>
      );
    case "dead":
      return (
        <span className="ac-gly dd" aria-hidden="true">
          ✕
        </span>
      );
    case "drift":
      return (
        <span className="ac-gly dr" aria-hidden="true">
          ⚠
        </span>
      );
    case "todo":
      return (
        <span className="ac-gly cl" aria-hidden="true">
          ◌
        </span>
      );
    default:
      return <span className="ac-gly" aria-hidden="true" />;
  }
}

// Working-delta presence glyph (#817) — a SEPARATE glyph from the drift ⚠;
// the two may coexist on one row (drifted at HEAD AND dirty in the working
// tree). Neutral-to-info tone, never the warning family: presence is a fact
// about the instrument, not owed work. `an` = the uncommitted `aim:`-anchor
// edit (info accent — the anchor on screen is not the anchor in HEAD), `nw` =
// an untracked new node (dotted "new" reading).
const WD_GLYPH_CLASS: Record<WorkingDeltaKind, string> = {
  uncommitted: "",
  "uncommitted-anchor": "an",
  untracked: "nw",
};

function WorkingDeltaGlyph({ kind }: { kind: WorkingDeltaKind }) {
  return (
    <span
      className={cn("ac-wd", WD_GLYPH_CLASS[kind])}
      data-testid="aim-wd-badge"
      data-wd={kind}
      title={WORKING_DELTA_FACT[kind]}
      aria-hidden="true"
    >
      {WORKING_DELTA_GLYPH}
    </span>
  );
}

// ── overview ruler ────────────────────────────────────────────────────

function OverviewRuler({
  ticks,
  onReveal,
}: {
  ticks: readonly RulerTick[];
  onReveal: (slug: string) => void;
}) {
  return (
    <div
      className="ac-ruler"
      data-testid="aim-ruler"
      title="overview ruler — every node a tick, owed ones lit; click to reveal"
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
              className="ac-tick"
              style={{ top }}
            />
          );
        }
        return (
          <button
            key={t.slug}
            type="button"
            data-testid="ruler-tick"
            data-slug={t.slug}
            data-owed={t.owed}
            onClick={() => onReveal(t.slug)}
            title={`${t.owed === "drift" ? "⚠ drift" : "◌ todo"} · ${t.repoLabel} · ${t.slug}`}
            aria-label={`Reveal ${t.slug} (${t.owed})`}
            className={cn("ac-tick", t.owed === "drift" ? "dr" : "cl")}
            style={{ top }}
          />
        );
      })}
      {/* repo-boundary dividers (a separate pass — same visual as inline) */}
      {ticks
        .filter((t) => t.repoBoundary)
        .map((t) => (
          <span
            key={`rdiv-${t.slug}`}
            className="ac-rdiv"
            aria-hidden="true"
            style={{ top: `${(t.pos * 100).toFixed(2)}%` }}
          />
        ))}
    </div>
  );
}

// ── inspector ─────────────────────────────────────────────────────────

function Inspector({
  sel,
  onSelectAncestor,
  onEdit,
  onAddChild,
  onClose,
}: {
  sel: Selection;
  onSelectAncestor: (slug: string) => void;
  onEdit: () => void;
  onAddChild: (parent: string) => void;
  onClose: () => void;
}) {
  const { node, repo, bySlug } = sel;
  const chain = useMemo(() => ancestry(node.slug, bySlug), [node.slug, bySlug]);
  const wd = workingDeltaKind(node);

  return (
    <div className="ac-insp-in" data-testid="aim-inspector">
      <button
        type="button"
        className="ac-insp-x"
        onClick={onClose}
        aria-label="Close inspector"
        title="閉じる"
      >
        ✕
      </button>

      {/* Sticky close ✕ above; everything below scrolls so a long body never
          scrolls the close affordance out of reach. */}
      <div className="ac-insp-scroll" data-testid="aim-inspector-scroll">
        {/* Ought-ancestry breadcrumb — every ancestor selectable; the node itself
          is the cyan tail. */}
        <nav className="ac-icrumb">
          {chain.map((a, i) =>
            i < chain.length - 1 ? (
              <span key={a.slug} className="ac-icrumb-item">
                <button
                  type="button"
                  className="ac-icrumb-link"
                  onClick={() => onSelectAncestor(a.slug)}
                  title={a.aim}
                >
                  {a.aim.slice(0, 18)}…
                </button>
                <span className="s" aria-hidden="true">
                  ›
                </span>
              </span>
            ) : (
              <span key={a.slug} className="ac-icrumb-cur">
                {a.slug}
                {/* Cite this aim node to the Producer: the bare `[[slug]]`
                    wikilink, copied for hand-off (aim: operator-cites-aim). */}
                <CopyRefButton
                  text={`[[${a.slug}]]`}
                  variant="console"
                  label={`copy [[${a.slug}]] reference`}
                  testId="aim-copy-slug"
                />
              </span>
            ),
          )}
        </nav>

        <div className="ac-iought">
          <b>aim:</b> {node.aim}
        </div>

        <div className="ac-imeta">
          <span className={cn("ac-pill", repo.primary && "op")}>repo: {repo.repo_label}</span>
          <span className="ac-pill op" data-testid="aim-state-pill">
            state: {AIM_STATE_LABEL[node.state]}
            {node.parent === null ? " · root" : ""}
          </span>
          {node.drift !== null && (
            <span
              className="ac-pill dr"
              data-testid="aim-drift-pill"
              title={`ancestor anchor moved ${node.drift.ancestor_change_date} (${node.drift.ancestor_change_sha}); this node last changed ${node.drift.aim_change_date}`}
            >
              ⚠ {node.state === "done" ? "done · " : ""}drift ← 祖先{" "}
              {node.drift.stale_from_ancestor_slug}
            </span>
          )}
          {/* Working-delta fact line (#817) — presence only, beside (never inside)
            the drift pill: a node can be both drifted at HEAD and dirty in the
            working tree, and the two facts stay separately stated. */}
          {wd !== null && (
            <span className="ac-pill wd" data-testid="aim-wd-pill" data-wd={wd}>
              {WORKING_DELTA_GLYPH} {WORKING_DELTA_FACT[wd]}
            </span>
          )}
        </div>

        <AimBody
          body={node.body}
          slug={node.slug}
          variant="console"
          resolves={(slug) => bySlug.has(slug)}
          onNavigate={onSelectAncestor}
        />

        {/* Resignation inventory (#811) — done is reversible attention-parking,
          so on an already-done node the parked objects stay visible, quietly.
          Read-only context for the (reversible) state edit — never a gate. */}
        {node.state === "done" && (
          <ResignationInventoryView
            title="resignation inventory — この done が駐車したもの"
            node={node}
            nodes={repo.aims}
          />
        )}

        <div className="ac-insp-actions">
          <button type="button" className="ac-btn small" onClick={onEdit}>
            ✎ 編集
          </button>{" "}
          <button type="button" className="ac-btn small" onClick={() => onAddChild(node.slug)}>
            ＋ 子 aim を作成
          </button>
        </div>
      </div>
    </div>
  );
}

// ── resignation inventory (#811) ──────────────────────────────────────
//
// Renders the `resignationInventory` facts beside the done act: 満足 = the
// node's own `[done]` (実装済) PROCESS items; 諦め = its `[todo]` (未実装)
// PROCESS items (named but not reached, parked not settled) + descendants
// still open. Categorical tones only — the existing done/todo tag tokens and
// the open/drift glyph conventions; no severity ramp, no warning framing, no
// gate. The frontier line is CONSTANT and unconditional — the unwritten
// remainder exists whether the enumerable buckets are full or empty.
function ResignationInventoryView({
  title,
  node,
  nodes,
}: {
  title: string;
  node: AimWire;
  nodes: readonly AimWire[];
}) {
  const inv = useMemo(() => resignationInventory(node, nodes), [node, nodes]);
  return (
    <div className="ac-resig" data-testid="resignation-inventory">
      <div className="ac-isec">{title}</div>

      <div className="ac-resig-cap">満足 — 実装済</div>
      {inv.satisfied.length === 0 ? (
        <div className="ac-il dim">— 実装済 PROCESS なし —</div>
      ) : (
        // PROCESS items have no id; key off content (text + detail), the
        // composite the legacy mark list used — distinct lines stay distinct.
        inv.satisfied.map((m) => (
          <div className="ac-il" key={`done:${m.text}:${m.detail}`} data-testid="resig-satisfied">
            <span className="ac-tg c">✓ 実装済</span>
            <span>{m.text}</span>
          </div>
        ))
      )}

      <div className="ac-resig-cap">諦め — 駐車されるもの</div>
      {inv.parkedTodos.length === 0 && inv.parkedOpenDescendants.length === 0 ? (
        <div className="ac-il dim">— 列挙できる駐車対象なし —</div>
      ) : (
        <>
          {inv.parkedTodos.map((m) => (
            <div
              className="ac-il"
              key={`todo:${m.text}:${m.detail}`}
              data-testid="resig-parked-todo"
            >
              <span className="ac-tg k">◌ 未実装</span>
              <span>{m.text}（未実装のまま駐車）</span>
            </div>
          ))}
          {inv.parkedOpenDescendants.map((d) => (
            <div className="ac-il" key={d.slug} data-testid="resig-open-desc" data-slug={d.slug}>
              <span className="ac-tg o">○ open</span>
              <span>
                {d.aim} <span className="ac-resig-slug">{d.slug}</span>
                {/* A drifted descendant is still open+drifted — its drift rides
                    along with the existing ⚠ convention, untouched. */}
                {d.drift !== null && (
                  <span
                    className="ac-resig-dr"
                    data-testid="resig-drift-badge"
                    title={`ancestor anchor moved ${d.drift.ancestor_change_date} (${d.drift.ancestor_change_sha})`}
                  >
                    {" "}
                    ⚠ drift ← {d.drift.stale_from_ancestor_slug}
                  </span>
                )}
              </span>
            </div>
          ))}
        </>
      )}

      <div className="ac-resig-frontier" data-testid="resig-frontier">
        {RESIGNATION_FRONTIER}
      </div>
    </div>
  );
}

// ── create / edit modal ───────────────────────────────────────────────

// What the modal is doing: a CREATE (root in `repoRoot`, optionally under
// `parent`) or an EDIT of an existing node by `slug`. The mock's single modal
// doubles for both (edit shows the `state` select, freezes repo + slug).
type ModalDescriptor =
  | { mode: "create"; repoRoot: string; parent: string }
  | { mode: "edit"; slug: string };

function CreateEditModal({
  descriptor,
  repos,
  unitName,
  refresh,
  onClose,
  onDone,
}: {
  descriptor: ModalDescriptor;
  repos: readonly RepoAimsWire[];
  unitName: string;
  refresh: () => void;
  onClose: () => void;
  onDone: (slug: string) => void;
}) {
  const isEdit = descriptor.mode === "edit";
  const editSel = isEdit ? resolveSelection(descriptor.slug, repos) : null;

  const [repoRoot, setRepoRoot] = useState(
    isEdit ? (editSel?.repo.repo_root ?? "") : descriptor.repoRoot,
  );
  const repo = repos.find((r) => r.repo_root === repoRoot) ?? null;
  const existingSlugs = useMemo(() => new Set(repo?.aims.map((n) => n.slug) ?? []), [repo]);
  const bySlug = useMemo(() => bySlugMap(repo?.aims ?? []), [repo]);
  const childrenOf = useMemo(() => buildChildren(repo?.aims ?? []), [repo]);

  const [aim, setAim] = useState(isEdit ? (editSel?.node.aim ?? "") : "");
  const [slug, setSlug] = useState(isEdit ? descriptor.slug : "");
  // Edit: slug is frozen, so the auto-suggest never fires.
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [parent, setParent] = useState(isEdit ? (editSel?.node.parent ?? "") : descriptor.parent);
  const [state, setState] = useState<AimState>(isEdit ? (editSel?.node.state ?? "open") : "open");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit: forbid re-parenting onto self or any descendant (a trivial cycle).
  const forbidden = useMemo(() => {
    if (!isEdit || editSel === null) return EMPTY_FORBIDDEN;
    const set = descendantsOf(editSel.node.slug, childrenOf);
    set.add(editSel.node.slug);
    return set;
  }, [isEdit, editSel, childrenOf]);

  // Esc dismisses the modal (document-level so it fires regardless of focus).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const trimmedAim = aim.trim();
  const trimmedSlug = slug.trim();
  const slugShapeError = validateAimSlug(trimmedSlug);
  const duplicate = !isEdit && existingSlugs.has(trimmedSlug);

  const slugMsg = isEdit
    ? "(slug は不変)"
    : (slugShapeError ?? (duplicate ? "slug 重複" : trimmedSlug !== "" ? "✓ ok" : ""));
  const slugMsgKind = isEdit
    ? ""
    : slugShapeError !== null || duplicate
      ? "err"
      : trimmedSlug !== ""
        ? "ok"
        : "";

  const canSubmit = isEdit
    ? trimmedAim !== "" && !submitting
    : trimmedAim !== "" &&
      trimmedSlug !== "" &&
      slugShapeError === null &&
      !duplicate &&
      !submitting;

  function onAimChange(next: string) {
    setAim(next);
    // Auto-derive the slug from the aim until the operator types one (create).
    if (!isEdit && !slugTouched) setSlug(suggestSlug(next, existingSlugs));
  }

  function onRepoChange(nextRoot: string) {
    setRepoRoot(nextRoot);
    setParent("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await api.editAim(unitName, descriptor.slug, {
          aim: trimmedAim,
          parent: parent === "" ? null : parent,
          state,
        });
        refresh();
        onDone(descriptor.slug);
      } else {
        const created = await api.createAim(unitName, {
          slug: trimmedSlug,
          aim: trimmedAim,
          parent: parent === "" ? null : parent,
        });
        refresh();
        onDone(created.slug);
      }
    } catch (err) {
      setError(writeErrorMessage(err));
      setSubmitting(false);
    }
  }

  const title = isEdit ? "aim を編集" : "新規 aim";
  const ctx = parent
    ? `— child of ${parent}（${repo?.repo_label ?? "?"}）`
    : `— ${repo?.repo_label ?? "?"} の root`;
  const submitLabel = submitting ? (isEdit ? "保存中…" : "作成中…") : isEdit ? "保存" : "作成";

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap-to-close; Esc handles the keyboard path.
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a dismiss target, not a control.
    <div
      className="ac-modal-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ac-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="aim-create-modal"
      >
        <form onSubmit={onSubmit}>
          <h3>
            {title} <span className="ctx">{ctx}</span>
          </h3>
          <div className="ac-modal-body">
            <div className="ac-fld">
              <label htmlFor="ac-m-aim">
                aim — 人間が書く1文の ought <span className="req">*</span>
              </label>
              <textarea
                id="ac-m-aim"
                value={aim}
                onChange={(e) => onAimChange(e.target.value)}
                placeholder="その高度の不可分な選択(bearing)を1文で…"
              />
              <div className="ac-hint2">
                body(is)は Producer が後で filing。ここは operator の bearing のみ。
              </div>
            </div>

            <div className="ac-frow">
              <div className="ac-fld ac-fld-repo">
                <label htmlFor="ac-m-repo">repo</label>
                <select
                  id="ac-m-repo"
                  value={repoRoot}
                  disabled={isEdit}
                  onChange={(e) => onRepoChange(e.target.value)}
                >
                  {isEdit ? (
                    <option value={repoRoot}>{repo?.repo_label ?? repoRoot}</option>
                  ) : (
                    repos.map((r) => (
                      <option key={r.repo_root} value={r.repo_root}>
                        {r.repo_label}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="ac-fld ac-fld-parent">
                <label htmlFor="ac-m-parent">parent</label>
                <select id="ac-m-parent" value={parent} onChange={(e) => setParent(e.target.value)}>
                  <option value="">（root — {repo?.repo_label ?? "?"} の最上位）</option>
                  {(repo?.aims ?? [])
                    .filter((n) => !forbidden.has(n.slug))
                    .map((n) => (
                      <option key={n.slug} value={n.slug}>
                        {`${"· ".repeat(depthOf(n.slug, bySlug))}${n.aim.slice(0, 32)}`}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="ac-fld">
              <label htmlFor="ac-m-slug">slug — 安定 identity（日付なし kebab）</label>
              <div className="ac-slugrow">
                <input
                  id="ac-m-slug"
                  value={slug}
                  disabled={isEdit}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugTouched(true);
                  }}
                  placeholder="例: attention-icon-row"
                />
                <span className={cn("ac-hint2", slugMsgKind)}>{slugMsg}</span>
              </div>
              <div className="ac-hint2">
                Producer が aim から派生 → operator が確認/訂正。rename=identity
                死なので誕生時のみ。
              </div>
            </div>

            {isEdit && (
              <div className="ac-fld">
                <label htmlFor="ac-m-state">state</label>
                <select
                  id="ac-m-state"
                  value={state}
                  onChange={(e) => setState(e.target.value as AimState)}
                >
                  <option value="open">open — 未解決（作業中 / owed）</option>
                  <option value="done">done — 解決（aim 到達 / confirmed）</option>
                  <option value="dead">dead — 放棄（self-death・系譜は残す・親無傷）</option>
                </select>
                {/* Resignation inventory at done-set (#811): when the operator
                    is putting this node TO done, show what this done will park
                    — inline, beside the state control, BEFORE the commit.
                    Strictly non-blocking: it never disables submit, never asks
                    "are you sure" — facts beside the act, not a gate. */}
                {state === "done" && editSel !== null && (
                  <ResignationInventoryView
                    title="resignation inventory — この done が駐車するもの"
                    node={editSel.node}
                    nodes={editSel.repo.aims}
                  />
                )}
              </div>
            )}

            {error !== null && (
              <p role="alert" className="ac-hint2 err">
                {error}
              </p>
            )}
          </div>
          <div className="ac-modal-foot">
            <button type="button" className="ac-btn" onClick={onClose}>
              cancel
            </button>
            <button type="submit" className="ac-btn primary" disabled={!canSubmit}>
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
