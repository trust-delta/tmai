// AimConsole — the destination aim-console shell (S1).
//
// A faithful reproduction of the destination mock
// (`origin/mock/aim-ui-sample` → `assets/ui-sample.html`, dev-tool / scale
// variant): a full-window 3-pane console — Aim (worklist) ⟂ Session (raw CC)
// ⟂ PR-rail — under a sober top bar (brand + unit tabs + meta). Serves aim
// node `aim-ui` (`tmai-core:doc/aims/aim-ui.md`), part of the aim-model
// dogfood.
//
// COEXIST, DO NOT RIP: this is opt-in behind a StatusBar toggle; the
// existing ProducerConsole stays the default (see `console-mode.ts`). The
// dev-tool tokens are scoped to `.aim-console` in `styles/aim-console.css`
// so they never bleed into the existing console.
//
// SCOPE so far: the TOKEN LAYER + the SHELL (S1) and the Aim pane (S2). The
// top bar (real, data-driven unit tabs) and the 3-pane grid incl. the PR-rail
// expand/collapse transition are S1; the Aim (left) pane is now the real
// worklist (Frontier⊥Tree, ledger, overview ruler, inspector, create-aim
// modal — `AimPane`, reusing the Stage B logic layer). The remaining two
// bodies are still stubs:
//   - S3 fills the Session conversation (tabs + bash footer);
//   - S4 fills the PR-rail PR/Issue lists.

import { useState } from "react";
import { useUnitAttention } from "@/hooks/useUnitAttention";
import type { UnitResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AimPane } from "./AimPane";
// Bundled dev-tool typography (offline-robust @fontsource, NOT a Google Fonts
// <link>) — loads the exact families `aim-console.css` references via --sans /
// --mono so the dev-tool look matches the mock instead of falling back to
// system fonts. Loading is document-global, but ONLY `.aim-console` references
// these families, so the existing console is unaffected. Weights mirror the
// mock: IBM Plex Mono 400/500/600, Inter Tight 400/500/600, Noto Sans JP
// 400/500.
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/inter-tight/400.css";
import "@fontsource/inter-tight/500.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@/styles/aim-console.css";

function repoBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

interface AimConsoleProps {
  /** Configured `[[unit]]` membership (App's `useUnits`), rendered as the
   *  top-bar unit tabs. Empty = no tabs (cwd-synthesized units aren't
   *  enumerated; same convention as the existing UnitTabs). */
  units: UnitResponse[];
  /** Name of the currently focused unit, so the matching tab highlights. */
  activeUnitName: string | null;
  /** Re-scope the focused unit to the clicked tab. */
  onSelectUnit: (unit: UnitResponse) => void;
  /** "Add unit = launch Producer" affordance (App's clipboard placeholder). */
  onAddUnit: () => void;
  /** Switch back to the existing ProducerConsole (the default view). The
   *  ENTER toggle lives in StatusBar; this is its EXIT pair, since the
   *  full-window aim console replaces the existing chrome incl. StatusBar. */
  onExit: () => void;
}

