// Browser KeyboardEvent → raw bytes for the rev3 terminal-plane keys
// WebSocket (#174 Phase 3b-1).
//
// Mirrors `tmai_core::utils::keys::tmux_key_to_bytes` semantics without
// the tmux key-name as an intermediate. The legacy `passthrough` HTTP
// endpoint accepts tmux names (`"Enter"` / `"C-c"` / `"BTab"` …) and
// converts on the server; the new keys WS is byte-only, so the
// conversion has to happen in the browser. Keeping the byte sequences
// identical to the Rust reference is essential — agents see exactly
// what they would have seen via the tmux `send-keys` path.
//
// References: `crates/tmai-core/src/utils/keys.rs` (in tmai-core).

const ENC = new TextEncoder();

// Special-key sequences that match `tmux_key_to_bytes` exactly.
const SPECIAL_KEY_BYTES: Record<string, Uint8Array> = {
  Enter: new Uint8Array([0x0d]), // \r
  Escape: new Uint8Array([0x1b]),
  Backspace: new Uint8Array([0x7f]),
  Tab: new Uint8Array([0x09]),
  ArrowUp: new Uint8Array([0x1b, 0x5b, 0x41]), // CSI A
  ArrowDown: new Uint8Array([0x1b, 0x5b, 0x42]), // CSI B
  ArrowRight: new Uint8Array([0x1b, 0x5b, 0x43]), // CSI C
  ArrowLeft: new Uint8Array([0x1b, 0x5b, 0x44]), // CSI D
  Home: new Uint8Array([0x1b, 0x5b, 0x48]), // CSI H
  End: new Uint8Array([0x1b, 0x5b, 0x46]), // CSI F
  PageUp: new Uint8Array([0x1b, 0x5b, 0x35, 0x7e]), // CSI 5 ~
  PageDown: new Uint8Array([0x1b, 0x5b, 0x36, 0x7e]), // CSI 6 ~
  Delete: new Uint8Array([0x1b, 0x5b, 0x33, 0x7e]), // CSI 3 ~
  " ": new Uint8Array([0x20]),
};

// Shift+Tab (BTab). Returned only when both the key is "Tab" and shift
// is held; otherwise SPECIAL_KEY_BYTES.Tab applies.
const SHIFT_TAB = new Uint8Array([0x1b, 0x5b, 0x5a]); // CSI Z

/**
 * Convert a `KeyboardEvent` into the byte sequence the agent's PTY
 * expects. Returns `null` for keys that have no representation (e.g.
 * F-keys or modifier-only events) so the caller can decide whether to
 * fall back to `event.key` or drop the event.
 *
 * Equivalent path-by-path to `tmux_key_to_bytes` for every input that
 * the existing `toTmuxKey()` mapping in `PreviewPanel` produces:
 *
 * | KeyboardEvent          | toTmuxKey output | tmux_key_to_bytes | this fn  |
 * | ---------------------- | ---------------- | ----------------- | -------- |
 * | "c" + ctrl             | "C-c"            | 0x03              | 0x03     |
 * | "C" + ctrl (caps)      | "C-c"            | 0x03              | 0x03     |
 * | "Enter"                | "Enter"          | 0x0d              | 0x0d     |
 * | "Enter" + ctrl         | "C-m"            | 0x0d              | 0x0d     |
 * | "Tab"                  | "Tab"            | 0x09              | 0x09     |
 * | "Tab" + shift          | "BTab"           | ESC [ Z           | ESC [ Z  |
 * | "ArrowUp"              | "Up"             | ESC [ A           | ESC [ A  |
 * | "@" + ctrl (US layout) | "C-@"            | 0x00              | 0x00     |
 * | "y" (no modifier)      | (chars: "y")     | (chars path)      | 0x79     |
 */
export function keyEventToBytes(e: KeyboardEvent): Uint8Array | null {
  // Ctrl+single-char → bitmask to control codes (matches the Rust
  // `s.as_bytes()[2] & 0x1f` branch, but with browser-side normalization
  // to lowercase — the Rust impl accepts both cases identically because
  // the masked bit is the same).
  if (e.ctrlKey && e.key.length === 1) {
    const ch = e.key.toLowerCase().charCodeAt(0);
    return new Uint8Array([ch & 0x1f]);
  }

  // Shift+Tab → BTab. Plain Tab falls through to SPECIAL_KEY_BYTES.
  if (e.key === "Tab" && e.shiftKey) return SHIFT_TAB;

  const sp = SPECIAL_KEY_BYTES[e.key];
  if (sp) return sp;

  // Any other single-character key: encode as UTF-8 (covers letters,
  // digits, punctuation, multi-byte glyphs typed without IME).
  if (e.key.length === 1) {
    return ENC.encode(e.key);
  }

  // Modifier-only events ("Shift", "Control"…), F-keys, "Insert", and
  // anything else outside the tmux mapping fall through to `null` so
  // the caller can decide.
  return null;
}

/**
 * Encode a literal string (e.g. IME-confirmed text or a paste payload)
 * as UTF-8 bytes for direct send through the keys WebSocket. Equivalent
 * to the legacy `passthrough({ chars })` path.
 */
export function textToBytes(text: string): Uint8Array {
  return ENC.encode(text);
}
