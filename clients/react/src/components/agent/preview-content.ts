// Pure helpers for splitting /api/preview content into the immutable
// scrollback history and the live capture-pane region, and for shrinking
// long Box Drawing horizontal runs to fit within the container width.
//
// Keeping these pure (no React, no DOM) lets PreviewPanel memoize the
// history render so that 1MB+ scrollback is not re-parsed on every poll
// tick — the dominant input-lag cost in long sessions (#413).

// Terminal column width of a character (full-width CJK = 2, others = 1).
// Matches wcwidth behavior for common Unicode ranges.
export function charColumns(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33bf) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

// Consecutive Box Drawing horizontal characters (U+2500–U+257F runs of 4+)
const HLINE_RUN_RE = /[\u2500-\u257f]{4,}/g;

// ANSI escape patterns (constructed via RegExp to avoid control-char lint)
const ESC = "\x1b";
const CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const OSC_RE = new RegExp(`${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`, "g");

// Shrink Box Drawing horizontal runs so the line fits within `cols` columns.
function shrinkHorizontalRuns(visible: string, cols: number): string {
  if (visible.length <= cols) return visible;

  const excess = visible.length - cols;
  const runs: { index: number; length: number }[] = [];
  HLINE_RUN_RE.lastIndex = 0;
  for (const m of visible.matchAll(HLINE_RUN_RE)) {
    if (m.index != null) runs.push({ index: m.index, length: m[0].length });
  }
  if (runs.length === 0) return visible;

  const totalRunChars = runs.reduce((s, r) => s + r.length, 0);
  if (totalRunChars <= excess) return visible.slice(0, cols);

  const newLengths = runs.map((r) => {
    const shrink = Math.ceil((r.length / totalRunChars) * excess);
    return Math.max(1, r.length - shrink);
  });

  let result = "";
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    result += visible.slice(pos, run.index);
    result += visible.slice(run.index, run.index + newLengths[i]);
    pos = run.index + run.length;
  }
  result += visible.slice(pos);
  return result;
}

// Shrink Box Drawing horizontal runs in each line to fit `cols` columns.
// Preserves ANSI escape sequences and does NOT strip trailing blank lines —
// use this for history where trailing blanks may be real content at the
// history/live boundary.
export function shrinkContentToWidth(raw: string, cols: number): string {
  if (cols <= 0) return raw;
  return raw.replace(/^.*$/gm, (line) => {
    const visible = line.replace(CSI_RE, "").replace(OSC_RE, "");
    if (visible.length <= cols) return line;
    if (!HLINE_RUN_RE.test(visible)) return line;
    HLINE_RUN_RE.lastIndex = 0;

    const shrunk = shrinkHorizontalRuns(visible, cols);
    const leadAnsi = line.match(new RegExp(`^(${ESC}\\[[0-9;?]*[ -/]*[@-~])*`))?.[0] ?? "";
    const trailAnsi = line.match(new RegExp(`(${ESC}\\[[0-9;?]*[ -/]*[@-~])*$`))?.[0] ?? "";
    return leadAnsi + shrunk + trailAnsi;
  });
}

// Trim trailing blank lines and shrink Box Drawing runs to fit width.
// Use this for the live region where trailing blanks are cosmetic.
export function trimPreviewContent(raw: string, cols: number): string {
  const trimmed = raw.replace(/(\s*\n)*\s*$/, "");
  return shrinkContentToWidth(trimmed, cols);
}

// Cap `raw` to its last `maxLines` lines. Returns the capped content and
// the number of lines that were dropped from the front.
//
// Long-running agents can accumulate tens of thousands of scrollback lines.
// Feeding all of that through AnsiUp → DOMPurify → innerHTML on the first
// mount (or on any re-render that changes the `history` string) freezes
// the browser for multiple seconds. The cap bounds the per-render cost
// while preserving the part of scrollback operators actually look at —
// the tail, closest to the live region.
export function capHistoryLines(
  raw: string,
  maxLines: number,
): { content: string; dropped: number } {
  if (!raw || maxLines <= 0) return { content: raw, dropped: 0 };
  // Fast path: count newlines before doing the split to avoid an O(N)
  // array allocation when the cap wouldn't apply anyway.
  let newlines = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) === 10 /* \n */) newlines++;
  }
  const lineCount = newlines + 1; // N newlines → up to N+1 lines
  if (lineCount <= maxLines) return { content: raw, dropped: 0 };

  // Slow path: slice to the tail by finding the (lineCount - maxLines)-th
  // newline and keeping everything after it.
  const toDrop = lineCount - maxLines;
  let seen = 0;
  let cutAt = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) === 10) {
      seen++;
      if (seen === toDrop) {
        cutAt = i + 1;
        break;
      }
    }
  }
  return { content: raw.slice(cutAt), dropped: toDrop };
}

// Split content into (history, live) at the given line boundary.
// `liveStartLine` is a 0-based line index; lines [0, liveStartLine) become
// history and lines [liveStartLine, ...) become live. A trailing newline
// separator between the two regions is dropped so re-joining them does not
// introduce an extra blank row.
//
// When liveStartLine is 0 (or negative), the whole content is treated as
// live — this is the fallback path when the backend cannot provide pane
// dimensions (e.g. standalone runtime, last_content cache).
export function splitPreviewContent(
  content: string,
  liveStartLine: number,
): { history: string; live: string } {
  if (!content || liveStartLine <= 0) {
    return { history: "", live: content };
  }
  // Find the index of the Nth '\n' (0-indexed: Nth newline ends line N-1, so
  // the character after it is the start of line N).
  let pos = -1;
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      count++;
      if (count === liveStartLine) {
        pos = i;
        break;
      }
    }
  }
  if (pos < 0) {
    // Fewer than `liveStartLine` newlines — the split would put all content
    // in history, leaving live empty. Treat the whole thing as live instead
    // so the cursor overlay still has a target.
    return { history: "", live: content };
  }
  // Slice so the '\n' that terminates the last history line stays on the
  // history side and live begins at the first character of line `liveStartLine`.
  const history = content.slice(0, pos);
  const live = content.slice(pos + 1);
  return { history, live };
}
