// Pure aim-record file format — parse a `docs/aims/<slug>.md` file into the wire
// shape the aim-console renders, and serialize the operator's frontmatter edits
// back. A faithful TS mirror of tmai-core's `workbench::aim` write surface
// (`split_frontmatter` / `serialize_new_aim` / `edit_aim_frontmatter` /
// `yaml_inline_scalar` / `validate_new_aim_slug`), so the offline (file-backed)
// aim mode produces records the engine parses identically and edits records
// byte-for-byte the way the engine does. No DOM, no FS — fully unit-testable.
//
// Scope mirrors the engine's: the frontmatter carries the operator's bearing
// (`aim` / `parent` / `state`) only; the agent-authored body and any other
// frontmatter line (cross-edges) are preserved verbatim on edit. The body's
// `[[slug]]` DAG and `# PROCESS` progress are read from `body` downstream
// (`aim-body-parse` / `aim-tree`), so this module leaves the cross-edge wire
// fields empty — they are vestigial for the new body-section form.

import type { AimState } from "@/types/generated/AimState";
import type { AimWire } from "@/types/generated/AimWire";

const AIM_STATES: readonly AimState[] = ["open", "done", "dead"];

export interface SplitResult {
  /** The YAML frontmatter block, trailing newline excluded. */
  front: string;
  /** Everything after the closing `---` line, verbatim. */
  body: string;
}

// Mirror of `decision::split_frontmatter`: require a leading `---` line, find
// the closing `---` line, return the block between and the body after. Handles
// both `\n` and `\r\n` line endings, same as the Rust.
export function splitFrontmatter(raw: string): SplitResult | null {
  let rest: string | null = null;
  if (raw.startsWith("---\n")) rest = raw.slice(4);
  else if (raw.startsWith("---\r\n")) rest = raw.slice(5);
  if (rest === null) return null;

  let end = rest.indexOf("\n---\n");
  let closeLen = 5;
  if (end === -1) {
    end = rest.indexOf("\n---\r\n");
    closeLen = 6;
  }
  if (end === -1) return null;

  return { front: rest.slice(0, end), body: rest.slice(end + closeLen) };
}

// A top-level frontmatter line declaring `key` — begins `key:` with no leading
// indentation, so a block-sequence item or a `aim_foo:` look-alike never
// matches. Mirror of `aim::is_frontmatter_key`.
function isFrontmatterKey(line: string, key: string): boolean {
  return line.startsWith(key) && line.slice(key.length).startsWith(":");
}

// Split front into its lines, normalizing CRLF (mirrors Rust `str::lines`).
function frontLines(front: string): string[] {
  return front.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

// ── YAML single-line scalar (de)serialization ─────────────────────────
//
// The corpus frontmatter values (`aim` / `parent` / `state`) are always a
// single line. We only need single-line scalar round-trip, not a full YAML
// emitter: emit a plain scalar when it is unambiguous, otherwise a
// double-quoted scalar (`JSON.stringify` is a valid YAML double-quoted scalar:
// YAML's double-quoted escapes are a superset of JSON's). The engine parses
// either form back to the same value; we are not required to be byte-identical
// to serde_yaml's emitter, only to round-trip the value.

const YAML_INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
const YAML_RESERVED = /^(?:true|false|null|~|yes|no|on|off)$/i;
const YAML_NUMBER_LIKE = /^[+-]?(?:\d|\.\d)/;

function isPlainSafe(v: string): boolean {
  if (v.length === 0) return false;
  if (v !== v.trim()) return false;
  if (v.includes("\n")) return false;
  if (YAML_INDICATOR_START.test(v)) return false;
  if (v.includes(": ") || v.endsWith(":")) return false;
  if (v.includes(" #")) return false;
  if (YAML_RESERVED.test(v)) return false;
  if (YAML_NUMBER_LIKE.test(v)) return false;
  return true;
}

// Mirror of `aim::yaml_inline_scalar` (role-equivalent — plain when safe, else
// a quoted form the YAML parser round-trips).
export function yamlInlineScalar(value: string): string {
  return isPlainSafe(value) ? value : JSON.stringify(value);
}

// Unescape the common YAML double-quoted escapes JSON.parse does not cover
// (used only as a fallback when the value is not valid JSON).
function unescapeDoubleQuoted(inner: string): string {
  return inner.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, esc: string) => {
    if (esc.startsWith("u")) return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    const map: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      "\\": "\\",
      '"': '"',
      "/": "/",
      "0": "\0",
    };
    return map[esc] ?? esc;
  });
}

// Invert `yamlInlineScalar`, and also accept the engine's single-quoted output.
// Single-line scalars only (the corpus invariant): plain, double-quoted, or
// single-quoted (`''` → `'`).
export function unquoteYamlScalar(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(t);
      if (typeof parsed === "string") return parsed;
    } catch {
      // fall through to the YAML-double-quote unescape
    }
    return unescapeDoubleQuoted(t.slice(1, -1));
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

