import { useState, useEffect } from "react";
import { api, type TeamSummary } from "@/lib/api";
import { type TeamTaskInfo } from "@/lib/teams";

interface TeamsPanelProps {
  onClose: () => void;
}

// Teams panel showing all teams and their task status
export function TeamsPanel({ onClose }: TeamsPanelProps) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [teamTasks, setTeamTasks] = useState<TeamTaskInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load teams on mount
  useEffect(() => {
    setLoading(true);
    api.listTeams()
      .then((teams) => {
        setTeams(teams);
        if (teams.length > 0) {
          setSelectedTeam(teams[0].name);
        }
      })
      .catch((e) => {
        setError((e as Error).message);
      })
      .finally(() => setLoading(false));
  }, []);

  // Load team tasks when team selection changes
  useEffect(() => {
    if (!selectedTeam) return;
    
    api.getTeamTasks(selectedTeam)
      .then((tasks) => setTeamTasks(tasks))
      .catch((e) => setError((e as Error).message));
  }, [selectedTeam]);

  const selectedTeamData = teams.find((t) => t.name === selectedTeam);

  return (
    <div className="glass-deep flex flex-1 flex-col overflow-hidden rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <h2 className="text-lg font-semibold text-zinc-100">Teams</h2>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-subtle"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden gap-4 p-6">
        {/* Teams List */}
        <div className="w-64 shrink-0 overflow-y-auto">
          {loading ? (
            <div className="text-zinc-500">Loading teams...</div>
          ) : error ? (
            <div className="text-red-500 text-sm">{error}</div>
          ) : teams.length === 0 ? (
            <div className="text-zinc-500">No teams found</div>
          ) : (
            <div className="space-y-2">
              {teams.map((team) => (
                <button
                  key={team.name}
                  onClick={() => setSelectedTeam(team.name)}
                  className={`glass-card w-full rounded-lg px-3 py-2 text-left transition-subtle text-sm ${
                    selectedTeam === team.name
                      ? "!border-cyan-500/30 !bg-cyan-500/10"
                      : "hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="font-medium text-zinc-200">{team.name}</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {team.member_count} members • {team.task_done}/{team.task_total} done
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Team Details */}
        <div className="flex-1 overflow-y-auto">
          {selectedTeamData ? (
            <div className="space-y-4">
              {/* Team Info */}
              <div className="glass-card rounded-lg px-4 py-3">
                <h3 className="font-semibold text-zinc-100 text-base">
                  {selectedTeamData.name}
                </h3>
                {selectedTeamData.description && (
                  <p className="text-sm text-zinc-400 mt-1">
                    {selectedTeamData.description}
                  </p>
                )}
                <div className="text-xs text-zinc-500 mt-2 space-y-1">
                  <div>Members: {selectedTeamData.member_count}</div>
                  <div>
                    Progress: {selectedTeamData.task_done}/{selectedTeamData.task_total} tasks completed
                  </div>
                </div>
              </div>

              {/* Tasks */}
              <div>
                <h4 className="text-sm font-semibold text-zinc-300 mb-2">Tasks</h4>
                {teamTasks.length === 0 ? (
                  <div className="text-zinc-600 text-sm">No tasks</div>
                ) : (
                  <div className="space-y-2">
                    {teamTasks.map((task) => (
                      <div
                        key={task.id}
                        className="glass-card rounded-lg px-3 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1">
                            <div className="font-medium text-zinc-200">
                              {task.subject}
                            </div>
                            <div className="text-xs text-zinc-600 mt-0.5">
                              {task.description}
                            </div>
                          </div>
                          <div className={`px-2 py-1 rounded text-xs font-medium shrink-0 ${
                            task.status === "completed"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : task.status === "in_progress"
                                ? "bg-cyan-500/20 text-cyan-400"
                                : "bg-zinc-500/20 text-zinc-400"
                          }`}>
                            {task.status}
                          </div>
                        </div>
                        {task.owner && (
                          <div className="text-xs text-zinc-500 mt-1">
                            Owner: {task.owner}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-zinc-500">Select a team</div>
          )}
        </div>
      </div>
    </div>
  );
}
