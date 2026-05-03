import { useCallback, useEffect, useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import {
  api,
  type EventHandling,
  type OrchestratorSettings,
  type SpawnSettings,
  type UsageSettings,
  type WorkflowSettings,
  type WorktreeSettings,
} from "@/lib/api";
import { AutoApproveSection } from "./AutoApproveSection";
import { buildNotifyEventHelp } from "./notify-event-help";
import { OrchestrationDispatchSection } from "./OrchestrationDispatchSection";
import { SaveStatus } from "./SaveStatus";
import { ScheduledKicksSection } from "./ScheduledKicksSection";
import { SpawnRuntimeSelector } from "./SpawnRuntimeSelector";

interface SettingsPanelProps {
  onClose: () => void;
  onProjectsChanged: () => void;
}

/**
 * Auto-saved textarea used by the orchestration role / workflow-rule fields.
 * Local edits stream through `onDraft`; on blur (or Cmd/Ctrl+Enter) the value
 * is committed via `onCommit`, routed through the section's save tracker so
 * Saving / Saved / error indicators stay in sync. Mid-typing keystrokes clear
 * a stale error so the inline message doesn't linger after the user starts
 * correcting it.
 */
function OrchestrationRuleTextarea({
  label,
  placeholder,
  rows,
  value,
  save,
  onDraft,
  onCommit,
}: {
  label: string;
  placeholder: string;
  rows: number;
  value: string;
  save: ReturnType<typeof useSaveTracker>;
  onDraft: (value: string) => void;
  onCommit: (value: string) => Promise<unknown>;
}) {
  return (
    <div>
      <span className="block text-xs text-zinc-400 mb-1">{label}</span>
      <textarea
        value={value}
        onChange={(e) => {
          save.clearError();
          onDraft(e.target.value);
        }}
        onBlur={() => {
          const commit = value;
          void save.track(() => onCommit(commit));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
      />
    </div>
  );
}

// Settings panel displayed in the main area
export function SettingsPanel({ onClose, onProjectsChanged }: SettingsPanelProps) {
  const [projects, setProjects] = useState<string[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [spawnSettings, setSpawnSettings] = useState<SpawnSettings | null>(null);
  const [usageSettings, setUsageSettings] = useState<UsageSettings | null>(null);
  const [notifyOnIdle, setNotifyOnIdle] = useState(true);
  const [notifyThresholdSecs, setNotifyThresholdSecs] = useState(10);
  const [orchestrator, setOrchestrator] = useState<OrchestratorSettings | null>(null);
  const [orchScope, setOrchScope] = useState<string>("global");
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings | null>(null);
  const [worktreeSettings, setWorktreeSettings] = useState<WorktreeSettings | null>(null);
  const [newSetupCommand, setNewSetupCommand] = useState("");

  // Per-section auto-save status (#578). Each tracker runs independently so a
  // failure in one section does not blank out the indicator on another.
  const spawnSave = useSaveTracker();
  const orchestratorSave = useSaveTracker();
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

  const orchProject = orchScope === "global" ? undefined : orchScope;
  const refreshOrchestrator = useCallback(() => {
    api.getOrchestratorSettings(orchProject).then(setOrchestrator).catch(console.error);
  }, [orchProject]);

  useEffect(() => {
    refreshProjects();
    refreshSpawnSettings();
    refreshUsageSettings();
    refreshOrchestrator();
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
  }, [refreshProjects, refreshSpawnSettings, refreshUsageSettings, refreshOrchestrator]);

  // Add a project directory
  const handleAdd = async (projectPath?: string) => {
    const trimmed = (projectPath ?? path).trim();
    if (!trimmed) return;
    setError("");
    try {
      await api.addProject(trimmed);
      setPath("");
      setBrowsing(false);
      refreshProjects();
      onProjectsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add project");
    }
  };

  // Remove a project directory
  const handleRemove = async (projectPath: string) => {
    try {
      await api.removeProject(projectPath);
      refreshProjects();
      onProjectsChanged();
    } catch (_e) {}
  };

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
        {orchestrator && (
          <section>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-zinc-300">Orchestration</h3>
              <SaveStatus
                status={orchestratorSave.status}
                error={orchestratorSave.error}
                variant="section"
              />
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              Configure the orchestrator agent that coordinates sub-agents for parallel development
              workflows.
            </p>

            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-4">
              {/* Scope selector */}
              <div>
                <span className="block text-xs text-zinc-400 mb-1">Scope</span>
                <select
                  value={orchScope}
                  onChange={(e) => setOrchScope(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                >
                  <option value="global">Global (default)</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {orchScope !== "global" && (
                  <p className="mt-1 text-[10px] text-zinc-600">
                    {orchestrator.is_project_override
                      ? "Project-level override active"
                      : "Using global settings (no project override)"}
                  </p>
                )}
              </div>

              {/* Enable toggle */}
              <label className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <span className="text-sm text-zinc-300">Enabled</span>
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    Enable orchestrator workflow features.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !orchestrator.enabled;
                    setOrchestrator({ ...orchestrator, enabled: next });
                    void orchestratorSave.track(
                      async () => {
                        await api.updateOrchestratorSettings({ enabled: next }, orchProject);
                        refreshOrchestrator();
                      },
                      { onError: () => setOrchestrator({ ...orchestrator, enabled: !next }) },
                    );
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    orchestrator.enabled ? "bg-cyan-500/40" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                      orchestrator.enabled
                        ? "translate-x-[18px] bg-cyan-400"
                        : "translate-x-0.5 bg-zinc-500"
                    }`}
                  />
                </button>
              </label>

              {orchestrator.enabled && (
                <div className="space-y-3 border-t border-white/5 pt-3">
                  <OrchestrationRuleTextarea
                    label="Role"
                    placeholder="Describe the orchestrator's role and persona..."
                    rows={2}
                    value={orchestrator.role}
                    save={orchestratorSave}
                    onDraft={(role) => setOrchestrator({ ...orchestrator, role })}
                    onCommit={(role) => api.updateOrchestratorSettings({ role }, orchProject)}
                  />

                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    Workflow Rules
                  </p>

                  {(
                    [
                      {
                        key: "branch",
                        label: "Branch rules",
                        placeholder: "Rules for branch naming and strategy...",
                        rows: 2,
                      },
                      {
                        key: "merge",
                        label: "Merge rules",
                        placeholder: "Rules for merge strategy and conflict resolution...",
                        rows: 2,
                      },
                      {
                        key: "review",
                        label: "Review rules",
                        placeholder: "Rules for code review process...",
                        rows: 2,
                      },
                      {
                        key: "custom",
                        label: "Custom rules",
                        placeholder: "Additional custom rules for the orchestrator...",
                        rows: 3,
                      },
                    ] as const
                  ).map(({ key, label, placeholder, rows }) => (
                    <OrchestrationRuleTextarea
                      key={key}
                      label={label}
                      placeholder={placeholder}
                      rows={rows}
                      value={orchestrator.rules[key]}
                      save={orchestratorSave}
                      onDraft={(value) =>
                        setOrchestrator({
                          ...orchestrator,
                          rules: { ...orchestrator.rules, [key]: value },
                        })
                      }
                      onCommit={(value) =>
                        api.updateOrchestratorSettings({ rules: { [key]: value } }, orchProject)
                      }
                    />
                  ))}

                  {/* PR Monitor */}
                  <PrMonitorSection
                    orchestrator={orchestrator}
                    setOrchestrator={setOrchestrator}
                    orchProject={orchProject}
                    save={orchestratorSave}
                  />

                  {/* Notifications */}
                  <NotifySettingsSection
                    orchestrator={orchestrator}
                    setOrchestrator={setOrchestrator}
                    orchProject={orchProject}
                    save={orchestratorSave}
                  />

                  {/* Guardrails */}
                  <GuardrailsSection
                    orchestrator={orchestrator}
                    setOrchestrator={setOrchestrator}
                    orchProject={orchProject}
                    save={orchestratorSave}
                  />
                </div>
              )}
            </div>
          </section>
        )}

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
        <section>
          <h3 className="text-sm font-medium text-zinc-300">Projects</h3>
          <p className="mt-1 text-xs text-zinc-600">
            Registered directories appear in the sidebar even with no agents running.
          </p>

          {/* Add project — always visible */}
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                placeholder="/path/to/project"
                className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
              />
              <button
                type="button"
                onClick={() => handleAdd()}
                className="rounded-md bg-cyan-500/20 px-3 py-1.5 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setBrowsing((v) => !v)}
                className={`rounded-md border border-white/10 px-3 py-1.5 text-xs transition-colors hover:bg-white/10 ${browsing ? "text-cyan-400" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                Browse
              </button>
            </div>
            {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
            {browsing && (
              <div className="mt-2">
                <DirBrowser
                  onSelect={(selected) => handleAdd(selected)}
                  onCancel={() => setBrowsing(false)}
                />
              </div>
            )}
          </div>

          {/* Project list */}
          <div className="mt-3 space-y-1">
            {projects.length === 0 && (
              <p className="py-4 text-center text-xs text-zinc-600">No projects registered</p>
            )}
            {projects.map((p) => (
              <div
                key={p}
                className="group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-white/5"
              >
                <span className="text-xs text-zinc-500">●</span>
                <div className="flex-1 truncate">
                  <span className="text-sm text-zinc-300">
                    {p.split("/").filter(Boolean).pop()}
                  </span>
                  <span className="ml-2 text-[11px] text-zinc-600">{p}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(p)}
                  className="shrink-0 rounded px-2 py-0.5 text-xs text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Notification settings sub-component ──────────────────────────

/** Event definition for notification rows */
interface NotifyEventDef {
  key: keyof Omit<import("@/lib/api").NotifySettings, "templates" | "default_templates">;
  templateKey: keyof import("@/lib/api").NotifyTemplates;
  label: string;
  description: string;
  /** Built-in default mode for this event (mirrors `OrchestratorNotifySettings::default` in core). */
  defaultMode: EventHandling;
  /** Available {{variable}} placeholders for the Notify-mode template */
  variables: string[];
  /** If set, an Auto Action handler exists for this event. */
  autoActionTemplateKey?: keyof import("@/lib/api").AutoActionTemplates;
  /** Available {{variable}} placeholders for the Auto Action template. */
  autoActionVariables?: string[];
  /** One-line description of what Auto Action does for this event (undefined ⇒ unsupported). */
  autoActionBehavior?: string;
}

const NOTIFY_EVENTS: NotifyEventDef[] = [
  {
    key: "on_agent_stopped",
    templateKey: "agent_stopped",
    label: "Agent stopped",
    description: "Sub-agent stopped normally (task completed)",
    defaultMode: "notify",
    variables: ["name", "branch", "summary"],
  },
  {
    key: "on_agent_error",
    templateKey: "agent_error",
    label: "Agent error",
    description: "Sub-agent entered error state",
    defaultMode: "notify",
    variables: ["name", "branch"],
  },
  {
    key: "on_ci_passed",
    templateKey: "ci_passed",
    label: "CI passed",
    description: "PR checks passed — usually no action needed",
    defaultMode: "off",
    variables: ["pr_number", "title", "summary"],
    autoActionTemplateKey: undefined,
    autoActionBehavior: "Dispatch a reviewer when the PR has no review yet.",
  },
  {
    key: "on_ci_failed",
    templateKey: "ci_failed",
    label: "CI failed",
    description: "PR checks failed — action required",
    defaultMode: "notify",
    variables: ["pr_number", "title", "failed_details"],
    autoActionTemplateKey: "ci_failed_implementer",
    autoActionVariables: ["pr_number", "title", "branch", "failed_details"],
    autoActionBehavior: "Instruct the implementer to fix the failure.",
  },
  {
    key: "on_pr_created",
    templateKey: "pr_created",
    label: "PR created",
    description: "New pull request opened",
    defaultMode: "notify",
    variables: ["pr_number", "title", "branch"],
  },
  {
    key: "on_pr_comment",
    templateKey: "pr_comment",
    label: "Review feedback",
    description: "PR received review comments (changes requested)",
    defaultMode: "notify",
    variables: ["pr_number", "title", "comments_summary"],
    autoActionTemplateKey: "review_feedback_implementer",
    autoActionVariables: ["pr_number", "title", "branch", "comments_summary"],
    autoActionBehavior: "Instruct the implementer to address the feedback.",
  },
  {
    key: "on_rebase_conflict",
    templateKey: "rebase_conflict",
    label: "Rebase conflict",
    description: "Merge/rebase conflict detected",
    defaultMode: "notify",
    variables: ["branch", "error"],
  },
  {
    key: "on_pr_closed",
    templateKey: "pr_closed",
    label: "PR closed",
    description: "Pull request closed or merged",
    defaultMode: "notify",
    variables: ["pr_number", "title", "branch"],
  },
  {
    key: "on_guardrail_exceeded",
    templateKey: "guardrail_exceeded",
    label: "Guardrail exceeded",
    description: "CI retries, review loops, or failure limit exceeded",
    defaultMode: "notify",
    variables: ["guardrail", "branch", "count", "limit"],
  },
];

/**
 * Events whose handling can be AutoAction. The row for `on_ci_passed` also
 * supports AutoAction (dispatches a reviewer) even though it has no template.
 */
const AUTO_ACTION_EVENTS: ReadonlySet<NotifyEventDef["key"]> = new Set([
  "on_ci_failed",
  "on_pr_comment",
  "on_ci_passed",
]);

/** Orchestrator notification settings with per-event toggles and template editing */
function NotifySettingsSection({
  orchestrator,
  setOrchestrator,
  orchProject,
  save,
}: {
  orchestrator: OrchestratorSettings;
  setOrchestrator: (v: OrchestratorSettings) => void;
  orchProject: string | undefined;
  save: ReturnType<typeof useSaveTracker>;
}) {
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // Change the per-event handling mode (off / notify / auto_action) and persist
  const setHandling = (key: NotifyEventDef["key"], value: import("@/lib/api").EventHandling) => {
    const updated = {
      ...orchestrator,
      notify: { ...orchestrator.notify, [key]: value },
    };
    setOrchestrator(updated);
    void save.track(
      () => api.updateOrchestratorSettings({ notify: { [key]: value } }, orchProject),
      { onError: () => setOrchestrator(orchestrator) },
    );
  };

  // Save a notify-mode template change (text-field commit; no rollback)
  const saveTemplate = (templateKey: NotifyEventDef["templateKey"], value: string) => {
    const templates: Record<string, string> = { [templateKey]: value };
    void save.track(() =>
      api.updateOrchestratorSettings(
        { notify: { templates: templates as Partial<import("@/lib/api").NotifyTemplates> } },
        orchProject,
      ),
    );
  };

  // Save an auto-action template change (text-field commit; no rollback)
  const saveAutoActionTemplate = (
    templateKey: keyof import("@/lib/api").AutoActionTemplates,
    value: string,
  ) => {
    const templates: Record<string, string> = { [templateKey]: value };
    void save.track(() =>
      api.updateOrchestratorSettings(
        {
          auto_action_templates: templates as Partial<import("@/lib/api").AutoActionTemplates>,
        },
        orchProject,
      ),
    );
  };

  // Toggle one of the origin-aware filter booleans (#440)
  type OriginFilterKey =
    | "suppress_self"
    | "notify_on_human_action"
    | "notify_on_agent_action"
    | "notify_on_system_action";
  const setOriginFlag = (key: OriginFilterKey, value: boolean) => {
    const updated = {
      ...orchestrator,
      notify: { ...orchestrator.notify, [key]: value },
    };
    setOrchestrator(updated);
    void save.track(
      () => api.updateOrchestratorSettings({ notify: { [key]: value } }, orchProject),
      { onError: () => setOrchestrator(orchestrator) },
    );
  };

  return (
    <>
      <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mt-1">
        Notifications
      </p>
      <p className="text-[10px] text-zinc-500 -mt-1 mb-1">
        Decide how tmai handles background events while the orchestrator is working.
      </p>
      <dl className="text-[10px] text-zinc-500 mb-2 space-y-1">
        <div className="flex gap-2">
          <dt className="w-[68px] shrink-0 text-zinc-400">Off</dt>
          <dd className="flex-1 text-zinc-500">
            Silent; only the task log records it. Good for events you don&apos;t want to see at all.
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[68px] shrink-0 text-zinc-400">Notify</dt>
          <dd className="flex-1 text-zinc-500">
            The orchestrator gets a send_prompt. Good when you want to stay in the loop but decide
            yourself. Trade-off: every event interrupts the orchestrator.
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[68px] shrink-0 text-zinc-400">Auto Action</dt>
          <dd className="flex-1 text-zinc-500">
            tmai handles it directly without asking — e.g. CI failed → instruct the implementer;
            Review feedback → instruct the implementer; CI passed (no review) → dispatch a reviewer.
            Trade-off: orchestrator only surfaces on guardrail trips (bounded retries, PR-age limit,
            etc.).
          </dd>
        </div>
      </dl>

      <div className="space-y-0.5">
        {NOTIFY_EVENTS.map((evt) => {
          const current = orchestrator.notify[evt.key] as import("@/lib/api").EventHandling;
          const templateValue = orchestrator.notify.templates[evt.templateKey];
          const isExpanded = expandedTemplate === evt.key;
          const supportsAutoAction = AUTO_ACTION_EVENTS.has(evt.key);
          const autoActionTpl = evt.autoActionTemplateKey
            ? (orchestrator.auto_action_templates?.[evt.autoActionTemplateKey] ?? "")
            : "";
          const showNotifyTemplate = current === "notify" && isExpanded;
          const showAutoActionTemplate =
            current === "auto_action" && isExpanded && !!evt.autoActionTemplateKey;

          return (
            <div key={evt.key}>
              {/* Row: radio group + template toggle */}
              <div className="flex items-center justify-between gap-2 py-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-zinc-300">{evt.label}</span>
                    <span
                      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/10 text-[9px] text-zinc-500 cursor-help select-none"
                      title={buildNotifyEventHelp({
                        label: evt.label,
                        defaultMode: evt.defaultMode,
                        autoActionBehavior: evt.autoActionBehavior,
                        hasTemplate: !!evt.autoActionTemplateKey,
                      })}
                      role="img"
                      aria-label={`Help: ${evt.label} — default mode and Auto Action support`}
                    >
                      ?
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600 truncate">{evt.description}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {current !== "off" && (current === "notify" || evt.autoActionTemplateKey) && (
                    <button
                      type="button"
                      onClick={() => setExpandedTemplate(isExpanded ? null : evt.key)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1"
                      title="Edit prompt template"
                    >
                      {isExpanded ? "hide" : "template"}
                    </button>
                  )}
                  <HandlingRadioGroup
                    name={evt.key}
                    value={current}
                    onChange={(v) => setHandling(evt.key, v)}
                    supportsAutoAction={supportsAutoAction}
                  />
                </div>
              </div>

              {/* Expandable notify-mode template editor */}
              {showNotifyTemplate && (
                <div className="ml-2 mb-2">
                  <div className="relative">
                    <textarea
                      value={templateValue}
                      onChange={(e) => {
                        const updated = {
                          ...orchestrator,
                          notify: {
                            ...orchestrator.notify,
                            templates: {
                              ...orchestrator.notify.templates,
                              [evt.templateKey]: e.target.value,
                            },
                          },
                        };
                        setOrchestrator(updated);
                      }}
                      onBlur={() => saveTemplate(evt.templateKey, templateValue)}
                      rows={2}
                      placeholder={
                        orchestrator.notify.default_templates[evt.templateKey] ||
                        "Empty = use built-in default"
                      }
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 pr-7 text-[11px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-cyan-500/30 resize-y font-mono"
                    />
                    {templateValue && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = {
                            ...orchestrator,
                            notify: {
                              ...orchestrator.notify,
                              templates: {
                                ...orchestrator.notify.templates,
                                [evt.templateKey]: "",
                              },
                            },
                          };
                          setOrchestrator(updated);
                          saveTemplate(evt.templateKey, "");
                        }}
                        className="absolute top-1.5 right-1.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="Reset to default template"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          className="w-3.5 h-3.5"
                          role="img"
                          aria-label="Reset to default"
                        >
                          <path
                            fillRule="evenodd"
                            d="M3.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-9ZM6.354 5.646a.5.5 0 1 0-.708.708L7.293 8l-1.647 1.646a.5.5 0 0 0 .708.708L8 8.707l1.646 1.647a.5.5 0 0 0 .708-.708L8.707 8l1.647-1.646a.5.5 0 1 0-.708-.708L8 7.293 6.354 5.646Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5">
                    Variables: {evt.variables.map((v) => `{{${v}}}`).join(", ")}
                  </p>
                </div>
              )}

              {/* Expandable auto-action template editor */}
              {showAutoActionTemplate && evt.autoActionTemplateKey && (
                <AutoActionTemplateEditor
                  autoActionKey={evt.autoActionTemplateKey}
                  value={autoActionTpl}
                  onChange={(next) => {
                    const updated = {
                      ...orchestrator,
                      auto_action_templates: {
                        ...(orchestrator.auto_action_templates ?? {
                          ci_failed_implementer: "",
                          review_feedback_implementer: "",
                        }),
                        [evt.autoActionTemplateKey as string]: next,
                      },
                    };
                    setOrchestrator(updated);
                  }}
                  onSave={(next) =>
                    saveAutoActionTemplate(
                      evt.autoActionTemplateKey as keyof import("@/lib/api").AutoActionTemplates,
                      next,
                    )
                  }
                  variables={evt.autoActionVariables ?? []}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* #440 Origin-aware filtering for ActionPerformed events */}
      <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mt-4">Sources</p>
      <p className="text-[10px] text-zinc-600 -mt-1 mb-1">
        Choose which initiators of side-effect actions trigger a notification. Self-suppress hides
        echoes for actions you (an orchestrator) just performed.
      </p>
      <div className="space-y-0.5">
        <OriginToggleRow
          label="Skip my own actions"
          description="Suppress echoes when an orchestrator initiated the action"
          checked={orchestrator.notify.suppress_self}
          onChange={(v) => setOriginFlag("suppress_self", v)}
        />
        <OriginToggleRow
          label="Human actions"
          description="WebUI / TUI / CLI initiated actions (kill_agent, approve, …)"
          checked={orchestrator.notify.notify_on_human_action}
          onChange={(v) => setOriginFlag("notify_on_human_action", v)}
        />
        <OriginToggleRow
          label="Agent actions"
          description="Actions from MCP, sub-agents, AutoActionExecutor"
          checked={orchestrator.notify.notify_on_agent_action}
          onChange={(v) => setOriginFlag("notify_on_agent_action", v)}
        />
        <OriginToggleRow
          label="System actions"
          description="auto_cleanup, pr_monitor, and other tmai-internal subsystems"
          checked={orchestrator.notify.notify_on_system_action}
          onChange={(v) => setOriginFlag("notify_on_system_action", v)}
        />
      </div>
    </>
  );
}

/** One row of the Sources subsection — label/description + toggle. */
function OriginToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-zinc-300">{label}</span>
        <p className="text-[10px] text-zinc-600 truncate">{description}</p>
      </div>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-cyan-500/40" : "bg-white/10"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
            checked ? "translate-x-[18px] bg-cyan-400" : "translate-x-0.5 bg-zinc-500"
          }`}
        />
      </button>
    </div>
  );
}

/** Inline editor for an AutoAction template. */
function AutoActionTemplateEditor({
  autoActionKey: _autoActionKey,
  value,
  onChange,
  onSave,
  variables,
}: {
  autoActionKey: keyof import("@/lib/api").AutoActionTemplates;
  value: string;
  onChange: (next: string) => void;
  onSave: (next: string) => void | Promise<void>;
  variables: string[];
}) {
  return (
    <div className="ml-2 mb-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        rows={2}
        placeholder="Empty = use built-in default"
        className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 pr-7 text-[11px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-cyan-500/30 resize-y font-mono"
      />
      <p className="text-[10px] text-zinc-600 mt-0.5">
        Auto Action prompt — sent directly to the target worker. Variables:{" "}
        {variables.map((v) => `{{${v}}}`).join(", ")}
      </p>
    </div>
  );
}

/** Tri-state radio group for per-event handling. */
function HandlingRadioGroup({
  name,
  value,
  onChange,
  supportsAutoAction,
}: {
  name: string;
  value: import("@/lib/api").EventHandling;
  onChange: (v: import("@/lib/api").EventHandling) => void;
  supportsAutoAction: boolean;
}) {
  const options: {
    v: import("@/lib/api").EventHandling;
    label: string;
    title: string;
  }[] = [
    {
      v: "off",
      label: "Off",
      title: "Silent — only the task log records it; orchestrator is not notified.",
    },
    {
      v: "notify",
      label: "Notify",
      title: "Forward to the orchestrator via send_prompt so you can decide what to do.",
    },
  ];
  if (supportsAutoAction) {
    options.push({
      v: "auto_action",
      label: "Auto",
      title:
        "tmai handles it directly (instructs the target worker or dispatches a reviewer). Orchestrator only surfaces on guardrail trips.",
    });
  }
  return (
    <div
      title={`Handling for ${name}`}
      className="inline-flex items-center rounded-md overflow-hidden border border-white/10"
    >
      {options.map((opt) => {
        const selected = value === opt.v;
        return (
          <button
            key={opt.v}
            type="button"
            aria-pressed={selected}
            title={opt.title}
            onClick={() => onChange(opt.v)}
            className={`text-[10px] px-1.5 py-0.5 transition-colors ${
              selected
                ? "bg-cyan-500/30 text-cyan-200"
                : "bg-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** PR Monitor settings — automatic PR/CI status monitoring */
function PrMonitorSection({
  orchestrator,
  setOrchestrator,
  orchProject,
  save,
}: {
  orchestrator: OrchestratorSettings;
  setOrchestrator: (v: OrchestratorSettings) => void;
  orchProject: string | undefined;
  save: ReturnType<typeof useSaveTracker>;
}) {
  const updateInterval = (value: number) => {
    const clamped = Math.max(10, Math.min(3600, value));
    setOrchestrator({ ...orchestrator, pr_monitor_interval_secs: clamped });
    void save.track(() =>
      api.updateOrchestratorSettings({ pr_monitor_interval_secs: clamped }, orchProject),
    );
  };

  return (
    <>
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-4 mb-2">
        PR Monitor
      </h4>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-xs text-zinc-300">Enable PR monitoring</span>
            <p className="text-[10px] text-zinc-600 leading-tight">
              Automatically poll PR/CI status and send notifications
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !orchestrator.pr_monitor_enabled;
              setOrchestrator({ ...orchestrator, pr_monitor_enabled: next });
              void save.track(
                () => api.updateOrchestratorSettings({ pr_monitor_enabled: next }, orchProject),
                {
                  onError: () => setOrchestrator({ ...orchestrator, pr_monitor_enabled: !next }),
                },
              );
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              orchestrator.pr_monitor_enabled ? "bg-cyan-500/40" : "bg-white/10"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                orchestrator.pr_monitor_enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {!orchestrator.pr_monitor_enabled && (
          <div
            role="alert"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-200"
          >
            ⚠ PR Monitor is disabled. CI-pass / PR-comment / agent-stopped events that rely on PR
            state polling will not reach the orchestrator.
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className="text-xs text-zinc-300">Poll interval (seconds)</span>
            <p className="text-[10px] text-zinc-600 leading-tight">
              How often to check PR/CI status (10–3600)
            </p>
          </div>
          <input
            type="number"
            min={10}
            max={3600}
            value={orchestrator.pr_monitor_interval_secs}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                save.clearError();
                setOrchestrator({ ...orchestrator, pr_monitor_interval_secs: val });
              }
            }}
            onBlur={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                updateInterval(val);
              }
            }}
            className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 text-center outline-none focus:border-cyan-500/30"
          />
        </div>
      </div>
    </>
  );
}

/** Guardrails settings — limits to prevent infinite loops */
function GuardrailsSection({
  orchestrator,
  setOrchestrator,
  orchProject,
  save,
}: {
  orchestrator: OrchestratorSettings;
  setOrchestrator: (v: OrchestratorSettings) => void;
  orchProject: string | undefined;
  save: ReturnType<typeof useSaveTracker>;
}) {
  const guardrailFields: {
    key: keyof OrchestratorSettings["guardrails"];
    label: string;
    description: string;
  }[] = [
    {
      key: "max_ci_retries",
      label: "Max CI retries",
      description: "CI fix attempts per PR before escalation",
    },
    {
      key: "max_review_loops",
      label: "Max review loops",
      description: "Review→fix cycles per PR before escalation",
    },
    {
      key: "escalate_to_human_after",
      label: "Escalate after failures",
      description: "Consecutive failures before notifying human",
    },
  ];

  const updateField = (key: keyof OrchestratorSettings["guardrails"], value: number) => {
    if (value < 1) return;
    const updated = {
      ...orchestrator,
      guardrails: { ...orchestrator.guardrails, [key]: value },
    };
    setOrchestrator(updated);
    void save.track(() =>
      api.updateOrchestratorSettings({ guardrails: { [key]: value } }, orchProject),
    );
  };

  return (
    <>
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-4 mb-2">
        Guardrails
      </h4>
      <div className="space-y-2">
        {guardrailFields.map((field) => (
          <div key={field.key} className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-xs text-zinc-300">{field.label}</span>
              <p className="text-[10px] text-zinc-600 leading-tight">{field.description}</p>
            </div>
            <input
              type="number"
              min={1}
              value={orchestrator.guardrails[field.key]}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  save.clearError();
                  setOrchestrator({
                    ...orchestrator,
                    guardrails: { ...orchestrator.guardrails, [field.key]: val },
                  });
                }
              }}
              onBlur={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val) && val >= 1) {
                  updateField(field.key, val);
                }
              }}
              className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 text-center outline-none focus:border-cyan-500/30"
            />
          </div>
        ))}
      </div>
    </>
  );
}
