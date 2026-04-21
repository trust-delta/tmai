import { AnsiUp } from "ansi_up";
import { describe, expect, it } from "vitest";
import { capHistoryLines, splitPreviewContent, trimPreviewContent } from "../preview-content";

// Regression coverage for #413: the preview panel used to re-render the
// entire capture-pane blob (history + live) on every poll tick, which made
// keystrokes lag in long sessions. The backend now returns `live_start_line`
// so the client can split the payload; the tests below verify the split is
// correct and that re-rendering the live region stays cheap even when
// history is >1MB.

describe("splitPreviewContent", () => {
  it("returns empty history when liveStartLine is 0", () => {
    const content = "line A\nline B\nline C";
    const { history, live } = splitPreviewContent(content, 0);
    expect(history).toBe("");
    expect(live).toBe(content);
  });

  it("splits at the Nth newline (exclusive boundary)", () => {
    // Lines: 0="a", 1="b", 2="c", 3="d"
    const content = "a\nb\nc\nd";
    const { history, live } = splitPreviewContent(content, 2);
    // liveStartLine=2 → history is lines [0,2) = "a\nb", live is lines [2,...) = "c\nd"
    expect(history).toBe("a\nb");
    expect(live).toBe("c\nd");
  });

  it("keeps trailing newline between history and live out of both halves", () => {
    // The '\n' that terminates the last history line is dropped from live;
    // it stays on the history side so rejoining with '\n' reconstructs the
    // original exactly.
    const content = "a\nb\nc\n";
    const { history, live } = splitPreviewContent(content, 1);
    expect(history).toBe("a");
    expect(live).toBe("b\nc\n");
    expect(`${history}\n${live}`).toBe(content);
  });

  it("treats whole content as live when liveStartLine exceeds newlines", () => {
    const content = "a\nb";
    const { history, live } = splitPreviewContent(content, 10);
    expect(history).toBe("");
    expect(live).toBe(content);
  });

  it("handles empty content", () => {
    const { history, live } = splitPreviewContent("", 5);
    expect(history).toBe("");
    expect(live).toBe("");
  });
});

