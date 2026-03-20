import { useState, useCallback, useMemo, useEffect } from "react";
import { useAgents } from "@/hooks/useAgents";
import { isAiAgent, api } from "@/lib/api";
import { AgentList } from "@/components/agent/AgentList";
import { AgentActions } from "@/components/agent/AgentActions";
import { StatusBar } from "@/components/layout/StatusBar";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { TerminalList } from "@/components/terminal/TerminalList";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export function App() {
  const { agents, attentionCount, loading, refresh } = useAgents();
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [registeredProjects, setRegisteredProjects] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

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

  // Match by id (target may be missing from API response)
  const selectedAgent = agents.find(
    (a) => a.id === selectedTarget || a.target === selectedTarget,
  );
  const sessionId = selectedAgent?.pty_session_id ?? null;

  const handleSpawned = useCallback(
    (target: string) => {
      setSelectedTarget(target);
      setShowSettings(false);
      refresh();
    },
    [refresh],
  );

  return (
    <div className="flex h-screen text-zinc-100">
      {/* Sidebar */}
      <aside className="glass flex w-80 shrink-0 flex-col">
        <StatusBar
          agentCount={aiAgents.length}
          attentionCount={attentionCount}
          onSettingsClick={() => setShowSettings((v) => !v)}
        />
        <AgentList
          agents={aiAgents}
          loading={loading}
          selectedTarget={selectedTarget}
          onSelect={(target) => {
            setSelectedTarget(target);
            setShowSettings(false);
          }}
          registeredProjects={registeredProjects}
          onSpawned={handleSpawned}
        />
        <TerminalList
          terminals={terminals}
          selectedTarget={selectedTarget}
          onSelect={(target) => {
            setSelectedTarget(target);
            setShowSettings(false);
          }}
        />
      </aside>

      {/* Main area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {showSettings ? (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            onProjectsChanged={refreshProjects}
          />
        ) : (
          <>
            {selectedAgent && <AgentActions agent={selectedAgent} />}
            {sessionId ? (
              <TerminalPanel key={sessionId} sessionId={sessionId} />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="glass-light rounded-2xl px-12 py-10 text-center">
                  <h1 className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
                    tmai
                  </h1>
                  <p className="mt-2 text-sm text-zinc-500">
                    {agents.length > 0
                      ? "Select an agent to view terminal"
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
