// ◎ Aim body — the agent-authored interior (`AimWire.body`) rendered as
// STRUCTURED sections in each inspector's own design idiom. Shared by both aim
// surfaces (R-panel `RAimsSection` + aim-console `AimPane`), the same way both
// share `aim-tree.ts`.
//
// WHY this exists: the rebuilt aim form expresses structured-knowing as
// `#`-headed markdown — 障害 (escalation) / 手段 (means, with 実装済/未実装) /
// history (却下手段) / DAG (`[[slug]]` cross-edges) — NOT the old `[claimed]` /
// `[confirmed]` interior marks. So a new-form node parses to an empty `is[]`
// and its whole body was invisible. A first cut rendered the raw body via
// generic `prose`, which read as foreign next to the rest of the inspector;
// this renders the body's SECTIONS as typed blocks that speak each surface's
// tokens (`.ac-*` in the console, the app's prose / mark idioms in the R-panel).
//
// Parsing is client-side + section-level (`./aim-body-parse`) on purpose: the
// form is still settling (a running dogfood trial), so its grammar is not
// frozen into the wire yet. `[[slug]]` cross-edges become in-tree navigation
// (resolved → clickable; unresolved → plain). When the body carries any
// recognised section, the canonical 障害/手段/DAG/history scaffold is shown in
// reading order with empty slots surfaced subtly; a non-conforming (pure-prose)
// body is rendered verbatim without the scaffold.

import { useMemo } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type AimBodySection,
  type AimBodySectionKind,
  hasStructure,
  parseAimBody,
} from "./aim-body-parse";
import { PROSE_CLASSES } from "./r-viewer/prose";

export type AimBodyVariant = "rpanel" | "console";

// Canonical reading order: 障害 (the 律速 escalation) first … history (settled,
// append-only) last. Means + DAG sit between.
const CANONICAL: readonly AimBodySectionKind[] = ["obstacle", "means", "dag", "history"];

const SECTION_LABEL: Record<AimBodySectionKind, string> = {
  obstacle: "障害 — escalation",
  means: "手段 — means",
  dag: "DAG — cross-edges",
  history: "history — 却下手段",
  prose: "",
};

// The body's DAG cross-edge syntax. Same shape the record viewer's excerpt
// uses; here the target is an aim node, not a decision/approach record.
const WIKILINK = /\[\[([^[\]]+)\]\]/g;

// A stable render key for a parsed section — content-derived, not the array
// index (sections have no id; this keeps React identity stable across re-parses
// without an index key).
const sectionKey = (s: AimBodySection): string =>
  `${s.kind}:${s.heading}:${s.content.slice(0, 32)}`;

interface AimBodyProps {
  body: string;
  /** Which surface's tokens to speak. */
  variant: AimBodyVariant;
  /** Does this slug name a loaded aim node (in the selection's repo)? */
  resolves: (slug: string) => boolean;
  /** Navigate the panel's selection to a resolved aim node. */
  onNavigate: (slug: string) => void;
}

export function AimBody({ body, variant, resolves, onNavigate }: AimBodyProps) {
  const sections = useMemo(() => parseAimBody(body), [body]);

  // An empty body renders nothing (a pure-ought node stays clean).
  if (sections.length === 0) return null;

  const structured = hasStructure(sections);
  const lead = sections.filter((s) => s.kind === "prose" && s.heading === "");
  const otherProse = sections.filter((s) => s.kind === "prose" && s.heading !== "");

  return (
    <section
      data-testid="aim-body"
      className={variant === "console" ? "ac-body-sections" : "mt-3 space-y-3"}
    >
      {/* A lead block (content before any heading) is the section intro. */}
      {lead.map((s) => (
        <SectionView
          key={`lead-${sectionKey(s)}`}
          section={s}
          variant={variant}
          resolves={resolves}
          onNavigate={onNavigate}
        />
      ))}

      {/* Canonical scaffold — only when the body actually speaks the form. */}
      {structured
        ? CANONICAL.map((kind) => {
            const present = sections.filter((s) => s.kind === kind);
            if (present.length === 0) return <EmptySlot key={kind} kind={kind} variant={variant} />;
            return present.map((s) => (
              <SectionView
                key={sectionKey(s)}
                section={s}
                variant={variant}
                resolves={resolves}
                onNavigate={onNavigate}
              />
            ));
          })
        : null}

      {/* Unknown headed prose — after the canonical block (or alone, when the
          body is not structured). Nothing the parser sees is ever dropped. */}
      {otherProse.map((s) => (
        <SectionView
          key={`prose-${sectionKey(s)}`}
          section={s}
          variant={variant}
          resolves={resolves}
          onNavigate={onNavigate}
        />
      ))}
    </section>
  );
}

// ── one section ───────────────────────────────────────────────────────

