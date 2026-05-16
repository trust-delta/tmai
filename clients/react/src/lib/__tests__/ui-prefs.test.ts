// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_UI_PREFS,
  loadUIPrefs,
  saveUIPrefs,
  UI_PREFS_STORAGE_KEY,
  type UIPrefs,
} from "../ui-prefs";

describe("ui-prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadUIPrefs()).toEqual(DEFAULT_UI_PREFS);
  });

  it("defaults the theme to tokyonight (matches the operator's tmux)", () => {
    expect(loadUIPrefs().theme).toBe("tokyonight");
  });

  it("round-trips a theme selection through localStorage", () => {
    saveUIPrefs({ ...DEFAULT_UI_PREFS, theme: "zinc" });
    // Persisted to the consolidated blob, not a side key.
    expect(JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "{}").theme).toBe("zinc");
    expect(loadUIPrefs().theme).toBe("zinc");
  });

  it("falls back to the default theme for an unknown theme value", () => {
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_UI_PREFS, theme: "midnight" }),
    );
    expect(loadUIPrefs().theme).toBe(DEFAULT_UI_PREFS.theme);
  });

  it("defaults the terminal font size to 13 and round-trips a change", () => {
    expect(loadUIPrefs().terminalFontSize).toBe(13);
    saveUIPrefs({ ...DEFAULT_UI_PREFS, terminalFontSize: 18 });
    expect(loadUIPrefs().terminalFontSize).toBe(18);
  });

  it("clamps an out-of-range / non-numeric terminal font size", () => {
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_UI_PREFS, terminalFontSize: 999 }),
    );
    expect(loadUIPrefs().terminalFontSize).toBe(32); // TERMINAL_FONT_SIZE_MAX
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_UI_PREFS, terminalFontSize: "big" }),
    );
    expect(loadUIPrefs().terminalFontSize).toBe(DEFAULT_UI_PREFS.terminalFontSize);
  });

  it("round-trips a saved blob", () => {
    const next: UIPrefs = {
      ...DEFAULT_UI_PREFS,
      displayMode: "triple",
      splitRatioH: 0.42,
      tabsActive: "git",
    };
    saveUIPrefs(next);
    expect(loadUIPrefs()).toEqual(next);
  });

  it("clamps out-of-range ratios to the legal window", () => {
    saveUIPrefs({ ...DEFAULT_UI_PREFS, splitRatioH: 0.05, splitRatioV: 0.99 });
    const loaded = loadUIPrefs();
    // RATIO_MIN = 0.2, RATIO_MAX = 0.8
    expect(loaded.splitRatioH).toBe(0.2);
    expect(loaded.splitRatioV).toBe(0.8);
  });

  it("falls back to defaults for invalid enum values without nuking siblings", () => {
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({
        displayMode: "garbage",
        tabsActive: "git",
        splitRatioH: 0.65,
      }),
    );
    const loaded = loadUIPrefs();
    expect(loaded.displayMode).toBe(DEFAULT_UI_PREFS.displayMode);
    expect(loaded.tabsActive).toBe("git");
    expect(loaded.splitRatioH).toBe(0.65);
  });

  it("recovers gracefully when the blob is malformed JSON", () => {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, "{not json");
    expect(loadUIPrefs()).toEqual(DEFAULT_UI_PREFS);
  });

  it("migrates legacy split keys on first load and clears them after merge", () => {
    localStorage.setItem("tmai:split-ratio", "0.7");
    localStorage.setItem("tmai:split-v-ratio", "0.4");

    const loaded = loadUIPrefs();
    expect(loaded.splitRatioH).toBe(0.7);
    expect(loaded.splitRatioV).toBe(0.4);

    expect(localStorage.getItem("tmai:split-ratio")).toBeNull();
    expect(localStorage.getItem("tmai:split-v-ratio")).toBeNull();

    // Subsequent load reads the consolidated blob, not the (now empty) legacy keys.
    expect(loadUIPrefs()).toEqual(loaded);
  });

  it("sweeps the retired tmai:dev-show-auto-discovered key even though no field consumes it", () => {
    localStorage.setItem("tmai:dev-show-auto-discovered", "true");
    const loaded = loadUIPrefs();
    // Defaults applied — the legacy value carries no information into the
    // new schema, but the key still gets removed so it doesn't linger.
    expect(loaded).toEqual(DEFAULT_UI_PREFS);
    expect(localStorage.getItem("tmai:dev-show-auto-discovered")).toBeNull();
  });

  it("does not migrate when a consolidated blob already exists", () => {
    saveUIPrefs({ ...DEFAULT_UI_PREFS, splitRatioH: 0.3 });
    localStorage.setItem("tmai:split-ratio", "0.7");
    const loaded = loadUIPrefs();
    expect(loaded.splitRatioH).toBe(0.3);
    // Legacy key is left in place since migration only fires when the new blob is absent.
    expect(localStorage.getItem("tmai:split-ratio")).toBe("0.7");
  });

  it("preserves legacy keys when the migration save fails (CodeRabbit #640)", () => {
    localStorage.setItem("tmai:split-ratio", "0.7");
    localStorage.setItem("tmai:split-v-ratio", "0.4");
    // Force the consolidated-blob write to fail. We surface this by
    // proxying setItem so the new key throws while every other call (legacy
    // reads, removeItem during clearLegacyKeys, etc.) still works.
    const realSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === UI_PREFS_STORAGE_KEY) throw new Error("quota");
      realSetItem.call(this, key, value);
    });

    try {
      const loaded = loadUIPrefs();
      // In-memory result still reflects the migrated values …
      expect(loaded.splitRatioH).toBe(0.7);
      expect(loaded.splitRatioV).toBe(0.4);
      // … but legacy keys MUST stay so the next load can retry. Otherwise
      // a quota failure would silently drop the user's persisted prefs.
      expect(localStorage.getItem("tmai:split-ratio")).toBe("0.7");
      expect(localStorage.getItem("tmai:split-v-ratio")).toBe("0.4");
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
