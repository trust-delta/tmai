// Equivalence fixture for `keyEventToBytes` against the Rust reference
// `tmai_core::utils::keys::tmux_key_to_bytes`. Every entry below is a
// `(KeyboardEvent shape, expected bytes)` pair where the `expected
// bytes` come straight from `tmux_key_to_bytes` for the corresponding
// tmux name produced by the legacy `toTmuxKey` mapping in PreviewPanel.

import { describe, expect, it } from "vitest";
import { keyEventToBytes, textToBytes } from "../keys";

interface EventShape {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

function makeEvent(shape: EventShape): KeyboardEvent {
  return shape as unknown as KeyboardEvent;
}

const CASES: Array<{
  name: string;
  event: EventShape;
  expected: number[];
}> = [
  // Plain printable
  { name: "y", event: { key: "y" }, expected: [0x79] },
  { name: "0", event: { key: "0" }, expected: [0x30] },
  { name: "/", event: { key: "/" }, expected: [0x2f] },
  { name: "Space (' ')", event: { key: " " }, expected: [0x20] },

  // Control characters via bitmask
  { name: "C-c", event: { key: "c", ctrlKey: true }, expected: [0x03] },
  { name: "C-C (uppercase same as C-c)", event: { key: "C", ctrlKey: true }, expected: [0x03] },
  { name: "C-a", event: { key: "a", ctrlKey: true }, expected: [0x01] },
  { name: "C-@ (NUL via ctrl-2/ctrl-space)", event: { key: "@", ctrlKey: true }, expected: [0x00] },
  { name: "C-[ (ESC)", event: { key: "[", ctrlKey: true }, expected: [0x1b] },
  { name: "C-Space (NUL)", event: { key: " ", ctrlKey: true }, expected: [0x00] },

  // Special keys
  { name: "Enter", event: { key: "Enter" }, expected: [0x0d] },
  {
    name: "Enter + ctrl (== C-m == Enter)",
    event: { key: "Enter", ctrlKey: true },
    expected: [0x0d],
  },
  { name: "Escape", event: { key: "Escape" }, expected: [0x1b] },
  { name: "Backspace", event: { key: "Backspace" }, expected: [0x7f] },
  { name: "Tab", event: { key: "Tab" }, expected: [0x09] },
  { name: "Shift+Tab (BTab)", event: { key: "Tab", shiftKey: true }, expected: [0x1b, 0x5b, 0x5a] },

  // Arrow / nav
  { name: "ArrowUp", event: { key: "ArrowUp" }, expected: [0x1b, 0x5b, 0x41] },
  { name: "ArrowDown", event: { key: "ArrowDown" }, expected: [0x1b, 0x5b, 0x42] },
  { name: "ArrowRight", event: { key: "ArrowRight" }, expected: [0x1b, 0x5b, 0x43] },
  { name: "ArrowLeft", event: { key: "ArrowLeft" }, expected: [0x1b, 0x5b, 0x44] },
  { name: "Home", event: { key: "Home" }, expected: [0x1b, 0x5b, 0x48] },
  { name: "End", event: { key: "End" }, expected: [0x1b, 0x5b, 0x46] },
  { name: "PageUp", event: { key: "PageUp" }, expected: [0x1b, 0x5b, 0x35, 0x7e] },
  { name: "PageDown", event: { key: "PageDown" }, expected: [0x1b, 0x5b, 0x36, 0x7e] },
  { name: "Delete (DC)", event: { key: "Delete" }, expected: [0x1b, 0x5b, 0x33, 0x7e] },
];

describe("keyEventToBytes — tmux_key_to_bytes equivalence", () => {
  for (const { name, event, expected } of CASES) {
    it(`maps ${name}`, () => {
      const out = keyEventToBytes(makeEvent(event));
      expect(out).not.toBeNull();
      expect(Array.from(out as Uint8Array)).toEqual(expected);
    });
  }

  it("returns null for modifier-only events", () => {
    expect(keyEventToBytes(makeEvent({ key: "Shift" }))).toBeNull();
    expect(keyEventToBytes(makeEvent({ key: "Control" }))).toBeNull();
    expect(keyEventToBytes(makeEvent({ key: "Alt" }))).toBeNull();
    expect(keyEventToBytes(makeEvent({ key: "Meta" }))).toBeNull();
  });

  it("returns null for F-keys and other unmapped multichar keys", () => {
    expect(keyEventToBytes(makeEvent({ key: "F1" }))).toBeNull();
    expect(keyEventToBytes(makeEvent({ key: "Insert" }))).toBeNull();
    expect(keyEventToBytes(makeEvent({ key: "ContextMenu" }))).toBeNull();
  });

  it("encodes multi-byte unicode via UTF-8", () => {
    // BMP — Japanese hiragana あ (U+3042 → 0xE3 0x81 0x82).
    expect(Array.from(keyEventToBytes(makeEvent({ key: "あ" })) as Uint8Array)).toEqual([
      0xe3, 0x81, 0x82,
    ]);
  });
});

describe("textToBytes", () => {
  it("encodes ASCII strings", () => {
    expect(Array.from(textToBytes("hi"))).toEqual([0x68, 0x69]);
  });
  it("encodes empty string", () => {
    expect(Array.from(textToBytes(""))).toEqual([]);
  });
  it("encodes unicode strings as UTF-8", () => {
    expect(Array.from(textToBytes("テスト"))).toEqual([
      0xe3, 0x83, 0x86, 0xe3, 0x82, 0xb9, 0xe3, 0x83, 0x88,
    ]);
  });
});
