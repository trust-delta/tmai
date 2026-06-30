import { THEME_MODE_OPTIONS, THEMES } from "@/lib/theme";
import { useUIPref } from "@/lib/ui-prefs-provider";

/**
 * WebUI-only setting: the colour-theme MODE (System / Light / Dark). Lives in
 * the unified WebUI prefs blob (localStorage), not in tmai-core's config.toml —
 * theme is pure presentation and has no meaning for the CLI / TUI clients
 * (provisional store: a later core config field may pick it up). Picking a mode
 * persists immediately and re-skins the terminal + the rest of the UI live
 * (App's `useApplyTheme` + useTerminal both resolve the same `lib/theme`
 * source), so there is no Save button and no reload. `System` additionally
 * follows the OS appearance live via `prefers-color-scheme`.
 */
export function ThemeSection() {
  const [mode, setMode] = useUIPref("themeMode");

  return (
    <section>
      <h3 className="text-sm font-medium text-foreground">Theme</h3>
      <p className="mt-1 text-xs text-subtle-foreground">
        Colours for the whole WebUI, including the terminal palette. Stored per-browser; applies
        instantly. <span className="text-muted-foreground">System</span> follows your OS appearance.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {THEME_MODE_OPTIONS.map((opt) => {
          const active = mode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => setMode(opt.mode)}
              aria-pressed={active}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-hairline-strong bg-surface text-muted-foreground hover:border-hairline-strong hover:text-foreground"
              }`}
            >
              <Swatch swatch={opt.swatch} />
              <span className="text-sm">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// A recognisable preview of a mode's colours without applying it. A concrete
// theme (light / dark) shows its terminal bg framed by its accent ring; the
// `system` mode (no single colour) shows a split of the two it chooses between.
function Swatch({ swatch }: { swatch: (typeof THEME_MODE_OPTIONS)[number]["swatch"] }) {
  if (swatch === null) {
    const dark = THEMES.tokyonight.palette.terminalBackground;
    const light = THEMES.light.palette.terminalBackground;
    return (
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 rounded border-2 border-hairline-strong"
        style={{ background: `linear-gradient(135deg, ${dark} 0 50%, ${light} 50% 100%)` }}
      />
    );
  }
  const t = THEMES[swatch];
  return (
    <span
      aria-hidden="true"
      className="h-5 w-5 shrink-0 rounded border-2"
      style={{ backgroundColor: t.palette.terminalBackground, borderColor: t.palette.tokens.ring }}
    />
  );
}