function SectionView({
  section,
  variant,
  resolves,
  onNavigate,
}: {
  section: AimBodySection;
  variant: AimBodyVariant;
  resolves: (slug: string) => boolean;
  onNavigate: (slug: string) => void;
}) {
  const label = SECTION_LABEL[section.kind] || section.heading;
  // 実装済/未実装 are a means-section progress convention; surface whichever the
  // author used as a header chip. Best-effort (the form is loose) — the chips
  // are facts the author wrote, never a re-judgement.
  const statuses = section.kind === "means" ? meansStatuses(section.content) : [];

  const withLinks = useMemo(
    () => section.content.replace(WIKILINK, (_m, slug: string) => `[${slug}](aim:${slug})`),
    [section.content],
  );
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (href?.startsWith("aim:")) {
          const slug = href.slice("aim:".length);
          if (!resolves(slug)) {
            return <span className={UNRESOLVED_CLASS[variant]}>{children}</span>;
          }
          return (
            <button type="button" onClick={() => onNavigate(slug)} className={LINK_CLASS[variant]}>
              {children}
            </button>
          );
        }
        return <a href={href}>{children}</a>;
      },
    }),
    [variant, resolves, onNavigate],
  );

  const md =
    section.content === "" ? null : (
      <Markdown
        remarkPlugins={[remarkGfm]}
        // Preserve the synthetic `aim:` scheme; sanitize everything else as
        // react-markdown would by default.
        urlTransform={(url) => (url.startsWith("aim:") ? url : defaultUrlTransform(url))}
        components={components}
      >
        {withLinks}
      </Markdown>
    );

  if (variant === "console") {
    return (
      <div className="ac-body-sec" data-testid="aim-body-section" data-kind={section.kind}>
        <div className="ac-isec">
          {label}
          {statuses.map((s) => (
            <StatusChip key={s} status={s} variant={variant} />
          ))}
        </div>
        {md === null ? (
          <div className="ac-il dim">— なし —</div>
        ) : (
          <div className="ac-body">{md}</div>
        )}
      </div>
    );
  }

  return (
    <section data-testid="aim-body-section" data-kind={section.kind}>
      <h4 className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">
        <span>{label}</span>
        {statuses.map((s) => (
          <StatusChip key={s} status={s} variant={variant} />
        ))}
      </h4>
      {md === null ? (
        <p className="mt-0.5 text-[11px] italic text-subtle-foreground">— なし —</p>
      ) : (
        <div className={`mt-1 ${PROSE_CLASSES}`}>{md}</div>
      )}
    </section>
  );
}

// An absent canonical section — a subtle present-but-empty slot, so the
// 障害/手段/DAG/history structure stays legible (it scaffolds the write
// surface). Subtle, never an alarm — a missing slot is not owed work.
function EmptySlot({ kind, variant }: { kind: AimBodySectionKind; variant: AimBodyVariant }) {
  if (variant === "console") {
    return (
      <div
        className="ac-body-sec"
        data-testid="aim-body-section"
        data-kind={kind}
        data-empty="true"
      >
        <div className="ac-isec">{SECTION_LABEL[kind]}</div>
        <div className="ac-il dim">— なし —</div>
      </div>
    );
  }
  return (
    <section data-testid="aim-body-section" data-kind={kind} data-empty="true">
      <h4 className="font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">
        {SECTION_LABEL[kind]}
      </h4>
      <p className="mt-0.5 text-[11px] italic text-subtle-foreground">— なし —</p>
    </section>
  );
}

type MeansStatus = "実装済" | "未実装";

// Detect the means-progress markers the author used. Distinct substrings (one
// is not a substring of the other), so a plain test is safe.
function meansStatuses(content: string): MeansStatus[] {
  const out: MeansStatus[] = [];
  if (content.includes("実装済")) out.push("実装済");
  if (content.includes("未実装")) out.push("未実装");
  return out;
}

// done = success/green (calm), undone = ochre/open (owed, not alarming).
function StatusChip({ status, variant }: { status: MeansStatus; variant: AimBodyVariant }) {
  const done = status === "実装済";
  const glyph = done ? "✓" : "◌";
  if (variant === "console") {
    return <span className={`ac-tg ${done ? "c" : "k"}`}>{`${glyph} ${status}`}</span>;
  }
  return (
    <span
      className={`shrink-0 rounded border px-1 py-px font-mono text-[9px] ${
        done ? "border-success/40 text-success" : "border-dashed border-warning/50 text-warning"
      }`}
    >
      {glyph} {status}
    </span>
  );
}

// Resolved / unresolved `[[slug]]` link classes per surface.
const LINK_CLASS: Record<AimBodyVariant, string> = {
  rpanel:
    "font-mono text-info underline decoration-dotted underline-offset-2 hover:decoration-solid",
  console: "ac-bodylink",
};
const UNRESOLVED_CLASS: Record<AimBodyVariant, string> = {
  rpanel: "text-muted-foreground",
  console: "ac-bodylink dim",
};
