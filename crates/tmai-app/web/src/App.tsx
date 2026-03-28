import { useState, useCallback, useMemo, useEffect } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useWorktrees } from "@/hooks/useWorktrees";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { isAiAgent, api, type Selection } from "@/lib/api";
import { AgentList } from "@/components/agent/AgentList";
import { AgentActions } from "@/components/agent/AgentActions";
import { StatusBar } from "@/components/layout/StatusBar";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { TerminalList } from "@/components/terminal/TerminalList";
import { PreviewPanel } from "@/components/agent/PreviewPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { SecurityPanel } from "@/components/settings/SecurityPanel";
import { UsagePanel } from "@/components/usage/UsagePanel";
import { WorktreePanel } from "@/components/worktree/WorktreePanel";
import { BranchGraph } from "@/components/worktree/BranchGraph";
import { MarkdownPanel } from "@/components/markdown/MarkdownPanel";
import { ProjectSidebar } from "@/components/project/ProjectSidebar";
import { HelpOverlay } from "@/components/layout/HelpOverlay";
import { ToastContainer, useToast } from "@/components/layout/ToastContainer";

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

  // Fetch registered projects on mount and on demand
  const refreshProjects = useCallback(() => {
    api.listProjects().then((projects) => {
      setRegisteredProjects(projects);
      // Set first project as default if not set
      if (projects.length > 0 && !currentProject) {
        setCurrentProject(projects[0]);
      }
    }).catch((e) => {
      console.error("Failed to load projects:", e);
      toast.error("Failed to load projects");
    });
  }, [currentProject, toast]);
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Split agents into AI agents and plain terminals
  const aiAgents = useMemo(
    () => agents.filter((a) => isAiAgent(a.agent_type)),
    [agents],
  );
  const terminals = useMemo(
    () => agents.filter((a) => !isAiAgent(a.agent_type)),
    [agents],
  );

  // Derive selected agent from selection
  const selectedAgent =
    selection?.type === "agent"
      ? agents.find(
          (a) => a.id === selection.id || a.target === selection.id,
        )
      : undefined;
  const sessionId = selectedAgent?.pty_session_id ?? null;

  // Derive selected worktree from selection
  const selectedWorktree =
    selection?.type === "worktree"
      ? worktrees.find(
          (wt) =>
            wt.repo_path === selection.repoPath && wt.name === selection.name,
        )
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
  const handleSelectAgent = useCallback(
    (target: string) => {
      setSelection({ type: "agent", id: target });
      setShowSettings(false);
      setShowSecurity(false);
    },
    [],
  );

  // Select handler for worktrees (from BranchGraph click)
  const handleSelectWorktree = useCallback(
    (repoPath: string, name: string, worktreePath: string) => {
      setSelection({ type: "worktree", repoPath, name, worktreePath });
      setShowSettings(false);
      setShowSecurity(false);
    },
    [],
  );

  // Select handler for project branch graph
  const handleSelectProject = useCallback(
    (path: string, name: string) => {
      setSelection({ type: "project", path, name });
      setShowSettings(false);
      setShowSecurity(false);
    },
    [],
  );

  // Select handler for project markdown viewer
  const handleSelectMarkdown = useCallback(
    (projectPath: string, projectName: string) => {
      setSelection({ type: "markdown", projectPath, projectName });
      setShowSettings(false);
      setShowSecurity(false);
    },
    [],
  );

  // Derive selectedTarget string for components that need it
  const selectedTarget =
    selection?.type === "agent" ? selection.id : null;

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
      keys: ["]"],
      description: "Next project",
      handler: () => {
        const newIndex = Math.min(
          registeredProjects.length - 1,
          currentProjectIndex + 1,
        );
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
        <ProjectSidebar
          registeredProjects={registeredProjects}
          currentProject={currentProject}
          onProjectChange={setCurrentProject}
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
          <div className="animate-scale-in">
            <SecurityPanel onClose={() => setShowSecurity(false)} />
          </div>
        ) : showSettings ? (
          <div className="animate-scale-in">
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
              onSelectWorktree={handleSelectWorktree}
            />
          </div>
        ) : selection?.type === "markdown" ? (
          <div className="animate-fade-in">
            <MarkdownPanel
              key={selection.projectPath}
              projectPath={selection.projectPath}
              projectName={selection.projectName}
            />
          </div>
        ) : selection?.type === "worktree" && selectedWorktree ? (
          <div className="animate-fade-in">
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
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {selectedAgent && <AgentActions agent={selectedAgent} passthrough />}
            {sessionId ? (
              <div key={sessionId} className="flex-1 overflow-hidden animate-fade-in">
                <TerminalPanel sessionId={sessionId} />
              </div>
            ) : selectedAgent ? (
              <div key={selectedAgent.id} className="flex-1 overflow-auto animate-fade-in">
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
