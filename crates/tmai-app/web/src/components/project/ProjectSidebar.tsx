import { useEffect, useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { TeamSummary } from "@/lib/teams";

interface ProjectSidebarProps {
  registeredProjects: string[];
  currentProject: string | null;
  onProjectChange: (path: string) => void;
}

export function ProjectSidebar({
  registeredProjects,
  currentProject,
  onProjectChange,
}: ProjectSidebarProps) {
  const [expanded, setExpanded] = useState(true);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load teams on mount
  useEffect(() => {
    const loadTeams = async () => {
      try {
        setTeamsLoading(true);
        const teamList = await api.listTeams();
        setTeams(teamList);
      } catch (e) {
        console.error("Failed to load teams:", e);
      } finally {
        setTeamsLoading(false);
      }
    };

    loadTeams();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  // Get project display name from path
  const getProjectName = (path: string): string => {
    return path.split("/").pop() || path;
  };

  // Get active project display
  const activeProjectName = currentProject
    ? getProjectName(currentProject)
    : "Select Project";

  return (
    <div className="flex flex-col gap-3 border-b border-white/10 px-3 py-3">
      {/* Project Selector */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-500 uppercase">
            Project
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-1 text-zinc-600 transition-colors hover:text-zinc-400"
          >
            <span
              className={cn(
                "inline-block transition-transform",
                !expanded && "-rotate-90",
              )}
            >
              ▼
            </span>
          </button>
        </div>

        {expanded && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm transition-all hover:bg-white/[0.05] hover:border-white/20 flex items-center justify-between group"
            >
              <span className="truncate text-zinc-300 group-hover:text-zinc-100">
                {activeProjectName}
              </span>
              <ChevronDown size={14} className="shrink-0 text-zinc-600 group-hover:text-zinc-400" />
            </button>

            {showDropdown && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 flex max-h-48 flex-col gap-1 rounded-lg border border-white/10 bg-zinc-900/95 p-1 shadow-xl overflow-y-auto">
                {registeredProjects.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-zinc-500">
                    No projects registered
                  </div>
                ) : (
                  registeredProjects.map((path) => (
                    <button
                      key={path}
                      onClick={() => {
                        onProjectChange(path);
                        setShowDropdown(false);
                      }}
                      className={cn(
                        "rounded px-3 py-2 text-left text-xs transition-colors",
                        currentProject === path
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                          : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-300",
                      )}
                    >
                      <div className="truncate font-medium">
                        {getProjectName(path)}
                      </div>
                      <div className="truncate text-[10px] text-zinc-600 mt-0.5">
                        {path}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Teams Summary */}
      {expanded && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 uppercase">
              Teams ({teams.length})
            </span>
          </div>

          {teamsLoading ? (
            <div className="px-2 py-2 text-xs text-zinc-600">
              Loading teams...
            </div>
          ) : teams.length === 0 ? (
            <div className="px-2 py-2 text-xs text-zinc-600">
              No teams available
            </div>
          ) : (
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
              {teams.map((team) => (
                <div
                  key={team.name}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 transition-all hover:bg-white/[0.04] hover:border-white/[0.12]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-zinc-300">
                      {team.name}
                    </span>
                    {team.task_done > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 text-[10px] text-emerald-400">
                        {team.task_done}/{team.task_total}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600">
                      {team.member_count} member{team.member_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
