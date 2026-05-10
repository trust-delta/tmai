import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentActions } from "@/components/agent/AgentActions";
import { AgentList } from "@/components/agent/AgentList";
import { PreviewPanel } from "@/components/agent/PreviewPanel";
import { HelpOverlay } from "@/components/layout/HelpOverlay";
import { SplitPaneLayout } from "@/components/layout/SplitPaneLayout";
import { StatusBar } from "@/components/layout/StatusBar";
import { ToastContainer, useToast } from "@/components/layout/ToastContainer";
import { MarkdownPanel } from "@/components/markdown/MarkdownPanel";
import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { TerminalList } from "@/components/terminal/TerminalList";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { UsagePanel } from "@/components/usage/UsagePanel";
import { BranchGraph } from "@/components/worktree/BranchGraph";
import { WorktreePanel } from "@/components/worktree/WorktreePanel";
import { useAgentSelectionFallback } from "@/hooks/useAgentSelectionFallback";
import { useAgents } from "@/hooks/useAgents";
import { useIdleNotification } from "@/hooks/useIdleNotification";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNotificationConfig } from "@/hooks/useNotificationConfig";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useShowAutoDiscovered } from "@/hooks/useShowAutoDiscovered";
import { useSplitPane } from "@/hooks/useSplitPane";
import { useWorktrees } from "@/hooks/useWorktrees";
import { groupByProject, isAiAgent, type Selection, setCallerCwd } from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";

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
  const [mainPanel, setMainPanel] = useState<"agents" | "settings" | "security">("agents");
  const [showHelp, setShowHelp] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"git" | "markdown">("git");
  const showSettings = mainPanel === "settings";
  const showSecurity = mainPanel === "security";
  const closeMainPanelOverlay = useCallback(() => setMainPanel("agents"), []);
  const toggleSettings = useCallback(
    () => setMainPanel((mp) => (mp === "settings" ? "agents" : "settings")),
    [],
  );
  const toggleSecurity = useCallback(
    () => setMainPanel((mp) => (mp === "security" ? "agents" : "security")),
    [],
  );

  // Split-pane layout state
  const {
    splitRatio,
    splitEnabled,
    setSplitEnabled,
    isDragging,
    isNarrowScreen,
    containerRef,
    onDividerMouseDown,
    onDividerDoubleClick,
  } = useSplitPane();

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

  // Hide CC sessions tmai never spawned by default — they pollute the
  // operational view with the user's own driving sessions firing hooks
  // through the shared `/hooks/event` URL. Dev toggle in Settings flips
  // this for tmai/CC dev work; preference is per-browser localStorage.
  const { show: showAutoDiscovered } = useShowAutoDiscovered();
  const visibleAgents = useMemo(
    () => (showAutoDiscovered ? agents : agents.filter((a) => !a.is_auto_discovered)),
    [agents, showAutoDiscovered],
  );

  // Split agents into AI agents and plain terminals
  const aiAgents = useMemo(
    () => visibleAgents.filter((a) => isAiAgent(a.agent_type)),
    [visibleAgents],
  );
  const terminals = useMemo(
    () => visibleAgents.filter((a) => !isAiAgent(a.agent_type)),
    [visibleAgents],
  );

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
  // Split view is only available on non-mobile, non-narrow screens
  const showSplitView =
    selection?.type === "agent" &&
    agentProjectPath !== null &&
    splitEnabled &&
    !isNarrowScreen &&
    !isMobileScreen;

  // Select handler for project branch graph — closes mobile drawer
  const handleSelectProject = useCallback(
    (path: string, name: string) => {
      // In split-pane mode with matching project, switch tab instead of going fullscreen
      if (
        splitEnabled &&
        !isNarrowScreen &&
        !isMobileScreen &&
        selection?.type === "agent" &&
        agentProjectPath
      ) {
        const matchesAgent = path === agentProjectPath;
        if (matchesAgent) {
          if (rightPanelTab === "git") {
            setSplitEnabled(false);
          } else {
            setRightPanelTab("git");
          }
          return;
        }
      }
      setSelection({ type: "project", path, name });
      closeMainPanelOverlay();
      closeMobileDrawer();
    },
    [
      splitEnabled,
      isNarrowScreen,
      isMobileScreen,
      selection,
      agentProjectPath,
      rightPanelTab,
      setSplitEnabled,
      closeMobileDrawer,
      closeMainPanelOverlay,
    ],
  );

  // Select handler for project markdown viewer — closes mobile drawer
  const handleSelectMarkdown = useCallback(
    (projectPath: string, projectName: string) => {
      // In split-pane mode with matching project, switch tab instead of going fullscreen
      if (
        splitEnabled &&
        !isNarrowScreen &&
        !isMobileScreen &&
        selection?.type === "agent" &&
        agentProjectPath
      ) {
        const matchesAgent = projectPath === agentProjectPath;
        if (matchesAgent) {
          if (rightPanelTab === "markdown") {
            setSplitEnabled(false);
          } else {
            setRightPanelTab("markdown");
          }
          return;
        }
      }
      setSelection({ type: "markdown", projectPath, projectName });
      closeMainPanelOverlay();
      closeMobileDrawer();
    },
    [
      splitEnabled,
      isNarrowScreen,
      isMobileScreen,
      selection,
      agentProjectPath,
      rightPanelTab,
      setSplitEnabled,
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
      description: "Toggle split view",
      handler: () => setSplitEnabled(!splitEnabled),
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
        splitPaneProjectPath={showSplitView ? agentProjectPath : null}
        splitPaneTab={showSplitView ? rightPanelTab : null}
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

        {showSecurity ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-scale-in">
            <SecurityPanel onClose={closeMainPanelOverlay} />
          </div>
        ) : showSettings ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-scale-in">
            <SettingsPanel onClose={closeMainPanelOverlay} />
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
        ) : showSplitView && selectedAgent && agentProjectPath && agentProjectName ? (
          <SplitPaneLayout
            left={
              <div className="flex flex-1 flex-col overflow-hidden">
                <AgentActions agent={selectedAgent} passthrough />
                {sessionId ? (
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
                )}
              </div>
            }
            right={
              rightPanelTab === "git" ? (
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
              ) : (
                <MarkdownPanel
                  key={agentProjectPath}
                  projectPath={agentProjectPath}
                  projectName={agentProjectName}
                />
              )
            }
            rightTab={rightPanelTab}
            onTabChange={setRightPanelTab}
            splitRatio={splitRatio}
            isDragging={isDragging}
            containerRef={containerRef}
            onDividerMouseDown={onDividerMouseDown}
            onDividerDoubleClick={onDividerDoubleClick}
          />
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
              <div className="flex flex-1 items-center justify-center animate-fade-in">
                <div className="glass-light rounded-2xl px-8 py-8 text-center transition-subtle hover:glass mx-4">
                  <h1 className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
                    tmai
                  </h1>
                  <p className="mt-2 text-sm text-zinc-500">
                    {agents.length > 0
                      ? isMobileScreen
                        ? "Tap ☰ to select an agent"
                        : "Select an agent to view • Press ? for shortcuts"
                      : isMobileScreen
                        ? "Tap ☰ then + on a project to spawn an agent"
                        : "Click + on a project to spawn an agent • Press ? for shortcuts"}
                  </p>
                </div>
              </div>
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
