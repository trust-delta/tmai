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

  it("defaults the attention-strip width to 320px and round-trips across reload", () => {
    // Default matches the pre-P1.1 fixed w-80.
    expect(loadUIPrefs().attentionStripWidth).toBe(320);
    // The drag commit persists a px width; a fresh load (= reload) reads it back.
    saveUIPrefs({ ...DEFAULT_UI_PREFS, attentionStripWidth: 440 });
    expect(loadUIPrefs().attentionStripWidth).toBe(440);
  });

  it("clamps an out-of-range / non-numeric attention-strip width", () => {
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_UI_PREFS, attentionStripWidth: 9999 }),
    );
    expect(loadUIPrefs().attentionStripWidth).toBe(560); // ATTENTION_STRIP_WIDTH_MAX
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_UI_PREFS, attentionStripWidth: 10 }),
    );
    expect(loadUIPrefs().attentionStripWidth).toBe(240); // ATTENTION_STRIP_WIDTH_MIN
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_UI_PREFS, attentionStripWidth: "wide" }),
    );
    expect(loadUIPrefs().attentionStripWidth).toBe(DEFAULT_UI_PREFS.attentionStripWidth);
  });

  it("defaults the aim panel to frontier mode and round-trips a switch to tree", () => {
    // The owed-worklist default is load-bearing (the panel is a write surface,
    // not a passive full-tree dump).
    expect(loadUIPrefs().aimMode).toBe("frontier");
    saveUIPrefs({ ...DEFAULT_UI_PREFS, aimMode: "tree" });
    expect(loadUIPrefs().aimMode).toBe("tree");
  });

  it("falls back to the default aim mode for an unknown value", () => {
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_UI_PREFS, aimMode: "galaxy" }),
    );
    expect(loadUIPrefs().aimMode).toBe(DEFAULT_UI_PREFS.aimMode);
  });

  it("round-trips a saved blob", () => {
    const next: UIPrefs = {
      ...DEFAULT_UI_PREFS,
      theme: "zinc",
      terminalFontSize: 18,
      attentionStripWidth: 440,
      attentionStripCollapsed: true,
    };
    saveUIPrefs(next);
    expect(loadUIPrefs()).toEqual(next);
  });

  it("falls back to defaults for an invalid theme without nuking siblings", () => {
    localStorage.setItem(
      UI_PREFS_STORAGE_KEY,
      JSON.stringify({ theme: "garbage", terminalFontSize: 18, attentionStripWidth: 440 }),
    );
    const loaded = loadUIPrefs();
    expect(loaded.theme).toBe(DEFAULT_UI_PREFS.theme);
    expect(loaded.terminalFontSize).toBe(18);
    expect(loaded.attentionStripWidth).toBe(440);
  });

  it("recovers gracefully when the blob is malformed JSON", () => {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, "{not json");
    expect(loadUIPrefs()).toEqual(DEFAULT_UI_PREFS);
  });

  it("sweeps legacy split keys on first load (defaults applied, keys cleared)", () => {
    localStorage.setItem("tmai:split-ratio", "0.7");
    localStorage.setItem("tmai:split-v-ratio", "0.4");

    // The split-ratio prefs retired with the git/docs multipane, so the
    // legacy keys carry nothing into the current schema — they're swept.
    const loaded = loadUIPrefs();
    expect(loaded).toEqual(DEFAULT_UI_PREFS);

    expect(localStorage.getItem("tmai:split-ratio")).toBeNull();
    expect(localStorage.getItem("tmai:split-v-ratio")).toBeNull();

    // Subsequent load reads the consolidated blob, not the (now empty) legacy keys.
    expect(loadUIPrefs()).toEqual(DEFAULT_UI_PREFS);
  });

  it("sweeps the retired tmai:dev-show-auto-discovered key even though no field consumes it", () => {
    localStorage.setItem("tmai:dev-show-auto-discovered", "true");
    const loaded = loadUIPrefs();
    // Defaults applied — the legacy value carries no information into the
    // new schema, but the key still gets removed so it doesn't linger.
    expect(loaded).toEqual(DEFAULT_UI_PREFS);
    expect(localStorage.getItem("tmai:dev-show-auto-discovered")).toBeNull();
  });

  it("does not sweep legacy keys when a consolidated blob already exists", () => {
    saveUIPrefs({ ...DEFAULT_UI_PREFS, theme: "zinc" });
    localStorage.setItem("tmai:split-ratio", "0.7");
    const loaded = loadUIPrefs();
    expect(loaded.theme).toBe("zinc");
    // Legacy key is left in place since the sweep only fires when the new blob is absent.
    expect(localStorage.getItem("tmai:split-ratio")).toBe("0.7");
  });

  it("preserves legacy keys when the sweep's save fails (CodeRabbit #640)", () => {
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
      // In-memory result is plain defaults …
      expect(loaded).toEqual(DEFAULT_UI_PREFS);
      // … but legacy keys MUST stay so the next load can retry the sweep.
      // Otherwise a quota failure would silently drop the signal one existed.
      expect(localStorage.getItem("tmai:split-ratio")).toBe("0.7");
      expect(localStorage.getItem("tmai:split-v-ratio")).toBe("0.4");
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
