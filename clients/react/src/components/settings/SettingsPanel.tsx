import { useCallback, useEffect, useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import {
  type AutoApproveSettings,
  api,
  type EventHandling,
  type OrchestratorSettings,
  type SpawnSettings,
  type UsageSettings,
  type WorkerPermissionMode,
  type WorkflowSettings,
  type WorktreeSettings,
} from "@/lib/api";
import { buildNotifyEventHelp } from "./notify-event-help";
import { ScheduledKicksSection } from "./ScheduledKicksSection";

interface SettingsPanelProps {
  onClose: () => void;
  onProjectsChanged: () => void;
}

// Settings panel displayed in the main area
export function SettingsPanel({ onClose, onProjectsChanged }: SettingsPanelProps) {
  const [projects, setProjects] = useState<string[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [spawnSettings, setSpawnSettings] = useState<SpawnSettings | null>(null);
  const [autoApprove, setAutoApprove] = useState<AutoApproveSettings | null>(null);
  const [usageSettings, setUsageSettings] = useState<UsageSettings | null>(null);
  const [notifyOnIdle, setNotifyOnIdle] = useState(true);
  const [notifyThresholdSecs, setNotifyThresholdSecs] = useState(10);
  const [newPattern, setNewPattern] = useState("");
  const [orchestrator, setOrchestrator] = useState<OrchestratorSettings | null>(null);
  const [orchScope, setOrchScope] = useState<string>("global");
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings | null>(null);
  const [worktreeSettings, setWorktreeSettings] = useState<WorktreeSettings | null>(null);
  const [newSetupCommand, setNewSetupCommand] = useState("");

  const refreshProjects = useCallback(() => {
    api.listProjects().then(setProjects).catch(console.error);
  }, []);

  const refreshSpawnSettings = useCallback(() => {
    api.getSpawnSettings().then(setSpawnSettings).catch(console.error);
  }, []);

  const refreshAutoApprove = useCallback(() => {
    api.getAutoApproveSettings().then(setAutoApprove).catch(console.error);
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
    refreshAutoApprove();
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
  }, [
    refreshProjects,
    refreshSpawnSettings,
    refreshAutoApprove,
    refreshUsageSettings,
    refreshOrchestrator,
  ]);

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

  // Toggle spawn in tmux
  const handleToggleSpawnInTmux = async () => {
    if (!spawnSettings) return;
    const newValue = !spawnSettings.use_tmux_window;
    try {
      await api.updateSpawnSettings({ use_tmux_window: newValue });
      setSpawnSettings({ ...spawnSettings, use_tmux_window: newValue });
    } catch (_e) {}
  };

  // Update tmux window name
  const handleWindowNameChange = async (name: string) => {
    if (!spawnSettings) return;
    setSpawnSettings({ ...spawnSettings, tmux_window_name: name });
  };

  // Save window name on blur or Enter
  const handleWindowNameSave = async () => {
    if (!spawnSettings) return;
    const trimmed = spawnSettings.tmux_window_name.trim();
    if (!trimmed) return;
    try {
      await api.updateSpawnSettings({
        use_tmux_window: spawnSettings.use_tmux_window,
        tmux_window_name: trimmed,
      });
    } catch (_e) {}
  };

  // Change worker permission mode (for dispatched workers)
  const handleWorkerPermissionModeChange = async (mode: WorkerPermissionMode) => {
    if (!spawnSettings) return;
    setSpawnSettings({ ...spawnSettings, worker_permission_mode: mode });
    try {
      await api.updateSpawnSettings({
        use_tmux_window: spawnSettings.use_tmux_window,
        worker_permission_mode: mode,
      });
    } catch (_e) {}
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
        {autoApprove && (
          <section>
            <h3 className="text-sm font-medium text-zinc-300">Auto-approve</h3>
            <p className="mt-1 text-xs text-zinc-600">
              Automatically approve agent actions. Changes apply on restart.
            </p>

            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-4">
              {/* Mode selector */}
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-zinc-500">Mode</span>
                <select
                  value={autoApprove.mode}
                  onChange={async (e) => {
                    const mode = e.target.value;
                    setAutoApprove({ ...autoApprove, mode });
                    try {
                      await api.updateAutoApproveMode(mode);
                    } catch (_err) {}
                  }}
                  className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                >
                  <option value="off">Off</option>
                  <option value="rules">Rules (fast, pattern-based)</option>
                  <option value="ai">AI (Claude Haiku judge)</option>
                  <option value="hybrid">Hybrid (rules → AI fallback)</option>
                </select>
              </div>

              {/* Enabled toggle */}
              <label className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <span className="text-xs text-zinc-300">Enabled</span>
                  <p className="text-[10px] text-zinc-600">Master enable/disable switch</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const next = !autoApprove.enabled;
                    setAutoApprove({ ...autoApprove, enabled: next });
                    try {
                      await api.updateAutoApproveFields({ enabled: next });
                    } catch (_err) {}
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    autoApprove.enabled ? "bg-cyan-500/40" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                      autoApprove.enabled
                        ? "translate-x-[18px] bg-cyan-400"
                        : "translate-x-0.5 bg-zinc-500"
                    }`}
                  />
                </button>
              </label>

              {/* Status indicator */}
              {autoApprove.running && (
                <p className="text-[11px] text-emerald-500/70">Service running</p>
              )}
              {autoApprove.mode !== "off" && !autoApprove.running && (
                <p className="text-[11px] text-amber-500/70">Restart tmai to activate</p>
              )}

              {/* Provider & model — visible when mode uses AI */}
              {(autoApprove.mode === "ai" || autoApprove.mode === "hybrid") && (
                <div className="space-y-2 border-t border-white/5 pt-3">
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    AI Provider
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs text-zinc-500 w-16">Provider</span>
                    <input
                      type="text"
                      value={autoApprove.provider}
                      onChange={(e) => setAutoApprove({ ...autoApprove, provider: e.target.value })}
                      onBlur={async () => {
                        try {
                          await api.updateAutoApproveFields({ provider: autoApprove.provider });
                        } catch (_err) {}
                      }}
                      className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs text-zinc-500 w-16">Model</span>
                    <input
                      type="text"
                      value={autoApprove.model}
                      onChange={(e) => setAutoApprove({ ...autoApprove, model: e.target.value })}
                      onBlur={async () => {
                        try {
                          await api.updateAutoApproveFields({ model: autoApprove.model });
                        } catch (_err) {}
                      }}
                      className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                    />
                  </div>
                </div>
              )}

              {/* Advanced settings */}
              {autoApprove.mode !== "off" && (
                <div className="space-y-2 border-t border-white/5 pt-3">
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    Advanced
                  </p>
                  {(
                    [
                      {
                        key: "timeout_secs" as const,
                        label: "Timeout (sec)",
                        desc: "Max seconds per judgment",
                      },
                      {
                        key: "cooldown_secs" as const,
                        label: "Cooldown (sec)",
                        desc: "Pause after each judgment",
                      },
                      {
                        key: "check_interval_ms" as const,
                        label: "Check interval (ms)",
                        desc: "Polling interval for candidates",
                      },
                      {
                        key: "max_concurrent" as const,
                        label: "Max concurrent",
                        desc: "Parallel judgment limit",
                      },
                    ] as const
                  ).map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center gap-2">
                      <div className="flex-1">
                        <span className="text-xs text-zinc-300">{label}</span>
                        <p className="text-[10px] text-zinc-600">{desc}</p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={autoApprove[key]}
                        onChange={(e) => {
                          const val = Number.parseInt(e.target.value, 10);
                          if (!Number.isNaN(val) && val >= 0) {
                            setAutoApprove({ ...autoApprove, [key]: val });
                          }
                        }}
                        onBlur={async () => {
                          try {
                            await api.updateAutoApproveFields({ [key]: autoApprove[key] });
                          } catch (_err) {}
                        }}
                        className="w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 text-right outline-none focus:border-cyan-500/30"
                      />
                    </div>
                  ))}

                  {/* Allowed types */}
                  <div className="border-t border-white/5 pt-3 space-y-2">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                      Allowed Types
                    </p>
                    <p className="text-[10px] text-zinc-600">
                      Tool types that can be auto-approved (empty = all except UserQuestion).
                    </p>

                    {autoApprove.allowed_types.length > 0 && (
                      <div className="space-y-1">
                        {autoApprove.allowed_types.map((t) => (
                          <div
                            key={t}
                            className="group flex items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-white/5"
                          >
                            <code className="flex-1 text-[11px] text-zinc-300 font-mono">{t}</code>
                            <button
                              type="button"
                              onClick={async () => {
                                const updated = autoApprove.allowed_types.filter((x) => x !== t);
                                setAutoApprove({ ...autoApprove, allowed_types: updated });
                                try {
                                  await api.updateAutoApproveFields({ allowed_types: updated });
                                } catch (_err) {}
                              }}
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="e.g. Bash, Read, Write"
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            const input = e.currentTarget;
                            const val = input.value.trim();
                            if (!val) return;
                            const updated = [...autoApprove.allowed_types, val];
                            setAutoApprove({ ...autoApprove, allowed_types: updated });
                            input.value = "";
                            try {
                              await api.updateAutoApproveFields({ allowed_types: updated });
                            } catch (_err) {}
                          }
                        }}
                        className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-mono text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Rule presets — visible when mode uses rules */}
              {(autoApprove.mode === "rules" || autoApprove.mode === "hybrid") && (
                <div className="space-y-2 border-t border-white/5 pt-3">
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    Rule Presets
                  </p>
                  {(
                    [
                      {
                        key: "allow_read" as const,
                        label: "Read operations",
                        desc: "file reads, cat, ls, grep, find",
                      },
                      {
                        key: "allow_tests" as const,
                        label: "Test execution",
                        desc: "cargo test, npm test, pytest, go test",
                      },
                      {
                        key: "allow_fetch" as const,
                        label: "Web fetch",
                        desc: "WebFetch / WebSearch (GET only)",
                      },
                      {
                        key: "allow_git_readonly" as const,
                        label: "Git read-only",
                        desc: "status, log, diff, branch, show, blame",
                      },
                      {
                        key: "allow_format_lint" as const,
                        label: "Format & lint",
                        desc: "cargo fmt/clippy, prettier, eslint",
                      },
                      {
                        key: "allow_tmai_mcp" as const,
                        label: "tmai MCP tools",
                        desc: "list_agents, approve, spawn, send_text, etc.",
                      },
                    ] as const
                  ).map(({ key, label, desc }) => (
                    <label key={key} className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <span className="text-xs text-zinc-300">{label}</span>
                        <p className="text-[10px] text-zinc-600">{desc}</p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          const newVal = !autoApprove.rules[key];
                          setAutoApprove({
                            ...autoApprove,
                            rules: { ...autoApprove.rules, [key]: newVal },
                          });
                          try {
                            await api.updateAutoApproveRules({ [key]: newVal });
                          } catch (_err) {}
                        }}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          autoApprove.rules[key] ? "bg-cyan-500/40" : "bg-white/10"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                            autoApprove.rules[key]
                              ? "translate-x-[18px] bg-cyan-400"
                              : "translate-x-0.5 bg-zinc-500"
                          }`}
                        />
                      </button>
                    </label>
                  ))}

                  {/* Custom patterns */}
                  <div className="border-t border-white/5 pt-3 space-y-2">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                      Custom Patterns
                    </p>
                    <p className="text-[10px] text-zinc-600">
                      Regex patterns matched against tool context for approval.
                    </p>

                    {/* Pattern list */}
                    {autoApprove.rules.allow_patterns.length > 0 && (
                      <div className="space-y-1">
                        {autoApprove.rules.allow_patterns.map((pat) => (
                          <div
                            key={pat}
                            className="group flex items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-white/5"
                          >
                            <code className="flex-1 text-[11px] text-zinc-300 font-mono">
                              {pat}
                            </code>
                            <button
                              type="button"
                              onClick={async () => {
                                const updated = autoApprove.rules.allow_patterns.filter(
                                  (p) => p !== pat,
                                );
                                setAutoApprove({
                                  ...autoApprove,
                                  rules: { ...autoApprove.rules, allow_patterns: updated },
                                });
                                try {
                                  await api.updateAutoApproveRules({
                                    allow_patterns: updated,
                                  });
                                } catch (_err) {}
                              }}
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add pattern */}
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newPattern}
                        onChange={(e) => setNewPattern(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter" && newPattern.trim()) {
                            const updated = [
                              ...autoApprove.rules.allow_patterns,
                              newPattern.trim(),
                            ];
                            setAutoApprove({
                              ...autoApprove,
                              rules: { ...autoApprove.rules, allow_patterns: updated },
                            });
                            setNewPattern("");
                            try {
                              await api.updateAutoApproveRules({
                                allow_patterns: updated,
                              });
                            } catch (_err) {}
                          }
                        }}
                        placeholder="e.g. cargo build.*"
                        className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-mono text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!newPattern.trim()) return;
                          const updated = [...autoApprove.rules.allow_patterns, newPattern.trim()];
                          setAutoApprove({
                            ...autoApprove,
                            rules: { ...autoApprove.rules, allow_patterns: updated },
                          });
                          setNewPattern("");
                          try {
                            await api.updateAutoApproveRules({
                              allow_patterns: updated,
                            });
                          } catch (_err) {}
                        }}
                        className="rounded-md bg-cyan-500/20 px-3 py-1 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Spawn section */}
        {spawnSettings && (
          <section>
            <h3 className="text-sm font-medium text-zinc-300">Spawn</h3>
            <p className="mt-1 text-xs text-zinc-600">
              How new agents are started from the Web UI.
            </p>

            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <label className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <span className="text-sm text-zinc-300">Spawn in tmux window</span>
                  <p className="mt-0.5 text-[11px] text-zinc-600">
                    {spawnSettings.tmux_available
                      ? `New agents will appear as tmux panes in the "${spawnSettings.tmux_window_name}" window, detected by the poller like regular sessions.`
                      : "tmux is not available in this mode. Agents are spawned as internal PTY sessions."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleSpawnInTmux}
                  disabled={!spawnSettings.tmux_available}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    !spawnSettings.tmux_available
                      ? "cursor-not-allowed bg-white/5"
                      : spawnSettings.use_tmux_window
                        ? "bg-cyan-500/40"
                        : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                      !spawnSettings.tmux_available
                        ? "translate-x-0.5 bg-zinc-700"
                        : spawnSettings.use_tmux_window
                          ? "translate-x-[18px] bg-cyan-400"
                          : "translate-x-0.5 bg-zinc-500"
                    }`}
                  />
                </button>
              </label>

              {/* Window name field — shown when tmux is available and enabled */}
              {spawnSettings.tmux_available && spawnSettings.use_tmux_window && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="shrink-0 text-xs text-zinc-500">Window name</span>
                  <input
                    type="text"
                    value={spawnSettings.tmux_window_name}
                    onChange={(e) => handleWindowNameChange(e.target.value)}
                    onBlur={handleWindowNameSave}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleWindowNameSave();
                    }}
                    className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                  />
                </div>
              )}

              {/* Worker permission mode — applies to dispatched workers only */}
              <div className="mt-4 border-t border-white/5 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <span className="text-xs text-zinc-400">Worker permission mode</span>
                    <p className="mt-0.5 text-[10px] text-zinc-600">
                      Injected as <code>--permission-mode</code> for Claude Code workers spawned via
                      <code> dispatch_issue</code> / <code>dispatch_review</code>. Does not apply to
                      the orchestrator itself. <code>acceptEdits</code> lets workers edit files
                      without per-tool approval while still gating Bash via tmai auto-approve.
                    </p>
                  </div>
                  <select
                    value={spawnSettings.worker_permission_mode}
                    onChange={(e) =>
                      handleWorkerPermissionModeChange(e.target.value as WorkerPermissionMode)
                    }
                    className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                  >
                    <option value="acceptEdits">acceptEdits (recommended)</option>
                    <option value="default">default</option>
                    <option value="plan">plan</option>
                    <option value="dontAsk">dontAsk</option>
                  </select>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Orchestrator section */}
        {orchestrator && (
          <section>
            <h3 className="text-sm font-medium text-zinc-300">Orchestrator</h3>
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
                  onClick={async () => {
                    const next = !orchestrator.enabled;
                    setOrchestrator({ ...orchestrator, enabled: next });
                    try {
                      await api.updateOrchestratorSettings({ enabled: next }, orchProject);
                      refreshOrchestrator();
                    } catch (_e) {
                      setOrchestrator({ ...orchestrator, enabled: !next });
                    }
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
                  {/* Role */}
                  <div>
                    <span className="block text-xs text-zinc-400 mb-1">Role</span>
                    <textarea
                      value={orchestrator.role}
                      onChange={(e) => setOrchestrator({ ...orchestrator, role: e.target.value })}
                      onBlur={async () => {
                        try {
                          await api.updateOrchestratorSettings(
                            { role: orchestrator.role },
                            orchProject,
                          );
                        } catch (_e) {}
                      }}
                      rows={2}
                      placeholder="Describe the orchestrator's role and persona..."
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
                    />
                  </div>

                  {/* Rules */}
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    Workflow Rules
                  </p>

                  {/* Branch rules */}
                  <div>
                    <span className="block text-xs text-zinc-400 mb-1">Branch rules</span>
                    <textarea
                      value={orchestrator.rules.branch}
                      onChange={(e) =>
                        setOrchestrator({
                          ...orchestrator,
                          rules: { ...orchestrator.rules, branch: e.target.value },
                        })
                      }
                      onBlur={async () => {
                        try {
                          await api.updateOrchestratorSettings(
                            { rules: { branch: orchestrator.rules.branch } },
                            orchProject,
                          );
                        } catch (_e) {}
                      }}
                      rows={2}
                      placeholder="Rules for branch naming and strategy..."
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
                    />
                  </div>

                  {/* Merge rules */}
                  <div>
                    <span className="block text-xs text-zinc-400 mb-1">Merge rules</span>
                    <textarea
                      value={orchestrator.rules.merge}
                      onChange={(e) =>
                        setOrchestrator({
                          ...orchestrator,
                          rules: { ...orchestrator.rules, merge: e.target.value },
                        })
                      }
                      onBlur={async () => {
                        try {
                          await api.updateOrchestratorSettings(
                            { rules: { merge: orchestrator.rules.merge } },
                            orchProject,
                          );
                        } catch (_e) {}
                      }}
                      rows={2}
                      placeholder="Rules for merge strategy and conflict resolution..."
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
                    />
                  </div>

                  {/* Review rules */}
                  <div>
                    <span className="block text-xs text-zinc-400 mb-1">Review rules</span>
                    <textarea
                      value={orchestrator.rules.review}
                      onChange={(e) =>
                        setOrchestrator({
                          ...orchestrator,
                          rules: { ...orchestrator.rules, review: e.target.value },
                        })
                      }
                      onBlur={async () => {
                        try {
                          await api.updateOrchestratorSettings(
                            { rules: { review: orchestrator.rules.review } },
                            orchProject,
                          );
                        } catch (_e) {}
                      }}
                      rows={2}
                      placeholder="Rules for code review process..."
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
                    />
                  </div>

                  {/* Custom rules */}
                  <div>
                    <span className="block text-xs text-zinc-400 mb-1">Custom rules</span>
                    <textarea
                      value={orchestrator.rules.custom}
                      onChange={(e) =>
                        setOrchestrator({
                          ...orchestrator,
                          rules: { ...orchestrator.rules, custom: e.target.value },
                        })
                      }
                      onBlur={async () => {
                        try {
                          await api.updateOrchestratorSettings(
                            { rules: { custom: orchestrator.rules.custom } },
                            orchProject,
                          );
                        } catch (_e) {}
                      }}
                      rows={3}
                      placeholder="Additional custom rules for the orchestrator..."
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
                    />
                  </div>

                  {/* PR Monitor */}
                  <PrMonitorSection
                    orchestrator={orchestrator}
                    setOrchestrator={setOrchestrator}
                    orchProject={orchProject}
                  />

                  {/* Notifications */}
                  <NotifySettingsSection
                    orchestrator={orchestrator}
                    setOrchestrator={setOrchestrator}
                    orchProject={orchProject}
                  />

                  {/* Guardrails */}
                  <GuardrailsSection
                    orchestrator={orchestrator}
                    setOrchestrator={setOrchestrator}
                    orchProject={orchProject}
                  />
                </div>
              )}
            </div>
          </section>
        )}

        {/* Scheduled kicks / Routines section */}
        <ScheduledKicksSection />

        {/* Usage monitoring section */}
        {usageSettings && (
          <section>
            <h3 className="text-sm font-medium text-zinc-300">Usage Monitoring</h3>
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
                  onClick={async () => {
                    const newEnabled = !usageSettings.enabled;
                    setUsageSettings({ ...usageSettings, enabled: newEnabled });
                    try {
                      await api.updateUsageSettings({ enabled: newEnabled });
                    } catch (_e) {}
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
                        setUsageSettings({ ...usageSettings, auto_refresh_min: val });
                      }
                    }}
                    onBlur={async () => {
                      const val = Math.max(5, usageSettings.auto_refresh_min || 30);
                      try {
                        await api.updateUsageSettings({ auto_refresh_min: val });
                      } catch (_e) {}
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
          <h3 className="text-sm font-medium text-zinc-300">Notifications</h3>
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
                onClick={async () => {
                  const prev = notifyOnIdle;
                  const next = !prev;
                  setNotifyOnIdle(next);
                  try {
                    await api.updateNotificationSettings({ notify_on_idle: next });
                  } catch (_e) {
                    setNotifyOnIdle(prev);
                  }
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
                      setNotifyThresholdSecs(val);
                    }
                  }}
                  onBlur={async () => {
                    const val = Math.max(0, notifyThresholdSecs);
                    try {
                      await api.updateNotificationSettings({
                        notify_idle_threshold_secs: val,
                      });
                    } catch (_e) {}
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
            <h3 className="text-sm font-medium text-zinc-300">Workflow</h3>
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
                  onClick={async () => {
                    const next = !workflowSettings.auto_rebase_on_merge;
                    setWorkflowSettings({ ...workflowSettings, auto_rebase_on_merge: next });
                    try {
                      await api.updateWorkflowSettings({ auto_rebase_on_merge: next });
                    } catch (_e) {}
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
            <h3 className="text-sm font-medium text-zinc-300">Worktree</h3>
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
                        onClick={async () => {
                          const cmds = worktreeSettings.setup_commands.filter((c) => c !== cmd);
                          setWorktreeSettings({ ...worktreeSettings, setup_commands: cmds });
                          try {
                            await api.updateWorktreeSettings({ setup_commands: cmds });
                          } catch (_e) {}
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
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && newSetupCommand.trim()) {
                        const cmds = [...worktreeSettings.setup_commands, newSetupCommand.trim()];
                        setWorktreeSettings({ ...worktreeSettings, setup_commands: cmds });
                        setNewSetupCommand("");
                        try {
                          await api.updateWorktreeSettings({ setup_commands: cmds });
                        } catch (_e) {}
                      }
                    }}
                    placeholder="e.g., npm install"
                    className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newSetupCommand.trim()) return;
                      const cmds = [...worktreeSettings.setup_commands, newSetupCommand.trim()];
                      setWorktreeSettings({ ...worktreeSettings, setup_commands: cmds });
                      setNewSetupCommand("");
                      try {
                        await api.updateWorktreeSettings({ setup_commands: cmds });
                      } catch (_e) {}
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
                      setWorktreeSettings({ ...worktreeSettings, setup_timeout_secs: val });
                    }
                  }}
                  onBlur={async () => {
                    const val = Math.max(30, worktreeSettings.setup_timeout_secs);
                    try {
                      await api.updateWorktreeSettings({ setup_timeout_secs: val });
                    } catch (_e) {}
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
                      setWorktreeSettings({ ...worktreeSettings, branch_depth_warning: val });
                    }
                  }}
                  onBlur={async () => {
                    const val = Math.max(1, worktreeSettings.branch_depth_warning);
                    try {
                      await api.updateWorktreeSettings({ branch_depth_warning: val });
                    } catch (_e) {}
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
}: {
  orchestrator: OrchestratorSettings;
  setOrchestrator: (v: OrchestratorSettings) => void;
  orchProject: string | undefined;
}) {
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // Change the per-event handling mode (off / notify / auto_action) and persist
  const setHandling = async (
    key: NotifyEventDef["key"],
    value: import("@/lib/api").EventHandling,
  ) => {
    const updated = {
      ...orchestrator,
      notify: { ...orchestrator.notify, [key]: value },
    };
    setOrchestrator(updated);
    try {
      await api.updateOrchestratorSettings({ notify: { [key]: value } }, orchProject);
    } catch (_e) {
      // Revert on error
      setOrchestrator(orchestrator);
    }
  };

  // Save a notify-mode template change
  const saveTemplate = async (templateKey: NotifyEventDef["templateKey"], value: string) => {
    try {
      const templates: Record<string, string> = { [templateKey]: value };
      await api.updateOrchestratorSettings(
        { notify: { templates: templates as Partial<import("@/lib/api").NotifyTemplates> } },
        orchProject,
      );
    } catch (_e) {}
  };

  // Save an auto-action template change
  const saveAutoActionTemplate = async (
    templateKey: keyof import("@/lib/api").AutoActionTemplates,
    value: string,
  ) => {
    try {
      const templates: Record<string, string> = { [templateKey]: value };
      await api.updateOrchestratorSettings(
        {
          auto_action_templates: templates as Partial<import("@/lib/api").AutoActionTemplates>,
        },
        orchProject,
      );
    } catch (_e) {}
  };

  // Toggle one of the origin-aware filter booleans (#440)
  type OriginFilterKey =
    | "suppress_self"
    | "notify_on_human_action"
    | "notify_on_agent_action"
    | "notify_on_system_action";
  const setOriginFlag = async (key: OriginFilterKey, value: boolean) => {
    const updated = {
      ...orchestrator,
      notify: { ...orchestrator.notify, [key]: value },
    };
    setOrchestrator(updated);
    try {
      await api.updateOrchestratorSettings({ notify: { [key]: value } }, orchProject);
    } catch (_e) {
      setOrchestrator(orchestrator);
    }
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
                        onClick={async () => {
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
                          await saveTemplate(evt.templateKey, "");
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
}: {
  orchestrator: OrchestratorSettings;
  setOrchestrator: (v: OrchestratorSettings) => void;
  orchProject: string | undefined;
}) {
  const updateInterval = async (value: number) => {
    const clamped = Math.max(10, Math.min(3600, value));
    setOrchestrator({ ...orchestrator, pr_monitor_interval_secs: clamped });
    try {
      await api.updateOrchestratorSettings({ pr_monitor_interval_secs: clamped }, orchProject);
    } catch (_e) {}
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
            onClick={async () => {
              const next = !orchestrator.pr_monitor_enabled;
              setOrchestrator({ ...orchestrator, pr_monitor_enabled: next });
              try {
                await api.updateOrchestratorSettings({ pr_monitor_enabled: next }, orchProject);
              } catch (_e) {}
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
}: {
  orchestrator: OrchestratorSettings;
  setOrchestrator: (v: OrchestratorSettings) => void;
  orchProject: string | undefined;
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

  const updateField = async (key: keyof OrchestratorSettings["guardrails"], value: number) => {
    if (value < 1) return;
    const updated = {
      ...orchestrator,
      guardrails: { ...orchestrator.guardrails, [key]: value },
    };
    setOrchestrator(updated);
    try {
      await api.updateOrchestratorSettings({ guardrails: { [key]: value } }, orchProject);
    } catch (_e) {}
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
