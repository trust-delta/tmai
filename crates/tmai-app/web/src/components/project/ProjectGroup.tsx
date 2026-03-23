import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type {
  ProjectGroup as ProjectGroupType,
  WorktreeGroup,
  Selection,
  BranchListResponse,
} from "@/lib/api";
import { AgentCard } from "@/components/agent/AgentCard";

interface ProjectGroupProps {
  project: ProjectGroupType;
  selection: Selection | null;
  onSelectAgent: (target: string) => void;
  onSelectProject: (path: string, name: string) => void;
  onSpawned: (sessionId: string) => void;
}

// Collapsible project group containing worktree sub-groups
export function ProjectGroup({
  project,
  selection,
  onSelectAgent,
  onSelectProject,
  onSpawned,
}: ProjectGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [worktreeInput, setWorktreeInput] = useState(false);
  const [worktreeName, setWorktreeName] = useState("");
  const [worktreeError, setWorktreeError] = useState("");
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branches, setBranches] = useState<BranchListResponse | null>(null);
  const [branchFilter, setBranchFilter] = useState("");

  // Fetch branches when worktree input opens
  useEffect(() => {
    if (worktreeInput && !branches) {
      api.listBranches(project.path).then(setBranches).catch(console.error);
    }
  }, [worktreeInput]);

  // Derive selectedTarget for agent card highlighting
  const selectedTarget = selection?.type === "agent" ? selection.id : null;
  const isProjectSelected =
    selection?.type === "project" && selection.path === project.path;

  // Spawn an agent in this project's directory
  const spawn = async (command: string, args?: string[]) => {
    if (spawning) return;
    setSpawning(true);
    setShowSpawn(false);
    setWorktreeInput(false);
    setWorktreeName("");
    try {
      const res = await api.spawnPty({ command, args, cwd: project.path });
      onSpawned(res.session_id);
    } catch (e) {
      console.error("Spawn failed:", e);
    } finally {
      setSpawning(false);
    }
  };

  // Validate worktree name
  const validateWorktreeName = (name: string): string => {
    if (!name) return "";
    if (name.length > 64) return "Max 64 chars";
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return "Only a-z, 0-9, - and _";
    return "";
  };

  // Create git worktree then spawn claude in it
  const spawnWorktree = async () => {
    const name = worktreeName.trim();
    const err = validateWorktreeName(name);
    if (!name || err || spawning) return;
    setSpawning(true);
    setWorktreeInput(false);
    setWorktreeName("");
    setWorktreeError("");
    setBaseBranch(null);
    setBranchPickerOpen(false);
    setBranches(null);
    setBranchFilter("");
    try {
      const res = await api.spawnWorktree({
        name,
        cwd: project.path,
        base_branch: baseBranch || branches?.default_branch || undefined,
      });
      onSpawned(res.session_id);
    } catch (e) {
      console.error("Worktree spawn failed:", e);
    } finally {
      setSpawning(false);
    }
  };

  const isEmpty = project.totalAgents === 0;

  return (
    <div className="mb-1">
      {/* Project header */}
      <div className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span
            className={cn(
              "text-[10px] text-zinc-600 transition-transform",
              collapsed && "-rotate-90",
            )}
          >
            ▼
          </span>
          <span
            className={cn(
              "truncate text-xs font-semibold",
              isEmpty ? "text-zinc-500" : "text-zinc-300",
            )}
          >
            {project.name}
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          {project.totalAgents > 0 && (
            <span className="text-[10px] text-zinc-600">
              {project.totalAgents}
            </span>
          )}
          {project.attentionAgents > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
              {project.attentionAgents}
            </span>
          )}
          {/* Branch graph button */}
          <button
            onClick={() => onSelectProject(project.path, project.name)}
            className={cn(
              "rounded px-1 py-0.5 transition-colors",
              isProjectSelected
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-zinc-600 hover:text-emerald-400 hover:bg-emerald-500/10",
            )}
            title="Branch graph"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="inline-block">
              <circle cx="4" cy="4" r="2" fill="currentColor" />
              <circle cx="4" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="8" r="2" fill="currentColor" />
              <line x1="4" y1="6" x2="4" y2="10" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 6 C4 8, 8 8, 12 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          {/* Spawn button */}
          <div className="relative">
            <button
              onClick={() => setShowSpawn((v) => !v)}
              disabled={spawning}
              className="rounded px-1 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-white/10 hover:text-cyan-400 disabled:opacity-50"
              title="Spawn agent"
            >
              +
            </button>
            {showSpawn && (
              <div className="glass absolute right-0 top-full z-10 mt-1 flex flex-col gap-0.5 rounded-lg border border-white/10 p-1 shadow-lg">
                {["claude", "codex", "bash"].map((cmd) => (
                  <button
                    key={cmd}
                    onClick={() => spawn(cmd)}
                    className="whitespace-nowrap rounded px-3 py-1 text-left text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-cyan-400"
                  >
                    {cmd}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setWorktreeInput(true);
                    setShowSpawn(false);
                  }}
                  className="whitespace-nowrap rounded px-3 py-1 text-left text-xs text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
                >
                  Worktree (Claude)
                </button>
              </div>
            )}
            {worktreeInput && (
              <div className="glass absolute right-0 top-full z-10 mt-1 flex flex-col gap-1 rounded-lg border border-emerald-500/20 p-1.5 shadow-lg">
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    type="text"
                    value={worktreeName}
                    onChange={(e) => {
                      setWorktreeName(e.target.value);
                      setWorktreeError(validateWorktreeName(e.target.value.trim()));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") spawnWorktree();
                      if (e.key === "Escape") {
                        setWorktreeInput(false);
                        setWorktreeName("");
                        setWorktreeError("");
                        setBaseBranch(null);
                        setBranchPickerOpen(false);
                        setBranches(null);
                        setBranchFilter("");
                      }
                    }}
                    placeholder="worktree name"
                    className={cn(
                      "w-32 rounded bg-black/30 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none ring-1",
                      worktreeError
                        ? "ring-red-500/50 focus:ring-red-500/80"
                        : "ring-emerald-500/30 focus:ring-emerald-500/60",
                    )}
                  />
                  <button
                    onClick={spawnWorktree}
                    disabled={!worktreeName.trim() || !!worktreeError}
                    className="rounded px-2 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-30"
                  >
                    Go
                  </button>
                </div>
                {worktreeError && (
                  <span className="text-[10px] text-red-400">{worktreeError}</span>
                )}
                <button
                  onClick={() => setBranchPickerOpen((v) => !v)}
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  <span className="text-[10px]">{branchPickerOpen ? "\u25BE" : "\u25B8"}</span>
                  <span>from:</span>
                  <span className="text-zinc-400">
                    {baseBranch || branches?.default_branch || "..."}
                  </span>
                </button>
                {branchPickerOpen && (
                  <div className="flex flex-col gap-0.5">
                    <input
                      type="text"
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value)}
                      placeholder="filter branches..."
                      className="w-full rounded bg-black/30 px-2 py-0.5 text-[11px] text-zinc-300 placeholder-zinc-600 outline-none ring-1 ring-white/10 focus:ring-white/20"
                    />
                    <div className="max-h-32 overflow-y-auto">
                      {(branches?.branches ?? [])
                        .filter((b) =>
                          b.toLowerCase().includes(branchFilter.toLowerCase()),
                        )
                        .map((branch) => (
                          <button
                            key={branch}
                            onClick={() => {
                              setBaseBranch(branch);
                              setBranchPickerOpen(false);
                              setBranchFilter("");
                            }}
                            className={cn(
                              "flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[11px] transition-colors hover:bg-white/10",
                              branch === (baseBranch || branches?.default_branch)
                                ? "text-emerald-400"
                                : "text-zinc-400",
                            )}
                          >
                            {branch === branches?.default_branch && (
                              <span className="text-[9px] text-emerald-500">{"\u25CF"}</span>
                            )}
                            {branch}
                          </button>
                        ))}
                      {branches === null && (
                        <span className="px-2 py-1 text-[10px] text-zinc-600">Loading...</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agent sub-groups */}
      {!collapsed && (
        <div className="ml-1 border-l border-white/5 pl-2">
          {project.worktrees.map((wt) => (
            <WorktreeSection
              key={wt.name}
              worktree={wt}
              selectedTarget={selectedTarget}
              onSelect={onSelectAgent}
              showHeader={project.worktrees.length > 1}
            />
          ))}
          {isEmpty && (
            <div className="px-2 py-2 text-[11px] text-zinc-600">
              No agents — click + to spawn
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface WorktreeSectionProps {
  worktree: WorktreeGroup;
  selectedTarget: string | null;
  onSelect: (target: string) => void;
  showHeader: boolean;
}

// Sub-section for a worktree (or main) within a project
function WorktreeSection({
  worktree,
  selectedTarget,
  onSelect,
  showHeader,
}: WorktreeSectionProps) {
  return (
    <div className="mb-0.5">
      {showHeader && (
        <div className="flex items-center gap-1.5 px-1 py-1">
          {worktree.isWorktree ? (
            <span className="text-[10px] text-emerald-500">🌿</span>
          ) : (
            <span className="text-[10px] text-zinc-500">●</span>
          )}
          <span className="truncate text-[11px] text-zinc-500">
            {worktree.branch || worktree.name}
          </span>
          {worktree.dirty && (
            <span className="text-[10px] text-amber-500">*</span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {worktree.agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedTarget}
            onClick={() => onSelect(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
