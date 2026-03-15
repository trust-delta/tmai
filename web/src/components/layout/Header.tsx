import { useThemeStore } from "../../stores/theme";
import { ConnectionIndicator } from "../common/ConnectionIndicator";

interface HeaderProps {
  connected: boolean;
}

export function Header({ connected }: HeaderProps) {
  const { theme, toggle } = useThemeStore();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-300 bg-neutral-200 px-4 dark:border-neutral-800 dark:bg-transparent">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold tracking-tight">tmai</span>
      </div>
      <div className="flex items-center gap-3">
        <ConnectionIndicator connected={connected} />
        <button
          onClick={toggle}
          className="rounded p-1.5 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? "🌙" : "☀️"}
        </button>
      </div>
    </header>
  );
}
