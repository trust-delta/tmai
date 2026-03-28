import { useEffect } from "react";

// Keyboard shortcuts map
export const KEYBOARD_SHORTCUTS = {
  helpToggle: "?",
  settingsToggle: "s",
  securityToggle: "sec",
  projectNext: "]",
  projectPrev: "[",
  agentKill: "k",
  agentApprove: "a",
  focusSearch: "/",
} as const;

interface ShortcutHandler {
  keys: string[];
  description: string;
  handler: () => void;
  requiresCtrl?: boolean;
  requiresShift?: boolean;
  requiresAlt?: boolean;
}

export function useKeyboardShortcuts(handlers: ShortcutHandler[]) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if focus is on an input element
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";

      // Skip keyboard shortcuts when typing in input
      if (isInput && !["Escape"].includes(event.key)) {
        return;
      }

      for (const handler of handlers) {
        const keyMatch =
          handler.keys.includes(event.key.toLowerCase()) ||
          handler.keys.includes(event.code.toLowerCase());

        const ctrlMatch = handler.requiresCtrl
          ? event.ctrlKey || event.metaKey
          : !event.ctrlKey && !event.metaKey;
        const shiftMatch = handler.requiresShift
          ? event.shiftKey
          : !event.shiftKey;
        const altMatch = handler.requiresAlt
          ? event.altKey
          : !event.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          handler.handler();
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
