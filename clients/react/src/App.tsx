import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentActions } from "@/components/agent/AgentActions";
import { AgentList } from "@/components/agent/AgentList";
import { PreviewPanel } from "@/components/agent/PreviewPanel";
import { AimConsole } from "@/components/aim-console/AimConsole";
import { type ConsoleMode, DEFAULT_CONSOLE_MODE } from "@/components/aim-console/console-mode";
import { HelpOverlay } from "@/components/layout/HelpOverlay";
import { StatusBar } from "@/components/layout/StatusBar";
import { ToastContainer, useToast } from "@/components/layout/ToastContainer";
import { UnitTabs } from "@/components/layout/UnitTabs";
import { HandoffRitualFailureDialog } from "@/components/producer-console/HandoffRitualFailureDialog";
import { HandoffRitualOverlay } from "@/components/producer-console/HandoffRitualOverlay";
import { ProducerConsole } from "@/components/producer-console/ProducerConsole";
import { ProducerConversationHeader } from "@/components/producer-console/ProducerConversationHeader";
import { RPanel } from "@/components/producer-console/r-panel/RPanel";
import {
  RIssueViewer,
  selectedIssueKey,
} from "@/components/producer-console/r-panel/r-viewer/RIssueViewer";
import { RPrViewer, selectedPrKey } from "@/components/producer-console/r-panel/r-viewer/RPrViewer";
import { ProducerLaunchPicker } from "@/components/project/ProducerLaunchPicker";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { TerminalList } from "@/components/terminal/TerminalList";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { useApplyTheme } from "@/hooks/useActiveTheme";
import { useAgentSelectionFallback } from "@/hooks/useAgentSelectionFallback";
import { useAgents } from "@/hooks/useAgents";
import { useFocusedArtifact } from "@/hooks/useFocusedArtifact";
import { useHandoffRitual } from "@/hooks/useHandoffRitual";
import { useIdleNotification } from "@/hooks/useIdleNotification";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNotificationConfig } from "@/hooks/useNotificationConfig";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useSlots } from "@/hooks/useSlots";
import { useSplitPane } from "@/hooks/useSplitPane";
import { useUnits } from "@/hooks/useUnits";
import { useWorktrees } from "@/hooks/useWorktrees";
import {
  api,
  groupByProject,
  isAiAgentLoose,
  resolveUnitName,
  type Selection,
  setCallerCwd,
  type UnitResponse,
} from "@/lib/api";
import { closeUnitSlot } from "@/lib/close-unit-slot";
import { findProducerForUnit } from "@/lib/producer";
import { useSSE } from "@/lib/sse-provider";
import { ATTENTION_STRIP_WIDTH_DEFAULT, clampAttentionStripWidth } from "@/lib/ui-prefs";
import { useUIPref } from "@/lib/ui-prefs-provider";

// The R panel is a right-docked panel, but `useSplitPane` speaks in
// 0–1 ratios of its container (here the app root, full viewport width). We
// map the persisted px width to/from that ratio at the seams: a stored width
// W on a viewport V seeds ratio = 1 − W/V (the panel occupies the right
// `1 − ratio` of the row); on commit we read the ratio back into px. The hook
// clamps the ratio to [0.2, 0.8] and `clampAttentionStripWidth` clamps the
// committed px, so the two guards compose. The pref key is kept as
// `attentionStripWidth` post-rename for back-compat (storage migration is
// churn for no benefit — the field's meaning is unchanged).
function rPanelViewportWidth(): number {
  return typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 1440;
}
function rPanelWidthToRatio(width: number): number {
  return 1 - width / rPanelViewportWidth();
}
function rPanelRatioToWidth(ratio: number): number {
  return (1 - ratio) * rPanelViewportWidth();
}

