import { PreviewPanelLegacy } from "./PreviewPanelLegacy";
import { PreviewPanelXterm } from "./PreviewPanelXterm";

// Dispatcher between the legacy AnsiUp+Worker pipeline and the new
// xterm.js-backed preview (#5 Phase 1). Toggled per browser via
// `localStorage.setItem("tmai:preview-xterm", "true")` and a reload —
// swapping engines mid-session would tear down the PTY stream, so the
// flag is read once per render and persists for the panel's lifetime.
//
// Default OFF: production users keep the current behaviour until the
// xterm path has soaked through Phases 2-3.
function readPreviewXtermFlag(): boolean {
  try {
    return localStorage.getItem("tmai:preview-xterm") === "true";
  } catch {
    return false;
  }
}

interface PreviewPanelProps {
  agentId: string;
}

export function PreviewPanel({ agentId }: PreviewPanelProps) {
  const useXterm = readPreviewXtermFlag();
  return useXterm ? (
    <PreviewPanelXterm agentId={agentId} />
  ) : (
    <PreviewPanelLegacy agentId={agentId} />
  );
}
