import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "@/components/layout/ConfirmDialog";
import { RAimTreePrototype } from "@/components/producer-console/r-panel/RAimTreePrototype";
import { SSEProvider } from "@/lib/sse-provider";
import { applyThemeToDocument, resolveTheme } from "@/lib/theme";
import { loadUIPrefs } from "@/lib/ui-prefs";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import { App } from "./App";
import "./styles/globals.css";

// Apply the persisted theme synchronously, before the first React paint,
// so a non-default theme (e.g. zinc) doesn't flash the tokyonight `@theme`
// defaults for a frame. `useApplyTheme` (in App) takes over for live
// switching after mount.
applyThemeToDocument(resolveTheme(loadUIPrefs().theme));

// THROWAWAY dev-only escape hatch: opening `#aim-tree` swaps the whole app
// for the fixture-driven aim-tree prototype (no providers needed — it
// fetches nothing). This is the trial mount; remove it (and the component)
// when the eval concludes. Not a route, not wired into RPanel.
const isAimTreePrototype = typeof window !== "undefined" && window.location.hash === "#aim-tree";

// biome-ignore lint/style/noNonNullAssertion: root element guaranteed by index.html
createRoot(document.getElementById("root")!).render(
  isAimTreePrototype ? (
    <StrictMode>
      <RAimTreePrototype />
    </StrictMode>
  ) : (
    <StrictMode>
      <UIPrefsProvider>
        <SSEProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </SSEProvider>
      </UIPrefsProvider>
    </StrictMode>
  ),
);
