// The two top-level console views the operator can switch between.
//
// COEXIST, DO NOT RIP (aim node `tmai-core:doc/aims/aim-ui.md`): `aim` is the
// full-window 3-pane aim console and is now the DEFAULT — the aim mechanism
// matured enough to be the primary surface: it can open AND close units
// (launch + per-tab close, hub #850 / #851), so it is self-sufficient as the
// landing view. `producer` is the legacy hand-over digest console, kept as the
// opt-OUT (reached via the aim console's own EXIT toggle; in `producer` mode
// the StatusBar then hosts the toggle BACK to `aim`). The aim console is a
// full-screen takeover that replaces the existing shell — StatusBar included —
// while it is shown.
export type ConsoleMode = "producer" | "aim";

// `consoleMode` is App `useState` only (not persisted), so this default IS the
// landing mode on every load. Set to "producer" to revert the primary surface.
export const DEFAULT_CONSOLE_MODE: ConsoleMode = "aim";
