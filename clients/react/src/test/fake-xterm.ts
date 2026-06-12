// Test-only fake of the xterm buffer surface consumed by
// `lib/fenced-code.ts` (#819). Simulates xterm's soft-wrap layout: a
// logical line longer than `cols` is split into grid rows, every row after
// the first carries `isWrapped`, and rows are padded to full width with
// null cells (chars "", width 1) exactly like the real buffer — so the
// extraction's trim/no-trim decisions are exercised for real.

import type { BufferLike, BufferLineLike, CellLike } from "@/lib/fenced-code";

export interface FakeCell {
  chars: string;
  width: number;
}

const NULL_CELL: FakeCell = { chars: "", width: 1 };

/** Char → cells, marking chars in `wide` as width-2 (followed by the
 *  width-0 spacer cell real xterm stores after a wide glyph). */
export function cellsOf(text: string, wide: (ch: string) => boolean = () => false): FakeCell[] {
  const cells: FakeCell[] = [];
  for (const ch of text) {
    if (wide(ch)) {
      cells.push({ chars: ch, width: 2 }, { chars: "", width: 0 });
    } else {
      cells.push({ chars: ch, width: 1 });
    }
  }
  return cells;
}

export class FakeBufferLine implements BufferLineLike {
  constructor(
    private cells: FakeCell[],
    public readonly isWrapped: boolean,
  ) {}

  translateToString(trimRight = false, startColumn = 0, endColumn = this.cells.length): string {
    let s = "";
    for (let x = startColumn; x < Math.min(endColumn, this.cells.length); x++) {
      const c = this.cells[x];
      if (c.width === 0) continue; // spacer after a wide glyph
      s += c.chars === "" ? " " : c.chars;
    }
    return trimRight ? s.replace(/\s+$/, "") : s;
  }

  getCell(x: number): CellLike | undefined {
    const c = this.cells[x];
    if (!c) return undefined;
    return { getWidth: () => c.width, getChars: () => c.chars };
  }
}

/** Soft-wrap one logical line into grid rows of `cols` cells (xterm
 *  semantics: a wide glyph that doesn't fit the last column wraps early,
 *  leaving a null cell at the row end). */
export function wrapLine(cells: FakeCell[], cols: number): FakeBufferLine[] {
  const rows: FakeCell[][] = [];
  let row: FakeCell[] = [];
  let i = 0;
  while (i < cells.length) {
    const c = cells[i];
    if (c.width === 2 && row.length === cols - 1) {
      row.push({ ...NULL_CELL });
      rows.push(row);
      row = [];
      continue;
    }
    row.push(c);
    i++;
    if (row.length === cols) {
      rows.push(row);
      row = [];
    }
  }
  // A logical line that fills rows exactly still has a (possibly empty)
  // final row only when content remains; an empty trailing row would change
  // wrap flags, so only emit `row` if it has cells OR nothing was emitted.
  if (row.length > 0 || rows.length === 0) {
    while (row.length < cols) row.push({ ...NULL_CELL });
    rows.push(row);
  }
  return rows.map((r, idx) => new FakeBufferLine(r, idx > 0));
}

export class FakeBuffer implements BufferLike {
  constructor(private lines: FakeBufferLine[]) {}
  get length(): number {
    return this.lines.length;
  }
  getLine(y: number): BufferLineLike | undefined {
    return this.lines[y];
  }
}

/** Build a buffer from logical lines, soft-wrapping each at `cols`. */
export function makeBuffer(
  logicalLines: string[],
  cols: number,
  wide: (ch: string) => boolean = () => false,
): FakeBuffer {
  return new FakeBuffer(logicalLines.flatMap((l) => wrapLine(cellsOf(l, wide), cols)));
}
