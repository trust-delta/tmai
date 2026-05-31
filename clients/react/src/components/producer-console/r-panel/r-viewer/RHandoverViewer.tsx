// R₂ — the in-tmai Hand-over baton viewer (per-unit, read-only). Serves
// the spine `2026-05-29-c-and-r-as-the-development-substrate` (the per-kind
// walk's "📜 Hand-over" surface) + `2026-05-29-artifact-content-viewer`
// (γ-lean R₂ viewer). Realizes the operator-side half of tmai-core PR
// #473's handoffs endpoint.
//
// Mirrors `RPrViewer` / `RRecordViewer` / `RIssueViewer` /
// `RCalibrationViewer` posture exactly: in focus mode it RIDES the R
// panel's single column IN PLACE OF the R₁ inventory — same drag-set
// width, never an additive column that would squeeze the centre
// conversation. It NEVER auto-opens — it mounts only on an explicit
// operator row click in the R₁ Hand-over inventory (the parent gates the
// mount on a non-null `selectedHandoff`). R₁ (`RHandoverSection`) stays a
// pure baton inventory; this viewer renders the clicked baton's full
// content.
//
// The content endpoint returns ONLY `{ unit, name, content }` (the raw
// baton markdown, frontmatter + body verbatim). So the header's
// active/archived marker is derived from the baton name — the active
// baton's sentinel name is exactly `"active"`, every archived baton is a
// timestamp filename — and `composed_at` / `task` are parsed from the
// baton's leading YAML frontmatter (the same fields the backend's
// `HandoffEntryWire` derives server-side; re-parsed here because the
// selection carries only `{ unit, name }` and the content hook returns no
// metadata).
//
// SCOPE — read-only, NO actions. `[restore-as-active]` and a
// `[→Producer brief]` button need endpoints that do NOT exist server-side
// and are explicitly deferred — the viewer mutates nothing. `diff vs
// previous baton` (the spine's transition-trace enrich) is also deferred;
// this increment is the baton list (R₁) + baton content + meta (R₂).
//
// Negative space (the serving `2026-05-26-tmai-states-facts-not-appraisals`
// posture — tmai states facts, never appraises):
//   - ALL facts stay PLAIN — `text-foreground` / `text-muted-foreground` /
//     `text-subtle-foreground` only, never warning / destructive / success
//     accents. A baton's active/archived status is a fact (where it lives),
//     not an appraisal;
//   - NO "changed since you last looked" / unread / TL;DR / auto-summary —
//     only what the wire carries is rendered;
//   - the ONE allowed convention is standard markdown rendering of the
//     baton body (via the shared `PROSE_CLASSES`), same as the other R₂
//     viewers.

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useHandoffContent } from "@/hooks/useHandoffs";
import { InventoryBackButton } from "./InventoryBackButton";
import { PROSE_CLASSES } from "./prose";

// What R₁ hands R₂ on a baton row click. The selection carries only the
// unit + baton name (the `{name}` the content endpoint keys on); the
// header's status/meta are derived from the name + the fetched content's
// frontmatter, so no `HandoffEntryWire` rides along (the asymmetry with
// `SelectedPr` / `SelectedIssue`, which carry a full ride-along item, is
// intentional — see the file header).
export interface SelectedHandoff {
  unit: string;
  name: string;
}

// Symmetry helper with `selectedPrKey` / `selectedIssueKey` /
// `selectedCalibrationKey`: `(unit, name)` is the focus key (a unit has
// many batons, each uniquely named), so the R₁ row marks itself when this
// equals its own key.
export function selectedHandoffKey(unit: string, name: string): string {
  return `${unit}/${name}`;
}

// The active baton's sentinel name is exactly `"active"`; every archived
// baton is a timestamp filename. So "is this the active baton?" is a pure
// name check — no extra wire field needed (matches the backend's
// `HandoffEntryWire.status` semantics: where the baton lives, not its
// consumption lifecycle).
function isActive(name: string): boolean {
  return name === "active";
}

interface BatonMeta {
  composedAt: string | null;
  task: string | null;
}

