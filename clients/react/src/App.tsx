import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AimConsole } from "@/components/aim-console/AimConsole";
import { HandoffRitualFailureDialog } from "@/components/aim-console/HandoffRitualFailureDialog";
import { HandoffRitualOverlay } from "@/components/aim-console/HandoffRitualOverlay";
import { advanceCursor, unitHasUnobserved } from "@/components/aim-console/remote-delta";
import {
  handoffOwesReview,
  resolveUnitSignal,
  type UnitSignal,
} from "@/components/aim-console/unit-signal";
import { HelpOverlay } from "@/components/layout/HelpOverlay";
import { ToastContainer, useToast } from "@/components/layout/ToastContainer";
import { ProducerLaunchPicker } from "@/components/project/ProducerLaunchPicker";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { useApplyTheme } from "@/hooks/useActiveTheme";
import { useAgents } from "@/hooks/useAgents";
import { useCrossUnitRemoteDelta } from "@/hooks/useCrossUnitRemoteDelta";
import { useHandoffRitual } from "@/hooks/useHandoffRitual";
import { useIdleNotification } from "@/hooks/useIdleNotification";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNotificationConfig } from "@/hooks/useNotificationConfig";
import { useSlots } from "@/hooks/useSlots";
import { useWorktrees } from "@/hooks/useWorktrees";
import {
  api,
  groupByProject,
  isAiAgentLoose,
  resolveUnitName,
  type SlotResponse,
  setCallerCwd,
} from "@/lib/api";
import { closeUnitSlot } from "@/lib/close-unit-slot";
import { currentProjectBelongsToLiveProject } from "@/lib/current-project";
import { findProducerForUnit } from "@/lib/producer";
import { useSSE } from "@/lib/sse-provider";
import { useUIPref } from "@/lib/ui-prefs-provider";

// Grace window before the focus auto-default bounces a unit whose Producer
// briefly left the live set (handoff respawn / restart kill→relaunch) to
// another live unit. Comfortably covers the respawn launch window; a genuine
// stop still resets after it (aim `handoff-producer-unit-focus`).
const FOCUS_GRACE_MS = 12_000;