// ── Frontmatter → AimWire ─────────────────────────────────────────────

function fieldValue(lines: readonly string[], key: string): string | null {
  const line = lines.find((l) => isFrontmatterKey(l, key));
  if (line === undefined) return null;
  return unquoteYamlScalar(line.slice(key.length + 1));
}

function parseState(token: string | null): AimState {
  const found = AIM_STATES.find((s) => s === token);
  if (found === undefined) {
    throw new Error(`aim record has an unknown or missing state: ${token ?? "<none>"}`);
  }
  return found;
}

// Parse one `docs/aims/<slug>.md` file's raw text into an `AimWire`. The
// git-derived fields (`drift` / `working_delta`) are `null` (no engine / git
// analysis offline); progress is read from the body's `# PROCESS` section
// downstream. Throws on a malformed record.
export function fileToAimWire(slug: string, raw: string): AimWire {
  const split = splitFrontmatter(raw);
  if (split === null) {
    throw new Error(`aim record ${slug} has no \`---\` YAML frontmatter`);
  }
  const lines = frontLines(split.front);
  const aim = fieldValue(lines, "aim");
  if (aim === null) {
    throw new Error(`aim record ${slug} frontmatter has no \`aim:\` line`);
  }
  const parent = fieldValue(lines, "parent");
  const state = parseState(fieldValue(lines, "state"));

  return {
    slug,
    aim,
    parent: parent === null ? null : parent,
    state,
    depends_on: [],
    serves: [],
    related: [],
    body: split.body,
    drift: null,
    working_delta: null,
  };
}

// ── AimWire frontmatter → file text ───────────────────────────────────

// Mirror of `aim::serialize_new_aim`: a `---`-delimited frontmatter (`aim`,
// then `parent` only when present, then `state`) followed by an empty body.
export function serializeNewAim(aim: string, parent: string | null, state: AimState): string {
  let front = `aim: ${yamlInlineScalar(aim)}\n`;
  if (parent !== null) front += `parent: ${yamlInlineScalar(parent)}\n`;
  front += `state: ${state}\n`;
  return `---\n${front}---\n`;
}

// Mirror of `aim::edit_aim_frontmatter`: rewrite ONLY `aim` / `parent` /
// `state`, preserving every other frontmatter line and the entire body
// byte-for-byte. `parent === null` drops any `parent:` line (re-rooting);
// a newly-set parent with no line to replace goes right after `aim:`.
export function editAimFrontmatter(
  raw: string,
  aim: string,
  parent: string | null,
  state: AimState,
): string {
  const split = splitFrontmatter(raw);
  if (split === null) {
    throw new Error("aim record has no `---` YAML frontmatter");
  }

  const aimLine = `aim: ${yamlInlineScalar(aim)}`;
  const stateLine = `state: ${state}`;
  const parentLine = parent === null ? null : `parent: ${yamlInlineScalar(parent)}`;

  const lines = frontLines(split.front);
  const hasParentLine = lines.some((l) => isFrontmatterKey(l, "parent"));

  const out: string[] = [];
  let seenAim = false;
  let seenState = false;
  for (const line of lines) {
    if (isFrontmatterKey(line, "aim")) {
      out.push(aimLine);
      seenAim = true;
      if (!hasParentLine && parentLine !== null) out.push(parentLine);
    } else if (isFrontmatterKey(line, "parent")) {
      if (parentLine !== null) out.push(parentLine);
    } else if (isFrontmatterKey(line, "state")) {
      out.push(stateLine);
      seenState = true;
    } else {
      out.push(line);
    }
  }

  if (!seenAim) throw new Error("aim record frontmatter has no `aim:` line");
  if (!seenState) throw new Error("aim record frontmatter has no `state:` line");

  return `---\n${out.join("\n")}\n---\n${split.body}`;
}

// ── Slug validation (mirror of `aim::validate_new_aim_slug`) ──────────

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

// Returns the reason the slug is invalid, or `null` if valid. Non-empty,
// lowercase kebab (`[a-z0-9-]`, no leading/trailing/doubled `-`), and NON-dated
// (a `YYYY-MM-DD-` prefix is the decision/approach convention; aim slugs are
// dateless stable identities).
export function validateAimSlug(slug: string): string | null {
  if (slug.length === 0) return "slug must not be empty";
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return `slug '${slug}' must be lowercase kebab-case (only [a-z0-9-] allowed)`;
  }
  if (slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) {
    return `slug '${slug}' must not start/end with '-' or contain '--'`;
  }
  if (DATE_PREFIX.test(slug)) {
    return `slug '${slug}' must be NON-dated (aim slugs are dateless stable identities)`;
  }
  return null;
}
