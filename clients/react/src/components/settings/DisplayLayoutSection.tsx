import { useCallback } from "react";
import { useConfirm } from "@/components/layout/ConfirmDialog";
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from "@/lib/ui-prefs";
import { useUIPref, useUIPrefs } from "@/lib/ui-prefs-provider";

/**
 * WebUI-only settings. The display-mode selector retired with the git/docs
 * multipane (DR `2026-05-14-react-producer-console-rebuild.md` §Refinement
 * 2026-05-22 Fork B) — the agent view is single-pane now — so this section
 * keeps the terminal text-size control plus a reset for all WebUI prefs
 * (theme, font size, attention-strip width/collapse). Lives in the unified
 * WebUI prefs blob, not in tmai-core's config.toml.
 */
export function DisplayLayoutSection() {
  const [fontSize, setFontSize] = useUIPref("terminalFontSize");
  const { resetPrefs } = useUIPrefs();
  const confirm = useConfirm();

  const stepFontSize = useCallback(
    (delta: number) => {
      setFontSize(
        Math.max(TERMINAL_FONT_SIZE_MIN, Math.min(TERMINAL_FONT_SIZE_MAX, fontSize + delta)),
      );
    },
    [fontSize, setFontSize],
  );

  const handleReset = useCallback(async () => {
    const ok = await confirm({
      title: "Reset all WebUI preferences?",
      message:
        "Theme, terminal text size, and attention-strip layout will return to defaults. tmai-core settings are not affected.",
      confirmLabel: "Reset",
      variant: "danger",
    });
    if (ok) resetPrefs();
  }, [confirm, resetPrefs]);

  return (
    <section>
      <h3 className="text-sm font-medium text-foreground">Display &amp; Layout</h3>
      <p className="mt-1 text-xs text-subtle-foreground">
        Presentation choices for this WebUI. Stored per-browser.
      </p>

      <div className="mt-3 rounded-lg border border-hairline-strong bg-surface p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <span className="text-sm text-foreground">Terminal text size</span>
            <p className="mt-0.5 text-[11px] text-subtle-foreground">
              Font size of the agent terminal / preview, in pixels. Applies instantly.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepFontSize(-1)}
              disabled={fontSize <= TERMINAL_FONT_SIZE_MIN}
              aria-label="Decrease terminal text size"
              className="touch-target-sm flex h-7 w-7 items-center justify-center rounded-md border border-hairline-strong text-muted-foreground transition-colors hover:border-hairline-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span
              className="w-12 text-center text-sm tabular-nums text-foreground"
              aria-live="polite"
            >
              {fontSize} px
            </span>
            <button
              type="button"
              onClick={() => stepFontSize(1)}
              disabled={fontSize >= TERMINAL_FONT_SIZE_MAX}
              aria-label="Increase terminal text size"
              className="touch-target-sm flex h-7 w-7 items-center justify-center rounded-md border border-hairline-strong text-muted-foreground transition-colors hover:border-hairline-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md border border-hairline-strong px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
        >
          Reset all WebUI prefs
        </button>
      </div>
    </section>
  );
}
