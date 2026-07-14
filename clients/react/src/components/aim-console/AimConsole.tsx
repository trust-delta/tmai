// AimConsole — the destination aim-console shell (S1).
//
// A faithful reproduction of the destination mock
// (`origin/mock/aim-ui-sample` → `assets/ui-sample.html`, dev-tool / scale
// variant): a full-window 3-pane console — Aim (worklist) ⟂ Session (raw CC)
// ⟂ PR-rail — under a sober top bar (brand + unit tabs + meta). Serves aim
// node `aim-project-artifact` (`tmai-core:docs/aims/aim-project-artifact.md`) —
// the console IS the first-class artifact display + operation surface. (The old
// `aim-ui` node was archived in the corpus rebuild, tmai-core #528.)
//
// THE SOLE SURFACE: the legacy ProducerConsole / R-panel shell was ripped —
// aim is the only console now (no mode toggle, no EXIT pair). This console is
// self-sufficient: open + close units, launch Producers, drive the whole dev
// loop. The dev-tool tokens are scoped to `.aim-console` in
// `styles/aim-console.css`.
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

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import type { AgentSnapshot, SlotResponse, TriggerHandoffRitualRequest } from "@/lib/api";
import {
  AIM_CONSOLE_LAYOUT_DEFAULTS,
  type AimConsoleLayout,
  clampAimConsoleConvWidth,
  clampAimConsolePrWidth,
  normalizeAimConsoleLayout,
} from "@/lib/ui-prefs";
import { useUIPref } from "@/lib/ui-prefs-provider";
import { cn } from "@/lib/utils";
import { AimPane } from "./AimPane";
import { AimRemoteGutter, ConvAimGutter, OverlayEdgeGutter } from "./Gutters";
import { PrRail } from "./PrRail";
import { advanceCursor, effectiveCursor } from "./remote-delta";
import { SessionPane } from "./SessionPane";
import type { UnitSignal } from "./unit-signal";
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

// Drag-to-dock GUARD: dock only delivers its value (Aim + Remote both visible
// AND usable) when the Aim pane keeps a usable width. So the dock/overlay
// boundary is not a fixed --pr threshold but "does the Remote still leave Aim
// at least this many px?" — window- and conversation-width adaptive. Pull the
// Remote so wide that Aim would drop below this floor and it stays/floats to
// OVERLAY instead of docking; keep it narrow enough and it docks. (Tunable by
// feel.)
const DOCK_MIN_AIM_PX = 400;
// Two 5px pane gutters sit between Conversation | Aim | Remote when docked.
const DOCK_GUTTERS_PX = 10;

// The widest Remote (`--pr`) that can dock while leaving Aim ≥ DOCK_MIN_AIM_PX,
// measured live off the grid. Below/at this width docking fits; above it, Aim
// would be crushed, so the Remote stays an overlay.
function maxDockablePr(main: HTMLElement | null): number {
  if (main === null) return Number.POSITIVE_INFINITY;
  const consoleW = main.getBoundingClientRect().width;
  const convW = main.querySelector(".ac-session")?.getBoundingClientRect().width ?? 0;
  return consoleW - convW - DOCK_GUTTERS_PX - DOCK_MIN_AIM_PX;
}

function repoBasename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

