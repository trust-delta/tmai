// AimConsole — the destination aim-console shell (S1).
//
// A faithful reproduction of the destination mock
// (`origin/mock/aim-ui-sample` → `assets/ui-sample.html`, dev-tool / scale
// variant): a full-window 3-pane console — Aim (worklist) ⟂ Session (raw CC)
// ⟂ PR-rail — under a sober top bar (brand + unit tabs + meta). Serves aim
// node `aim-ui` (`tmai-core:doc/aims/aim-ui.md`), part of the aim-model
// dogfood.
//
// COEXIST, DO NOT RIP: this is now the DEFAULT surface (see `console-mode.ts`,
// hub #850 / #851 made it self-sufficient: open + close units); the legacy
// ProducerConsole is the opt-OUT via this console's EXIT toggle. The dev-tool
// tokens are scoped to `.aim-console` in `styles/aim-console.css` so they
// never bleed into the existing console.
//
// SCOPE so far: the TOKEN LAYER + the SHELL (S1), the Aim pane (S2), the
// Session pane (S3), its docked bash footer (S4), and the PR-rail lists (S5).
// The top bar (real, data-driven unit tabs) and the 3-pane grid incl. the
// PR-rail expand/collapse transition are S1; the Aim (left) pane is the real
// worklist (Frontier⊥Tree, ledger, overview ruler, inspector, create-aim
// modal — `AimPane`, reusing the Stage B logic layer); the Session (centre)
// pane is the real conversation surface (tabs + shead + term — `SessionPane`,
// reusing the existing console infra) with the real docked bash footer
// (per-repo + ad-hoc shell terminals, reusing `api.spawnPty` +
// `TerminalPanel`); the PR-rail (right) is the real per-repo PR + Issue
// inventory (`PrRail`, reusing `useUnitPrs` / `useUnitIssues` + the
// `prStatusPills` / `issueStatusPills` derivation). The shell is now fully
// filled in. S7 makes the grid drag-resizable: the two pane seams are real
// 5px gutter tracks (`Gutters`), the layout custom properties are driven
// from the persisted `aimConsoleLayout` ui-pref, and drag end (not per-move)
// writes it back.

import { type CSSProperties, useCallback, useState } from "react";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import { useUnitAttention } from "@/hooks/useUnitAttention";
import type { AgentSnapshot, TriggerHandoffRitualRequest, UnitResponse } from "@/lib/api";
import {
  AIM_CONSOLE_LAYOUT_DEFAULTS,
  type AimConsoleLayout,
  clampAimConsolePrWidth,
  normalizeAimConsoleLayout,
} from "@/lib/ui-prefs";
import { useUIPref } from "@/lib/ui-prefs-provider";
import { cn } from "@/lib/utils";
import { AimPane } from "./AimPane";
import { AimSessionGutter, SessionPrGutter } from "./Gutters";
import { PrRail } from "./PrRail";
import { SessionPane } from "./SessionPane";
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
  /** "Add unit = launch Producer" affordance — opens App's repo-root launch
   *  picker (the launch cwd defines the unit; aim `producer-cwd`). */
  onAddUnit: () => void;
  /** Close the unit's Producer slot — kill Producer + dispatched workers +
   *  footer bash (the `producer-kill` teardown, the sole `producer-slot-
   *  invariant` carve-out: close does NOT respawn). Gated behind an always-on
   *  confirm in the tab; called ONLY after that confirm is accepted. */
  onCloseUnit: (unit: UnitResponse) => void;
  /** Switch back to the existing ProducerConsole (the default view). The
   *  ENTER toggle lives in StatusBar; this is its EXIT pair, since the
   *  full-window aim console replaces the existing chrome incl. StatusBar. */
  onExit: () => void;
  /** Live agent list (App's `useAgents`) — drives the Session pane's tabs
   *  (Producer + workers). Threaded in rather than read here so the existing
   *  console keeps the single `useAgents` call. */
  agents: AgentSnapshot[];
  /** Primary repo path for the focused unit (App's `currentProject`) — the
   *  Session pane resolves the single Producer and scopes workers from it. */
  currentProjectPath: string | null;
  /** App-level lifted handoff ritual trigger (one `useHandoffRitual`
   *  instance, in App), forwarded to the Producer's shead. */
  trigger: (unit: string, body: TriggerHandoffRitualRequest) => Promise<void>;
  /** ⚙ deep-link into Settings (auto-handoff threshold), forwarded to the
   *  Producer's shead. */
  onOpenSettings: () => void;
}

