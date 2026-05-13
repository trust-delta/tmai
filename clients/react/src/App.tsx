import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentActions } from "@/components/agent/AgentActions";
import { AgentList } from "@/components/agent/AgentList";
import { PreviewPanel } from "@/components/agent/PreviewPanel";
import { CalibrationChip } from "@/components/calibration/CalibrationChip";
import { CalibrationPanel } from "@/components/calibration/CalibrationPanel";
import { TripwireBanner } from "@/components/calibration/TripwireBanner";
import { type DisplayMode, DisplayModeSelector } from "@/components/layout/DisplayModeSelector";
import { HelpOverlay } from "@/components/layout/HelpOverlay";
import { SplitPaneLayout } from "@/components/layout/SplitPaneLayout";
import { StatusBar } from "@/components/layout/StatusBar";
import { TabbedPaneLayout } from "@/components/layout/TabbedPaneLayout";
import { ToastContainer, useToast } from "@/components/layout/ToastContainer";
import { TriplePaneLayout } from "@/components/layout/TriplePaneLayout";
import { MarkdownPanel } from "@/components/markdown/MarkdownPanel";
import { ProducerConsole } from "@/components/producer-console/ProducerConsole";
import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { TerminalList } from "@/components/terminal/TerminalList";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { UsagePanel } from "@/components/usage/UsagePanel";
import { BranchGraph } from "@/components/worktree/BranchGraph";
import { WorktreePanel } from "@/components/worktree/WorktreePanel";
import { useAgentSelectionFallback } from "@/hooks/useAgentSelectionFallback";
import { useAgents } from "@/hooks/useAgents";
import { useCalibration } from "@/hooks/useCalibration";
import { useIdleNotification } from "@/hooks/useIdleNotification";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNotificationConfig } from "@/hooks/useNotificationConfig";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useSplitPane } from "@/hooks/useSplitPane";
import { useWorktrees } from "@/hooks/useWorktrees";
import { api, groupByProject, isAiAgent, type Selection, setCallerCwd } from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";
import { useUIPref } from "@/lib/ui-prefs-provider";

