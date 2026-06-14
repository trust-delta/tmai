// Pure model — parse an aim node's markdown body into its semantic sections.
// Shared by both aim surfaces (R-panel `RAimsSection` + aim-console `AimPane`),
// the same way both share `aim-tree.ts`. No React, fully unit-testable.
//
// The rebuilt aim form expresses a node's structured-knowing as `#`-headed
// markdown sections (`doc/aims/` self-describes the form):
//   - 障害 (escalation) — the "Go だけで進めない理由" → Producer→operator escalation
//   - 手段 (means)      — phase/condition-split implementation units (実装済/未実装)
//   - history (却下手段) — append-only don't-repeat ledger of rejected means
//   - DAG (cross-edges) — `[[slug]]` dependencies on other aim nodes
//
// The form is STILL SETTLING (a running trial — the operator is dogfooding it),
// so this parser is deliberately section-level + tolerant: it classifies by
// heading keyword and never imposes a rigid grammar. Anything it does not
// recognise falls through to `prose`, rendered verbatim — nothing is dropped.
// (Engine-side section parsing → typed wire is the eventual home, named in the
// corpus as a new means; left client-side for now so a settling grammar is not
// frozen into the wire — cf. the internal-contract-principle's "leave volatile
// seams un-contracted".)

export type AimBodySectionKind = "obstacle" | "means" | "history" | "dag" | "prose";

export interface AimBodySection {
  kind: AimBodySectionKind;
  /** The heading text as authored. Empty for a lead block before any heading. */
  heading: string;
  /** The section's markdown content (everything below the heading, trimmed). */
  content: string;
}

// A markdown ATX heading (`#`..`###` + text). The aim form uses `#`; we accept
// up to `###` so a deeper authoring habit still classifies rather than dropping
// into the body of the previous section.
const HEADING = /^#{1,3}\s+(.+?)\s*$/;

// Classify a heading by keyword (JP + EN variants). Order matters only in that
// the first match wins; the buckets are disjoint in practice.
function classify(heading: string): AimBodySectionKind {
  const h = heading.toLowerCase();
  if (/障害|escalation|obstacle|blocker/.test(h)) return "obstacle";
  if (/手段|means/.test(h)) return "means";
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
// shows the canonical 障害/手段/DAG/history scaffolding (with empty slots) or
// simply renders the prose verbatim (a non-conforming body is not forced into
// the scaffold).
export function hasStructure(sections: readonly AimBodySection[]): boolean {
  return sections.some((s) => s.kind !== "prose");
}
