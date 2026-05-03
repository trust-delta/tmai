import { useEffect, useState } from "react";
import { useSaveTracker } from "@/hooks/useSaveTracker";
import { type AutoApproveSettings, api } from "@/lib/api";
import { SaveStatus } from "./SaveStatus";

const ADVANCED_FIELDS = [
  { key: "timeout_secs", label: "Timeout (sec)", desc: "Max seconds per judgment" },
  { key: "cooldown_secs", label: "Cooldown (sec)", desc: "Pause after each judgment" },
  {
    key: "check_interval_ms",
    label: "Check interval (ms)",
    desc: "Polling interval for candidates",
  },
  { key: "max_concurrent", label: "Max concurrent", desc: "Parallel judgment limit" },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<
    AutoApproveSettings,
    "timeout_secs" | "cooldown_secs" | "check_interval_ms" | "max_concurrent"
  >;
  label: string;
  desc: string;
}>;

const RULE_PRESETS = [
  { key: "allow_read", label: "Read operations", desc: "file reads, cat, ls, grep, find" },
  { key: "allow_tests", label: "Test execution", desc: "cargo test, npm test, pytest, go test" },
  { key: "allow_fetch", label: "Web fetch", desc: "WebFetch / WebSearch (GET only)" },
  {
    key: "allow_git_readonly",
    label: "Git read-only",
    desc: "status, log, diff, branch, show, blame",
  },
  { key: "allow_format_lint", label: "Format & lint", desc: "cargo fmt/clippy, prettier, eslint" },
  {
    key: "allow_tmai_mcp",
    label: "tmai MCP tools",
    desc: "list_agents, approve, spawn, send_text, etc.",
  },
] as const;

/**
 * Auto-approve settings section: mode + enabled toggle + AI provider/model
 * (when mode uses AI) + advanced numeric fields + allowed-types list +
 * rule presets (when mode uses rules) + custom regex patterns.
 *
 * Owns its own state and load (`api.getAutoApproveSettings`) so the parent
 * SettingsPanel does not need to refresh it. Auto-saves on every interaction
 * via `useSaveTracker`; atomic toggles roll back local state on backend
 * error, text fields keep the user's draft so they can correct.
 */
