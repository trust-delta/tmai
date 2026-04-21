import { describe, expect, it } from "vitest";
import { KEYBOARD_SHORTCUTS } from "./useKeyboardShortcuts";

describe("KEYBOARD_SHORTCUTS constant", () => {
  it("should not contain single-key shortcuts that conflict with browser behavior", () => {
    const values = Object.values(KEYBOARD_SHORTCUTS);
    // TUI-era single-key shortcuts removed to avoid browser conflicts
    expect(values).not.toContain("s");
    expect(values).not.toContain("[");
    expect(values).not.toContain("]");
    expect(values).not.toContain("a");
    expect(values).not.toContain("k");
    expect(values).not.toContain("/");
  });

  it("should keep safe shortcuts that don't conflict with browser behavior", () => {
    expect(KEYBOARD_SHORTCUTS.helpToggle).toBe("?");
    expect(KEYBOARD_SHORTCUTS.splitToggle).toBe("\\");
  });

  it("should use modifier-based shortcuts for settings and project navigation", () => {
    expect(KEYBOARD_SHORTCUTS.settingsToggle).toBe("Ctrl+,");
    expect(KEYBOARD_SHORTCUTS.projectNext).toBe("Ctrl+]");
    expect(KEYBOARD_SHORTCUTS.projectPrev).toBe("Ctrl+[");
  });

  it("should not have unimplemented shortcuts (focusSearch, agentKill, agentApprove, securityToggle)", () => {
    const keys = Object.keys(KEYBOARD_SHORTCUTS);
    expect(keys).not.toContain("focusSearch");
    expect(keys).not.toContain("agentKill");
    expect(keys).not.toContain("agentApprove");
    expect(keys).not.toContain("securityToggle");
  });
});
