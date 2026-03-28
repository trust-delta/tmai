import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "@/components/layout/ConfirmDialog";
import { App } from "./App";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
