import { useCallback } from "react";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import { type DisplayMode, DisplayModeSelector } from "@/components/layout/DisplayModeSelector";
import { useUIPref, useUIPrefs } from "@/lib/ui-prefs-provider";

const MODE_LABEL: Record<DisplayMode, string> = {
  tabs: "Tabs (single pane)",
  "split-h": "Split horizontal",
  "split-v": "Split vertical",
  triple: "Triple pane",
};

/**
 * WebUI-only settings: how the agent main panel arranges preview / git / docs.
 * Lives in the unified WebUI prefs blob, not in tmai-core's config.toml.
 */
export function DisplayLayoutSection() {
  const [displayMode, setDisplayMode] = useUIPref("displayMode");
  const { resetPrefs } = useUIPrefs();
  const confirm = useConfirm();

  const handleReset = useCallback(async () => {
    const ok = await confirm({
      title: "Reset all WebUI preferences?",
      message:
        "Display mode, split ratios, tab choices, and developer toggles will return to defaults. tmai-core settings are not affected.",
      confirmLabel: "Reset",
      variant: "danger",
    });
    if (ok) resetPrefs();
  }, [confirm, resetPrefs]);

  return (
    <section>
      <h3 className="text-sm font-medium text-zinc-300">Display &amp; Layout</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Layout choices for the agent main panel. Stored per-browser; press{" "}
        <kbd className="rounded bg-white/5 px-1 text-[10px]">\</kbd> to cycle modes.
      </p>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <span className="text-sm text-zinc-300">Display mode</span>
            <p className="mt-0.5 text-[11px] text-zinc-600">
              Currently: <span className="text-zinc-400">{MODE_LABEL[displayMode]}</span>
            </p>
          </div>
          <DisplayModeSelector mode={displayMode} onChange={setDisplayMode} />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-red-500/40 hover:text-red-400"
        >
          Reset all WebUI prefs
        </button>
      </div>
    </section>
  );
}
