import { useCallback, useEffect, useState } from "react";
import { DirBrowser } from "@/components/project/DirBrowser";
import {
  type AutoApproveSettings,
  api,
  type OrchestratorSettings,
  type SpawnSettings,
  type UsageSettings,
} from "@/lib/api";

interface SettingsPanelProps {
  onClose: () => void;
  onProjectsChanged: () => void;
  onLaunchOrchestrator?: () => void;
  orchestratorSpawning?: boolean;
  orchestratorRunning?: boolean;
}

// Settings panel displayed in the main area
export function SettingsPanel({
  onClose,
  onProjectsChanged,
  onLaunchOrchestrator,
  orchestratorSpawning,
  orchestratorRunning,
}: SettingsPanelProps) {
  const [projects, setProjects] = useState<string[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [spawnSettings, setSpawnSettings] = useState<SpawnSettings | null>(null);
  const [autoApprove, setAutoApprove] = useState<AutoApproveSettings | null>(null);
  const [usageSettings, setUsageSettings] = useState<UsageSettings | null>(null);
  const [previewShowCursor, setPreviewShowCursor] = useState(true);
  const [notifyOnIdle, setNotifyOnIdle] = useState(true);
  const [notifyThresholdSecs, setNotifyThresholdSecs] = useState(10);
  const [newPattern, setNewPattern] = useState("");
  const [orchestrator, setOrchestrator] = useState<OrchestratorSettings | null>(null);

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

  const refreshOrchestrator = useCallback(() => {
    api.getOrchestratorSettings().then(setOrchestrator).catch(console.error);
  }, []);

  useEffect(() => {
    refreshProjects();
    refreshSpawnSettings();
    refreshAutoApprove();
    refreshUsageSettings();
    refreshOrchestrator();
    api
      .getPreviewSettings()
      .then((s) => setPreviewShowCursor(s.show_cursor))
      .catch(() => {});
    api
      .getNotificationSettings()
      .then((s) => {
        setNotifyOnIdle(s.notify_on_idle);
        setNotifyThresholdSecs(s.notify_idle_threshold_secs);
      })
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

              {/* Status indicator */}
              {autoApprove.running && (
                <p className="text-[11px] text-emerald-500/70">Service running</p>
              )}
              {autoApprove.mode !== "off" && !autoApprove.running && (
                <p className="text-[11px] text-amber-500/70">Restart tmai to activate</p>
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
                      await api.updateOrchestratorSettings({ enabled: next });
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

              {/* Launch button */}
              {orchestrator.enabled && onLaunchOrchestrator && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onLaunchOrchestrator}
                    disabled={orchestratorSpawning || orchestratorRunning}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      orchestratorRunning
                        ? "bg-emerald-500/15 text-emerald-400 cursor-default"
                        : orchestratorSpawning
                          ? "bg-white/5 text-zinc-500 cursor-not-allowed"
                          : "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25"
                    }`}
                  >
                    {orchestratorRunning ? (
                      <>
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Orchestrator Running
                      </>
                    ) : orchestratorSpawning ? (
                      <>
                        <svg
                          className="h-3.5 w-3.5 animate-spin"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <title>Spawning</title>
                          <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="8" />
                        </svg>
                        Starting...
                      </>
                    ) : (
                      <>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <title>Launch</title>
                          <path d="M5 3l8 5-8 5V3z" />
                        </svg>
                        Launch Orchestrator
                      </>
                    )}
                  </button>
                </div>
              )}

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
                          await api.updateOrchestratorSettings({ role: orchestrator.role });
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
                          await api.updateOrchestratorSettings({
                            rules: { branch: orchestrator.rules.branch },
                          });
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
                          await api.updateOrchestratorSettings({
                            rules: { merge: orchestrator.rules.merge },
                          });
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
                          await api.updateOrchestratorSettings({
                            rules: { review: orchestrator.rules.review },
                          });
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
                          await api.updateOrchestratorSettings({
                            rules: { custom: orchestrator.rules.custom },
                          });
                        } catch (_e) {}
                      }}
                      rows={3}
                      placeholder="Additional custom rules for the orchestrator..."
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30 resize-y"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

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

        {/* Preview section */}
        <section>
          <h3 className="text-sm font-medium text-zinc-300">Preview</h3>
          <p className="mt-1 text-xs text-zinc-600">Terminal preview panel display options.</p>
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <label className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <span className="text-sm text-zinc-300">Show cursor overlay</span>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Display the terminal cursor position in the preview panel. Can also be toggled
                  per-session from the preview footer.
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const prev = previewShowCursor;
                  const next = !prev;
                  setPreviewShowCursor(next);
                  try {
                    await api.updatePreviewSettings({ show_cursor: next });
                  } catch (_e) {
                    setPreviewShowCursor(prev);
                  }
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  previewShowCursor ? "bg-cyan-500/40" : "bg-white/10"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                    previewShowCursor
                      ? "translate-x-[18px] bg-cyan-400"
                      : "translate-x-0.5 bg-zinc-500"
                  }`}
                />
              </button>
            </label>
          </div>
        </section>

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
