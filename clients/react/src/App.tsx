import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentActions } from "@/components/agent/AgentActions";
import { AgentList } from "@/components/agent/AgentList";
import { AgentNotFound } from "@/components/agent/AgentNotFound";
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
import { useAgents } from "@/hooks/useAgents";
import { useDeepLink } from "@/hooks/useDeepLink";
import { useIdleNotification } from "@/hooks/useIdleNotification";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useSplitPane } from "@/hooks/useSplitPane";
import { useWorktrees } from "@/hooks/useWorktrees";
import { api, isAiAgent, type Selection, setCallerCwd, statusName } from "@/lib/api";
import { useSSE } from "@/lib/sse-provider";

export function App() {
  const { agents, attentionCount, loading, refresh } = useAgents();
  const { worktrees, refresh: refreshWorktrees } = useWorktrees();
  const deepLink = useDeepLink();
  const toast = useToast();
  const { success: toastSuccess, error: toastError, info: toastInfo } = toast;
  const [notifyConfig, setNotifyConfig] = useState({ enabled: true, thresholdSecs: 10 });

  // Load notification settings from backend
  useEffect(() => {
    api
      .getNotificationSettings()
      .then((s) =>
        setNotifyConfig({
          enabled: s.notify_on_idle,
          thresholdSecs: s.notify_idle_threshold_secs,
        }),
      )
      .catch(() => {});
  }, []);

  // Browser notification on agent idle
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
  // null: not a deep-link URL
  // "pending": deep-link detected, waiting for agent list to load
  // "resolved": agent found and selected
  // "not_found": agent not in the list → show 404
  const [deepLinkStatus, setDeepLinkStatus] = useState<"pending" | "resolved" | "not_found" | null>(
    () => {
      if (deepLink === null) return null;
      return deepLink.knownScheme ? "pending" : "not_found";
    },
  );
  const [registeredProjects, setRegisteredProjects] = useState<string[]>([]);
  const [currentProject, setCurrentProject] = useState<string | null>(null);
  const [currentProjectIndex, setCurrentProjectIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"git" | "markdown">("git");

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

  // Fetch registered projects on mount and on demand
  const refreshProjects = useCallback(() => {
    api
      .listProjects()
      .then((projects) => {
        setRegisteredProjects(projects);
        // Set first project as default if not set
        if (projects.length > 0) {
          setCurrentProject((prev) => prev ?? projects[0]);
        }
      })
      .catch((_e) => {
        toastError("Failed to load projects");
      });
  }, [toastError]);
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Sync selected project into the API client so X-Tmai-Origin carries cwd.
  useEffect(() => {
    setCallerCwd(currentProject);
  }, [currentProject]);

  // Split agents into AI agents and plain terminals
  const aiAgents = useMemo(() => agents.filter((a) => isAiAgent(a.agent_type)), [agents]);
  const terminals = useMemo(() => agents.filter((a) => !isAiAgent(a.agent_type)), [agents]);

  // Derive selected agent from selection
  const selectedAgent =
    selection?.type === "agent"
      ? agents.find((a) => a.id === selection.id || a.target === selection.id)
      : undefined;
  const sessionId = selectedAgent?.pty_session_id ?? null;

  // Derive selected worktree from selection
  const selectedWorktree =
    selection?.type === "worktree"
      ? worktrees.find((wt) => wt.repo_path === selection.repoPath && wt.name === selection.name)
      : undefined;

  const handleSpawned = useCallback(
    (target: string) => {
      setSelection({ type: "agent", id: target });
      setShowSettings(false);
      setShowSecurity(false);
      refresh();
      toastSuccess("Agent spawned");
    },
    [refresh, toastSuccess],
  );

  // Select handler for agents — closes mobile drawer after selection
  const handleSelectAgent = useCallback(
    (target: string) => {
      setSelection({ type: "agent", id: target });
      setShowSettings(false);
      setShowSecurity(false);
      closeMobileDrawer();
    },
    [closeMobileDrawer],
  );

  // Resolve deep-link once the agent list has loaded.
  // Runs whenever agents or loading changes; guards on deepLinkStatus so it
  // fires exactly once (subsequent state changes flip status off "pending").
  useEffect(() => {
    if (deepLinkStatus !== "pending" || loading) return;
    const agent = agents.find((a) => a.id === deepLink?.canonicalId);
    if (agent) {
      setSelection({ type: "agent", id: agent.target });
      setDeepLinkStatus("resolved");
    } else {
      setDeepLinkStatus("not_found");
    }
  }, [deepLinkStatus, loading, agents, deepLink]);

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
      setShowSettings(false);
      setShowSecurity(false);
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
      setShowSettings(false);
      setShowSecurity(false);
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
      handler: () => {
        setShowSettings((v) => !v);
        setShowSecurity(false);
      },
    },
    {
      keys: ["["],
      description: "Previous project",
      requiresCtrl: true,
      handler: () => {
        const newIndex = Math.max(0, currentProjectIndex - 1);
        setCurrentProjectIndex(newIndex);
        if (registeredProjects[newIndex]) {
          setCurrentProject(registeredProjects[newIndex]);
          toastInfo("Previous project");
        }
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
        const newIndex = Math.min(registeredProjects.length - 1, currentProjectIndex + 1);
        setCurrentProjectIndex(newIndex);
        if (registeredProjects[newIndex]) {
          setCurrentProject(registeredProjects[newIndex]);
          toastInfo("Next project");
        }
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

  // Update currentProjectIndex when currentProject changes
  useEffect(() => {
    const idx = registeredProjects.indexOf(currentProject || "");
    if (idx >= 0) {
      setCurrentProjectIndex(idx);
    }
  }, [currentProject, registeredProjects]);

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
        registeredProjects={registeredProjects}
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
              setShowSettings((v) => !v);
              setShowSecurity(false);
            }}
            onSecurityClick={() => {
              setShowSecurity((v) => !v);
              setShowSettings(false);
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
                  {statusName(agent.status) === "Processing"
                    ? "●"
                    : statusName(agent.status) === "AwaitingApproval"
                      ? "◐"
                      : "○"}
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
              setShowSettings((v) => !v);
              setShowSecurity(false);
            }}
            onSecurityClick={() => {
              setShowSecurity((v) => !v);
              setShowSettings(false);
            }}
          />
        )}

        {showSecurity ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-scale-in">
            <SecurityPanel onClose={() => setShowSecurity(false)} />
          </div>
        ) : showSettings ? (
          <div className="flex flex-1 flex-col overflow-hidden animate-scale-in">
            <SettingsPanel
              onClose={() => setShowSettings(false)}
              onProjectsChanged={refreshProjects}
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
        ) : showSplitView && selectedAgent && agentProjectPath && agentProjectName ? (
          <SplitPaneLayout
            left={
              <div className="flex flex-1 flex-col overflow-hidden">
                <AgentActions agent={selectedAgent} passthrough />
                {sessionId ? (
                  <div key={sessionId} className="flex-1 overflow-hidden animate-fade-in">
                    <TerminalPanel sessionId={sessionId} />
                  </div>
                ) : (
                  <div
                    key={selectedAgent.id}
                    className="flex flex-1 flex-col overflow-hidden animate-fade-in"
                  >
                    <PreviewPanel agentId={selectedAgent.id} />
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
            {sessionId ? (
              <div key={sessionId} className="flex-1 overflow-hidden animate-fade-in">
                <TerminalPanel sessionId={sessionId} />
              </div>
            ) : selectedAgent ? (
              <div
                key={selectedAgent.id}
                className="flex flex-1 flex-col overflow-hidden animate-fade-in"
              >
                <PreviewPanel agentId={selectedAgent.id} />
              </div>
            ) : deepLinkStatus === "not_found" && deepLink ? (
              <AgentNotFound scheme={deepLink.scheme} id={deepLink.id} />
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