export function AimConsole({
  units,
  activeUnitName,
  onSelectUnit,
  onAddUnit,
  onCloseUnit,
  onExit,
  agents,
  currentProjectPath,
  trigger,
  onOpenSettings,
}: AimConsoleProps) {
  // PR-rail expand state — the S1 shell's mechanism. The collapsed 46px rail
  // expands via the `.pr-open` modifier on the root + the inline `--pr`
  // (S7: the persisted drag width, 320px default). The state stays HERE;
  // `PrRail` only renders the rail/panel CONTENT (S5) and calls back to
  // toggle it.
  const [prOpen, setPrOpen] = useState(false);
  const metaUnit = activeUnitName ?? units[0]?.name ?? "—";
  // The focused unit's repos drive the Session pane's per-repo bash footer
  // tabs (S4). A cwd-synthesized unit isn't in the configured membership, so
  // `repos` is empty there — the footer falls back to `currentProjectPath`.
  const activeUnit = units.find((u) => u.name === activeUnitName) ?? null;

  // S7 drag-resizable layout. The persisted pref IS the layout state — a drag
  // adjusts the custom properties imperatively (no re-render per move, see
  // `Gutters`) and commits here once on pointerup; the committed values then
  // render as the same inline custom properties, so React reconciliation and
  // the imperative drag agree. `null` = untouched → defaults.
  const [storedLayout, setStoredLayout] = useUIPref("aimConsoleLayout");
  const layout: AimConsoleLayout = storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS;
  const layoutStyle = {
    "--aim": `${layout.aim}fr`,
    "--sess": `${layout.sess}fr`,
    // Collapsed rail: leave `--pr` to the stylesheet's 46px so the stored
    // expanded width survives without driving the collapsed track.
    "--pr": prOpen ? `${clampAimConsolePrWidth(layout.pr)}px` : undefined,
  } as CSSProperties;

  const commitPanes = useCallback(
    (aim: number, sess: number) =>
      setStoredLayout(
        normalizeAimConsoleLayout({ ...(storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS), aim, sess }),
      ),
    [storedLayout, setStoredLayout],
  );
  const resetPanes = useCallback(
    () =>
      setStoredLayout(
        normalizeAimConsoleLayout({
          ...(storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS),
          aim: AIM_CONSOLE_LAYOUT_DEFAULTS.aim,
          sess: AIM_CONSOLE_LAYOUT_DEFAULTS.sess,
        }),
      ),
    [storedLayout, setStoredLayout],
  );
  const commitPr = useCallback(
    (pr: number) =>
      setStoredLayout(
        normalizeAimConsoleLayout({ ...(storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS), pr }),
      ),
    [storedLayout, setStoredLayout],
  );
  const resetPr = useCallback(
    () =>
      setStoredLayout(
        normalizeAimConsoleLayout({
          ...(storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS),
          pr: AIM_CONSOLE_LAYOUT_DEFAULTS.pr,
        }),
      ),
    [storedLayout, setStoredLayout],
  );

  return (
    <div
      className={cn("aim-console", prOpen && "pr-open")}
      data-testid="aim-console"
      style={layoutStyle}
    >
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
            onClose={() => onCloseUnit(unit)}
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

      {/* ── 3-pane grid + 5px gutter tracks (S7) ── */}
      <div className="ac-main">
        {/* AIM — S2 worklist (Frontier⊥Tree, ledger, ruler, inspector, modal) */}
        <section className="ac-col ac-aim" aria-label="Aim">
          <AimPane unitName={activeUnitName} />
        </section>

        {/* gutter A — Aim|Session */}
        <AimSessionGutter
          aimShare={(layout.aim / (layout.aim + layout.sess)) * 100}
          onCommit={commitPanes}
          onReset={resetPanes}
        />

        {/* SESSION — S3 conversation (tabs + shead + term) + S4 bash footer */}
        <section className="ac-col ac-session" aria-label="Session">
          <SessionPane
            agents={agents}
            unitName={activeUnitName}
            currentProjectPath={currentProjectPath}
            trigger={trigger}
            onOpenSettings={onOpenSettings}
            repos={activeUnit?.repos ?? []}
          />
        </section>

        {/* gutter B — Session|PR (inert while the rail is collapsed) */}
        <SessionPrGutter
          open={prOpen}
          prWidth={clampAimConsolePrWidth(layout.pr)}
          onCommit={commitPr}
          onReset={resetPr}
        />

        {/* PR RAIL — collapsed rail ⇄ expanded panel (S1 mechanism); the
            per-repo PR + Issue lists + live counts are the real S5 content */}
        <section className="ac-col ac-pr" aria-label="PR / Issue rail">
          <PrRail
            unitName={activeUnitName}
            unitLabel={metaUnit}
            repos={activeUnit?.repos ?? []}
            open={prOpen}
            onExpand={() => setPrOpen(true)}
            onCollapse={() => setPrOpen(false)}
          />
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
  onClose,
}: {
  unit: UnitResponse;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { data } = useUnitAttention(unit.name);
  const highCount = data?.entries.filter((e) => e.level === "high").length ?? 0;

  // Always-on confirm gate (mirrors the legacy UnitTabs, same copy): close =
  // kill (Producer + workers + footer bash), so it is never silent. Nesting a
  // <button> inside the tab <button> is invalid, so the close × is a sibling
  // under a wrapper, exactly as UnitTabs does it.
  const confirm = useConfirm();
  const handleClose = async () => {
    const ok = await confirm({
      title: `Close unit ${unit.name}?`,
      message:
        "Close kills this unit's Producer, its dispatched workers, and its footer bash. " +
        "This is a kill, not a delete — worktrees and uncommitted work stay on disk.",
      confirmLabel: "Close unit",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (ok) onClose();
  };

  return (
    <div className="ac-utab-wrap">
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
      <button
        type="button"
        className="ac-uclose"
        onClick={handleClose}
        aria-label={`Close unit ${unit.name}`}
        title={`Close unit ${unit.name} — kill Producer + workers + footer bash (worktrees stay)`}
      >
        ×
      </button>
    </div>
  );
}