// Parse `composed-at` / `task` from a baton's leading YAML frontmatter.
//
// WHY here: the content endpoint returns the raw baton markdown only, and
// the selection carries just `{ unit, name }` — so the header re-derives
// these two facts the backend's `HandoffEntryWire` already parses. Either
// is null when the frontmatter is absent or omits that field (an
// unparseable / frontmatter-less archived baton still renders, bare). This
// is a deliberately minimal parser (the two scalar keys the header shows),
// NOT a general YAML reader; the full baton is rendered verbatim below.
function parseBatonMeta(content: string): BatonMeta {
  const meta: BatonMeta = { composedAt: null, task: null };
  // Frontmatter must be the very first thing in the file: a `---` line,
  // then key/value lines, then a closing `---` line.
  const lines = content.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") return meta;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break; // end of frontmatter block
    const sep = lines[i].indexOf(":");
    if (sep === -1) continue;
    const key = lines[i].slice(0, sep).trim();
    // Strip surrounding single/double quotes from the scalar value.
    const value = lines[i]
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key === "composed-at" && value !== "") meta.composedAt = value;
    else if (key === "task" && value !== "") meta.task = value;
  }
  return meta;
}

interface RHandoverViewerProps {
  selected: SelectedHandoff;
  onClose: () => void;
}

export function RHandoverViewer({ selected, onClose }: RHandoverViewerProps) {
  const { data, loading, error } = useHandoffContent(selected.unit, selected.name);
  const meta = data !== null ? parseBatonMeta(data.content) : { composedAt: null, task: null };

  // Focus mode: fills the R panel's single column (`flex-1`) at the
  // operator's drag-set width — imposes no width of its own, so it never
  // squeezes the centre conversation.
  return (
    <div data-testid="r-handover-viewer" className="flex min-h-0 flex-1 flex-col">
      <ViewerHeader
        unit={selected.unit}
        name={selected.name}
        composedAt={meta.composedAt}
        task={meta.task}
        onClose={onClose}
      />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-xs">
        {loading && <Loading />}
        {error && <FetchError what="hand-over" message={error.message} />}
        {data !== null && <BatonBody content={data.content} />}
      </div>
    </div>
  );
}

// ── Header — mechanical baton facts, all plain (no severity tint) ──
//
// Identity (unit · hand-over · baton name · active/archived) renders
// immediately from the selection; `composed_at` / `task` appear once the
// content resolves and the frontmatter is parsed (omitted when absent).

function ViewerHeader({
  unit,
  name,
  composedAt,
  task,
  onClose,
}: {
  unit: string;
  name: string;
  composedAt: string | null;
  task: string | null;
  onClose: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-hairline px-4 py-3">
      <InventoryBackButton onClose={onClose} />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-subtle-foreground">
          {unit} · hand-over
        </p>
        <h2 className="break-all text-sm font-semibold text-foreground">
          <span className="font-mono">{name}</span>
        </h2>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle-foreground">
        <span className="text-muted-foreground">{isActive(name) ? "active" : "archived"}</span>
        {composedAt !== null && (
          <span className="text-muted-foreground">composed {composedAt}</span>
        )}
      </div>
      {task !== null && <p className="mt-1 text-[11px] text-muted-foreground">{task}</p>}
    </header>
  );
}

// ── Async states (plain, never a fabricated empty) ──
//
// Ported 1:1 from the sibling R₂ viewers so the five read identically.

function Loading() {
  return <p className="text-subtle-foreground">Loading…</p>;
}

function FetchError({ what, message }: { what: string; message: string }) {
  return (
    <p className="text-muted-foreground">
      Failed to load {what}: {message}
    </p>
  );
}

// ── Baton body (markdown via the shared PROSE_CLASSES) ──
//
// The baton is frontmatter + markdown body verbatim — rendered as markdown
// (the one allowed convention). "Empty baton." when blank.

function BatonBody({ content }: { content: string }) {
  const empty = content.trim() === "";
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
        Baton
      </h3>
      {empty ? (
        <p className="text-subtle-foreground">Empty baton.</p>
      ) : (
        <div className={PROSE_CLASSES}>
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
      )}
    </section>
  );
}
