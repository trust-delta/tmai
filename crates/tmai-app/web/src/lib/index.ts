// Library exports - use Tauri-aware API by default
export * from "./api";
export { api } from "./api-tauri";
export { tauri } from "./tauri";
export { subscribeSSE, connectTerminal } from "./api";
export { type CoreEvent } from "../hooks/useTauriEvents";
