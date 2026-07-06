// Public API surface for the browser-served WebUI.
// The Tauri standalone app was sunset 2026-04-24, so the HTTP layer is the
// sole implementation — everything re-exports from ./api-http.
export * from "./api-http";