interface AimConsoleProps {
  /** Live Producer-slot set (App's `useSlots`, tmai-core #580 — aim
   *  `producer-cwd`), rendered as the top-bar unit tabs: a project is *where a
   *  Producer stood*, so a dormant `[[unit]]` with no live Producer is not a
   *  tab until its "+" Add-unit launch stands one. Empty = no live slots. Each
   *  slot carries `name + repos` (same membership the tabs + per-repo footer
   *  use) plus a lifecycle `state` (occupied / vacant / halted). */
  units: SlotResponse[];
  /** Per-unit cross-unit tab signal, keyed by unit name (App resolves it from
   *  the sibling sources, precedence-collapsed in `unit-signal.ts`). A unit's
   *  dot renders its signal; absent / `null` = quiet. Only the `owed` source
   *  (handoff `awaiting_review`) is populated today. Optional so tests and any
   *  pre-signal caller render a quiet strip. */
  unitSignals?: Record<string, UnitSignal | null>;
  /** Name of the currently focused unit, so the matching tab highlights. */
  activeUnitName: string | null;
  /** Re-scope the focused unit to the clicked tab. */
  onSelectUnit: (unit: SlotResponse) => void;
  /** "Add unit = launch Producer" affordance — opens App's repo-root launch
   *  picker (the launch cwd defines the unit; aim `producer-cwd`). */
  onAddUnit: () => void;
  /** Close the unit's Producer slot — kill Producer + dispatched workers +
   *  footer bash (the `producer-kill` teardown, the sole `producer-slot-
   *  invariant` carve-out: close does NOT respawn). Gated behind an always-on
   *  confirm in the tab; called ONLY after that confirm is accepted. */
  onCloseUnit: (unit: SlotResponse) => void;
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
  /** The in-progress handoff overlay (App-built from the single
   *  `useHandoffRitual` state), rendered INSIDE the Session column so a handoff
   *  covers only the conversation — not the whole console. `absolute inset-0`
   *  against `.ac-session`'s `position: relative`; `null` when no ritual runs
   *  for the focused unit. Threaded in (not built here) so the existing console
   *  keeps the single ritual instance. */
  handoffOverlay?: ReactNode;
}

