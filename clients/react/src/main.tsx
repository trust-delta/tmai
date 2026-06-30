import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "@/components/layout/ConfirmDialog";
import { SSEProvider } from "@/lib/sse-provider";
import {
  applyThemeToDocument,
  resolveTheme,
  resolveThemeMode,
  systemPrefersLight,
} from "@/lib/theme";
import { loadUIPrefs } from "@/lib/ui-prefs";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import { App } from "./App";
import "./styles/globals.css";

// Resolve + apply the persisted theme MODE synchronously, before the first
// React paint, so a non-dark choice (light, or system on a light OS) doesn't
// flash the tokyonight `@theme` defaults for a frame. `useApplyTheme` (in App)
// takes over for live switching + OS-appearance changes after mount.
applyThemeToDocument(resolveTheme(resolveThemeMode(loadUIPrefs().themeMode, systemPrefersLight())));

// biome-ignore lint/style/noNonNullAssertion: root element guaranteed by index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UIPrefsProvider>
      <SSEProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </SSEProvider>
    </UIPrefsProvider>
  </StrictMode>,
);
