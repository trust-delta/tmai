import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConfirmProvider } from "@/components/layout/ConfirmDialog";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