export function AimConsole({
  units,
  activeUnitName,
  onSelectUnit,
  onAddUnit,
  onExit,
}: AimConsoleProps) {
  // PR-rail expand state — the only live interaction in the S1 shell. The
  // collapsed 46px rail expands to a 320px panel via the `.pr-open` modifier
  // on the root (mock `body.pr-open { --pr: 320px }`). The panel CONTENT is
  // an S4 stub.
  const [prOpen, setPrOpen] = useState(false);
  const metaUnit = activeUnitName ?? units[0]?.name ?? "—";

  return (
    <div className={cn("aim-console", prOpen && "pr-open")} data-testid="aim-console">
      {/* ── top bar ── */}
      <div className="ac-top">
        <div className="ac-brand">
          <b>tmai</b> console
        </div>
        {units.map((unit) => (
          <AimUnitTab
            key={unit.name}
            unit={unit}
            active={unit.name === activeUnitName}
            onSelect={() => onSelectUnit(unit)}
          />
        ))}
        <button
          type="button"
          className="ac-uadd"
          onClick={onAddUnit}
          title="Add unit = launch a Producer in a unit's primary repo"
          aria-label="Add unit — launch Producer"
        >
          +
        </button>
        <div className="ac-sp" />
        <div className="ac-meta">unit {metaUnit} · opus-4.8 · max</div>
        <button
          type="button"
          className="ac-exit"
          onClick={onExit}
          title="Return to the Producer console"
          aria-label="Return to the Producer console"
        >
          ‹ console
        </button>
      </div>

      {/* ── 3-pane grid ── */}
      <div className="ac-main">
        {/* AIM — S2 worklist (Frontier⊥Tree, ledger, ruler, inspector, modal) */}
        <section className="ac-col ac-aim" aria-label="Aim">
          <AimPane unitName={activeUnitName} />
        </section>

        {/* SESSION — S3 conversation */}
        <section className="ac-col ac-session" aria-label="Session">
          <div className="ac-stabs" aria-hidden="true">
            <span className="ac-stab on">
              <span className="ac-ro p">PROD</span> Producer
            </span>
          </div>
          <PaneStub
            stage="S3"
            note="Session conversation (raw CC), session tabs, and the bash footer land here."
          />
        </section>

        {/* PR RAIL — collapsed rail ⇄ expanded panel (S1); lists are S4 */}
        <section className="ac-col ac-pr" aria-label="PR / Issue rail">
          <button
            type="button"
            className="ac-prrail"
            onClick={() => setPrOpen(true)}
            title="Expand PR / Issue rail"
            aria-label="Expand PR / Issue rail"
            aria-expanded={prOpen}
          >
            <span className="ac-v w">PR</span>
            <span className="ac-v">Issue</span>
            <span className="ac-g">‹ EXTERNAL</span>
          </button>
          <div className="ac-prfull">
            <div className="ac-prh">
              PR / ISSUE — unit {metaUnit}
              <button
                type="button"
                className="ac-x"
                onClick={() => setPrOpen(false)}
                title="Collapse PR / Issue rail"
                aria-label="Collapse PR / Issue rail"
              >
                ✕
              </button>
            </div>
            <div className="ac-prb">
              <PaneStub
                stage="S4"
                note="PR / Issue lists (the rail's expand/collapse content) land here."
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// Top-bar unit tab — repo pills (primary highlighted) + an attention rollup
// badge (⚠N). Mirrors the existing `UnitTabs`/`UnitTab` data wiring (reuses
// `useUnitAttention`, no new wire) but styled with the aim-console tokens.
// Per-unit so each tab calls the hook on its own without a rules-of-hooks
// violation as the tab list grows.
function AimUnitTab({
  unit,
  active,
  onSelect,
}: {
  unit: UnitResponse;
  active: boolean;
  onSelect: () => void;
}) {
  const { data } = useUnitAttention(unit.name);
  const highCount = data?.entries.filter((e) => e.level === "high").length ?? 0;

  return (
    <button
      type="button"
      className={cn("ac-utab", active && "on")}
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      aria-label={`unit: ${unit.name}`}
      title={`unit: ${unit.name}`}
    >
      <span className="ac-d" />
      {unit.repos.map((repo) => (
        <span
          key={repo.path}
          className={cn("ac-rp", repo.primary && "pri")}
          data-testid="aim-repo-pill"
          data-primary={repo.primary ? "true" : "false"}
        >
          {repoBasename(repo.path)}
        </span>
      ))}
      {highCount > 0 && (
        <span className="ac-um" title={`${highCount} owed attention`}>
          ⚠{highCount}
        </span>
      )}
    </button>
  );
}

// Placeholder body for a pane whose real content arrives in a later stage.
function PaneStub({ stage, note }: { stage: string; note: string }) {
  return (
    <div className="ac-stub" data-testid={`aim-pane-stub-${stage.toLowerCase()}`}>
      <span className="ac-stub-stage">{stage}</span>
      <p className="ac-stub-note">{note}</p>
    </div>
  );
}