export function App({
  initialConsoleMode = DEFAULT_CONSOLE_MODE,
}: {
  initialConsoleMode?: ConsoleMode;
} = {}) {
  // Apply the active WebUI theme's css vars to <html> and keep them in
  // sync when the user switches themes in Settings — re-skins the whole
  // UI live, no reload.
  useApplyTheme();

  const { agents, attentionCount, loading, refresh } = useAgents();
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [currentProject, setCurrentProject] = useState<string | null>(null);
  // Main panel takes one of `"agents"` (default), `"settings"`, or
  // `"calibration"`. They replace the main panel content (not modal overlays),
  // so they're mutually exclusive — opening one always closes the other.
  // The previous two-booleans-cleared-in-tandem pattern was equivalent but
  // more error-prone; this enum makes the constraint explicit.
  const [mainPanel, setMainPanel] = useState<"agents" | "settings">("agents");
  // Coexist console-mode toggle (aim node `tmai-core:doc/aims/aim-ui.md`).
  // A sibling of `mainPanel`: which TOP-LEVEL console is shown. `aim` (now the
  // DEFAULT — see `console-mode.ts`, hub #850/#851 made it self-sufficient)
  // swaps the whole window for the full-screen <AimConsole>; `producer` keeps
  // the legacy shell (sidebar + digest/conversation + R panel) and is the
  // opt-OUT via the aim console's EXIT toggle. Not persisted to ui-prefs: the
  // default IS the landing mode on every load (tests pin the legacy console
  // via the `initialConsoleMode` prop).
  const [consoleMode, setConsoleMode] = useState<ConsoleMode>(initialConsoleMode);
  const toggleConsoleMode = useCallback(
    () => setConsoleMode((m) => (m === "aim" ? "producer" : "aim")),
    [],
  );
  const [showHelp, setShowHelp] = useState(false);
  // Persistent right R panel (project artifact inventory — approach
  // `doc/approaches/2026-05-29-r-panel-as-project-artifact-inventory.md`).
  // Collapsed state lives in the WebUI prefs store so it survives
  // reloads / cross-tab. Pref key reused post-AttentionStrip-retire to
  // avoid storage migration churn.
  const [rPanelCollapsed, setRPanelCollapsed] = useUIPref("attentionStripCollapsed");
  const toggleRPanel = useCallback(
    () => setRPanelCollapsed(!rPanelCollapsed),
    [rPanelCollapsed, setRPanelCollapsed],
  );
  // Drag-resizable panel width. Persisted in px; the drag itself runs
  // through the shared useSplitPane engine (ratio-based), so we convert
  // at the seams. See the rPanel*Width helpers above.
  const [rPanelWidth, setRPanelWidth] = useUIPref("attentionStripWidth");
  // The artifact in focus in R₂. R₂ hosts exactly ONE focused artifact at
  // a time — a PR (#749), a record (decision/approach), or an issue — so
  // focusing one kind clears the others (the invariant lives in
  // `useFocusedArtifact`). All null = no viewer (it
  // never auto-opens — the operator clicks a row in the R₁ inventory to
  // select; viewer-approach negative space). Lives at App level because
  // focus mode (spine
  // `2026-05-29-c-and-r-as-the-development-substrate`) RIDES the R panel's
  // single column: a focus swaps R₁'s inventory body for the R₂ viewer at
  // the same drag-set width (`viewer` prop below), rather than adding a
  // fourth column that would steal width from the centre conversation.
  const {
    selectedPr,
    selectedIssue,
    selectPr,
    selectIssue,
    clearPr,
    clearIssue,
    clearAll: clearFocusedArtifact,
  } = useFocusedArtifact();
  const showSettings = mainPanel === "settings";
  // Phase B of the Producer-console rebuild
  // (`doc/decisions/2026-05-14-react-producer-console-rebuild.md`)
  // routes orchestrator-era controls behind a `<details>` section
  // inside SettingsPanel. The flag below distinguishes:
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
  // Producer-console return path (dogfood feedback 2026-05-14):
  // an operator talking to the Producer in the main pane had no way
  // back to the hand-over digest without killing the session. Reset
  // both selection and any overlay so the ProducerConsole branch (no
  // `selectedAgent`, no overlay) renders again. The Producer agent
  // itself stays alive in the sidebar — re-selecting it resumes the
  // conversation.
  const returnToConsole = useCallback(() => {
    setSelection(null);
    setMainPanel("agents");
  }, []);
  const toggleSettings = useCallback(() => {
    setSettingsOpenedFromOverride(false);
    setMainPanel((mp) => (mp === "settings" ? "agents" : "settings"));
  }, []);
  const openSettingsFromOverride = useCallback(() => {
    setSettingsOpenedFromOverride(true);
    setMainPanel("settings");
  }, []);

  // Configured-unit membership (tmai-core #460 — wire half of #439). Read
  // BEFORE `unitName` because the active unit is resolved by membership (see
  // `resolveUnitName`), not the project-path basename. Also threaded into
  // `findProducerForUnit` below so multi-repo units resolve their Producer
  // against the primary repo specifically, not against whichever repo
  // `currentProject` happens to point at. `useHandover` consumes the same wire
  // for cross-unit reconciliation.
  const { data: unitsData, loading: unitsLoading } = useUnits();

  // Live Producer-slot set (tmai-core #580 — aim `producer-cwd`): the
  // agent-primacy tab source for the aim console. Distinct from `useUnits`
  // (configured `[[unit]]` membership, kept above for agent→unit resolution
  // + the legacy unit-tab strip): `slotsData` reflects only units with a live
  // Producer, so the aim-console tabs become "where a Producer stood" rather
  // than the static config enumeration.
  const { data: slotsData } = useSlots();

  // The active unit NAME, fed to the unit-scoped wires (`GET
  // /api/units/{unit}/…`). Anchored to the unit that OWNS `currentProject` in
  // the configured `[[unit]]` membership — NOT the basename of the project
  // path. A multi-repo unit's `currentProject` can resolve to a SECONDARY repo
  // (e.g. `…/tmai-core`, basename "tmai-core") while the unit — and every
  // agent's wire `unit` — is "tmai"; a basename derivation then mismatched the
  // SessionPane `agent.unit === unitName` filter and hid the unit's own agents
  // (the aim-console worker-invisibility bug). `resolveUnitName` falls back to
  // the basename when no configured unit matches — the same cwd-synthesized-
  // unit behaviour the backend's `resolve_unit_or_cwd` and the CLI give for an
  // unconfigured cwd.
  const unitName = useMemo(() => {
    // Hold while the membership wire is still loading: until it arrives we
    // cannot tell which unit owns `currentProject`, and resolving by basename
    // in the meantime would briefly mis-scope a multi-repo unit to its
    // SECONDARY repo before units land. Once loading clears — even on fetch
    // failure (`data` stays null) — we fall through to the basename, the same
    // as an unconfigured cwd.
    if (unitsLoading) return null;
    return resolveUnitName(currentProject, unitsData?.units ?? []);
  }, [currentProject, unitsData, unitsLoading]);

  // Close the R₂ viewer when the focused unit changes — its open artifact
  // (PR or issue) belongs to the previous unit, so it must not
  // linger under a new unit's inventory (mirrors useUnitPrs clearing its
  // list on unit change). unitName is the intended trigger even though the
  // body only clears state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional unit-change trigger
  useEffect(() => {
    clearFocusedArtifact();
  }, [unitName]);
  const unitReposForCurrent = useMemo(() => {
    if (unitName === null) return null;
    return unitsData?.units.find((u) => u.name === unitName)?.repos ?? null;
  }, [unitsData, unitName]);

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
    trigger: triggerHandoff,
    retry: retryHandoff,
    dismiss: dismissHandoff,
    retryCount: handoffRetryCount,
    retryRefused: handoffRetryRefused,
  } = useHandoffRitual();

  // The single live Producer for the focused unit. Drives the
  // conversation-header gate (only show it when the selected agent IS
  // this Producer), the failure dialog's Force-kill target, and its
  // Resume-in-CC id. Shares the `findProducerForUnit` resolver with the
  // digest button and the ctx readout so all surfaces agree.
  //
  // Cross-repo aware: when the units wire has resolved this unit's
  // membership, we pass the full `UnitRepoWire[]` so the resolver can
  // pin the Producer to the unit's PRIMARY repo even if `currentProject`
  // happens to point at a non-primary repo. The single-path fallback
  // keeps the resolver working pre-wire-load and for cwd-synthesized
  // units that the units endpoint doesn't enumerate.
  const producerForUnit = useMemo(
    () => findProducerForUnit(agents, unitReposForCurrent ?? currentProject),
    [agents, unitReposForCurrent, currentProject],
  );

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
    if (unitName === null) return;
    void retryHandoff(unitName, { trigger: "manual" });
  }, [retryHandoff, unitName]);

  const handleHandoffForceKill = useCallback(async () => {
    if (producerForUnit === null) return;
    try {
      await api.killAgent(producerForUnit.target);
    } catch {
      // Best-effort — if the kill fails (already dead, etc.) we still
      // dismiss; the dialog already surfaced the upstream failure.
    }
    dismissHandoff();
  }, [producerForUnit, dismissHandoff]);

  // "Open Producer terminal" affordance from <ProducerConsole>.
  //
  // Decision `doc/decisions/2026-05-14-react-producer-console-rebuild.md`
  // §Producer chat: the Producer conversation stays on the terminal
  // substrate (substrate swap is rejected per cross-ref
  // `tmai-core@2026-05-13-agent-view-does-not-replace-multiplexer-
  // substrate`). The WebUI's job is just to make the canonical
  // command trivially copy-pasteable.
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
        const res = await api.launchProducer(path);
        setSelection({ type: "agent", id: res.session_id });
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

  const openProducerTerminal = useCallback(() => {
    if (!currentProject) return; // ProducerConsoleActions opens DirBrowser in this case
    void launchProducerAt(currentProject);
  }, [currentProject, launchProducerAt]);

  // R-panel resize. Its containerRef is attached to the app-root flex
  // row below; the panel is that row's right-most in-flow child, so a
  // ratio of `clientX / rowWidth` makes the panel occupy `1 − ratio`
  // of the row — i.e. dragging its left-edge handle resizes it. Commit
  // clamps the derived px width to the legal window.
  //
  // Also remains the source of `isNarrowScreen` (matchMedia(NARROW_
  // BREAKPOINT)), which the panel's visibility guard below depends on.
  const rPanelSplit = useSplitPane({
    orientation: "horizontal",
    initialRatio: rPanelWidthToRatio(rPanelWidth),
    onCommit: (ratio) => setRPanelWidth(clampAttentionStripWidth(rPanelRatioToWidth(ratio))),
  });
  const isNarrowScreen = rPanelSplit.isNarrowScreen;

  // Responsive layout state (sidebar collapse + mobile drawer). The action
  // panel collapse pair retired with BranchGraph — that fullscreen view
  // owned the only action panel, so nothing reads the toggle now.
  const {
    sidebarCollapsed,
    toggleSidebar,
    isMobileScreen,
    mobileDrawerOpen,
    toggleMobileDrawer,
    closeMobileDrawer,
  } = useResponsiveLayout();

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
  const terminals = useMemo(() => agents.filter((a) => !isAiAgentLoose(a)), [agents]);

  // Project list derived from active agents (replaces the pre-registered list).
  // Used by the keyboard shortcuts to cycle the X-Tmai-Origin scope and by
  // OrchestrationSection's per-project override selector.
  const projectPaths = useMemo(
    () => groupByProject(aiAgents, worktrees).map((p) => p.path),
    [aiAgents, worktrees],
  );

  // Default currentProject to the first derived project once one appears so
  // X-Tmai-Origin has a sensible scope before the user touches the sidebar.
  // Also reset the scope when the previously selected project disappears
  // (e.g. its last agent stopped) so we never keep sending a stale cwd —
  // CodeRabbit caught this on PR #615 review.
  useEffect(() => {
    if (projectPaths.length === 0) {
      if (currentProject !== null) setCurrentProject(null);
      return;
    }
    if (currentProject === null || !projectPaths.includes(currentProject)) {
      setCurrentProject(projectPaths[0]);
    }
  }, [currentProject, projectPaths]);

  // Derive selected agent from selection.
  //
  // tmai-core's L2 upgrade (decision 2026-05-09 Phase 1: hook payload
  // binds CC's session_id → pane_id) re-keys the agent's wire `id` from
  // `provisional:UUID` to `claude:UUID`. The follow-up wire fix (commit
  // landing alongside this one) reorders the emit to `Upserted(new) →
  // Removed(old)`, so both keys are simultaneously present in the
  // entity cache during the swap — `agents.find` resolves by `target`
  // (stable across the re-key) and panels stay mounted. The earlier
  // 500 ms last-good cache fallback retired with the wire reorder.
  const selectedAgent =
    selection?.type === "agent"
      ? agents.find((a) => a.id === selection.id || a.target === selection.id)
      : undefined;
  const sessionId = selectedAgent?.pty_session_id ?? null;

  // When the agent we were looking at disappears (kill button, CC quit,
  // dispatch unwind …) auto-pick a sibling in the same cwd so the user
  // doesn't drop into an empty pane. Same-cwd preferred (orchestrator
  // first, matching the sidebar order); else any agent; else clear.
  useAgentSelectionFallback({ selection, selectedAgent, agents, setSelection });

  const handleSpawned = useCallback(
    (target: string) => {
      setSelection({ type: "agent", id: target });
      closeMainPanelOverlay();
      refresh();
      toastSuccess("Agent spawned");
    },
    [refresh, toastSuccess, closeMainPanelOverlay],
  );

  // Select handler for agents — closes mobile drawer after selection
  const handleSelectAgent = useCallback(
    (target: string) => {
      setSelection({ type: "agent", id: target });
      closeMainPanelOverlay();
      closeMobileDrawer();
    },
    [closeMobileDrawer, closeMainPanelOverlay],
  );

  // Derive selectedTarget string for components that need it
  const selectedTarget = selection?.type === "agent" ? selection.id : null;

  // Cross-unit re-scope (DR `2026-05-14-react-producer-console-rebuild.md`
  // §Refinement 2026-05-22 Fork B reroute). The full-screen project /
  // BranchGraph view is retired, so picking a unit in the cross-unit list
  // (the ProducerConsole digest or the AttentionStrip) no longer opens a
  // view — it RE-SCOPES the focused unit, and the strip / digest sections
  // re-render for that unit. `path` always comes from that list, which is
  // derived from the same `groupByProject(aiAgents, worktrees)` as
  // `projectPaths`, so the auto-default effect below never resets it back.
  // `_name` is unused now (the old `{type:"project"}` selection carried it).
  const handleSelectProject = useCallback(
    (path: string, _name: string) => {
      setCurrentProject(path);
      closeMobileDrawer();
    },
    [closeMobileDrawer],
  );

  // C1 unit-tab click → re-scope the focused unit. A unit is addressed by
  // its PRIMARY repo path (where the Producer runs) — the same path
  // `currentProject` carries — so we resolve that and reuse the existing
  // project re-scope. Falls back to the first repo if no `primary` flag.
  const handleSelectUnit = useCallback(
    (unit: UnitResponse) => {
      const repo = unit.repos.find((r) => r.primary) ?? unit.repos[0];
      if (!repo) return;
      handleSelectProject(repo.path, unit.name);
    },
    [handleSelectProject],
  );

  // C1 `+` affordance — "add unit = launch Producer". v1 placeholder: copy
  // the canonical launch command to the clipboard (secure-context only;
  // localhost qualifies) and toast it, mirroring the Phase-A "Open Producer
  // terminal" clipboard fallback. NO new launch endpoint (issue #788 scope).
  const handleAddUnit = useCallback(() => {
    const cmd = "tmai producer <path-to-unit-primary-repo>";
    navigator.clipboard
      ?.writeText(cmd)
      .then(() => toastSuccess(`Copied: ${cmd} — run it in a repo to add a unit`))
      .catch(() => toastInfo(`Add a unit by launching a Producer: ${cmd}`));
  }, [toastSuccess, toastInfo]);

  // Aim-console "+" = the REAL "add unit = launch a Producer" path (the
  // bootstrap the `producer-slot-invariant` safety-net presupposes — it only
  // re-spawns slots that already hold a live Producer, so the FIRST occupant
  // must come from an explicit launch act). Opens a repo-root picker and
  // launches a Producer there via the existing `/api/spawn` path
  // (`launchProducerAt` → derives the unit from the basename); the launch cwd
  // DEFINES the unit (aim `producer-cwd`). No new endpoint (#788). The legacy
  // UnitTabs "+" keeps the clipboard placeholder above; only the aim console
  // gets the live launcher.
  const [launchPickerOpen, setLaunchPickerOpen] = useState(false);
  const openLaunchPicker = useCallback(() => setLaunchPickerOpen(true), []);

  // C1 close affordance (#540 / #546 companion). The per-tab confirm gate
  // lives in UnitTabs (close = kill, so never silent); this runs only after
  // the operator confirms. `closeUnitSlot` POSTs the core close (Producer +
  // dispatched workers) then kills the unit's webui-owned footer bash, which
  // the engine can't attribute server-side. `agents` is the live roster used
  // to resolve those hint-less footer shells.
  const handleCloseUnit = useCallback(
    async (unit: UnitResponse) => {
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
      keys: ["b"],
      description: "Toggle sidebar",
      requiresCtrl: true,
      handler: toggleSidebar,
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

  // Sidebar content shared between desktop sidebar and mobile drawer
  const sidebarContent = (
    <>
      <AgentList
        agents={aiAgents}
        loading={loading}
        selection={selection}
        onSelectAgent={handleSelectAgent}
        worktrees={worktrees}
        onSpawned={handleSpawned}
      />
      <TerminalList
        terminals={terminals}
        selectedTarget={selectedTarget}
        onSelect={handleSelectAgent}
      />
    </>
  );

  // C1 unit-tab strip — rendered in the StatusBar (top bar) when the engine
  // reports configured `[[unit]]` membership. A single configured unit
  // collapses to one tab; the component renders N. Omitted when the units
  // wire is empty (cwd-synthesized units aren't enumerated there).
  const unitTabsNode =
    (unitsData?.units.length ?? 0) > 0 ? (
      <UnitTabs
        units={unitsData?.units ?? []}
        activeUnitName={unitName}
        onSelectUnit={handleSelectUnit}
        onAddUnit={handleAddUnit}
        onCloseUnit={handleCloseUnit}
      />
    ) : null;

  // Focus-mode viewer node (spine `2026-05-29-c-and-r-as-the-development-
  // substrate`). At most one of the three is non-null (`useFocusedArtifact`
  // keeps them mutually exclusive), so this resolves to a single viewer or
  // null. It is handed to RPanel as `viewer`, where it REPLACES the R₁
  // inventory body in the same column — opening/closing it never changes
  // the centre column's width (only dragging the divider does). Its close
  // (‹ Inventory) clears the focus and reveals the inventory again.
  const rViewer = selectedPr ? (
    <RPrViewer selected={selectedPr} onClose={clearPr} />
  ) : selectedIssue ? (
    <RIssueViewer selected={selectedIssue} onClose={clearIssue} />
  ) : null;

  // Coexist: when the operator opts into aim-ui, the new full-window aim
  // console takes over the whole shell (its own top bar + 3-pane grid),
  // replacing the existing sidebar / digest / R panel. Returned AFTER every
  // hook above so the rules of hooks hold; the matching EXIT toggle lives in
  // the aim console's own top bar (the StatusBar that hosts the ENTER toggle
  // is not rendered in this mode).
  if (consoleMode === "aim") {
    return (
      <>
        <AimConsole
          units={slotsData?.slots ?? []}
          activeUnitName={unitName}
          onSelectUnit={handleSelectUnit}
          onAddUnit={openLaunchPicker}
          onCloseUnit={handleCloseUnit}
          onExit={toggleConsoleMode}
          agents={agents}
          currentProjectPath={currentProject}
          trigger={triggerHandoff}
          onOpenSettings={openSettingsFromOverride}
        />
        <ProducerLaunchPicker
          open={launchPickerOpen}
          onClose={() => setLaunchPickerOpen(false)}
          onLaunchProducerAt={launchProducerAt}
        />
      </>
    );
  }

  return (
    <div ref={rPanelSplit.containerRef} className="flex h-screen text-foreground">
      {/* Mobile: overlay backdrop when drawer is open */}
      {isMobileScreen && mobileDrawerOpen && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap to close
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop tap to close
        <div
          className="fixed inset-0 z-40 bg-background animate-fade-in"
          onClick={closeMobileDrawer}
        />
      )}

      {/* Mobile drawer (off-canvas) */}
      {isMobileScreen && (
        <div
          className={`fixed inset-y-0 left-0 z-50 flex w-80 flex-col glass border-r border-hairline transition-transform duration-300 ease-out safe-top safe-bottom ${
            mobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <span className="bg-gradient-to-r from-[var(--brand-from)] to-[var(--brand-to)] bg-clip-text text-sm font-bold tracking-wide text-transparent">
              tmai
            </span>
            <button
              type="button"
              onClick={closeMobileDrawer}
              className="touch-target flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-strong hover:text-foreground"
              title="Close navigation"
              aria-label="Close navigation"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <title>Close</title>
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto">{sidebarContent}</div>
        </div>
      )}

      {/* Desktop sidebar (not shown on mobile) */}
      {!isMobileScreen && (
        <aside
          className={`glass flex shrink-0 flex-col transition-subtle ${
            sidebarCollapsed ? "w-14" : "w-80"
          }`}
        >
          <StatusBar
            agentCount={aiAgents.length}
            attentionCount={attentionCount}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            onSettingsClick={() => {
              toggleSettings();
            }}
            consoleMode={consoleMode}
            onToggleConsoleMode={toggleConsoleMode}
            onReturnToConsole={
              selection !== null || mainPanel !== "agents" ? returnToConsole : undefined
            }
            unitTabs={sidebarCollapsed ? undefined : unitTabsNode}
          />
          {!sidebarCollapsed && (
            <div className="flex flex-1 flex-col overflow-y-auto">{sidebarContent}</div>
          )}
          {sidebarCollapsed && (
            <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
              {aiAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => handleSelectAgent(agent.target)}
                  className={`h-8 w-8 rounded-lg text-[10px] transition-colors ${
                    selectedTarget === agent.target
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-surface-strong hover:text-foreground"
                  }`}
                  title={agent.target}
                >
                  {/* Decision 2026-05-09 Phase 4: flat attention enum.
                      `"halted"` = permission prompt (◐), `"started"` /
                      `"completed"` = waiting on user (○), `null` =
                      running (●). */}
                  {agent.attention === "halted"
                    ? "◐"
                    : agent.attention === "started" || agent.attention === "completed"
                      ? "○"
                      : "●"}
                </button>
              ))}
            </div>
          )}
        </aside>
      )}

      {/* Main area */}
      <main className="flex flex-1 flex-col overflow-hidden transition-subtle">
        {/* Mobile top bar */}
        {isMobileScreen && (
          <StatusBar
            agentCount={aiAgents.length}
            attentionCount={attentionCount}
            isMobile
            onMobileMenuClick={toggleMobileDrawer}
            onSettingsClick={() => {
              toggleSettings();
            }}
            consoleMode={consoleMode}
            onToggleConsoleMode={toggleConsoleMode}
            onReturnToConsole={
              selection !== null || mainPanel !== "agents" ? returnToConsole : undefined
            }
            unitTabs={unitTabsNode}
          />
        )}

        {showSettings ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-scale-in">
            <SettingsPanel
              onClose={closeMainPanelOverlay}
              defaultOpenAdvanced={settingsOpenedFromOverride}
            />
          </div>
        ) : (
          // Single-pane centre (DR `2026-05-14-react-producer-console-
          // rebuild.md` §Refinement 2026-05-22 Fork B): the git/docs
          // multipane + the full-screen project/markdown/worktree views
          // retired, so the centre is just the agent conversation
          // (TerminalPanel / PreviewPanel) or — between selections — the
          // ProducerConsole hand-over digest. Selecting an agent in the
          // sidebar drops into the conversation; clearing the selection
          // (returnToConsole) returns to the digest.
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* One bar above the conversation. For the Producer it is the
                merged ProducerConversationHeader — status dot + name +
                Kill (subsuming AgentActions) PLUS the ctx% readout and
                the Handoff & restart trigger, co-visible ABOVE the
                terminal so the operator conversing with the Producer can
                reach the ritual without returning to the digest (fixes
                the manual-kill trap, lived friction 2026-05-23) and
                without three stacked bars eating the conversation height
                (density refinement 2026-05-23). For a worker we keep the
                plain AgentActions bar UNCHANGED. */}
            {selectedAgent &&
              (selectedAgent.target === producerForUnit?.target ? (
                <ProducerConversationHeader
                  agents={agents}
                  currentProjectPath={currentProject}
                  unitName={unitName}
                  trigger={triggerHandoff}
                  onOpenSettings={openSettingsFromOverride}
                />
              ) : (
                <AgentActions agent={selectedAgent} passthrough />
              ))}
            {sessionId && selectedAgent ? (
              <div key={sessionId} className="flex-1 overflow-hidden animate-fade-in">
                <TerminalPanel agentId={selectedAgent.target} />
              </div>
            ) : selectedAgent ? (
              <div
                key={selectedAgent.target}
                className="flex flex-1 flex-col overflow-hidden animate-fade-in"
              >
                <PreviewPanel agentId={selectedAgent.target} />
              </div>
            ) : (
              <ProducerConsole
                currentProjectPath={currentProject}
                unitName={unitName}
                onOpenProducerTerminal={openProducerTerminal}
                trigger={triggerHandoff}
                onSelectProjectByPath={handleSelectProject}
                onLaunchProducerAt={launchProducerAt}
                onOverrideSpawned={handleSpawned}
                onOpenSidebar={toggleSidebar}
                sidebarCollapsed={sidebarCollapsed}
                onOpenSettings={openSettingsFromOverride}
              />
            )}
          </div>
        )}
      </main>

      {/* Persistent right R panel — third (and LAST) flex column, sibling
          of <main> and OUTSIDE the selection switch above, so it stays
          co-visible with whatever the centre shows (Producer conversation
          or hand-over digest). Hidden on narrow / mobile so it never
          crowds a small viewport; folds to a thin rail otherwise.

          Focus mode: when an artifact is focused, `viewer` is the R₂
          viewer node and RPanel renders it in place of the R₁ inventory
          body — SAME column, SAME drag-set width. There is deliberately no
          additional R₂ sibling column here: opening a viewer must not
          steal width from the centre conversation (the C-width invariant).
          The single split divider on this column is the only thing that
          changes C's width. */}
      {!isNarrowScreen && !isMobileScreen && (
        <RPanel
          currentProjectPath={currentProject}
          unitName={unitName}
          collapsed={rPanelCollapsed}
          onToggleCollapsed={toggleRPanel}
          resize={{
            width: rPanelWidth,
            isResizing: rPanelSplit.isDragging,
            ratio: rPanelSplit.splitRatio,
            onMouseDown: rPanelSplit.onDividerMouseDown,
            onDoubleClick: () => setRPanelWidth(ATTENTION_STRIP_WIDTH_DEFAULT),
            onAdjust: rPanelSplit.adjustRatio,
          }}
          onSelectPr={selectPr}
          selectedPrKey={
            selectedPr ? selectedPrKey(selectedPr.repoPath, selectedPr.pr.number) : null
          }
          onSelectIssue={selectIssue}
          selectedIssueKey={
            selectedIssue
              ? selectedIssueKey(selectedIssue.repoPath, selectedIssue.issue.number)
              : null
          }
          viewer={rViewer}
        />
      )}

      {/* Help overlay */}
      <HelpOverlay isOpen={showHelp} onClose={() => setShowHelp(false)} />

      {/* Toast notifications */}
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />

      {/* Producer slot-restart ritual UI — App-level single instance so it
          stays co-visible regardless of the active centre view (digest,
          Producer conversation, Settings, …). Hosts BOTH the operator
          handoff (full 5-phase, the unchanged handoff-lifecycle DR §E
          contract) and the supervisor crash-respawn (launching→ready, or a
          `crash_loop_halted` escalate). The overlay/dialog read the ritual's
          OWN `unit` (a supervisor respawn may target a non-focused unit) and
          pick their copy off the `slot-supervisor:` id / reason. */}
      {ritualState.kind === "dispatching" && unitName !== null && (
        <HandoffRitualOverlay unitName={unitName} ritualId={null} phases={[]} />
      )}
      {ritualState.kind === "in_progress" && (
        <HandoffRitualOverlay
          unitName={ritualState.unit}
          ritualId={ritualState.ritualId}
          phases={ritualState.phases}
        />
      )}

      {ritualState.kind === "escalated" && ritualState.unit !== "" && (
        <HandoffRitualFailureDialog
          unitName={ritualState.unit}
          reason={ritualState.reason}
          message={ritualState.message}
          // The supervisor's `crash_loop_halted` halt is a different failure
          // than an operator-rejected handoff — manual relaunch, not retry.
          mode={ritualState.reason === "crash_loop_halted" ? "crash_loop" : "handoff"}
          producerAgentId={producerForUnit?.id ?? null}
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
    </div>
  );
}