export function AutoApproveSection() {
  const [autoApprove, setAutoApprove] = useState<AutoApproveSettings | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const save = useSaveTracker();

  useEffect(() => {
    api.getAutoApproveSettings().then(setAutoApprove).catch(console.error);
  }, []);

  if (!autoApprove) return null;

  const inputCls =
    "rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500/30";

  const togglePillCls = (active: boolean) =>
    `relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
      active ? "bg-cyan-500/40" : "bg-white/10"
    }`;
  const toggleKnobCls = (active: boolean) =>
    `inline-block h-3.5 w-3.5 rounded-full transition-transform ${
      active ? "translate-x-[18px] bg-cyan-400" : "translate-x-0.5 bg-zinc-500"
    }`;

  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-zinc-300">Auto-approve</h3>
        <SaveStatus status={save.status} error={save.error} variant="section" />
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Automatically approve agent actions. Changes apply on restart.
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-4">
        {/* Mode selector */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-zinc-500">Mode</span>
          <select
            value={autoApprove.mode}
            onChange={(e) => {
              const mode = e.target.value;
              const prev = autoApprove.mode;
              setAutoApprove({ ...autoApprove, mode });
              void save.track(() => api.updateAutoApproveMode(mode), {
                onError: () => setAutoApprove({ ...autoApprove, mode: prev }),
              });
            }}
            className={`flex-1 ${inputCls}`}
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
            onClick={() => {
              const next = !autoApprove.enabled;
              setAutoApprove({ ...autoApprove, enabled: next });
              void save.track(() => api.updateAutoApproveFields({ enabled: next }), {
                onError: () => setAutoApprove({ ...autoApprove, enabled: !next }),
              });
            }}
            className={togglePillCls(autoApprove.enabled)}
            aria-label="Auto-approve enabled"
          >
            <span className={toggleKnobCls(autoApprove.enabled)} />
          </button>
        </label>

        {/* Status indicator */}
        {autoApprove.running && <p className="text-[11px] text-emerald-500/70">Service running</p>}
        {autoApprove.mode !== "off" && !autoApprove.running && (
          <p className="text-[11px] text-amber-500/70">Restart tmai to activate</p>
        )}

        {/* Provider & model — visible when mode uses AI */}
        {(autoApprove.mode === "ai" || autoApprove.mode === "hybrid") && (
          <div className="space-y-2 border-t border-white/5 pt-3">
            <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              AI Provider
            </p>
            {(["provider", "model"] as const).map((field) => (
              <div key={field} className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-zinc-500 w-16 capitalize">{field}</span>
                <input
                  type="text"
                  value={autoApprove[field]}
                  onChange={(e) => {
                    save.clearError();
                    setAutoApprove({ ...autoApprove, [field]: e.target.value });
                  }}
                  onBlur={() => {
                    const value = autoApprove[field];
                    void save.track(() => api.updateAutoApproveFields({ [field]: value }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  className={`flex-1 ${inputCls}`}
                  aria-label={`Auto-approve ${field}`}
                />
              </div>
            ))}
          </div>
        )}

        {/* Advanced settings */}
        {autoApprove.mode !== "off" && (
          <div className="space-y-2 border-t border-white/5 pt-3">
            <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Advanced
            </p>
            {ADVANCED_FIELDS.map(({ key, label, desc }) => (
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
                      save.clearError();
                      setAutoApprove({ ...autoApprove, [key]: val });
                    }
                  }}
                  onBlur={() => {
                    const val = autoApprove[key];
                    void save.track(() => api.updateAutoApproveFields({ [key]: val }));
                  }}
                  className={`w-20 text-right ${inputCls}`}
                  aria-label={label}
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
                        onClick={() => {
                          const previous = autoApprove.allowed_types;
                          const updated = previous.filter((x) => x !== t);
                          setAutoApprove({ ...autoApprove, allowed_types: updated });
                          void save.track(
                            () => api.updateAutoApproveFields({ allowed_types: updated }),
                            {
                              onError: () =>
                                setAutoApprove({ ...autoApprove, allowed_types: previous }),
                            },
                          );
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                        aria-label={`Remove allowed type ${t}`}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const input = e.currentTarget;
                      const val = input.value.trim();
                      if (!val) return;
                      const previous = autoApprove.allowed_types;
                      const updated = [...previous, val];
                      setAutoApprove({ ...autoApprove, allowed_types: updated });
                      input.value = "";
                      void save.track(
                        () => api.updateAutoApproveFields({ allowed_types: updated }),
                        {
                          onError: () =>
                            setAutoApprove({ ...autoApprove, allowed_types: previous }),
                        },
                      );
                    }
                  }}
                  className={`flex-1 font-mono placeholder-zinc-600 ${inputCls}`}
                  aria-label="Add allowed type"
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
            {RULE_PRESETS.map(({ key, label, desc }) => {
              const active = autoApprove.rules[key];
              return (
                <label key={key} className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <span className="text-xs text-zinc-300">{label}</span>
                    <p className="text-[10px] text-zinc-600">{desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newVal = !active;
                      setAutoApprove({
                        ...autoApprove,
                        rules: { ...autoApprove.rules, [key]: newVal },
                      });
                      void save.track(() => api.updateAutoApproveRules({ [key]: newVal }), {
                        onError: () =>
                          setAutoApprove({
                            ...autoApprove,
                            rules: { ...autoApprove.rules, [key]: !newVal },
                          }),
                      });
                    }}
                    className={togglePillCls(active)}
                    aria-label={`Rule preset ${label}`}
                  >
                    <span className={toggleKnobCls(active)} />
                  </button>
                </label>
              );
            })}

            {/* Custom patterns */}
            <div className="border-t border-white/5 pt-3 space-y-2">
              <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                Custom Patterns
              </p>
              <p className="text-[10px] text-zinc-600">
                Regex patterns matched against tool context for approval.
              </p>

              {autoApprove.rules.allow_patterns.length > 0 && (
                <div className="space-y-1">
                  {autoApprove.rules.allow_patterns.map((pat) => (
                    <div
                      key={pat}
                      className="group flex items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-white/5"
                    >
                      <code className="flex-1 text-[11px] text-zinc-300 font-mono">{pat}</code>
                      <button
                        type="button"
                        onClick={() => {
                          const previous = autoApprove.rules.allow_patterns;
                          const updated = previous.filter((p) => p !== pat);
                          setAutoApprove({
                            ...autoApprove,
                            rules: { ...autoApprove.rules, allow_patterns: updated },
                          });
                          void save.track(
                            () => api.updateAutoApproveRules({ allow_patterns: updated }),
                            {
                              onError: () =>
                                setAutoApprove({
                                  ...autoApprove,
                                  rules: { ...autoApprove.rules, allow_patterns: previous },
                                }),
                            },
                          );
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                        aria-label={`Remove pattern ${pat}`}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPattern.trim()) {
                      commitNewPattern();
                    }
                  }}
                  placeholder="e.g. cargo build.*"
                  className={`flex-1 font-mono placeholder-zinc-600 ${inputCls}`}
                  aria-label="Add custom pattern"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newPattern.trim()) commitNewPattern();
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
  );

  function commitNewPattern() {
    const trimmed = newPattern.trim();
    if (!trimmed) return;
    if (!autoApprove) return;
    const previous = autoApprove.rules.allow_patterns;
    const updated = [...previous, trimmed];
    setAutoApprove({
      ...autoApprove,
      rules: { ...autoApprove.rules, allow_patterns: updated },
    });
    setNewPattern("");
    void save.track(() => api.updateAutoApproveRules({ allow_patterns: updated }), {
      onError: () =>
        setAutoApprove({
          ...autoApprove,
          rules: { ...autoApprove.rules, allow_patterns: previous },
        }),
    });
  }
}
