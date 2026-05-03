import type { UseSaveTrackerResult } from "@/hooks/useSaveTracker";
import type { SpawnRuntime, SpawnSettings } from "@/lib/api";
import { api } from "@/lib/api";

interface SpawnRuntimeSelectorProps {
  settings: SpawnSettings;
  onSettingsChange: (updated: SpawnSettings) => void;
  /**
   * Optional save tracker (#578). When provided, runtime-radio changes route
   * through it so the parent section can render Saving / Saved / error state.
   * Falls back to a fire-and-forget call (silent failure) for backwards
   * compatibility with callers that have not yet adopted the tracker.
   */
  save?: UseSaveTrackerResult;
}

interface RuntimeOption {
  value: SpawnRuntime;
  label: string;
  description: string;
  disabled: boolean;
}

const RUNTIME_OPTIONS: RuntimeOption[] = [
  {
    value: "native",
    label: "Native",
    description:
      "PTY-server backed. Agents run under tmai's supervisor. Required for browser preview, resize, programmatic input. (default)",
    disabled: false,
  },
  {
    value: "tmux",
    label: "tmux",
    description:
      "Run agents in a tmux pane the user can attach to. Coming soon — currently uses the legacy spawn path; will move to the IPC adapter framework in a follow-up release.",
    disabled: true,
  },
];

export function SpawnRuntimeSelector({
  settings,
  onSettingsChange,
  save,
}: SpawnRuntimeSelectorProps) {
  const handleChange = async (runtime: SpawnRuntime) => {
    // tmux is not yet selectable; guard prevents accidental selection
    if (runtime === "tmux") return;
    const previous = settings.runtime;
    onSettingsChange({ ...settings, runtime });
    if (save) {
      void save.track(() => api.updateSpawnSettings({ runtime }), {
        onError: () => onSettingsChange({ ...settings, runtime: previous }),
      });
    } else {
      try {
        await api.updateSpawnSettings({ runtime });
      } catch (_e) {
        onSettingsChange({ ...settings, runtime: previous });
      }
    }
  };

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-zinc-400">Spawn runtime</span>
      {RUNTIME_OPTIONS.map((opt) => {
        const isSelected = settings.runtime === opt.value;
        return (
          <label
            key={opt.value}
            className={`flex items-start gap-3 rounded-md border p-2 transition-colors ${
              opt.disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-white/[0.03]"
            } ${isSelected ? "border-cyan-500/30 bg-cyan-500/5" : "border-white/5 bg-transparent"}`}
          >
            <input
              type="radio"
              name="spawn-runtime"
              value={opt.value}
              checked={isSelected}
              disabled={opt.disabled}
              onChange={() => handleChange(opt.value)}
              className="mt-0.5 accent-cyan-500"
              aria-label={opt.label}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-xs ${
                    opt.disabled && !isSelected ? "text-zinc-600" : "text-zinc-300"
                  }`}
                >
                  {opt.label}
                </span>
                {opt.disabled && (
                  <span className="text-[10px] text-zinc-600 border border-zinc-700 rounded px-1">
                    coming soon
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-600 mt-0.5">{opt.description}</p>
            </div>
          </label>
        );
      })}
    </div>
  );
}
