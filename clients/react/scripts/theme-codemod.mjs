#!/usr/bin/env node
// Theme-token codemod for the WebUI semantic-token migration.
//
// Rewrites the hardcoded Tailwind palette utility classes
// (`text-zinc-300`, `bg-white/10`, `text-cyan-400`, …) to the semantic
// theme tokens introduced in PR A (`text-foreground`, `bg-surface-strong`,
// `text-primary`, …) so the component tree actually re-skins with the
// active theme.
//
// This is the CANONICAL mapping for the migration — every per-area PR runs
// this same dictionary so the swap is consistent across the codebase. The
// `zinc` theme's token values are tuned (in lib/theme.ts) so that this
// substitution is near-identical under the legacy `zinc` theme; under
// `tokyonight` / `light` it is the intended re-skin.
//
// Why a regex codemod and not ts-morph: classes live in string / template
// literals and `clsx`-style ternaries; a className-token regex with
// boundary look-around preserves variant prefixes (`hover:`, `focus:`,
// `md:`) and opacity suffixes (`/40`) automatically because they sit
// OUTSIDE each match. The ~30% of cases this can't safely decide
// (gradients, ambiguous purples) are intentionally left for manual fixup
// and caught by the regression guard.
//
// Usage:
//   node scripts/theme-codemod.mjs <dir...>            # dry-run (counts)
//   node scripts/theme-codemod.mjs --write <dir...>    # apply in place
//
// Skips `__tests__` and only touches *.tsx / *.ts.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Each rule: [RegExp, replacement]. The RegExp matches a whole colour
// utility token; `(?<![\w-])` / `(?![\w/-])` boundaries keep us off
// partial matches and leave any `variant:` prefix and `/alpha` suffix
// untouched (they're outside the match), so `hover:text-zinc-300` →
// `hover:text-foreground` and `text-cyan-400/80` → `text-primary/80`
// fall out for free. `$1` is the utility prefix (text/bg/border/…).
const PREFIX = "(?:text|bg|border|ring|from|via|to|fill|stroke|accent|placeholder|outline|decoration)";

