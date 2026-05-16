import type { ReactNode } from "react";

export type PaneTab = "preview" | "git" | "markdown";

interface TabbedPaneLayoutProps {
  preview: ReactNode;
  git: ReactNode;
  markdown: ReactNode;
  active: PaneTab;
  onTabChange: (tab: PaneTab) => void;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-surface-strong text-primary"
          : "text-muted-foreground hover:bg-surface hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// Single-pane tabbed layout: preview / git / markdown share one viewport.
// All three are mounted simultaneously and toggled with `display: hidden` so
// the inactive panes preserve their state (xterm scrollback, scroll position,
// graph layout) instead of unmount/remount on every tab switch.
export function TabbedPaneLayout({
  preview,
  git,
  markdown,
  active,
  onTabChange,
}: TabbedPaneLayoutProps) {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-3 py-1.5">
        <TabButton active={active === "preview"} onClick={() => onTabChange("preview")}>
          Preview
        </TabButton>
        <TabButton active={active === "git"} onClick={() => onTabChange("git")}>
          Git
        </TabButton>
        <TabButton active={active === "markdown"} onClick={() => onTabChange("markdown")}>
          Docs
        </TabButton>
      </div>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <div
          className={`absolute inset-0 flex flex-col overflow-hidden ${
            active === "preview" ? "" : "hidden"
          }`}
        >
          {preview}
        </div>
        <div
          className={`absolute inset-0 flex flex-col overflow-hidden ${
            active === "git" ? "" : "hidden"
          }`}
        >
          {git}
        </div>
        <div
          className={`absolute inset-0 flex flex-col overflow-hidden ${
            active === "markdown" ? "" : "hidden"
          }`}
        >
          {markdown}
        </div>
      </div>
    </div>
  );
}