export function AimConsole({
  units,
  unitSignals = {},
  activeUnitName,
  onSelectUnit,
  onAddUnit,
  onCloseUnit,
  agents,
  currentProjectPath,
  trigger,
  onOpenSettings,
  handoffOverlay,
}: AimConsoleProps) {
  // Remote-panel state (root-layout `conversation-anchor`). The collapsed 46px
  // rail (right edge) `remoteOpen`s to the Remote panel. The DEFAULT open mode
  // is an OVERLAY drawer that floats over the right of the Aim pane — the
  // Conversation (left, fixed-px anchor) and Aim columns do NOT reflow, so the
  // operator's fixation point never shifts. `remoteDocked` is the transient
  // opt-in to push the Aim pane aside instead (both visible side-by-side); it
  // resets to overlay on close (no persisted mode — a momentary need, not a
  // standing preference). The state stays HERE; `PrRail` renders the
  // rail/panel CONTENT and calls back to toggle.
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteDocked, setRemoteDocked] = useState(false);
  const metaUnit = activeUnitName ?? units[0]?.name ?? "—";
  // The focused unit's repos drive the Session pane's per-repo bash footer
  // tabs (S4). A cwd-synthesized unit isn't in the configured membership, so
  // `repos` is empty there — the footer falls back to `currentProjectPath`.
  const activeUnit = units.find((u) => u.name === activeUnitName) ?? null;

  // Remote-Δ freshness cursors (#822; #606 §1 lift) — the `remoteDeltaCursors`
  // ui-pref (per-unit). Client state only, never sent to core; the Producer
  // never reads it. `AimConsole` owns the FOCUSED unit's close act here; App
  // owns the cross-unit tab-leave stamp (aim `cross-unit-remote-delta`) — both
  // write the same UIPrefs field, which the context keeps in sync. `PrRail` is
  // presentational and only receives the effective cursors. The rail has ONE
  // close act — the rail
  // collapse — so it stamps the coarse `panel` cursor, which via `effectiveCursor`
  // = MAX(panel, section) clears BOTH sections (collapsing the whole rail = done
  // looking at all of it). No section-level close acts, no timers, no per-row
  // marking (the operator-ratified exclusion list).
  const [cursors, setCursors] = useUIPref("remoteDeltaCursors");
  const prsCursor =
    activeUnitName === null ? null : effectiveCursor(cursors, activeUnitName, "prs");
  const issuesCursor =
    activeUnitName === null ? null : effectiveCursor(cursors, activeUnitName, "issues");
  // Remote-collapse close act: stamp the unit's `panel` cursor (the "when the
  // operator last stopped looking" timestamp), then collapse + reset the dock
  // mode to the overlay default. Expanding is the START of looking, not a close
  // act, so opening stays the plain `setRemoteOpen(true)`.
  const collapseRemote = useCallback(() => {
    if (activeUnitName !== null) {
      setCursors(advanceCursor(cursors, activeUnitName, "panel", new Date().toISOString()));
    }
    setRemoteOpen(false);
    setRemoteDocked(false);
  }, [activeUnitName, cursors, setCursors]);

  // Click-outside-to-close, OVERLAY ONLY. The overlay is a transient peek with
  // no ✕ — a pointerdown anywhere outside the floating drawer collapses it
  // (which stamps the close-act cursor via `collapseRemote`). A docked Remote
  // is a deliberate side-by-side and is NOT dismissed by outside clicks (it has
  // its own ✕); clicks INSIDE the drawer (incl. the ⊟/⊞ toggle) never close.
  useEffect(() => {
    if (!remoteOpen || remoteDocked) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // Inside the drawer, OR on its drag-to-dock edge handle (which lives just
      // outside the drawer) — not an "outside" click, don't close.
      if (target?.closest(".ac-prfull") || target?.closest(".ac-ovgut")) return;
      collapseRemote();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [remoteOpen, remoteDocked, collapseRemote]);

  // Drag-resizable layout. The persisted pref IS the layout state — a drag
  // adjusts the custom properties imperatively (no re-render per move, see
  // `Gutters`) and commits here once on pointerup; the committed values then
  // render as the same inline custom properties, so React reconciliation and
  // the imperative drag agree. `null` = untouched → defaults.
  const [storedLayout, setStoredLayout] = useUIPref("aimConsoleLayout");
  const layout: AimConsoleLayout = storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS;
  const conv = clampAimConsoleConvWidth(layout.conv);
  const pr = clampAimConsolePrWidth(layout.pr);
  const layoutStyle = {
    // Conversation anchor width (capped to 62vw live so a wide value never
    // starves the Aim + Remote side on a small window).
    "--conv": `${conv}px`,
    // Drives the overlay drawer width + the docked Remote track only while open;
    // collapsed leaves it to the stylesheet's 46px rail so the stored open width
    // survives a collapse.
    "--pr": remoteOpen ? `${pr}px` : undefined,
  } as CSSProperties;

  const commitConv = useCallback(
    (c: number) =>
      setStoredLayout(
        normalizeAimConsoleLayout({ ...(storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS), conv: c }),
      ),
    [storedLayout, setStoredLayout],
  );
  const resetConv = useCallback(
    () =>
      setStoredLayout(
        normalizeAimConsoleLayout({
          ...(storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS),
          conv: AIM_CONSOLE_LAYOUT_DEFAULTS.conv,
        }),
      ),
    [storedLayout, setStoredLayout],
  );
  const commitPr = useCallback(
    (prPx: number) =>
      setStoredLayout(
        normalizeAimConsoleLayout({ ...(storedLayout ?? AIM_CONSOLE_LAYOUT_DEFAULTS), pr: prPx }),
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

  // Drag-to-dock (GUARD): committing the Remote width also snaps the mode by the
  // Aim-room guard — dock IF the released width still leaves Aim ≥ the usable
  // floor, else float to overlay. So dragging the Remote to a width that fits
  // beside Aim docks it; dragging it so wide (or on a window/conversation too
  // narrow) that Aim would be crushed keeps/pops it to overlay. Decided on
  // release (not per-move) so the overlay never re-positions mid-drag. The ⊟/⊞
  // button is a manual override (it toggles directly, ignoring the guard).
  const mainRef = useRef<HTMLDivElement>(null);
  const commitRemoteWidth = useCallback(
    (finalPr: number) => {
      commitPr(finalPr);
      setRemoteDocked(finalPr <= maxDockablePr(mainRef.current));
    },
    [commitPr],
  );
  // Live preview during a drag: "would this width dock?" — the gutters use it to
  // signal (amber seam + "release to dock/float" readout) when releasing now
  // would FLIP the mode, so the threshold is legible mid-drag.
  const previewDock = useCallback((prPx: number) => prPx <= maxDockablePr(mainRef.current), []);

  return (
    <div
      className={cn(
        "aim-console",
        remoteOpen && "remote-open",
        remoteOpen && remoteDocked && "remote-dock",
      )}
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
            signal={unitSignals[unit.name] ?? null}
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
        {/* ⚙ Settings — app-level (the WebUI/Producer config affects the whole
            console, not one conversation), so it lives in the top-bar chrome
            beside the exit, not in a Session pane's shead. */}
        <button
          type="button"
          className="ac-settings"
          onClick={onOpenSettings}
          title="Open settings"
          aria-label="Open settings"
        >
          ⚙
        </button>
      </div>

      {/* ── 3-pane grid (Conversation anchor | Aim | Remote) + gutters ──
          Order: Conversation LEFT (the fixed-px fixation anchor) → Aim MIDDLE
          (1fr, the sole absorber) → Remote RIGHT (rail / overlay / docked). So
          opening / docking the Remote only ever moves the Aim pane; the
          conversation never shifts. `.ac-main` is the positioned ancestor the
          overlay drawer floats over (see aim-console.css). */}
      <div className="ac-main" ref={mainRef}>
        {/* CONVERSATION — the anchor (tabs + shead + term + S4 bash footer).
            `.ac-session` is `position: relative` so the in-progress handoff
            overlay (`handoffOverlay`, `absolute inset-0`) scopes to THIS column:
            a handoff covers only the conversation, leaving the top-bar unit
            tabs, the Aim worklist, and the Remote rail usable. */}
        <section className="ac-col ac-session" aria-label="Session">
          <SessionPane
            agents={agents}
            unitName={activeUnitName}
            currentProjectPath={currentProjectPath}
            trigger={trigger}
            repos={activeUnit?.repos ?? []}
          />
          {handoffOverlay}
        </section>

        {/* gutter A — Conversation|Aim (resizes the anchor width) */}
        <ConvAimGutter convWidth={conv} onCommit={commitConv} onReset={resetConv} />

        {/* AIM — worklist (Frontier⊥Tree, ledger, ruler, inspector, modal) */}
        <section className="ac-col ac-aim" aria-label="Aim">
          <AimPane unitName={activeUnitName} />
        </section>

        {/* gutter B — Aim|Remote (active while DOCKED; resizing narrower than
            the undock threshold floats it back to overlay on release) */}
        <AimRemoteGutter
          active={remoteOpen && remoteDocked}
          prWidth={pr}
          onCommit={commitRemoteWidth}
          onReset={resetPr}
          previewDock={previewDock}
        />

        {/* REMOTE — collapsed rail ⇄ overlay drawer ⇄ docked column. The
            per-repo PR + Issue lists + live counts + remote-Δ are the content. */}
        <section className="ac-col ac-pr" aria-label="PR / Issue rail">
          <PrRail
            unitName={activeUnitName}
            unitLabel={metaUnit}
            repos={activeUnit?.repos ?? []}
            open={remoteOpen}
            docked={remoteOpen && remoteDocked}
            onExpand={() => setRemoteOpen(true)}
            onCollapse={collapseRemote}
            onToggleDock={() => setRemoteDocked((d) => !d)}
            prsCursor={prsCursor}
            issuesCursor={issuesCursor}
          />
        </section>

        {/* Overlay edge handle — drag the floating drawer's left edge to resize;
            pulled wider than the dock threshold, it snaps to DOCK on release. */}
        {remoteOpen && !remoteDocked && (
          <OverlayEdgeGutter
            prWidth={pr}
            onCommit={commitRemoteWidth}
            onReset={resetPr}
            previewDock={previewDock}
          />
        )}
      </div>
    </div>
  );
}

// Human-readable reason per signal, surfaced on the tab's hover/aria so the
// operator learns WHAT a non-focused unit owes without switching to it (aim
// `cross-unit-operator-owed`: "provenance と理由は hover / on-switch の string
// で示す"). Only `owed` has a live source today (handoff review gate); the
// others are named ahead of their sources landing.
const SIGNAL_REASON: Record<UnitSignal, string> = {
  owed: "operator action owed — handoff awaiting review",
  fresh: "new remote activity",
  idle: "idle — no motion",
};

// Top-bar unit tab — repo pills (primary highlighted), styled with the
// aim-console tokens.
function AimUnitTab({
  unit,
  active,
  signal,
  onSelect,
  onClose,
}: {
  unit: SlotResponse;
  active: boolean;
  signal: UnitSignal | null;
  onSelect: () => void;
  onClose: () => void;
}) {
  const signalReason = signal ? SIGNAL_REASON[signal] : null;
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
        aria-label={signalReason ? `unit: ${unit.name}, ${signalReason}` : `unit: ${unit.name}`}
        title={signalReason ? `unit: ${unit.name} — ${signalReason}` : `unit: ${unit.name}`}
      >
        <span
          className={cn("ac-d", signal && `sig-${signal}`)}
          data-signal={signal ?? undefined}
          aria-hidden="true"
        />
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
