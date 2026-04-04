import { useEffect } from "react";
import { useThemeStore, loadThemeFromBackend } from "./stores/theme";
import { useSSE } from "./hooks/useSSE";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { MainArea } from "./components/layout/MainArea";

export function App() {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const connected = useSSE();

  // Apply dark class to <html> when resolved theme changes
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  // Load theme preference from backend on mount
  useEffect(() => {
    loadThemeFromBackend();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-100">
      <Header connected={connected} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <MainArea />
      </div>
    </div>
  );
}
