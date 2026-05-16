import { THEME_NAMES, THEMES } from "@/lib/theme";
import { useUIPref } from "@/lib/ui-prefs-provider";

/**
 * WebUI-only setting: the colour theme. Lives in the unified WebUI prefs
 * blob (localStorage), not in tmai-core's config.toml — theme is pure
 * presentation and has no meaning for the CLI / TUI clients. Selecting a
 * theme persists immediately and re-skins the terminal and the rest of
 * the UI live (App's `useApplyTheme` + useTerminal both read the same
 * `lib/theme` source), so there is no Save button and no reload.
 */
export function ThemeSection() {
  const [theme, setTheme] = useUIPref("theme");

  return (
    <section>
      <h3 className="text-sm font-medium text-foreground">Theme</h3>
      <p className="mt-1 text-xs text-subtle-foreground">
        Colours for the whole WebUI, including the terminal palette. Stored per-browser; applies
        instantly.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {THEME_NAMES.map((name) => {
          const t = THEMES[name];
          const active = theme === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setTheme(name)}
              aria-pressed={active}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-hairline-strong bg-surface text-muted-foreground hover:border-hairline-strong hover:text-foreground"
              }`}
            >
              {/* Swatch: the theme's terminal bg framed by its accent so
                  the choice is recognisable without applying it. */}
              <span
                className="h-5 w-5 shrink-0 rounded border-2"
                style={{
                  backgroundColor: t.palette.terminalBackground,
                  borderColor: t.palette.tokens.ring,
                }}
              />
              <span className="text-sm">{t.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
