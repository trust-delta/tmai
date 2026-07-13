/// <reference types="node" />
// Repo-wide regression lock for the WebUI semantic-token migration.
//
// The migration (PRs A–H) moved the entire component tree off the
// hardcoded Tailwind palette classes (`text-zinc-300`, `bg-white/10`,
// `text-cyan-400`, …) onto the semantic theme tokens, so every surface
// re-skins with the active theme (including the `light` theme). This
// guard makes that permanent: if a raw palette utility reappears
// ANYWHERE under `src/` it fails, so the theme can never silently stop
// applying again.
//
// (Earlier PRs used a growing `MIGRATED` allowlist; the final PR drops
// it and scans the whole tree.)
//
// Excluded, by design:
//   • `__tests__` dirs and `*.test.*` — test fixtures/strings.
//   • `types/generated/**` — generated wire types, not styled.
//   • `lib/theme.ts` — the single source of truth; it legitimately
//     holds colour *values* (hex/oklch), never Tailwind palette classes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// `relative()` yields the host separator (`\` on Windows), so normalize to
// forward slashes before comparing against EXCLUDED / building messages —
// otherwise the `lib/theme.ts` exclusion silently misses on Windows (`rel`
// is `lib\theme.ts`), the SoT file gets scanned, and its comments that
// *mention* palette classes (`bg-white/N`, `text-purple-400`) trip the
// regex as false positives. POSIX runs (CI) are unaffected.
const relPosix = (p: string): string => relative(SRC, p).split(sep).join("/");

// Paths (relative to src/) excluded from the scan.
const EXCLUDED = new Set(["types/generated", "lib/theme.ts"]);

// A raw Tailwind palette colour utility: <prefix>-<family>[-<shade>][/<alpha>].
// Semantic tokens (foreground / surface / primary / hairline / …) do not
// match because their names aren't palette families.
const PREFIX =
  "(?:text|bg|border|ring|from|via|to|fill|stroke|divide|placeholder|outline|decoration|caret|accent|shadow)";
const FAMILY =
  "(?:zinc|neutral|gray|slate|stone|white|black|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald|teal)";
const RAW_PALETTE = new RegExp(
  `(?<![\\w-])${PREFIX}-${FAMILY}(?:-[0-9]{2,3})?(?:/(?:\\[[0-9.]+\\]|[0-9]{1,3}))?(?![\\w-])`,
  "g",
);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const rel = relPosix(p);
    if (EXCLUDED.has(rel)) continue;
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__") continue;
      yield* walk(p);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield p;
    }
  }
}

// A string ternary whose two operands are byte-identical, e.g.
// `cond ? "text-muted-foreground" : "text-muted-foreground"`. The
// codemod collapses shade ranges (zinc-400 & zinc-500 → muted-foreground),
// which can silently turn a meaningful "dimmer-when-disabled" branch into
// a no-op conditional that drops a UX cue. Restore the distinction with a
// different token (e.g. subtle-foreground) or simplify to a single class.
const IDENTICAL_TERNARY = /\?\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")/g;

describe("semantic-token migration — repo-wide lock", () => {
  it("src/ is free of raw Tailwind palette classes", () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        const hits = line.match(RAW_PALETTE);
        if (hits) {
          violations.push(`${relPosix(file)}:${i + 1}  ${[...new Set(hits)].join(" ")}`);
        }
      });
    }
    expect(
      violations,
      `Raw Tailwind palette classes found — the WebUI is fully migrated to ` +
        `semantic theme tokens. Run scripts/theme-codemod.mjs on the file(s) ` +
        `and map any leftovers to semantic tokens:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("src/ has no codemod-collapsed (identical-branch) class ternaries", () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(IDENTICAL_TERNARY)) {
        if (m[1] === m[2]) {
          const ln = text.slice(0, m.index).split("\n").length;
          violations.push(`${relPosix(file)}:${ln}  ${m[1]}`);
        }
      }
    }
    expect(
      violations,
      `Both ternary branches resolve to the same class (a collapsed ` +
        `distinction). Restore it with a different token (e.g. ` +
        `subtle-foreground for the disabled/inactive branch) or simplify ` +
        `to a single class:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
