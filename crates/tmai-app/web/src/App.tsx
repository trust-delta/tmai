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
import { useAgents } from "@/hooks/useAgents";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSplitPane } from "@/hooks/useSplitPane";
import { useWorktrees } from "@/hooks/useWorktrees";
import { api, isAiAgent, type Selection } from "@/lib/api";

export function App() {
  const { agents, attentionCount, loading, refresh } = useAgents();
  const { worktrees, refresh: refreshWorktrees } = useWorktrees();
  const toast = useToast();
  const [selection, setSelection] = useState<Selection | null>(null);
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
        toast.error("Failed to load projects");
      });
  }, [toast]);
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

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
      toast.success("Agent spawned");
    },
    [refresh, toast],
  );

  // Select handler for agents
  const handleSelectAgent = useCallback((target: string) => {
    setSelection({ type: "agent", id: target });
    setShowSettings(false);
    setShowSecurity(false);
  }, []);

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
  const showSplitView =
    selection?.type === "agent" && agentProjectPath !== null && splitEnabled && !isNarrowScreen;

  // Select handler for project branch graph
  const handleSelectProject = useCallback(
    (path: string, name: string) => {
      // In split-pane mode with matching project, switch tab instead of going fullscreen
      if (splitEnabled && !isNarrowScreen && selection?.type === "agent" && agentProjectPath) {
        const matchesAgent = path === agentProjectPath;
        if (matchesAgent) {
          if (rightPanelTab === "git") {
            // Already showing git tab — toggle split view off
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
    },
    [splitEnabled, isNarrowScreen, selection, agentProjectPath, rightPanelTab, setSplitEnabled],
  );

  // Select handler for project markdown viewer
  const handleSelectMarkdown = useCallback(
    (projectPath: string, projectName: string) => {
      // In split-pane mode with matching project, switch tab instead of going fullscreen
      if (splitEnabled && !isNarrowScreen && selection?.type === "agent" && agentProjectPath) {
        const matchesAgent = projectPath === agentProjectPath;
        if (matchesAgent) {
          if (rightPanelTab === "markdown") {
            // Already showing markdown tab — toggle split view off
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
    },
    [splitEnabled, isNarrowScreen, selection, agentProjectPath, rightPanelTab, setSplitEnabled],
  );

  // Keyboard shortcuts handlers
  useKeyboardShortcuts([
    {
      keys: ["?"],
      description: "Toggle help menu",
      handler: () => setShowHelp((v) => !v),
    },
    {
      keys: ["s"],
      description: "Toggle settings",
      handler: () => {
        setShowSettings((v) => !v);
        setShowSecurity(false);
      },
    },
    {
      keys: ["["],
      description: "Previous project",
      handler: () => {
        const newIndex = Math.max(0, currentProjectIndex - 1);
        setCurrentProjectIndex(newIndex);
        if (registeredProjects[newIndex]) {
          setCurrentProject(registeredProjects[newIndex]);
          toast.info("Previous project");
        }
      },
    },
    {
      keys: ["\\"],
      description: "Toggle split view",
      handler: () => setSplitEnabled(!splitEnabled),
    },
    {
      keys: ["]"],
      description: "Next project",
      handler: () => {
        const newIndex = Math.min(registeredProjects.length - 1, currentProjectIndex + 1);
        setCurrentProjectIndex(newIndex);
        if (registeredProjects[newIndex]) {
          setCurrentProject(registeredProjects[newIndex]);
          toast.info("Next project");
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

  return (
    <div className="flex h-screen text-zinc-100">
      {/* Sidebar */}
      <aside className="glass flex w-80 shrink-0 flex-col transition-subtle">
        <StatusBar
          agentCount={aiAgents.length}
          attentionCount={attentionCount}
          onSettingsClick={() => {
            setShowSettings((v) => !v);
            setShowSecurity(false);
          }}
          onSecurityClick={() => {
            setShowSecurity((v) => !v);
            setShowSettings(false);
          }}
        />
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
      </aside>

      {/* Main area */}
      <main className="flex flex-1 flex-col overflow-hidden transition-subtle">
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
                toast.success("Worktree deleted");
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
            ) : (
              <div className="flex flex-1 items-center justify-center animate-fade-in">
                <div className="glass-light rounded-2xl px-12 py-10 text-center transition-subtle hover:glass">
                  <h1 className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
                    tmai
                  </h1>
                  <p className="mt-2 text-sm text-zinc-500">
                    {agents.length > 0
                      ? "Select an agent to view • Press ? for shortcuts"
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
