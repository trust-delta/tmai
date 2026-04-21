// Library exports - use Tauri-aware API by default

export type { CoreEvent } from "../hooks/useTauriEvents";
export * from "./api";
export { connectTerminal, subscribeSSE } from "./api";
export { api } from "./api-tauri";
export { tauri } from "./tauri";