const RULES = [
  // ── Neutral text scale → foreground / muted / subtle tiers ──
  [/(?<![\w-])text-zinc-(?:50|100|200|300)(?![\w-])/g, "text-foreground"],
  [/(?<![\w-])text-zinc-(?:400|500)(?![\w-])/g, "text-muted-foreground"],
  [/(?<![\w-])text-zinc-(?:600|700|800|900)(?![\w-])/g, "text-subtle-foreground"],
  [/(?<![\w-])placeholder-zinc-(?:500|600|700|800)(?![\w-])/g, "placeholder-subtle-foreground"],

  // ── White overlays → elevation surfaces / hairlines ──
  // Arbitrary ultra-faint opacities (`bg-white/[0.02]`) are the lowest
  // elevation tier → the faint `surface` token. Must precede the bare
  // `bg-white` rule. Alpha-bearing forms encode the elevation level, so
  // the `/N` is dropped (the token already carries the translucency).
  [/(?<![\w-])bg-white\/\[[0-9.]+\](?![\w-])/g, "bg-surface"],
  [/(?<![\w-])border-white\/\[[0-9.]+\](?![\w-])/g, "border-hairline"],
  [/(?<![\w-])bg-white\/5(?!\d)/g, "bg-surface"],
  [/(?<![\w-])bg-white\/(?:10|15|20)(?!\d)/g, "bg-surface-strong"],
  [/(?<![\w-])bg-white(?![\w/[-])/g, "bg-foreground"],
  [/(?<![\w-])border-white\/5(?!\d)/g, "border-hairline"],
  [/(?<![\w-])border-white\/(?:10|15|20|30)(?!\d)/g, "border-hairline-strong"],
  [/(?<![\w-])border-white(?![\w/[-])/g, "border-hairline-strong"],
  // Ring overlays → the strong hairline. (A resting-vs-focus pair that
  // collapses to the same ring is a deliberate manual-fixup point: the
  // focus ring is upgraded to ring-primary by hand, matching this
  // codebase's focus convention.)
  [/(?<![\w-])ring-white(?:\/(?:\[[0-9.]+\]|[0-9]{1,3}))?(?![\w-])/g, "ring-hairline-strong"],

  // ── Neutral fills/borders that aren't white overlays ──
  [/(?<![\w-])bg-zinc-(?:400|500|600)(?![\w-])/g, "bg-muted-foreground"],
  [/(?<![\w-])bg-zinc-(?:700|800|900|950)(?![\w-])/g, "bg-surface-strong"],
  [/(?<![\w-])border-zinc-(?:600|700|800)(?![\w-])/g, "border-hairline-strong"],

  // ── Accent (cyan is the product accent) → primary ──
  [
    new RegExp(`(?<![\\w-])(${PREFIX})-cyan-(?:200|300|400|500|600)(?![\\w-])`, "g"),
    "$1-primary",
  ],
  // ── Status families ──
  [new RegExp(`(?<![\\w-])(${PREFIX})-red-(?:300|400|500|600)(?![\\w-])`, "g"), "$1-destructive"],
  [
    new RegExp(`(?<![\\w-])(${PREFIX})-(?:amber|yellow|orange)-(?:200|300|400|500|600)(?![\\w-])`, "g"),
    "$1-warning",
  ],
  [
    new RegExp(`(?<![\\w-])(${PREFIX})-(?:emerald|green|teal|lime)-(?:200|300|400|500|600)(?![\\w-])`, "g"),
    "$1-success",
  ],
  [
    new RegExp(`(?<![\\w-])(${PREFIX})-(?:blue|sky|indigo)-(?:200|300|400|500|600)(?![\\w-])`, "g"),
    "$1-info",
  ],
  // Purple/violet is the WebUI's *secondary* categorical accent (dispatch
  // / agent / "remote" tags) — deliberately distinct from the primary
  // accent. The shadcn `accent`/`accent-foreground` token slots were the
  // muted-hover-surface convention but are UNUSED in this codebase
  // (surfaces map to surface/elevated), so they are repurposed in
  // theme.ts as this themed secondary accent. See lib/theme.ts.
  [
    new RegExp(`(?<![\\w-])(${PREFIX})-(?:purple|violet|fuchsia)-(?:200|300|400|500|600)(?![\\w-])`, "g"),
    "$1-accent",
  ],
  // Black scrims (`bg-black/20`, `bg-black/[0.3]`) are "recessed to the
  // base background" surfaces (inset side-panels, form inputs). Map to
  // the theme base bg so they invert correctly under a light theme
  // instead of staying a hardcoded black darkener. The `/alpha` is
  // dropped on purpose — the token is the solid recessed surface.
  [/(?<![\w-])bg-black(?:\/(?:\[[0-9.]+\]|[0-9]{1,3}))?(?![\w-])/g, "bg-background"],
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      yield* walk(p);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.(tsx|ts)$/.test(entry)) {
      yield p;
    }
  }
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const targets = args.filter((a) => a !== "--write");
if (targets.length === 0) {
  console.error("usage: node scripts/theme-codemod.mjs [--write] <dir...>");
  process.exit(2);
}

let filesChanged = 0;
let totalSubs = 0;
for (const target of targets) {
  for (const file of walk(target)) {
    const src = readFileSync(file, "utf8");
    let out = src;
    let subs = 0;
    for (const [re, to] of RULES) {
      out = out.replace(re, (...m) => {
        subs++;
        return typeof to === "string" ? to.replace("$1", m[1] ?? "") : to;
      });
    }
    if (subs > 0) {
      filesChanged++;
      totalSubs += subs;
      console.log(`${write ? "write" : "dry "}  ${file}  (${subs} subs)`);
      if (write) writeFileSync(file, out);
    }
  }
}
console.log(`\n${filesChanged} files, ${totalSubs} substitutions${write ? "" : " (dry-run)"}`);
