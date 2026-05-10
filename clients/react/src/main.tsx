import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "@/components/layout/ConfirmDialog";
import { SSEProvider } from "@/lib/sse-provider";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import { App } from "./App";
import "./styles/globals.css";

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
