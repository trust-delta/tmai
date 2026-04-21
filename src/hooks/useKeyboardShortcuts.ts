import { useEffect, useRef } from "react";

// Keyboard shortcuts map (WebUI uses modifier keys to avoid browser conflicts)
export const KEYBOARD_SHORTCUTS = {
  helpToggle: "?",
  settingsToggle: "Ctrl+,",
  splitToggle: "\\",
  projectNext: "Ctrl+]",
  projectPrev: "Ctrl+[",
} as const;

interface ShortcutHandler {
  keys: string[];
  description: string;
  handler: () => void;
  requiresCtrl?: boolean;
  requiresShift?: boolean;
  requiresAlt?: boolean;
}

// Register keyboard shortcuts with a stable event listener.
// Handlers are stored in a ref so the listener never needs to be re-attached.
export function useKeyboardShortcuts(handlers: ShortcutHandler[]) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

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

      for (const handler of handlersRef.current) {
        const keyMatch =
          handler.keys.includes(event.key.toLowerCase()) ||
          handler.keys.includes(event.code.toLowerCase());

        const ctrlMatch = handler.requiresCtrl
          ? event.ctrlKey || event.metaKey
          : !event.ctrlKey && !event.metaKey;
        const shiftMatch = handler.requiresShift ? event.shiftKey : !event.shiftKey;
        const altMatch = handler.requiresAlt ? event.altKey : !event.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          handler.handler();
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