describe("preview render cost scaling with scrollback size (#413)", () => {
  // Build a fixture that looks like a real long session: ~1MB of history
  // followed by a small visible region. Each tick appends a single char to
  // the live region (simulating a keystroke echoing back from tmux) and we
  // verify that the expensive ANSI-to-HTML pass on history is avoided.
  function makeHistoryBlob(sizeBytes: number): string {
    // Mix of plain text and ANSI color escapes so AnsiUp has real work to do.
    const segment = "\x1b[32mhello\x1b[0m world Lorem ipsum dolor sit amet\n";
    const reps = Math.ceil(sizeBytes / segment.length);
    return segment.repeat(reps);
  }

  it("history string identity is preserved across ticks that only change live", () => {
    const history = makeHistoryBlob(1_200_000); // ~1.2 MB
    const liveStartLine = history.split("\n").length - 1; // line count of history

    // Tick 1: initial content
    const live1 = "prompt> a";
    const content1 = `${history}${live1}`;
    const split1 = splitPreviewContent(content1, liveStartLine);

    // Tick 2: one additional keystroke echoed into the live region
    const live2 = "prompt> ab";
    const content2 = `${history}${live2}`;
    const split2 = splitPreviewContent(content2, liveStartLine);

    // History substrings are byte-identical across ticks. `===` on strings
    // compares by value — React's useMemo with `history` in deps will bail,
    // so AnsiUp + DOMPurify on history does NOT run again.
    expect(split1.history).toBe(split2.history);
    expect(split1.history.length).toBeGreaterThan(1_000_000);

    // Live differs, as expected
    expect(split1.live).not.toBe(split2.live);
  });

  it("rendering live stays fast regardless of history size", () => {
    const ansi = new AnsiUp();
    ansi.use_classes = true;

    // Large history (simulating a very long session)
    const history = makeHistoryBlob(1_200_000);
    const liveStartLine = history.split("\n").length - 1;
    const live = "prompt> abcdef";
    const content = `${history}${live}`;

    const { live: liveOnly } = splitPreviewContent(content, liveStartLine);

    // The live-only render path is what runs on every keystroke. Time it and
    // compare to rendering the full content: the full render dwarfs live.
    const liveStart = performance.now();
    for (let i = 0; i < 10; i++) {
      ansi.ansi_to_html(trimPreviewContent(liveOnly, 120));
    }
    const liveElapsed = performance.now() - liveStart;

    const fullStart = performance.now();
    for (let i = 0; i < 10; i++) {
      ansi.ansi_to_html(trimPreviewContent(content, 120));
    }
    const fullElapsed = performance.now() - fullStart;

    // The fix only pays off when full render is meaningfully slower than
    // live. Assert at least 10x — in practice it's closer to 100-1000x on
    // a 1MB blob, but CI can be noisy.
    expect(fullElapsed).toBeGreaterThan(liveElapsed * 10);
  });

  it("capHistoryLines: returns content unchanged when under cap", () => {
    const raw = "a\nb\nc";
    const { content, dropped } = capHistoryLines(raw, 10);
    expect(content).toBe(raw);
    expect(dropped).toBe(0);
  });

  it("capHistoryLines: empty input returns empty", () => {
    const { content, dropped } = capHistoryLines("", 100);
    expect(content).toBe("");
    expect(dropped).toBe(0);
  });

  it("capHistoryLines: keeps the last N lines exactly when over cap", () => {
    // 5 lines, cap to 2 → keep last 2 lines, drop 3
    const raw = "l1\nl2\nl3\nl4\nl5";
    const { content, dropped } = capHistoryLines(raw, 2);
    expect(content).toBe("l4\nl5");
    expect(dropped).toBe(3);
  });

  it("capHistoryLines: boundary — exactly N lines returns unchanged", () => {
    const raw = "l1\nl2\nl3";
    const { content, dropped } = capHistoryLines(raw, 3);
    expect(content).toBe(raw);
    expect(dropped).toBe(0);
  });

  it("capHistoryLines: trailing newline counts as a terminal on the last line", () => {
    // "l1\nl2\n" has 2 newlines → lineCount = 3 (l1, l2, empty trailer)
    const raw = "l1\nl2\n";
    const { content, dropped } = capHistoryLines(raw, 2);
    // With cap=2, drop 1 from the front (l1), keep "l2\n"
    expect(content).toBe("l2\n");
    expect(dropped).toBe(1);
  });

  it("capHistoryLines: non-positive cap is a passthrough (defensive)", () => {
    const raw = "l1\nl2\nl3";
    expect(capHistoryLines(raw, 0)).toEqual({ content: raw, dropped: 0 });
    expect(capHistoryLines(raw, -5)).toEqual({ content: raw, dropped: 0 });
  });

  it("capHistoryLines: handles a very large scrollback bounded by cap", () => {
    const lines = [] as string[];
    for (let i = 0; i < 25_000; i++) lines.push(`line-${i}`);
    const raw = lines.join("\n");
    const { content, dropped } = capHistoryLines(raw, 2000);
    expect(dropped).toBe(23_000);
    // First surviving line should be line-23000, last should be line-24999.
    expect(content.startsWith("line-23000\n")).toBe(true);
    expect(content.endsWith("line-24999")).toBe(true);
  });

  it("live size does not grow with history size", () => {
    // Two sessions, same live region, wildly different history sizes.
    const smallHistory = makeHistoryBlob(10_000);
    const largeHistory = makeHistoryBlob(2_000_000);
    const liveText = "prompt> x";

    const smallLive = splitPreviewContent(
      `${smallHistory}${liveText}`,
      smallHistory.split("\n").length - 1,
    ).live;
    const largeLive = splitPreviewContent(
      `${largeHistory}${liveText}`,
      largeHistory.split("\n").length - 1,
    ).live;

    // Live region is identical — history size doesn't leak into it.
    expect(smallLive).toBe(largeLive);
  });
});
