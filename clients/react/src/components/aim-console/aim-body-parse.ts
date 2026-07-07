// Pure model — parse an aim node's markdown body into its semantic sections.
// Shared by both aim surfaces (R-panel `RAimsSection` + aim-console `AimPane`),
// the same way both share `aim-tree.ts`. No React, fully unit-testable.
//
// The rebuilt aim form expresses a node's structured-knowing as `#`-headed
// markdown. The body is the PRODUCER's domain (authored for write ergonomics);
// this parser turns that into a shape the inspector renders for the operator.
// The canonical sections (see `docs/aims/aim-body`), in reading order:
//   - IS         — the agent's INTERPRETATION of the aim: how it read the
//                  purpose, so the human can confirm it read it right. TOP.
//   - ESCALATION — the "Go だけで進めない理由" → Producer→operator escalation
//   - PROCESS    — phase/condition-split implementation steps, EACH carrying
//                  its own progress (実装済 / 未実装) — process is
//                  progress-bearing by construction
//   - HISTORY    — append-only don't-repeat ledger of rejected means
//   - DAG        — `[[slug]]` dependencies on other aim nodes
//
// The form is STILL SETTLING (a running dogfood trial), so this parser is
// deliberately section-level + tolerant: it classifies by heading keyword and
// never imposes a rigid grammar. Anything it does not recognise falls through
// to `prose`, rendered verbatim — nothing is dropped. (Engine-side section
// parsing → typed wire is the eventual home; left client-side for now so a
// settling grammar is not frozen into the wire.)

export type AimBodySectionKind = "is" | "obstacle" | "means" | "history" | "dag" | "prose";

export interface AimBodySection {
  kind: AimBodySectionKind;
  /** The heading text as authored. Empty for a lead block before any heading. */
  heading: string;
  /** The section's markdown content (everything below the heading, trimmed). */
  content: string;
}

// A markdown ATX heading (`#`..`###` + text).
const HEADING = /^#{1,3}\s+(.+?)\s*$/;

// Classify a heading by keyword. The aim form's canonical section labels are
// IS / ESCALATION / PROCESS / HISTORY / DAG (see `docs/aims/aim-body`); JP
// glosses + a few synonyms are accepted too. `is` is tested first so an "# IS"
// heading reads as the agent's interpretation rather than falling to prose.
function classify(heading: string): AimBodySectionKind {
  const h = heading.toLowerCase();
  if (/\bis\b|前提|premise|assumption|interpretation|解釈|interior/.test(h)) return "is";
  if (/escalation|障害|obstacle|blocker/.test(h)) return "obstacle";
  if (/process|手段|means|実装手順|実装工程/.test(h)) return "means";
  if (/history|却下|履歴|recoil/.test(h)) return "history";
  if (/dag|依存|cross.?edge/.test(h)) return "dag";
  return "prose";
}

export function parseAimBody(body: string): AimBodySection[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const sections: AimBodySection[] = [];
  let heading = "";
  let kind: AimBodySectionKind = "prose";
  let buf: string[] = [];

  const flush = () => {
    const content = buf.join("\n").trim();
    buf = [];
    // Drop only a truly empty lead block (no heading AND no content); a headed
    // section with an empty body is still a present (if empty) slot and is kept.
    if (heading === "" && content === "") return;
    sections.push({ kind, heading, content });
  };

  for (const line of lines) {
    const m = line.match(HEADING);
    if (m) {
      flush();
      heading = m[1];
      kind = classify(heading);
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

// True when the body carries at least one RECOGNISED structured section — i.e.
// it speaks the aim form, not just free prose. Drives whether the renderer
// shows the canonical is/障害/手段/DAG/history scaffolding (with empty slots) or
// simply renders the prose verbatim (a non-conforming body is not forced into
// the scaffold).
export function hasStructure(sections: readonly AimBodySection[]): boolean {
  return sections.some((s) => s.kind !== "prose");
}

// ── 手段 (means) — a progress-bearing checklist ───────────────────────────
//
// A means section is a (optional) lead intro + a list of implementation units,
// each carrying an implemented / unimplemented status. The CLEAN authoring
// convention (the Producer's, designed for easy writing) is a top-level bullet
// prefixed with a status marker:
//   - [実装済] existing parser already does X
//   - [未実装] drift surfacing mechanism
//       · sub-bullets are that item's detail
// A bullet WITHOUT a marker is a plain (status-less) item, rendered as an
// ordinary bullet — so a not-yet-converted body still reads correctly while
// the section header falls back to whatever 実装済/未実装 the prose mentions.

export type MeansStatus = "done" | "todo";

export interface MeansItem {
  /** done = 実装済, todo = 未実装, null = no marker (a plain bullet). */
  status: MeansStatus | null;
  /** The item line (markdown inline), marker stripped. */
  text: string;
  /** Indented continuation / sub-bullets, dedented, as markdown. */
  detail: string;
}

export interface ParsedMeans {
  intro: string;
  items: MeansItem[];
  done: number;
  todo: number;
}

const TOP_BULLET = /^[-*]\s+(.*)$/;
const DONE_MARK = /^\[(?:実装済|済|done|x|✓)\]\s*(.*)$/i;
const TODO_MARK = /^\[(?:未実装|未|todo|◌)\]\s*(.*)$/i;

export function parseMeans(content: string): ParsedMeans {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const introLines: string[] = [];
  const items: MeansItem[] = [];
  let cur: MeansItem | null = null;
  let detailLines: string[] = [];

  const closeDetail = () => {
    if (cur) cur.detail = dedent(detailLines).trim();
    detailLines = [];
  };

  for (const line of lines) {
    const indented = /^(?:\s\s+|\t)/.test(line);
    const bullet = !indented ? line.match(TOP_BULLET) : null;
    if (bullet) {
      closeDetail();
      let text = bullet[1];
      let status: MeansStatus | null = null;
      const d = text.match(DONE_MARK);
      const t = text.match(TODO_MARK);
      if (d) {
        status = "done";
        text = d[1];
      } else if (t) {
        status = "todo";
        text = t[1];
      }
      cur = { status, text, detail: "" };
      items.push(cur);
    } else if (cur && (indented || line.trim() !== "")) {
      detailLines.push(line);
    } else if (cur === null) {
      introLines.push(line);
    }
  }
  closeDetail();

  return {
    intro: introLines.join("\n").trim(),
    items,
    done: items.filter((i) => i.status === "done").length,
    todo: items.filter((i) => i.status === "todo").length,
  };
}

// Remove the common leading whitespace from a block so nested bullets render as
// their own list rather than an indented code block.
function dedent(lines: readonly string[]): string {
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return "";
  const min = Math.min(...nonEmpty.map((l) => l.match(/^\s*/)?.[0].length ?? 0));
  return lines.map((l) => l.slice(min)).join("\n");
}
