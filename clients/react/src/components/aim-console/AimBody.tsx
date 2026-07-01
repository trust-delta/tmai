// ◎ Aim body — the agent-authored interior (`AimWire.body`) rendered as
// STRUCTURED sections in each inspector's own design idiom. Shared by both aim
// surfaces (R-panel `RAimsSection` + aim-console `AimPane`), the same way both
// share `aim-tree.ts`.
//
// WHY this exists: the rebuilt aim form expresses structured-knowing as
// `#`-headed markdown — is/前提 (premises) / 障害 (escalation) / 手段 (means,
// progress-bearing) / DAG (`[[slug]]` cross-edges) / history (却下手段). The
// body is the PRODUCER's domain (authored for write ergonomics); the render is
// the OPERATOR's (readable after parse). A first cut rendered the raw body via
// generic `prose`, which read as foreign next to the rest of the inspector;
// this renders the body's SECTIONS as typed blocks that speak each surface's
// tokens (`.ac-*` in the console, the app's prose / mark idioms in the R-panel).
//
// Parsing is client-side + section-level (`./aim-body-parse`) on purpose — the
// form is still settling (a running dogfood trial), so its grammar is not
// frozen into the wire yet. The canonical is/障害/手段/DAG/history scaffold is
// shown in reading order with empty slots surfaced subtly (operator-approved);
// a non-conforming (pure-prose) body is rendered verbatim. 手段 is rendered as
// a progress-bearing checklist (実装済 / 未実装 per item + a header ratio);
// `[[slug]]` cross-edges become in-tree navigation (resolved → clickable).

import { useMemo } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type AimBodySection,
  type AimBodySectionKind,
  hasStructure,
  type MeansItem,
  type ParsedMeans,
  parseAimBody,
  parseMeans,
} from "./aim-body-parse";
import { PROSE_CLASSES } from "./prose";

export type AimBodyVariant = "rpanel" | "console";

// Canonical reading order (per `doc/aims/aim-body`): IS (the agent's reading
// you check first) → ESCALATION (the 律速 blockers) → PROCESS (the plan) →
// HISTORY (rejected means) → DAG (cross-tree dependencies).
const CANONICAL: readonly AimBodySectionKind[] = ["is", "obstacle", "means", "history", "dag"];

const SECTION_LABEL: Record<AimBodySectionKind, string> = {
  is: "IS — 解釈",
  obstacle: "ESCALATION — 障害",
  means: "PROCESS — 実装手順",
  history: "HISTORY — 却下手段",
  dag: "DAG — 依存",
  prose: "",
};

// The body's DAG cross-edge syntax. Same shape the record viewer's excerpt
// uses; here the target is an aim node, not a decision/approach record.
const WIKILINK = /\[\[([^[\]]+)\]\]/g;

// A stable render key for a parsed section — content-derived, not the array
// index (sections have no id; keeps React identity stable across re-parses).
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
  // 手段 is progress-bearing: parse it into a checklist + a done/todo ratio.
  const means = useMemo(
    () => (section.kind === "means" ? parseMeans(section.content) : null),
    [section.kind, section.content],
  );

  const headerExtra =
    section.kind === "means" ? (
      means && means.done + means.todo > 0 ? (
        <ProgressBadge done={means.done} todo={means.todo} variant={variant} />
      ) : (
        // Not-yet-converted body: fall back to whatever 実装済/未実装 the prose
        // mentions, as section-level chips (the marks are facts, not a judgement).
        <FallbackStatusChips content={section.content} variant={variant} />
      )
    ) : null;

  const body =
    means !== null ? (
      <MeansBody means={means} variant={variant} resolves={resolves} onNavigate={onNavigate} />
    ) : (
      <Md content={section.content} variant={variant} resolves={resolves} onNavigate={onNavigate} />
    );

  if (variant === "console") {
    return (
      <div className="ac-body-sec" data-testid="aim-body-section" data-kind={section.kind}>
        <div className="ac-isec">
          {label}
          {headerExtra}
        </div>
        {body === null ? (
          <div className="ac-il dim">— なし —</div>
        ) : (
          <div className="ac-body">{body}</div>
        )}
      </div>
    );
  }

  return (
    <section data-testid="aim-body-section" data-kind={section.kind}>
      <h4 className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">
        <span>{label}</span>
        {headerExtra}
      </h4>
      {body === null ? (
        <p className="mt-0.5 text-[11px] italic text-subtle-foreground">— なし —</p>
      ) : (
        <div className={`mt-1 ${PROSE_CLASSES}`}>{body}</div>
      )}
    </section>
  );
}

// ── 手段 (means) — the progress-bearing checklist ─────────────────────────

