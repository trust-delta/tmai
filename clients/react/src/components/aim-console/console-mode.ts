// The two top-level console views the operator can switch between.
//
// COEXIST, DO NOT RIP (aim node `tmai-core:doc/aims/aim-ui.md`): `producer`
// is the existing hand-over digest console — the DEFAULT, and it stays the
// default until the aim mechanism matures. `aim` is the new full-window
// 3-pane aim console (S1 shell + S2–S4 fill).
//
// The toggle to ENTER aim-ui lives in StatusBar (the existing top chrome);
// the toggle to EXIT lives in the aim console's own top bar, because the
// aim console is a full-screen takeover that replaces the existing shell —
// StatusBar included — while it is shown.
export type ConsoleMode = "producer" | "aim";

export const DEFAULT_CONSOLE_MODE: ConsoleMode = "producer";
