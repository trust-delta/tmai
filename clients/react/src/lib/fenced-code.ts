// Fenced-code-block extraction from an xterm.js buffer (#819).
//
// WHY this exists — relay fidelity on a privileged channel: when the
// Producer hands the operator a command to run, copying it off the rendered
// PTY grid picks up newlines injected at soft-wrap columns. A newline is a
// shell statement separator, so the operator can end up executing a command
// DIFFERENT from what the Producer authored (fired live 2026-06-12: a
// wrapped paste dropped `--input` from a `gh api` call and bash executed a
// JSON file line-by-line).
//
// CHOSEN EXTRACTION (investigated per the issue): the PTY plane delivers raw
// ANSI bytes; the client-side substrate is xterm's buffer, which only offers
// WRAPPED GRID ROWS — there is no logical-line stream to read from. xterm
// does, however, mark every row that is a soft-wrap continuation of the row
// above with `IBufferLine.isWrapped`, so logical lines are reconstructed
// here by concatenating each row with its continuation rows WITHOUT a line
// break. Hard newlines (real `\n` in the source) start a non-wrapped row and
// survive as logical line boundaries. `\r` never reaches the buffer text
// (the parser consumes CR as cursor motion), and is additionally stripped
// below as a belt-and-braces guarantee.
//
// KNOWN SUBSTRATE LIMIT: trailing whitespace at the END of a logical line is
// indistinguishable from the buffer's cell padding and is trimmed. Interior
// whitespace — including spaces that happen to sit at a wrap column — is
// preserved exactly (continuation-feeding rows are taken at full width,
// untrimmed).

/** Structural subset of xterm's `IBufferCell` (keeps tests xterm-free). */
export interface CellLike {
  getWidth(): number;
  getChars(): string;
}

/** Structural subset of xterm's `IBufferLine`. */
export interface BufferLineLike {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
  getCell(x: number): CellLike | undefined;
}

/** Structural subset of xterm's `IBuffer`. */
export interface BufferLike {
  readonly length: number;
  getLine(y: number): BufferLineLike | undefined;
}

export interface FencedBlock {
  /** Logical source of the block body — soft-wrap joins applied, no `\r`,
   *  lines joined with `\n`, the rendering indent of the fence stripped. */
  source: string;
  /** Info string of the opening fence (e.g. `bash`), trimmed. */
  info: string;
  /** Buffer row index of the opening fence (scan-time; rows shift as the
   *  scrollback trims, so use only as a per-scan identity/ordering key). */
  openLine: number;
}

/**
 * Re-join soft-wrapped grid rows into logical lines.
 *
 * A row whose SUCCESSOR has `isWrapped` feeds a continuation, so it is taken
 * at full width WITHOUT right-trimming — trimming there would eat genuine
 * spaces that landed exactly at the wrap column. Only the final row of each
 * logical line is right-trimmed (its trailing cells are empty-cell padding).
 *
 * Wide-glyph edge (mirrors xterm's own selection logic,
 * `SelectionService._getWrappedLineTrimmedLength`): when a CJK/wide glyph
 * does not fit in the last column, xterm wraps it early and leaves a null
 * cell at the row end; reading that cell as a space would inject a phantom
 * space into the joined line, so it is excluded when the continuation row
 * starts with a width-2 cell.
 */
export function extractLogicalLines(buffer: BufferLike, cols: number): string[] {
  const out: string[] = [];
  let current: string | null = null;

  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const next = buffer.getLine(y + 1);
    const feedsContinuation = next?.isWrapped === true;

    let text: string;
    if (feedsContinuation) {
      let end = cols;
      const lastCell = line.getCell(cols - 1);
      if (lastCell?.getChars() === "" && next?.getCell(0)?.getWidth() === 2) {
        end = cols - 1;
      }
      text = line.translateToString(false, 0, end);
    } else {
      text = line.translateToString(true);
    }

    if (line.isWrapped && current !== null) {
      current += text;
    } else {
      if (current !== null) out.push(current);
      current = text;
    }
  }
  if (current !== null) out.push(current);
  return out;
}

// Opening fence: optional rendering indent (the conversation TUI draws
// assistant content behind a gutter), a run of >=3 backticks, then an info
// string that may not contain a backtick (CommonMark rule for ` fences).
const OPENING_FENCE = /^([ \t]*)(`{3,})([^`]*)$/;

/**
 * Find CLOSED fenced code blocks among logical lines.
 *
 * Unterminated fences are deliberately NOT reported: while the agent is
 * still streaming a block, exposing a copy of its half-arrived body would be
 * its own fidelity hazard — the block becomes copyable once its closing
 * fence lands.
 *
 * The opening fence's indent is stripped from body lines (it is rendering
 * gutter, not source); lines indented deeper keep the excess.
 */
export function findFencedBlocks(lines: string[]): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = OPENING_FENCE.exec(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    const [, indent, fence, rawInfo] = open;

    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (trimmed.length >= fence.length && /^`+$/.test(trimmed)) {
        close = j;
        break;
      }
    }
    if (close === -1) {
      i++;
      continue;
    }

    const body = lines.slice(i + 1, close).map((l) => stripGutter(l, indent.length));
    blocks.push({
      // \r cannot occur in buffer text (see header comment) — strip anyway
      // so the no-CR guarantee holds independent of the substrate.
      source: body.join("\n").replace(/\r/g, ""),
      info: rawInfo.trim(),
      openLine: i,
    });
    i = close + 1;
  }
  return blocks;
}

/** Strip up to `width` leading whitespace chars (never into non-whitespace). */
function stripGutter(line: string, width: number): string {
  let k = 0;
  while (k < width && k < line.length && (line[k] === " " || line[k] === "\t")) k++;
  return line.slice(k);
}

/** One-shot scan: buffer grid → logical lines → closed fenced blocks. */
export function extractFencedBlocks(buffer: BufferLike, cols: number): FencedBlock[] {
  return findFencedBlocks(extractLogicalLines(buffer, cols));
}