function MeansBody({
  means,
  variant,
  resolves,
  onNavigate,
}: {
  means: ParsedMeans;
  variant: AimBodyVariant;
  resolves: (slug: string) => boolean;
  onNavigate: (slug: string) => void;
}) {
  if (means.intro === "" && means.items.length === 0) return null;
  return (
    <>
      {means.intro !== "" && (
        <Md content={means.intro} variant={variant} resolves={resolves} onNavigate={onNavigate} />
      )}
      <ul className="ac-means-list">
        {means.items.map((item) => (
          <MeansItemRow
            key={`${item.status ?? "·"}:${item.text}`}
            item={item}
            variant={variant}
            resolves={resolves}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </>
  );
}

function MeansItemRow({
  item,
  variant,
  resolves,
  onNavigate,
}: {
  item: MeansItem;
  variant: AimBodyVariant;
  resolves: (slug: string) => boolean;
  onNavigate: (slug: string) => void;
}) {
  const glyph = item.status === "done" ? "✓" : item.status === "todo" ? "◌" : "·";
  const glyphClass =
    variant === "console"
      ? item.status === "done"
        ? "ac-means-g done"
        : item.status === "todo"
          ? "ac-means-g todo"
          : "ac-means-g"
      : item.status === "done"
        ? "text-success"
        : item.status === "todo"
          ? "text-warning"
          : "text-subtle-foreground";

  return (
    <li
      className={variant === "console" ? "ac-means-item" : "flex flex-col gap-0.5"}
      data-testid="aim-means-item"
      data-status={item.status ?? "none"}
    >
      <span className={variant === "console" ? "ac-means-row" : "flex items-baseline gap-1.5"}>
        <span aria-hidden="true" className={`shrink-0 font-mono ${glyphClass}`}>
          {glyph}
        </span>
        <span className="min-w-0">
          <Md
            content={item.text}
            variant={variant}
            resolves={resolves}
            onNavigate={onNavigate}
            inline
          />
        </span>
      </span>
      {item.detail !== "" && (
        <div className={variant === "console" ? "ac-means-detail" : "ml-4 text-subtle-foreground"}>
          <Md content={item.detail} variant={variant} resolves={resolves} onNavigate={onNavigate} />
        </div>
      )}
    </li>
  );
}

// done = green/success (calm), todo = ochre/warning (owed, not alarming).
function ProgressBadge({
  done,
  todo,
  variant,
}: {
  done: number;
  todo: number;
  variant: AimBodyVariant;
}) {
  const total = done + todo;
  const donePct = total === 0 ? 0 : Math.round((100 * done) / total);
  if (variant === "console") {
    return (
      <span className="ac-prog" data-testid="aim-means-progress">
        done {done} / todo {todo}
        <span className="ac-prog-bar" aria-hidden="true">
          <span className="done" style={{ width: `${donePct}%` }} />
        </span>
      </span>
    );
  }
  return (
    <span
      data-testid="aim-means-progress"
      className="flex items-center gap-1.5 font-mono text-[9px] normal-case text-muted-foreground"
    >
      done {done} / todo {todo}
      <span className="flex h-1 w-10 overflow-hidden rounded-full border border-hairline">
        <span className="bg-success" style={{ width: `${donePct}%` }} />
        <span className="bg-warning/70" style={{ width: `${100 - donePct}%` }} />
      </span>
    </span>
  );
}

// A not-yet-converted means body: surface whichever status the prose mentions
// (done / todo, JP 実装済 / 未実装 too) as a section-level chip. Best-effort —
// the chips are facts the author wrote, never a re-judgement.
function FallbackStatusChips({ content, variant }: { content: string; variant: AimBodyVariant }) {
  const statuses: ("done" | "todo")[] = [];
  if (/実装済|done/i.test(content)) statuses.push("done");
  if (/未実装|todo/i.test(content)) statuses.push("todo");
  return (
    <>
      {statuses.map((s) => {
        const done = s === "done";
        const glyph = done ? "✓" : "◌";
        if (variant === "console") {
          return <span key={s} className={`ac-tg ${done ? "c" : "k"}`}>{`${glyph} ${s}`}</span>;
        }
        return (
          <span
            key={s}
            className={`shrink-0 rounded border px-1 py-px font-mono text-[9px] normal-case ${
              done
                ? "border-success/40 text-success"
                : "border-dashed border-warning/50 text-warning"
            }`}
          >
            {glyph} {s}
          </span>
        );
      })}
    </>
  );
}

// An absent canonical section — a subtle present-but-empty slot, so the
// is/障害/手段/DAG/history structure stays legible (it scaffolds the write
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

// ── markdown with `[[slug]]` aim-node cross-refs ──────────────────────────

function Md({
  content,
  variant,
  resolves,
  onNavigate,
  inline = false,
}: {
  content: string;
  variant: AimBodyVariant;
  resolves: (slug: string) => boolean;
  onNavigate: (slug: string) => void;
  /** Unwrap the single top-level paragraph (for one-line item text). */
  inline?: boolean;
}) {
  const withLinks = useMemo(
    () => content.replace(WIKILINK, (_m, slug: string) => `[${slug}](aim:${slug})`),
    [content],
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
      // For inline item text, drop the wrapping <p> so the glyph + text stay on
      // one baseline row.
      ...(inline ? { p: ({ children }) => <>{children}</> } : {}),
    }),
    [variant, resolves, onNavigate, inline],
  );

  if (content.trim() === "") return null;
  return (
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