export function App() {
  const { agents, attentionCount, loading, refresh } = useAgents();
  const { worktrees, refresh: refreshWorktrees } = useWorktrees();
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
  // Main panel takes one of `"agents"` (default), `"settings"`, or `"security"`.
  // Settings and Security replace the main panel content (not modal overlays),
  // so they're mutually exclusive — opening one always closes the other.
  // The previous two-booleans-cleared-in-tandem pattern was equivalent but
  // more error-prone; this enum makes the constraint explicit.
  const [mainPanel, setMainPanel] = useState<"agents" | "settings" | "security" | "calibration">(
    "agents",
  );
  const [showHelp, setShowHelp] = useState(false);
  // Multi-pane layout choices live in the WebUI prefs store (browser-only,
  // not in tmai-core's config.toml — these describe how this WebUI shows
  // the same backend data). The store handles persistence + cross-tab sync.
  const [rightPanelTab, setRightPanelTab] = useUIPref("rightPanelTab");
  const [displayMode, setDisplayMode] = useUIPref("displayMode");
  const [tabsActive, setTabsActive] = useUIPref("tabsActive");
  const [splitRatioH, setSplitRatioH] = useUIPref("splitRatioH");
  const [splitRatioV, setSplitRatioV] = useUIPref("splitRatioV");
  const showSettings = mainPanel === "settings";
  const showSecurity = mainPanel === "security";
  const showCalibration = mainPanel === "calibration";
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
  const toggleSettings = useCallback(() => {
    setSettingsOpenedFromOverride(false);
    setMainPanel((mp) => (mp === "settings" ? "agents" : "settings"));
  }, []);
  const openSettingsFromOverride = useCallback(() => {
    setSettingsOpenedFromOverride(true);
    setMainPanel("settings");
  }, []);
  const toggleSecurity = useCallback(
    () => setMainPanel((mp) => (mp === "security" ? "agents" : "security")),
    [],
  );
  const openCalibration = useCallback(() => setMainPanel("calibration"), []);

  // Unit name for the calibration view. The wire endpoint (`GET
  // /api/units/{unit}/calibration`) takes a unit *name* (a configured
  // `[[unit]]` table key or a cwd-synthesized basename) — the WebUI does
  // not know which `[[unit]]` tables the operator has configured, so we
  // pass the basename of the currently-selected project path. The
  // backend's `resolve_unit_or_cwd` falls back to the basename when no
  // matching `[[unit]]` exists, which matches what the CLI does for the
  // same input.
  const unitName = useMemo(() => {
    if (!currentProject) return null;
    return currentProject.split("/").filter(Boolean).pop() ?? null;
  }, [currentProject]);
  const { data: calibrationData } = useCalibration(unitName);

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
  const openProducerTerminal = useCallback(async () => {
    if (!unitName) return;
    // `tmai producer <unit>` is implemented as an `exec`-style command
    // (`tmai-core/src/producer_cli.rs::launch_producer`) — the tmai
    // subprocess composes the hand-over, then replaces itself with a
    // Claude session seeded with that hand-over as the initial prompt.
    // From the PTY-server's perspective this is just a normal spawn,
    // so we treat it as one: `spawnPty` returns a session id, we point
    // selection at it, and the PreviewPanel shows the Producer session
    // immediately. No clipboard / external-terminal round-trip.
    try {
      const res = await api.spawnPty({
        command: "tmai",
        args: ["producer", unitName],
        cwd: currentProject ?? undefined,
      });
      setSelection({ type: "agent", id: res.session_id });
      closeMainPanelOverlay();
      refresh();
      toastSuccess(`Producer launched for ${unitName}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      toastInfo(`Failed to launch Producer: ${reason}`);
    }
  }, [unitName, currentProject, closeMainPanelOverlay, refresh, toastSuccess, toastInfo]);

  // Split-pane drag state — separate instances for horizontal vs vertical
  // so the user can drag each independently and resume where they left off
  // when cycling display modes. Persistence flows through useUIPref via
  // onCommit; the hook stays in-memory so per-frame drag updates don't
  // hammer localStorage.
  const horizontalSplit = useSplitPane({
    orientation: "horizontal",
    initialRatio: splitRatioH,
    onCommit: setSplitRatioH,
  });
  const verticalSplit = useSplitPane({
    orientation: "vertical",
    initialRatio: splitRatioV,
    onCommit: setSplitRatioV,
  });
  const isNarrowScreen = horizontalSplit.isNarrowScreen;

  // Responsive layout state (sidebar & action panel collapse)
  const {
    sidebarCollapsed,
    toggleSidebar,
    actionPanelCollapsed,
    toggleActionPanel,
    isMobileScreen,
    mobileDrawerOpen,
    toggleMobileDrawer,
    closeMobileDrawer,
  } = useResponsiveLayout();

  // Sync selected project into the API client so X-Tmai-Origin carries cwd.
  useEffect(() => {
    setCallerCwd(currentProject);
  }, [currentProject]);

  // Split agents into AI agents and plain terminals
  const aiAgents = useMemo(() => agents.filter((a) => isAiAgent(a.agent_type)), [agents]);
  const terminals = useMemo(() => agents.filter((a) => !isAiAgent(a.agent_type)), [agents]);

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

  // Derive selected worktree from selection
  const selectedWorktree =
    selection?.type === "worktree"
      ? worktrees.find((wt) => wt.repo_path === selection.repoPath && wt.name === selection.name)
      : undefined;

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

  // Derive project context from selected agent for split view
  const agentProjectPath = selectedAgent?.git_common_dir ?? selectedAgent?.cwd ?? null;
  const agentProjectName = agentProjectPath
    ? (agentProjectPath
        .replace(/\/\.git\/?$/, "")
        .replace(/\/+$/, "")
        .split("/")
        .pop() ?? agentProjectPath)
    : null;
  // Multi-pane (tabs / split / triple) is only available on non-mobile,
  // non-narrow screens with an agent and project context resolved. Below
  // that threshold we always fall back to preview-only.
  const canShowMultiPane =
    selection?.type === "agent" && agentProjectPath !== null && !isNarrowScreen && !isMobileScreen;

  // Project / markdown sidebar buttons. When the click matches the agent's
  // own project AND we're already showing a multi-pane layout that contains
  // that target view, we just route the focus to the relevant tab — no need
  // to blow away the agent context with a fullscreen swap.
  const focusMultiPaneTab = useCallback(
    (tab: "git" | "markdown") => {
      if (displayMode === "tabs") {
        setTabsActive(tab);
        return true;
      }
      if (displayMode === "split-h" || displayMode === "split-v") {
        setRightPanelTab(tab);
        return true;
      }
      // triple already shows both git + markdown — nothing to switch.
      return displayMode === "triple";
    },
    [displayMode, setTabsActive, setRightPanelTab],
  );

  const handleSelectProject = useCallback(
    (path: string, name: string) => {
      if (canShowMultiPane && agentProjectPath && path === agentProjectPath) {
        if (focusMultiPaneTab("git")) {
          closeMobileDrawer();
          return;
        }
      }
      setSelection({ type: "project", path, name });
      closeMainPanelOverlay();
      closeMobileDrawer();
    },
    [
      canShowMultiPane,
      agentProjectPath,
      focusMultiPaneTab,
      closeMobileDrawer,
      closeMainPanelOverlay,
    ],
  );

  const handleSelectMarkdown = useCallback(
    (projectPath: string, projectName: string) => {
      if (canShowMultiPane && agentProjectPath && projectPath === agentProjectPath) {
        if (focusMultiPaneTab("markdown")) {
          closeMobileDrawer();
          return;
        }
      }
      setSelection({ type: "markdown", projectPath, projectName });
      closeMainPanelOverlay();
      closeMobileDrawer();
    },
    [
      canShowMultiPane,
      agentProjectPath,
      focusMultiPaneTab,
      closeMobileDrawer,
      closeMainPanelOverlay,
    ],
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
      keys: ["\\"],
      description: "Cycle display mode (tabs → split-h → split-v → triple)",
      handler: () => {
        const order: DisplayMode[] = ["tabs", "split-h", "split-v", "triple"];
        const next = order[(order.indexOf(displayMode) + 1) % order.length];
        setDisplayMode(next);
      },
    },
    {
      keys: ["b"],
      description: "Toggle sidebar",
      requiresCtrl: true,
      handler: toggleSidebar,
    },
    {
      keys: ["."],
      description: "Toggle action panel",
      requiresCtrl: true,
      handler: toggleActionPanel,
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

  // Map current displayMode to which sidebar tab badge should be highlighted.
  // - tabs:    only when the active tab is git/markdown (preview = no badge)
  // - split-*: the right-pane tab choice
  // - triple:  no single tab is "active" since both surfaces are visible
  const sidebarSplitTab: "git" | "markdown" | null = !canShowMultiPane
    ? null
    : displayMode === "tabs"
      ? tabsActive === "preview"
        ? null
        : tabsActive
      : displayMode === "triple"
        ? null
        : rightPanelTab;

  // Sidebar content shared between desktop sidebar and mobile drawer
  const sidebarContent = (
    <>
      <AgentList
        agents={aiAgents}
        loading={loading}
        selection={selection}
        onSelectAgent={handleSelectAgent}
        onSelectProject={handleSelectProject}
        onSelectMarkdown={handleSelectMarkdown}
        worktrees={worktrees}
        onSpawned={handleSpawned}
        splitPaneProjectPath={canShowMultiPane ? agentProjectPath : null}
        splitPaneTab={sidebarSplitTab}
      />
      <TerminalList
        terminals={terminals}
        selectedTarget={selectedTarget}
        onSelect={handleSelectAgent}
      />
      <UsagePanel />
    </>
  );

  return (
    <div className="flex h-screen text-zinc-100">
      {/* Mobile: overlay backdrop when drawer is open */}
      {isMobileScreen && mobileDrawerOpen && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap to close
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop tap to close
        <div
          className="fixed inset-0 z-40 bg-black/60 animate-fade-in"
          onClick={closeMobileDrawer}
        />
      )}

      {/* Mobile drawer (off-canvas) */}
      {isMobileScreen && (
        <div
          className={`fixed inset-y-0 left-0 z-50 flex w-80 flex-col glass border-r border-white/5 transition-transform duration-300 ease-out safe-top safe-bottom ${
            mobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-sm font-bold tracking-wide text-transparent">
              tmai
            </span>
            <button
              type="button"
              onClick={closeMobileDrawer}
              className="touch-target flex items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
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
            onSecurityClick={() => {
              toggleSecurity();
            }}
            indicatorSlot={<CalibrationChip data={calibrationData} onClick={openCalibration} />}
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
                      ? "bg-cyan-500/20 text-cyan-400"
                      : "text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
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
            onSecurityClick={() => {
              toggleSecurity();
            }}
          />
        )}

        {/* DR §B.4: zero-tolerance tier-1 tripwire banner, hoisted
            ABOVE every main-panel switch so an operator who never
            opens the calibration panel still cannot miss it. Empty
            violation list = silent (the component renders null). */}
        <TripwireBanner data={calibrationData} onDetailsClick={openCalibration} />

        {showCalibration && unitName ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-scale-in">
            <CalibrationPanel unit={unitName} onClose={closeMainPanelOverlay} />
          </div>
        ) : showSecurity ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-scale-in">
            <SecurityPanel onClose={closeMainPanelOverlay} />
          </div>
        ) : showSettings ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-scale-in">
            <SettingsPanel
              onClose={closeMainPanelOverlay}
              defaultOpenAdvanced={settingsOpenedFromOverride}
            />
          </div>
        ) : selection?.type === "project" ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
            <BranchGraph
              key={selection.path}
              projectPath={selection.path}
              projectName={selection.name}
              worktrees={worktrees}
              agents={aiAgents}
              onFocusAgent={handleSelectAgent}
              actionPanelCollapsed={actionPanelCollapsed || isMobileScreen}
              onToggleActionPanel={isMobileScreen ? undefined : toggleActionPanel}
            />
          </div>
        ) : selection?.type === "markdown" ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
            <MarkdownPanel
              key={selection.projectPath}
              projectPath={selection.projectPath}
              projectName={selection.projectName}
            />
          </div>
        ) : selection?.type === "worktree" && selectedWorktree ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
            <WorktreePanel
              worktree={selectedWorktree}
              onLaunched={(target) => {
                handleSpawned(target);
                refreshWorktrees();
              }}
              onDeleted={() => {
                setSelection(null);
                refreshWorktrees();
                toastSuccess("Worktree deleted");
              }}
            />
          </div>
        ) : canShowMultiPane && selectedAgent && agentProjectPath && agentProjectName ? (
          (() => {
            const previewSlot = sessionId ? (
              <div key={sessionId} className="flex-1 overflow-hidden animate-fade-in">
                <TerminalPanel agentId={selectedAgent.target} />
              </div>
            ) : (
              <div
                key={selectedAgent.target}
                className="flex flex-1 flex-col overflow-hidden animate-fade-in"
              >
                <PreviewPanel agentId={selectedAgent.target} />
              </div>
            );
            const gitSlot = (
              <BranchGraph
                key={agentProjectPath}
                projectPath={agentProjectPath}
                projectName={agentProjectName}
                worktrees={worktrees}
                agents={aiAgents}
                onFocusAgent={handleSelectAgent}
                actionPanelCollapsed={actionPanelCollapsed}
                onToggleActionPanel={toggleActionPanel}
              />
            );
            const markdownSlot = (
              <MarkdownPanel
                key={agentProjectPath}
                projectPath={agentProjectPath}
                projectName={agentProjectName}
              />
            );
            const split = displayMode === "split-v" ? verticalSplit : horizontalSplit;
            return (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex shrink-0 items-center justify-end gap-2 border-b border-white/[0.06] px-3 py-1">
                  <DisplayModeSelector mode={displayMode} onChange={setDisplayMode} />
                </div>
                <AgentActions agent={selectedAgent} passthrough />
                {displayMode === "tabs" ? (
                  <TabbedPaneLayout
                    active={tabsActive}
                    onTabChange={setTabsActive}
                    preview={previewSlot}
                    git={gitSlot}
                    markdown={markdownSlot}
                  />
                ) : displayMode === "triple" ? (
                  <TriplePaneLayout preview={previewSlot} git={gitSlot} markdown={markdownSlot} />
                ) : (
                  <SplitPaneLayout
                    orientation={displayMode === "split-v" ? "vertical" : "horizontal"}
                    left={previewSlot}
                    right={rightPanelTab === "git" ? gitSlot : markdownSlot}
                    rightTab={rightPanelTab}
                    onTabChange={setRightPanelTab}
                    splitRatio={split.splitRatio}
                    isDragging={split.isDragging}
                    containerRef={split.containerRef}
                    onDividerMouseDown={split.onDividerMouseDown}
                    onDividerDoubleClick={split.onDividerDoubleClick}
                    onAdjustRatio={split.adjustRatio}
                  />
                )}
              </div>
            );
          })()
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {selectedAgent && <AgentActions agent={selectedAgent} passthrough />}
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
              // Decision `doc/decisions/2026-05-14-react-producer-
              // console-rebuild.md` Phase A: default view becomes the
              // Producer console (hand-over digest). Selecting an
              // agent in the sidebar still drops into the agent view
              // above; this is the empty / between-selections home.
              <ProducerConsole
                currentProjectPath={currentProject}
                unitName={unitName}
                calibrationData={calibrationData}
                onOpenProducerTerminal={openProducerTerminal}
                onOpenCalibration={openCalibration}
                onSelectProjectByPath={handleSelectProject}
                onOverrideSpawned={handleSpawned}
                onOpenSidebar={toggleSidebar}
                sidebarCollapsed={sidebarCollapsed}
                onOpenSettings={openSettingsFromOverride}
              />
            )}
          </div>
        )}
      </main>

      {/* Help overlay */}
      <HelpOverlay isOpen={showHelp} onClose={() => setShowHelp(false)} />

      {/* Toast notifications */}
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
    </div>
  );
}
