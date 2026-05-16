// Regression guard for the WebUI semantic-token migration.
//
// Once an area has been migrated off the hardcoded Tailwind palette
// classes (`text-zinc-300`, `bg-white/10`, `text-cyan-400`, …) onto the
// semantic theme tokens, it must STAY migrated — otherwise the theme
// silently stops applying there again. This test fails if any raw
// palette utility reappears in a migrated directory.
//
// `MIGRATED` is the allowlist that grows one entry per area PR. The
// remaining (not-yet-migrated) directories are intentionally NOT scanned
// — they still hardcode palette classes by design until their PR lands.
// The migration's final PR scans `components` wholesale and deletes this
// comment's caveat.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Directories (relative to src/) that have completed the migration.
const MIGRATED = ["components/settings"];

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
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__") continue;
      yield* walk(p);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield p;
    }
  }
}

describe("semantic-token migration regression guard", () => {
  for (const area of MIGRATED) {
    it(`'${area}' stays free of raw Tailwind palette classes`, () => {
      const violations: string[] = [];
      for (const file of walk(join(SRC, area))) {
        const text = readFileSync(file, "utf8");
        text.split("\n").forEach((line, i) => {
          const hits = line.match(RAW_PALETTE);
          if (hits) {
            violations.push(`${relative(SRC, file)}:${i + 1}  ${[...new Set(hits)].join(" ")}`);
          }
        });
      }
      expect(
        violations,
        `Raw palette classes found in a migrated area — run scripts/theme-codemod.mjs ` +
          `and map any leftovers to semantic tokens:\n${violations.join("\n")}`,
      ).toEqual([]);
    });
  }
});
