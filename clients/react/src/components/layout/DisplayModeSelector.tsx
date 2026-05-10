import type { ReactNode } from "react";

export type DisplayMode = "tabs" | "split-h" | "split-v" | "triple";

interface DisplayModeSelectorProps {
  mode: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

interface ModeIconProps {
  mode: DisplayMode;
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}

function ModeIcon({ mode, active, onClick, title, children }: ModeIconProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-mode={mode}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-white/10 text-cyan-400"
          : "text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

// SVG icons drawn at 16×16 with 1.5px stroke to match the rest of the UI.
function TabsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <title>Tabs</title>
      <rect x="2" y="4" width="12" height="9" rx="1" />
      <path d="M2 7h12" />
      <path d="M5 4v3" />
      <path d="M9 4v3" />
    </svg>
  );
}

function SplitHIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <title>Split horizontal</title>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M8 3v10" />
    </svg>
  );
}

function SplitVIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <title>Split vertical</title>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 8h12" />
    </svg>
  );
}

function TripleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <title>Triple pane</title>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M8 3v10" />
      <path d="M8 8h6" />
    </svg>
  );
}

// Segmented control letting the user switch between Tabs / Split-H /
// Split-V / Triple display modes for the agent main panel.
export function DisplayModeSelector({ mode, onChange }: DisplayModeSelectorProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.03] p-0.5">
      <ModeIcon
        mode="tabs"
        active={mode === "tabs"}
        onClick={() => onChange("tabs")}
        title="Tabs (single pane)"
      >
        <TabsIcon />
      </ModeIcon>
      <ModeIcon
        mode="split-h"
        active={mode === "split-h"}
        onClick={() => onChange("split-h")}
        title="Split horizontal (left/right)"
      >
        <SplitHIcon />
      </ModeIcon>
      <ModeIcon
        mode="split-v"
        active={mode === "split-v"}
        onClick={() => onChange("split-v")}
        title="Split vertical (top/bottom)"
      >
        <SplitVIcon />
      </ModeIcon>
      <ModeIcon
        mode="triple"
        active={mode === "triple"}
        onClick={() => onChange("triple")}
        title="Triple pane (preview + git + docs)"
      >
        <TripleIcon />
      </ModeIcon>
    </div>
  );
}
