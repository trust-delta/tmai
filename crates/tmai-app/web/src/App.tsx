import { useState, useCallback, useMemo, useEffect } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useWorktrees } from "@/hooks/useWorktrees";
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

export function App() {
  const { agents, attentionCount, loading, refresh } = useAgents();
  const { worktrees, refresh: refreshWorktrees } = useWorktrees();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [registeredProjects, setRegisteredProjects] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);

  // Fetch registered projects on mount and on demand
  const refreshProjects = useCallback(() => {
    api.listProjects().then(setRegisteredProjects).catch(console.error);
  }, []);
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
    },
    [refresh],
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

  return (
    <div className="flex h-screen text-zinc-100">
      {/* Sidebar */}
      <aside className="glass flex w-80 shrink-0 flex-col">
        <StatusBar
          agentCount={aiAgents.length}
          attentionCount={attentionCount}
          onSettingsClick={() => { setShowSettings((v) => !v); setShowSecurity(false); }}
          onSecurityClick={() => { setShowSecurity((v) => !v); setShowSettings(false); }}
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
      <main className="flex flex-1 flex-col overflow-hidden">
        {showSecurity ? (
          <SecurityPanel onClose={() => setShowSecurity(false)} />
        ) : showSettings ? (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            onProjectsChanged={refreshProjects}
          />
        ) : selection?.type === "project" ? (
          <BranchGraph
            key={selection.path}
            projectPath={selection.path}
            projectName={selection.name}
            worktrees={worktrees}
            onSelectWorktree={handleSelectWorktree}
          />
        ) : selection?.type === "markdown" ? (
          <MarkdownPanel
            key={selection.projectPath}
            projectPath={selection.projectPath}
            projectName={selection.projectName}
          />
        ) : selection?.type === "worktree" && selectedWorktree ? (
          <WorktreePanel
            worktree={selectedWorktree}
            onLaunched={(target) => {
              handleSpawned(target);
              refreshWorktrees();
            }}
            onDeleted={() => {
              setSelection(null);
              refreshWorktrees();
            }}
          />
        ) : (
          <>
            {selectedAgent && <AgentActions agent={selectedAgent} passthrough />}
            {sessionId ? (
              <TerminalPanel key={sessionId} sessionId={sessionId} />
            ) : selectedAgent ? (
              <PreviewPanel
                key={selectedAgent.id}
                agentId={selectedAgent.id}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="glass-light rounded-2xl px-12 py-10 text-center">
                  <h1 className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
                    tmai
                  </h1>
                  <p className="mt-2 text-sm text-zinc-500">
                    {agents.length > 0
                      ? "Select an agent to view"
                      : "Click + on a project to spawn an agent"}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
