// Fidelity contract of the fenced-code extraction (#819): the copied
// string must be byte-exact w.r.t. the logical source — soft-wrap line
// breaks introduced by the terminal grid must NOT appear, and no `\r`.

import { describe, expect, it } from "vitest";
import { extractFencedBlocks, extractLogicalLines, findFencedBlocks } from "@/lib/fenced-code";
import { makeBuffer } from "@/test/fake-xterm";

const WIDE = (ch: string) => /[　-鿿]/.test(ch);

describe("extractLogicalLines — soft-wrap re-join", () => {
  it("re-joins a line wrapped across several grid rows without injecting newlines", () => {
    const long = "gh api repos/o/r/branches/main/protection --method PUT --input protection.json";
    const buf = makeBuffer([long], 20);
    // sanity: the fake actually wrapped (the scenario under test)
    expect(buf.length).toBeGreaterThan(1);
    expect(extractLogicalLines(buf, 20)).toEqual([long]);
  });

  it("preserves spaces that land exactly at the wrap column", () => {
    const line = "aaaaaaaa  bbbbbbbb"; // double space spans the col-10 boundary
    expect(extractLogicalLines(makeBuffer([line], 10), 10)).toEqual([line]);
  });

  it("does not inject a phantom space when a wide glyph wraps early", () => {
    // cols=3: "ab" + null pad (漢 doesn't fit the last column) | "漢" row
    expect(extractLogicalLines(makeBuffer(["ab漢"], 3, WIDE), 3)).toEqual(["ab漢"]);
  });

  it("keeps hard newlines as logical line boundaries", () => {
    expect(extractLogicalLines(makeBuffer(["one", "two"], 80), 80)).toEqual(["one", "two"]);
  });
});

describe("findFencedBlocks — fence detection", () => {
  it("captures the body and info string of a closed block", () => {
    const blocks = findFencedBlocks(["before", "```bash", "echo hi", "echo yo", "```", "after"]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("echo hi\necho yo");
    expect(blocks[0].info).toBe("bash");
  });

  it("reports nothing on non-fenced text", () => {
    expect(findFencedBlocks(["plain text", "more `inline` code", "$ a prompt"])).toEqual([]);
  });

  it("does not report an unterminated (still-streaming) fence", () => {
    expect(findFencedBlocks(["```bash", "half-arrived command"])).toEqual([]);
  });

  it("strips the rendering gutter (fence indent) but keeps deeper indentation", () => {
    const blocks = findFencedBlocks(["  ```", "  echo hi", "    indented", "  ```"]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("echo hi\n  indented");
  });

  it("returns blocks in scrollback order", () => {
    const blocks = findFencedBlocks(["```", "first", "```", "```", "second", "```"]);
    expect(blocks.map((b) => b.source)).toEqual(["first", "second"]);
  });
});

describe("extractFencedBlocks — end-to-end fidelity", () => {
  it("a multi-line block whose rendering wraps copies the exact source", () => {
    const cmd =
      "gh api repos/owner/repo/branches/main/protection --method PUT --input protection.json";
    const second = "git push origin main";
    const buf = makeBuffer(["⏺ Run this:", "```bash", cmd, second, "```"], 24);
    const blocks = extractFencedBlocks(buf, 24);
    expect(blocks).toHaveLength(1);
    // byte-exact: no newline at any wrap column, both hard lines intact
    expect(blocks[0].source).toBe(`${cmd}\n${second}`);
  });

  it("never contains \\r, even if the substrate were to surface one", () => {
    const buf = makeBuffer(["```", "foo\rbar", "```"], 80);
    const [block] = extractFencedBlocks(buf, 80);
    expect(block.source).not.toMatch(/\r/);
    expect(block.source).toBe("foobar");
  });

  it("finds no blocks in a buffer of plain conversation", () => {
    const buf = makeBuffer(["⏺ I looked at the file and it seems fine.", "Next step?"], 30);
    expect(extractFencedBlocks(buf, 30)).toEqual([]);
  });
});
