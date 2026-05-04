import { useCallback, useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import {
  api,
  type SpawnSettings,
  type UsageSettings,
  type WorkflowSettings,
  type WorktreeSettings,
} from "@/lib/api";
import { AutoApproveSection } from "./AutoApproveSection";
import { OrchestrationDispatchSection } from "./OrchestrationDispatchSection";
import { OrchestrationSection } from "./OrchestrationSection";
import { ProjectsSection } from "./ProjectsSection";
import { SaveStatus } from "./SaveStatus";
import { ScheduledKicksSection } from "./ScheduledKicksSection";
import { SpawnRuntimeSelector } from "./SpawnRuntimeSelector";

interface SettingsPanelProps {
  onClose: () => void;
  onProjectsChanged: () => void;
}

// Settings panel displayed in the main area
export function SettingsPanel({ onClose, onProjectsChanged }: SettingsPanelProps) {
  const [projects, setProjects] = useState<string[]>([]);
  const [spawnSettings, setSpawnSettings] = useState<SpawnSettings | null>(null);
  const [usageSettings, setUsageSettings] = useState<UsageSettings | null>(null);
  const [notifyOnIdle, setNotifyOnIdle] = useState(true);
  const [notifyThresholdSecs, setNotifyThresholdSecs] = useState(10);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings | null>(null);
  const [worktreeSettings, setWorktreeSettings] = useState<WorktreeSettings | null>(null);
  const [newSetupCommand, setNewSetupCommand] = useState("");

  // Per-section auto-save status (#578). Each tracker runs independently so a
  // failure in one section does not blank out the indicator on another.
  const spawnSave = useSaveTracker();
  const usageSave = useSaveTracker();
  const notifySave = useSaveTracker();
  const workflowSave = useSaveTracker();
  const worktreeSave = useSaveTracker();

  const refreshProjects = useCallback(() => {
    api.listProjects().then(setProjects).catch(console.error);
  }, []);

  const refreshSpawnSettings = useCallback(() => {
    api.getSpawnSettings().then(setSpawnSettings).catch(console.error);
  }, []);

  const refreshUsageSettings = useCallback(() => {
    api.getUsageSettings().then(setUsageSettings).catch(console.error);
  }, []);

  useEffect(() => {
    refreshProjects();
    refreshSpawnSettings();
    refreshUsageSettings();
    api
      .getNotificationSettings()
      .then((s) => {
        setNotifyOnIdle(s.notify_on_idle);
        setNotifyThresholdSecs(s.notify_idle_threshold_secs);
      })
      .catch(() => {});
    api
      .getWorkflowSettings()
      .then(setWorkflowSettings)
      .catch(() => {});
    api
      .getWorktreeSettings()
      .then(setWorktreeSettings)
      .catch(() => {});
  }, [refreshProjects, refreshSpawnSettings, refreshUsageSettings]);

  // Update tmux window name
  const handleWindowNameChange = async (name: string) => {
    if (!spawnSettings) return;
    setSpawnSettings({ ...spawnSettings, tmux_window_name: name });
  };

  // Save window name on blur or Enter (text-field commit; no rollback so the
  // user can edit and retry if the backend rejects the value).
  const handleWindowNameSave = () => {
    if (!spawnSettings) return;
    const trimmed = spawnSettings.tmux_window_name.trim();
    if (!trimmed) return;
    void spawnSave.track(() =>
      api.updateSpawnSettings({
        runtime: spawnSettings.runtime,
        tmux_window_name: trimmed,
      }),
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <h2 className="text-lg font-semibold text-zinc-200">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1 text-sm text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {/* Auto-approve section */}
        <AutoApproveSection />

        {/* Spawn section */}
        {spawnSettings && (
          <section>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-zinc-300">Spawn</h3>
              <SaveStatus status={spawnSave.status} error={spawnSave.error} variant="section" />
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              How new agents are started from the Web UI.
            </p>

            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
              <SpawnRuntimeSelector
                settings={spawnSettings}
                onSettingsChange={setSpawnSettings}
                save={spawnSave}
              />

              {/* Window name field — shown when runtime is tmux */}
              {spawnSettings.runtime === "tmux" && (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-zinc-500">Window name</span>
                  <input
                    type="text"
                    value={spawnSettings.tmux_window_name}
                    onChange={(e) => {
                      spawnSave.clearError();
                      handleWindowNameChange(e.target.value);
                    }}
                    onBlur={handleWindowNameSave}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                    className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                  />
                </div>
              )}
            </div>
          </section>
        )}

        {/* Orchestration section */}
        <OrchestrationSection projects={projects} />

        {/* Orchestration dispatch bundles section (#573) */}
        <OrchestrationDispatchSection />

        {/* Scheduled kicks / Routines section */}
        <ScheduledKicksSection />

        {/* Usage monitoring section */}
        {usageSettings && (
          <section>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-zinc-300">Usage Monitoring</h3>
              <SaveStatus status={usageSave.status} error={usageSave.error} variant="section" />
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              Periodically fetch Claude Code subscription usage. Spawns a temporary Claude Code
              instance (Haiku) for each refresh.
            </p>

            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
              <label className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <span className="text-sm text-zinc-300">Auto-refresh</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newEnabled = !usageSettings.enabled;
                    setUsageSettings({ ...usageSettings, enabled: newEnabled });
                    void usageSave.track(() => api.updateUsageSettings({ enabled: newEnabled }), {
                      onError: () => setUsageSettings({ ...usageSettings, enabled: !newEnabled }),
                    });
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    usageSettings.enabled ? "bg-cyan-500/40" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                      usageSettings.enabled
                        ? "translate-x-[18px] bg-cyan-400"
                        : "translate-x-0.5 bg-zinc-500"
                    }`}
                  />
                </button>
              </label>

              {usageSettings.enabled && (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-zinc-500">Interval</span>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={usageSettings.auto_refresh_min || 30}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!Number.isNaN(val)) {
                        usageSave.clearError();
                        setUsageSettings({ ...usageSettings, auto_refresh_min: val });
                      }
                    }}
                    onBlur={() => {
                      const val = Math.max(5, usageSettings.auto_refresh_min || 30);
                      void usageSave.track(() =>
                        api.updateUsageSettings({ auto_refresh_min: val }),
                      );
                    }}
                    className="w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                  />
                  <span className="text-xs text-zinc-500">minutes</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Notification section */}
        <section>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-zinc-300">Notifications</h3>
            <SaveStatus status={notifySave.status} error={notifySave.error} variant="section" />
          </div>
          <p className="mt-1 text-xs text-zinc-600">
            Browser notifications when agents finish processing and become idle.
          </p>

          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
            <label className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <span className="text-sm text-zinc-300">Notify on idle</span>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Send a browser notification when an agent transitions from Processing to Idle.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const prev = notifyOnIdle;
                  const next = !prev;
                  setNotifyOnIdle(next);
                  void notifySave.track(
                    () => api.updateNotificationSettings({ notify_on_idle: next }),
                    { onError: () => setNotifyOnIdle(prev) },
                  );
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  notifyOnIdle ? "bg-cyan-500/40" : "bg-white/10"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                    notifyOnIdle ? "translate-x-[18px] bg-cyan-400" : "translate-x-0.5 bg-zinc-500"
                  }`}
                />
              </button>
            </label>

            {notifyOnIdle && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-zinc-500">Idle threshold</span>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={notifyThresholdSecs}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      notifySave.clearError();
                      setNotifyThresholdSecs(val);
                    }
                  }}
                  onBlur={() => {
                    const val = Math.max(0, notifyThresholdSecs);
                    void notifySave.track(() =>
                      api.updateNotificationSettings({ notify_idle_threshold_secs: val }),
                    );
                  }}
                  className="w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                />
                <span className="text-xs text-zinc-500">seconds</span>
              </div>
            )}

            {notifyOnIdle && (
              <p className="text-[10px] text-zinc-600">
                Hook-detected (◈) agents notify immediately. Capture-pane (●) agents wait the full
                threshold to filter out transient state flickers.
              </p>
            )}
          </div>
        </section>

        {/* Workflow section */}
        {workflowSettings && (
          <section>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-zinc-300">Workflow</h3>
              <SaveStatus
                status={workflowSave.status}
                error={workflowSave.error}
                variant="section"
              />
            </div>
            <p className="mt-1 text-xs text-zinc-600">Workflow automation settings.</p>

            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <label className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <span className="text-sm text-zinc-300">Auto-rebase on merge</span>
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    Automatically rebase open worktree branches onto main after a PR merge.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !workflowSettings.auto_rebase_on_merge;
                    setWorkflowSettings({ ...workflowSettings, auto_rebase_on_merge: next });
                    void workflowSave.track(
                      () => api.updateWorkflowSettings({ auto_rebase_on_merge: next }),
                      {
                        onError: () =>
                          setWorkflowSettings({
                            ...workflowSettings,
                            auto_rebase_on_merge: !next,
                          }),
                      },
                    );
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    workflowSettings.auto_rebase_on_merge ? "bg-cyan-500/40" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                      workflowSettings.auto_rebase_on_merge
                        ? "translate-x-[18px] bg-cyan-400"
                        : "translate-x-0.5 bg-zinc-500"
                    }`}
                  />
                </button>
              </label>
            </div>
          </section>
        )}

        {/* Worktree section */}
        {worktreeSettings && (
          <section>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-zinc-300">Worktree</h3>
              <SaveStatus
                status={worktreeSave.status}
                error={worktreeSave.error}
                variant="section"
              />
            </div>
            <p className="mt-1 text-xs text-zinc-600">Git worktree settings for spawned agents.</p>

            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
              <div>
                <span className="text-xs text-zinc-500">Setup commands</span>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  Commands to run after creating a new worktree (e.g., npm install).
                </p>
                <div className="mt-2 space-y-1">
                  {worktreeSettings.setup_commands.map((cmd) => (
                    <div key={cmd} className="flex items-center gap-1.5">
                      <code className="flex-1 rounded bg-white/5 px-2 py-1 text-xs text-zinc-300">
                        {cmd}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          const previous = worktreeSettings.setup_commands;
                          const cmds = previous.filter((c) => c !== cmd);
                          setWorktreeSettings({ ...worktreeSettings, setup_commands: cmds });
                          void worktreeSave.track(
                            () => api.updateWorktreeSettings({ setup_commands: cmds }),
                            {
                              onError: () =>
                                setWorktreeSettings({
                                  ...worktreeSettings,
                                  setup_commands: previous,
                                }),
                            },
                          );
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <input
                    type="text"
                    value={newSetupCommand}
                    onChange={(e) => setNewSetupCommand(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSetupCommand.trim()) {
                        const previous = worktreeSettings.setup_commands;
                        const cmds = [...previous, newSetupCommand.trim()];
                        setWorktreeSettings({ ...worktreeSettings, setup_commands: cmds });
                        setNewSetupCommand("");
                        void worktreeSave.track(
                          () => api.updateWorktreeSettings({ setup_commands: cmds }),
                          {
                            onError: () =>
                              setWorktreeSettings({
                                ...worktreeSettings,
                                setup_commands: previous,
                              }),
                          },
                        );
                      }
                    }}
                    placeholder="e.g., npm install"
                    className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newSetupCommand.trim()) return;
                      const previous = worktreeSettings.setup_commands;
                      const cmds = [...previous, newSetupCommand.trim()];
                      setWorktreeSettings({ ...worktreeSettings, setup_commands: cmds });
                      setNewSetupCommand("");
                      void worktreeSave.track(
                        () => api.updateWorktreeSettings({ setup_commands: cmds }),
                        {
                          onError: () =>
                            setWorktreeSettings({
                              ...worktreeSettings,
                              setup_commands: previous,
                            }),
                        },
                      );
                    }}
                    className="rounded-md bg-cyan-500/20 px-3 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-zinc-500">Setup timeout</span>
                <input
                  type="number"
                  min={30}
                  max={3600}
                  value={worktreeSettings.setup_timeout_secs}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      worktreeSave.clearError();
                      setWorktreeSettings({ ...worktreeSettings, setup_timeout_secs: val });
                    }
                  }}
                  onBlur={() => {
                    const val = Math.max(30, worktreeSettings.setup_timeout_secs);
                    void worktreeSave.track(() =>
                      api.updateWorktreeSettings({ setup_timeout_secs: val }),
                    );
                  }}
                  className="w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                />
                <span className="text-xs text-zinc-500">seconds</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-zinc-500">Branch depth warning</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={worktreeSettings.branch_depth_warning}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      worktreeSave.clearError();
                      setWorktreeSettings({ ...worktreeSettings, branch_depth_warning: val });
                    }
                  }}
                  onBlur={() => {
                    const val = Math.max(1, worktreeSettings.branch_depth_warning);
                    void worktreeSave.track(() =>
                      api.updateWorktreeSettings({ branch_depth_warning: val }),
                    );
                  }}
                  className="w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                />
                <span className="text-xs text-zinc-500">levels</span>
              </div>
            </div>
          </section>
        )}

        {/* Projects section */}
        <ProjectsSection
          projects={projects}
          refreshProjects={refreshProjects}
          onProjectsChanged={onProjectsChanged}
        />
      </div>
    </div>
  );
}