export function App() {
  // Apply the active WebUI theme's css vars to <html> and keep them in
  // sync when the user switches themes in Settings — re-skins the whole
  // UI live, no reload.
  useApplyTheme();

  const { agents, refresh } = useAgents();
  // `worktrees` still feeds project grouping (sidebar agent-less worktrees +
  // `projectPaths` derivation); the BranchGraph/WorktreePanel views that
  // mutated worktrees retired with the multipane, so no refresh handle here.
  const { worktrees } = useWorktrees();
  const toast = useToast();
  const { success: toastSuccess, info: toastInfo } = toast;

  // Browser notification on agent idle. The config refetches on window focus /
  // visibility change so toggling "Notify on idle" in Settings — which
  // tmai-core hot-reloads server-side (#255) — actually flips the WebUI
  // behaviour on the next focus event without a tab reload.
  const notifyConfig = useNotificationConfig();
  const { handleAgentStopped } = useIdleNotification(agents, notifyConfig);

  // Listen for agent_stopped SSE event for immediate hook-based notifications
  useSSE({
    onEvent: (eventName, data) => {
      if (eventName === "agent_stopped") {
        const d = data as { target: string; cwd: string; last_assistant_message?: string };
        handleAgentStopped(d);
        // Surface last_assistant_message in the toast so it appears in an isolated
        // UI surface — not in the conversation input (fixes #9).
        if (d.last_assistant_message) {
          toastInfo(d.last_assistant_message);
        }
      }
    },
  });
  const [currentProject, setCurrentProject] = useState<string | null>(null);
  // Main panel takes one of `"agents"` (default), `"settings"`, or
  // `"calibration"`. They replace the main panel content (not modal overlays),
  // so they're mutually exclusive — opening one always closes the other.
  // The previous two-booleans-cleared-in-tandem pattern was equivalent but
  // more error-prone; this enum makes the constraint explicit.
  const [mainPanel, setMainPanel] = useState<"agents" | "settings">("agents");
  const [showHelp, setShowHelp] = useState(false);
  const showSettings = mainPanel === "settings";
  // Post-inversion default (aim `producer-centric-project`): orchestrator-era
  // controls are routed behind a `<details>` section inside SettingsPanel so
  // the Producer-relevant sections show first. The flag below distinguishes:
  //
  // - regular Settings entry (StatusBar button / Ctrl+,) → Advanced
  //   stays collapsed; the Producer-relevant sections are what you
  //   see first.
  // - "Open Settings" deep-link from `ProducerConsoleActions`'
  //   Operator override panel → Advanced opens by default; the
  //   operator deliberately asked to bypass the Producer, so we
  //   land them on the orchestrator-era controls directly.
  const [settingsOpenedFromOverride, setSettingsOpenedFromOverride] = useState(false);
  const closeMainPanelOverlay = useCallback(() => setMainPanel("agents"), []);
  const toggleSettings = useCallback(() => {
    setSettingsOpenedFromOverride(false);
    setMainPanel((mp) => (mp === "settings" ? "agents" : "settings"));
  }, []);
  const openSettingsFromOverride = useCallback(() => {
    setSettingsOpenedFromOverride(true);
    setMainPanel("settings");
  }, []);

  // Live Producer-slot set (tmai-core #580 — aim `producer-cwd`) — the
  // agent-primacy tab source AND the sole unit→repo membership surface. Since
  // the config-unit rip (tmai-core #623) retired the configured-unit
  // enumeration (`/units`), `useSlots` is the one membership source: it drives
  // the active `unitName` resolution (below), the multi-repo Producer
  // resolution (`findProducerForUnit`) and the aim-console tab strip.
  // `unit ≡ live Producer`, so a unit
  // surfaces here iff it has a live Producer — read BEFORE `unitName` because
  // the active unit is resolved by membership, not the project-path basename.
  const { data: slotsData, loading: slotsLoading } = useSlots();

  // The active unit NAME, fed to the unit-scoped wires (`GET
  // /api/units/{unit}/…`). Anchored to the slot that OWNS `currentProject` in
  // the live membership — NOT the basename of the project path. A multi-repo
  // unit's `currentProject` can resolve to a SECONDARY repo (e.g.
  // `…/tmai-core`, basename "tmai-core") while the unit — and every agent's
  // wire `unit` — is "tmai"; a basename derivation then mismatched the
  // SessionPane `agent.unit === unitName` filter and hid the unit's own agents
  // (the aim-console worker-invisibility bug). `resolveUnitName` falls back to
  // the basename when no live slot matches — the same cwd-synthesized-unit
  // behaviour the backend's `resolve_unit_or_cwd` and the CLI give for an
  // unconfigured cwd.
  const unitName = useMemo(() => {
    // Hold while the membership wire is still loading: until it arrives we
    // cannot tell which unit owns `currentProject`, and resolving by basename
    // in the meantime would briefly mis-scope a multi-repo unit to its
    // SECONDARY repo before slots land. Once loading clears — even on fetch
    // failure (`data` stays null) — we fall through to the basename, the same
    // as an unconfigured cwd.
    if (slotsLoading) return null;
    return resolveUnitName(currentProject, slotsData?.slots ?? []);
  }, [currentProject, slotsData, slotsLoading]);

  // ── Producer handoff-and-restart ritual (lifted to App level) ──
  //
  // Exactly ONE `useHandoffRitual` instance for the whole app. The
  // trigger flows down to BOTH trigger sites (the digest's `Handoff &
  // restart` button via ProducerConsole, and the conversation header),
  // while the in-progress overlay / failure dialog / ready-toast render
  // HERE as App-level siblings of TripwireBanner / ToastContainer — so
  // they stay co-visible regardless of which centre view is shown
  // (digest, Producer conversation, Settings, …). It used to live inside
  // the digest-only ProducerConsoleActions, which left the trigger
  // unreachable while conversing with the Producer (lived friction
  // 2026-05-23). Two hook instances would mean two overlays, so this
  // MUST remain the only one.
  const {
    state: ritualState,
    unitPhases: handoffUnitPhases,
    trigger: triggerHandoff,
    retry: retryHandoff,
    dismiss: dismissHandoff,
    retryCount: handoffRetryCount,
    retryRefused: handoffRetryRefused,
  } = useHandoffRitual();

  // Remote-Δ freshness cursors (client-state, UIPrefs context). AimConsole
  // owns the focused unit's close act (R-panel collapse → `collapseRemote`);
  // App owns the cross-unit stamp below. Both write the SAME context field, so
  // they stay in sync (the provider is a single source).
  const [cursors, setCursors] = useUIPref("remoteDeltaCursors");

  // Fan the remote-Δ read across every live unit (aim `cross-unit-remote-delta`).
  // The focused-unit instrument only ever polled the one focused unit; this
  // lifts the same per-unit PR / issue read to every tab so a NON-focused unit's
  // unobserved artifact can light its tab. Keyed by unit name, 60s poll.
  const slotNames = useMemo(() => (slotsData?.slots ?? []).map((s) => s.name), [slotsData]);
  const crossUnitDelta = useCrossUnitRemoteDelta(slotNames);

  // Tab-leave close act — the cross-unit analog of the R-panel collapse (aim
  // `cross-unit-remote-delta` PROCESS: cursor = "when this tab was last looked
  // at"). Switching focus AWAY from a unit stamps its `panel` cursor, so its
  // freshness dot clears and only NEW activity re-lights it. This is the THIRD
  // cursor-advance act (alongside the R-panel + section collapses) — still an
  // explicit operator act, not a timer / visibilitychange (the operator-ratified
  // exclusion list in remote-delta.ts). Needed because the panel-collapse close
  // act only fires when the R panel is OPEN; switching tabs with it closed (the
  // common case) would otherwise never advance a non-focused unit's cursor,
  // pinning its dot on forever.
  const prevUnitRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevUnitRef.current;
    if (prev !== null && prev !== unitName) {
      setCursors(advanceCursor(cursors, prev, "panel", new Date().toISOString()));
    }
    prevUnitRef.current = unitName;
  }, [unitName, cursors, setCursors]);

  // Per-unit cross-unit tab signal (aim `1-worktree-merge`'s cross-unit
  // family). One dot per unit tab, precedence-collapsed (owed > fresh > idle).
  // `owed` — a unit whose latest handoff phase is `awaiting_review` owes the
  // operator a review act (aim `cross-unit-operator-owed`), surfaced even when
  // NOT focused. `fresh` — a non-focused unit with any unobserved remote
  // artifact (aim `cross-unit-remote-delta`). `idle` (`cross-unit-idle-passive`)
  // drops in here later without re-architecting the tab.
  const unitSignals = useMemo(() => {
    const out: Record<string, UnitSignal | null> = {};
    for (const slot of slotsData?.slots ?? []) {
      out[slot.name] = resolveUnitSignal({
        owed: handoffOwesReview(handoffUnitPhases[slot.name]),
        fresh: unitHasUnobserved(crossUnitDelta[slot.name], cursors, slot.name),
      });
    }
    return out;
  }, [slotsData, handoffUnitPhases, crossUnitDelta, cursors]);

  // The Producer of the unit the ESCALATED handoff ritual is for
  // (`ritualState.unit`), resolved from the live membership — NOT from the
  // focused unit. The handoff FAILURE dialog is shown for `ritualState.unit`
  // regardless of which unit is focused, so every action it drives (Force-kill
  // target, Retry, Resume-in-CC id) must target THAT unit. Deriving these from
  // the focused unit mis-fired: a failed handoff whose Producer dropped from
  // the live set auto-bounced focus (`FOCUS_GRACE_MS`) to another unit, and
  // Force-kill then killed the WRONG, unopened unit's Producer
  // (operator-reported 2026-07-15). `null` when the ritual's unit has no live
  // Producer — the dialog then disables Force-kill / Resume rather than falling
  // back to the focused unit's Producer. `findProducerForUnit` scoped to the
  // ritual unit's own repos can only ever match that unit's Producer, so a
  // cross-unit mis-kill is now structurally impossible.
  const ritualUnitProducer = useMemo(() => {
    if (ritualState.kind !== "escalated" || ritualState.unit === "") return null;
    const repos = slotsData?.slots.find((s) => s.name === ritualState.unit)?.repos ?? null;
    return repos === null ? null : findProducerForUnit(agents, repos);
  }, [ritualState, slotsData, agents]);

  // Auto-dismiss `ready` with a brief success toast (handoff-lifecycle
  // DR §E overlay spec). Moved up from ProducerConsoleActions with the
  // rest of the ritual UI.
  const [handoffReadyToastVisible, setHandoffReadyToastVisible] = useState(false);
  useEffect(() => {
    if (ritualState.kind !== "ready") return;
    setHandoffReadyToastVisible(true);
    const t = setTimeout(() => {
      setHandoffReadyToastVisible(false);
      dismissHandoff();
    }, 2500);
    return () => clearTimeout(t);
  }, [ritualState.kind, dismissHandoff]);

  const handleHandoffRetry = useCallback(() => {
    // Retry re-attempts the handoff for the unit the ritual FAILED for
    // (`ritualState.unit`), not the focused unit — the failure dialog can be
    // showing for a unit other than the focused one (see `ritualUnitProducer`).
    if (ritualState.kind !== "escalated" || ritualState.unit === "") return;
    void retryHandoff(ritualState.unit, { trigger: "manual" });
  }, [retryHandoff, ritualState]);

  const handleHandoffForceKill = useCallback(async () => {
    // Kill the RITUAL unit's Producer, never the focused unit's (see
    // `ritualUnitProducer`). `null` → the ritual unit has no live Producer, so
    // there is nothing to kill (the dialog's Force-kill is already disabled).
    if (ritualUnitProducer === null) return;
    try {
      await api.killAgent(ritualUnitProducer.target);
    } catch {
      // Best-effort — if the kill fails (already dead, etc.) we still
      // dismiss; the dialog already surfaced the upstream failure.
    }
    dismissHandoff();
  }, [ritualUnitProducer, dismissHandoff]);

  // The "Open Producer terminal" affordance.
  //
  // Per aim `cli-pty-server`: the Producer conversation stays on the terminal
  // substrate (substrate swap is rejected — see aim `configurable-cli-substrate`).
  // The WebUI's job is just to make the canonical command trivially
  // copy-pasteable.
  //
  // `navigator.clipboard.writeText` requires a secure context;
  // `localhost` qualifies, so it works in dev. When the API isn't
  // available (or rejects) we still surface the command in a toast
  // so the operator can copy it by hand — no silent failure.
  // `tmai producer <unit>` is implemented as an `exec`-style command
  // (`tmai-core/src/producer_cli.rs::launch_producer`) — the tmai
  // subprocess composes the hand-over, then replaces itself with a
  // Claude session seeded with that hand-over as the initial prompt.
  // From the PTY-server's perspective this is a normal spawn, so we
  // treat it as one.
  //
  // Caveat that bit on first dogfood: the WebUI derives `unitName`
  // from the *currently-selected* project, which itself comes from
  // *currently-running* agents. On a clean start with no agents,
  // there's no project, so no unit — the Producer launch button used
  // to disable itself there (chicken-and-egg). We now split the path:
  //
  //   - `launchProducerAt(path)` is the actual spawn — takes a repo
  //     root path explicitly, derives the unit name from its basename,
  //     and `setCurrentProject`s it so the next click skips the dir
  //     picker.
  //   - `openProducerTerminal` is the "hot path" callable when
  //     `currentProject` is already set; it delegates to the above.
  //     When nothing is set, ProducerConsoleActions opens a DirBrowser
  //     instead and calls `launchProducerAt` with the picked path.
  const launchProducerAt = useCallback(
    async (path: string) => {
      if (!path) {
        toastInfo("No path chosen.");
        return;
      }
      // Display label only — the engine derives the REAL unit from the path.
      const label = path.split("/").filter(Boolean).pop() ?? path;
      try {
        // By-PATH launch (#581 — the `+` Add-unit bootstrap fix): send the
        // picked ABSOLUTE PATH, not its basename. The engine derives the unit
        // from it (`unit_for_path` — the owning `[[unit]]`, else a `from_dir`
        // synthesis), so a brand-new project root launches where the old
        // by-name basename 404'd (`no [[unit]] named '<basename>'`). The
        // launched process IS `claude` (`agent_type=claude` + `is_producer` at
        // the spawn act), no bash / tmai shim. A missing dir returns 400 → the
        // failure toast below.
        // The launched Producer surfaces in the aim console via the live slot
        // set (`useSlots`); focusing its unit (setCurrentProject) is enough —
        // the aim console owns session selection, so no App-level selection.
        await api.launchProducer(path);
        setCurrentProject(path);
        closeMainPanelOverlay();
        refresh();
        toastSuccess(`Producer launched for ${label}`);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        toastInfo(`Failed to launch Producer: ${reason}`);
      }
    },
    [closeMainPanelOverlay, refresh, toastSuccess, toastInfo],
  );

  // Sync selected project into the API client so X-Tmai-Origin carries cwd.
  useEffect(() => {
    setCallerCwd(currentProject);
  }, [currentProject]);

  // Split agents into AI agents and plain terminals. `isAiAgentLoose`
  // catches the bash-wrapped Producer (id starts `claude:` but
  // `agent_type` reads `Custom("bash")`) so it lands in `aiAgents` and
  // its repo participates in `projectPaths` / `currentProject`
  // auto-default — without this the Producer console's ⬡ Settled
  // decisions and ▶ Where-you-left-off sections stay parked (#676 +
  // #685 ergonomics).
  const aiAgents = useMemo(() => agents.filter(isAiAgentLoose), [agents]);

  // Project list derived from active agents (replaces the pre-registered list).
  // Used by the keyboard shortcuts to cycle the X-Tmai-Origin scope and by
  // ProducerSection's per-project override selector.
  const projectPaths = useMemo(
    () => groupByProject(aiAgents, worktrees).map((p) => p.path),
    [aiAgents, worktrees],
  );

  // Default currentProject to the first derived project once one appears so
  // X-Tmai-Origin has a sensible scope before the user touches the sidebar.
  // Also reset the scope when the previously selected project disappears
  // (e.g. its last agent stopped) so we never keep sending a stale cwd —
  // CodeRabbit caught this on PR #615 review. The membership is tree-tolerant
  // (`currentProjectBelongsToLiveProject`): a multi-repo unit's tab selects its
  // PRIMARY repo while the Producer's wrapper cwd is the derived projectPath, so
  // a literal `includes` reset bounced an explicit tab selection to the wrong
  // unit once a second unit was live (#581 dogfood).
  //
  // Grace window (aim `handoff-producer-unit-focus`): a unit's Producer briefly
  // leaves the live set during a handoff respawn or a restart (kill→relaunch).
  // When OTHER units remain live, don't bounce focus to one of them for that
  // transient gap — hold the selection and only reset if the unit stays gone
  // past the window (a genuine stop). If the unit re-enters `projectPaths`
  // first, this effect re-runs, the membership check passes, and the pending
  // timer is cleared — focus is preserved across the blink.
  useEffect(() => {
    if (projectPaths.length === 0) {
      // No live unit at all (e.g. engine restart) — nothing to focus.
      if (currentProject !== null) setCurrentProject(null);
      return;
    }
    if (currentProject === null) {
      setCurrentProject(projectPaths[0]);
      return;
    }
    if (currentProjectBelongsToLiveProject(currentProject, projectPaths)) {
      return; // still live — keep focus
    }
    // Left the live set while other units remain: a respawn/restart gap or a
    // genuine stop. Hold focus for the grace window, then reset only if it has
    // not come back.
    const id = window.setTimeout(() => {
      setCurrentProject(projectPaths[0]);
    }, FOCUS_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [currentProject, projectPaths]);

  // Unit re-scope: picking a unit RE-SCOPES the focused unit (sets
  // `currentProject` to its primary repo path); the unit-scoped wires and the
  // aim console re-render for that unit. `path` comes from the same
  // `groupByProject(aiAgents, worktrees)` as `projectPaths`, so the
  // auto-default effect below never resets it back.
  const handleSelectProject = useCallback((path: string) => {
    setCurrentProject(path);
  }, []);

  // C1 unit-tab click → re-scope the focused unit. A unit is addressed by
  // its PRIMARY repo path (where the Producer runs) — the same path
  // `currentProject` carries — so we resolve that and reuse the existing
  // project re-scope. Falls back to the first repo if no `primary` flag.
  const handleSelectUnit = useCallback(
    (unit: SlotResponse) => {
      const repo = unit.repos.find((r) => r.primary) ?? unit.repos[0];
      if (!repo) return;
      handleSelectProject(repo.path);
    },
    [handleSelectProject],
  );

  // Aim-console "+" = the REAL "add unit = launch a Producer" path (the
  // bootstrap the `producer-slot-invariant` safety-net presupposes — it only
  // re-spawns slots that already hold a live Producer, so the FIRST occupant
  // must come from an explicit launch act). Opens a repo-root picker and
  // launches a Producer there via the existing `/api/spawn` path
  // (`launchProducerAt` → derives the unit from the basename); the launch cwd
  // DEFINES the unit (aim `producer-cwd`). No new endpoint (#788).
  const [launchPickerOpen, setLaunchPickerOpen] = useState(false);
  const openLaunchPicker = useCallback(() => setLaunchPickerOpen(true), []);

  // Unit close affordance (#540 / #546 companion). The per-tab confirm gate
  // lives in the aim console's unit tab (close = kill, so never silent); this
  // runs only after the operator confirms. `closeUnitSlot` POSTs the core close (Producer +
  // dispatched workers) then kills the unit's webui-owned footer bash, which
  // the engine can't attribute server-side. `agents` is the live roster used
  // to resolve those hint-less footer shells.
  const handleCloseUnit = useCallback(
    async (unit: SlotResponse) => {
      try {
        await closeUnitSlot(unit, agents);
        refresh();
        toastSuccess(`Closed unit ${unit.name} — Producer + workers + footer bash killed`);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        toastInfo(`Failed to close unit ${unit.name}: ${reason}`);
      }
    },
    [agents, refresh, toastSuccess, toastInfo],
  );

  // Keyboard shortcuts handlers
  useKeyboardShortcuts([
    {
      keys: ["?"],
      description: "Toggle help menu",
      handler: () => setShowHelp((v) => !v),
    },
    {
      keys: [","],
      description: "Toggle settings",
      requiresCtrl: true,
      handler: toggleSettings,
    },
    {
      keys: ["["],
      description: "Previous project",
      requiresCtrl: true,
      handler: () => {
        if (projectPaths.length === 0) return;
        const idx = currentProject ? projectPaths.indexOf(currentProject) : -1;
        const newIndex = idx <= 0 ? 0 : idx - 1;
        setCurrentProject(projectPaths[newIndex]);
        toastInfo("Previous project");
      },
    },
    {
      keys: ["]"],
      description: "Next project",
      requiresCtrl: true,
      handler: () => {
        if (projectPaths.length === 0) return;
        const idx = currentProject ? projectPaths.indexOf(currentProject) : -1;
        const newIndex = Math.min(projectPaths.length - 1, idx + 1);
        setCurrentProject(projectPaths[newIndex]);
        toastInfo("Next project");
      },
    },
  ]);

  // Close help on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showHelp) {
        setShowHelp(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHelp]);

  // The IN-PROGRESS handoff overlay — scoped to the CONVERSATION PANEL, not a
  // full-window takeover. A handoff busies ONE unit's conversation (its
  // Producer is being killed + relaunched), so the overlay covers only that
  // panel and leaves the unit tabs, the Aim worklist, and the Remote rail
  // usable while the ritual runs — the operator can switch units, check PRs, or
  // work the Aim tree instead of being walled out of the whole app. Rendered
  // INSIDE the conversation panel in each mode (aim: the `.ac-session` column,
  // via AimConsole's `handoffOverlay` prop; producer: the centre conversation
  // div) — both panels are `position: relative` hosts for its `absolute inset-0`.
  // Shown for the FOCUSED unit only, so switching units reveals the other unit's
  // conversation cleanly; the ritual keeps running and re-appears on switch-back.
  // (The terminal FAILURE dialog + ready toast + help stay app-global below —
  // a failure / completion is app-level news, not one panel's busy-state.)
  const handoffOverlay =
    ritualState.kind === "dispatching" && unitName !== null ? (
      <HandoffRitualOverlay unitName={unitName} ritualId={null} phases={[]} />
    ) : ritualState.kind === "in_progress" && ritualState.unit === unitName ? (
      <HandoffRitualOverlay
        unitName={ritualState.unit}
        ritualId={ritualState.ritualId}
        phases={ritualState.phases}
      />
    ) : null;

  // App-level GLOBAL overlays — mode-INDEPENDENT. The terminal handoff FAILURE
  // dialog + ready toast, the toast container, and the help overlay must stay
  // co-visible whether the centre is the legacy producer shell OR the
  // full-screen aim console (now the DEFAULT). These used to be inlined in the
  // producer-mode return ONLY, so the aim-console default stranded them below
  // the aim-mode early return — invisible in the default surface (hub #897,
  // surfaced by tmai-core #589 ④). They are `fixed`-positioned, so the DOM
  // parent doesn't affect layout, and only one mode branch renders at a time
  // (no double-mount). (The in-progress overlay is NO LONGER here — it moved
  // into the conversation panel, see `handoffOverlay` above.) The single
  // `useHandoffRitual` instance still lives at App level — two would mean two.
  const globalOverlays = (
    <>
      <HelpOverlay isOpen={showHelp} onClose={() => setShowHelp(false)} />
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
      {ritualState.kind === "escalated" && ritualState.unit !== "" && (
        <HandoffRitualFailureDialog
          unitName={ritualState.unit}
          reason={ritualState.reason}
          message={ritualState.message}
          // The supervisor's `crash_loop_halted` halt is a different failure
          // than an operator-rejected handoff — manual relaunch, not retry.
          mode={ritualState.reason === "crash_loop_halted" ? "crash_loop" : "handoff"}
          producerAgentId={ritualUnitProducer?.id ?? null}
          retryCount={handoffRetryCount}
          retryRefused={handoffRetryRefused}
          onForceKill={() => void handleHandoffForceKill()}
          onRetry={handleHandoffRetry}
          onDismiss={dismissHandoff}
        />
      )}
      {handoffReadyToastVisible && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-40 rounded-md border border-success/30 bg-surface-strong px-4 py-2 text-xs text-success shadow-lg"
        >
          Handoff complete — fresh Producer is ready.
        </div>
      )}
    </>
  );

  // The aim console is the whole shell — its own top bar + 3-pane grid.
  // Returned AFTER every hook above so the rules of hooks hold.
  return (
    <>
      <AimConsole
        units={slotsData?.slots ?? []}
        unitSignals={unitSignals}
        activeUnitName={unitName}
        onSelectUnit={handleSelectUnit}
        onAddUnit={openLaunchPicker}
        onCloseUnit={handleCloseUnit}
        agents={agents}
        currentProjectPath={currentProject}
        trigger={triggerHandoff}
        onOpenSettings={openSettingsFromOverride}
        handoffOverlay={handoffOverlay}
      />
      <ProducerLaunchPicker
        open={launchPickerOpen}
        onClose={() => setLaunchPickerOpen(false)}
        onLaunchProducerAt={launchProducerAt}
      />
      {/* Settings in aim mode — the producer console renders SettingsPanel
            inline in its centre pane, but the aim console is a full-window
            takeover, so the SAME `showSettings` state surfaces here as a modal
            overlay (lifted past the aim-mode early return — same shape as the
            #897 globalOverlays / #907 remote-Δ lifts). The top-bar ⚙ sets it;
            the panel's own close button + the backdrop dismiss it. */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap to close */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop tap to close */}
          <div
            className="absolute inset-0 bg-background/60 backdrop-blur-[2px] animate-fade-in"
            onClick={closeMainPanelOverlay}
          />
          <div className="relative flex h-[85vh] w-[min(880px,92vw)] flex-col overflow-hidden rounded-xl border border-hairline-strong bg-background shadow-2xl animate-scale-in">
            <SettingsPanel
              onClose={closeMainPanelOverlay}
              defaultOpenAdvanced={settingsOpenedFromOverride}
            />
          </div>
        </div>
      )}
      {globalOverlays}
    </>
  );
}
