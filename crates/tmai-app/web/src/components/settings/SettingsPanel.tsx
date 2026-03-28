import { useState, useEffect, useCallback } from "react";
import { api, type SpawnSettings, type AutoApproveSettings, type UsageSettings } from "@/lib/api";
import { DirBrowser } from "@/components/project/DirBrowser";

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
  const [autoApprove, setAutoApprove] = useState<AutoApproveSettings | null>(
    null,
  );
  const [usageSettings, setUsageSettings] = useState<UsageSettings | null>(null);
  const [newPattern, setNewPattern] = useState("");

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

  useEffect(() => {
    refreshProjects();
    refreshSpawnSettings();
    refreshAutoApprove();
    refreshUsageSettings();
  }, [refreshProjects, refreshSpawnSettings, refreshAutoApprove, refreshUsageSettings]);

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
    } catch (e) {
      console.error("Remove failed:", e);
    }
  };

  // Toggle spawn in tmux
  const handleToggleSpawnInTmux = async () => {
    if (!spawnSettings) return;
    const newValue = !spawnSettings.use_tmux_window;
    try {
      await api.updateSpawnSettings({ use_tmux_window: newValue });
      setSpawnSettings({ ...spawnSettings, use_tmux_window: newValue });
    } catch (e) {
      console.error("Failed to update spawn settings:", e);
    }
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
    } catch (e) {
      console.error("Failed to update window name:", e);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <h2 className="text-lg font-semibold text-zinc-200">Settings</h2>
        <button
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
                    } catch (err) {
                      console.error("Failed to update auto-approve:", err);
                    }
                  }}
                  className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                >
                  <option value="Off">Off</option>
                  <option value="Rules">Rules (fast, pattern-based)</option>
                  <option value="Ai">AI (Claude Haiku judge)</option>
                  <option value="Hybrid">Hybrid (rules → AI fallback)</option>
                </select>
              </div>

              {/* Status indicator */}
              {autoApprove.running && (
                <p className="text-[11px] text-emerald-500/70">
                  Service running
                </p>
              )}
              {autoApprove.mode !== "Off" && !autoApprove.running && (
                <p className="text-[11px] text-amber-500/70">
                  Restart tmai to activate
                </p>
              )}

              {/* Rule presets — visible when mode uses rules */}
              {(autoApprove.mode === "Rules" || autoApprove.mode === "Hybrid") && (
                <div className="space-y-2 border-t border-white/5 pt-3">
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    Rule Presets
                  </p>
                  {([
                    { key: "allow_read" as const, label: "Read operations", desc: "file reads, cat, ls, grep, find" },
                    { key: "allow_tests" as const, label: "Test execution", desc: "cargo test, npm test, pytest, go test" },
                    { key: "allow_fetch" as const, label: "Web fetch", desc: "WebFetch / WebSearch (GET only)" },
                    { key: "allow_git_readonly" as const, label: "Git read-only", desc: "status, log, diff, branch, show, blame" },
                    { key: "allow_format_lint" as const, label: "Format & lint", desc: "cargo fmt/clippy, prettier, eslint" },
                  ] as const).map(({ key, label, desc }) => (
                    <label key={key} className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <span className="text-xs text-zinc-300">{label}</span>
                        <p className="text-[10px] text-zinc-600">{desc}</p>
                      </div>
                      <button
                        onClick={async () => {
                          const newVal = !autoApprove.rules[key];
                          setAutoApprove({
                            ...autoApprove,
                            rules: { ...autoApprove.rules, [key]: newVal },
                          });
                          try {
                            await api.updateAutoApproveRules({ [key]: newVal });
                          } catch (err) {
                            console.error("Failed to update rule:", err);
                          }
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
                        {autoApprove.rules.allow_patterns.map((pat, i) => (
                          <div
                            key={i}
                            className="group flex items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-white/5"
                          >
                            <code className="flex-1 text-[11px] text-zinc-300 font-mono">
                              {pat}
                            </code>
                            <button
                              onClick={async () => {
                                const updated = autoApprove.rules.allow_patterns.filter(
                                  (_, idx) => idx !== i,
                                );
                                setAutoApprove({
                                  ...autoApprove,
                                  rules: { ...autoApprove.rules, allow_patterns: updated },
                                });
                                try {
                                  await api.updateAutoApproveRules({
                                    allow_patterns: updated,
                                  });
                                } catch (err) {
                                  console.error("Failed to remove pattern:", err);
                                }
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
                            } catch (err) {
                              console.error("Failed to add pattern:", err);
                            }
                          }
                        }}
                        placeholder="e.g. cargo build.*"
                        className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-mono text-zinc-200 placeholder-zinc-600 outline-none focus:border-cyan-500/30"
                      />
                      <button
                        onClick={async () => {
                          if (!newPattern.trim()) return;
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
                          } catch (err) {
                            console.error("Failed to add pattern:", err);
                          }
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
                  <span className="text-sm text-zinc-300">
                    Spawn in tmux window
                  </span>
                  <p className="mt-0.5 text-[11px] text-zinc-600">
                    {spawnSettings.tmux_available
                      ? `New agents will appear as tmux panes in the "${spawnSettings.tmux_window_name}" window, detected by the poller like regular sessions.`
                      : "tmux is not available in this mode. Agents are spawned as internal PTY sessions."}
                  </p>
                </div>
                <button
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
                  <span className="shrink-0 text-xs text-zinc-500">
                    Window name
                  </span>
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

        {/* Usage monitoring section */}
        {usageSettings && (
          <section>
            <h3 className="text-sm font-medium text-zinc-300">Usage Monitoring</h3>
            <p className="mt-1 text-xs text-zinc-600">
              Periodically fetch Claude Code subscription usage.
              Spawns a temporary Claude Code instance (Haiku) for each refresh.
            </p>

            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
              <label className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <span className="text-sm text-zinc-300">Auto-refresh</span>
                </div>
                <button
                  onClick={async () => {
                    const newEnabled = !usageSettings.enabled;
                    setUsageSettings({ ...usageSettings, enabled: newEnabled });
                    try {
                      await api.updateUsageSettings({ enabled: newEnabled });
                    } catch (e) {
                      console.error("Failed to update usage settings:", e);
                    }
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
                      if (!isNaN(val)) {
                        setUsageSettings({ ...usageSettings, auto_refresh_min: val });
                      }
                    }}
                    onBlur={async () => {
                      const val = Math.max(5, usageSettings.auto_refresh_min || 30);
                      try {
                        await api.updateUsageSettings({ auto_refresh_min: val });
                      } catch (e) {
                        console.error("Failed to update usage interval:", e);
                      }
                    }}
                    className="w-20 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30"
                  />
                  <span className="text-xs text-zinc-500">minutes</span>
                </div>
              )}
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
                onClick={() => handleAdd()}
                className="rounded-md bg-cyan-500/20 px-3 py-1.5 text-xs text-cyan-400 transition-colors hover:bg-cyan-500/30"
              >
                Add
              </button>
              <button
                onClick={() => setBrowsing((v) => !v)}
                className={`rounded-md border border-white/10 px-3 py-1.5 text-xs transition-colors hover:bg-white/10 ${browsing ? "text-cyan-400" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                Browse
              </button>
            </div>
            {error && (
              <p className="mt-1.5 text-[11px] text-red-400">{error}</p>
            )}
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
              <p className="py-4 text-center text-xs text-zinc-600">
                No projects registered
              </p>
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
