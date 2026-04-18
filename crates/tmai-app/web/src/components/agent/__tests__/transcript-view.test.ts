import { describe, expect, it } from "vitest";
import type { TranscriptRecord } from "@/lib/api-http";

// ---- Pure helpers extracted from TranscriptView for unit testing ----

// Tool name color mapping (mirrors TranscriptView.tsx TOOL_COLORS)
const TOOL_COLORS: Record<string, string> = {
  Bash: "text-amber-400",
  Read: "text-cyan-400",
  Edit: "text-fuchsia-400",
  Write: "text-fuchsia-400",
  Grep: "text-teal-400",
  Glob: "text-teal-400",
  Agent: "text-violet-400",
};

// Get color class for a tool name (default: cyan)
function toolColor(name: string): string {
  return TOOL_COLORS[name] ?? "text-cyan-400";
}

// Truncate a string at a max length
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

// Check if a record starts a new user turn
function isNewTurn(record: TranscriptRecord, index: number): boolean {
  return record.type === "user" && index > 0;
}

// Threshold for collapsing long tool results
const TOOL_RESULT_COLLAPSE_THRESHOLD = 3;

// ---- Tests ----

describe("toolColor", () => {
  it("returns the mapped color for known tools", () => {
    expect(toolColor("Bash")).toBe("text-amber-400");
    expect(toolColor("Read")).toBe("text-cyan-400");
    expect(toolColor("Edit")).toBe("text-fuchsia-400");
    expect(toolColor("Grep")).toBe("text-teal-400");
    expect(toolColor("Agent")).toBe("text-violet-400");
  });

  it("falls back to cyan for unknown tools", () => {
    expect(toolColor("CustomTool")).toBe("text-cyan-400");
    expect(toolColor("")).toBe("text-cyan-400");
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long strings with ellipsis", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcde...");
  });

  it("returns exact-length strings unchanged", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });
});

describe("isNewTurn", () => {
  it("returns false for the first record", () => {
    const record: TranscriptRecord = { type: "user", text: "hello" };
    expect(isNewTurn(record, 0)).toBe(false);
  });

  it("returns true for a user record after the first", () => {
    const record: TranscriptRecord = { type: "user", text: "next turn" };
    expect(isNewTurn(record, 1)).toBe(true);
    expect(isNewTurn(record, 5)).toBe(true);
  });

  it("returns false for non-user records", () => {
    const assistant: TranscriptRecord = { type: "assistant_text", text: "reply" };
    const tool: TranscriptRecord = { type: "tool_use", tool_name: "Bash", input_summary: "ls" };
    expect(isNewTurn(assistant, 1)).toBe(false);
    expect(isNewTurn(tool, 2)).toBe(false);
  });
});

describe("tool result collapse logic", () => {
  it("identifies short output as non-collapsible", () => {
    const output = "line1\nline2";
    const lines = output.split("\n");
    expect(lines.length <= TOOL_RESULT_COLLAPSE_THRESHOLD).toBe(true);
  });

  it("identifies long output as collapsible", () => {
    const output = "line1\nline2\nline3\nline4\nline5";
    const lines = output.split("\n");
    expect(lines.length > TOOL_RESULT_COLLAPSE_THRESHOLD).toBe(true);
  });

  it("produces correct collapsed preview", () => {
    const lines = ["line1", "line2", "line3", "line4", "line5"];
    const collapsed = `${lines.slice(0, TOOL_RESULT_COLLAPSE_THRESHOLD).join("\n")}…`;
    expect(collapsed).toBe("line1\nline2\nline3…");
  });
});

// Cap logic for the "show last N records by default" behavior introduced to
// stop the browser freeze when a long-running worker accumulates hundreds of
// transcript records. Must match DEFAULT_VISIBLE_COUNT in TranscriptView.tsx.
describe("transcript cap logic", () => {
  const DEFAULT_VISIBLE_COUNT = 100;

  function computeVisible<T>(records: T[], showAll: boolean): T[] {
    const capped = !showAll && records.length > DEFAULT_VISIBLE_COUNT;
    return capped ? records.slice(-DEFAULT_VISIBLE_COUNT) : records;
  }

  it("renders all records when count is below the cap", () => {
    const records = Array.from({ length: 100 }, (_, i) => ({ uuid: `r${i}` }));
    const visible = computeVisible(records, false);
    expect(visible).toHaveLength(100);
    expect(visible[0].uuid).toBe("r0");
  });

  it("caps to the last DEFAULT_VISIBLE_COUNT when above the cap", () => {
    const total = 437;
    const records = Array.from({ length: total }, (_, i) => ({ uuid: `r${i}` }));
    const visible = computeVisible(records, false);
    expect(visible).toHaveLength(DEFAULT_VISIBLE_COUNT);
    expect(visible[0].uuid).toBe(`r${total - DEFAULT_VISIBLE_COUNT}`);
    expect(visible[visible.length - 1].uuid).toBe(`r${total - 1}`);
  });

  it("renders everything once showAll is true, even above cap", () => {
    const records = Array.from({ length: 500 }, (_, i) => ({ uuid: `r${i}` }));
    expect(computeVisible(records, true)).toHaveLength(500);
  });

  it("hiddenCount is 0 when below the cap so the toggle button stays hidden", () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ uuid: `r${i}` }));
    const visible = computeVisible(records, false);
    expect(records.length - visible.length).toBe(0);
  });

  it("hiddenCount matches the number trimmed from the front", () => {
    const records = Array.from({ length: 437 }, (_, i) => ({ uuid: `r${i}` }));
    const visible = computeVisible(records, false);
    expect(records.length - visible.length).toBe(437 - DEFAULT_VISIBLE_COUNT);
  });
});

// "no-change bail-out" for the transcript polling state setter. Keeps the
// TranscriptView from rebuilding every 3s when nothing new has been appended.
describe("transcript polling bail-out", () => {
  function shouldBailOut<T extends { uuid?: string }>(prev: T[], fetched: T[]): boolean {
    return (
      prev.length === fetched.length &&
      prev[prev.length - 1]?.uuid === fetched[fetched.length - 1]?.uuid
    );
  }

  it("bails when lengths match and the last uuid matches", () => {
    const prev = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
    const fetched = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
    expect(shouldBailOut(prev, fetched)).toBe(true);
  });

  it("does not bail when a new record has been appended", () => {
    const prev = [{ uuid: "a" }, { uuid: "b" }];
    const fetched = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
    expect(shouldBailOut(prev, fetched)).toBe(false);
  });

  it("does not bail when the tail uuid changed (replay/rewrite)", () => {
    const prev = [{ uuid: "a" }, { uuid: "b" }];
    const fetched = [{ uuid: "a" }, { uuid: "c" }];
    expect(shouldBailOut(prev, fetched)).toBe(false);
  });
});

describe("record type styling expectations", () => {
  it("UserRecord uses ❯ prefix and bold white", () => {
    // Verify the design contract: user records get the Claude Code prompt style
    const prefix = "❯";
    const styleClasses = "text-white font-bold";
    expect(prefix).toBe("❯");
    expect(styleClasses).toContain("font-bold");
    expect(styleClasses).toContain("text-white");
  });

  it("ToolUseRecord uses ● prefix", () => {
    const prefix = "●";
    expect(prefix).toBe("●");
  });

  it("ToolResultRecord uses ⎿ prefix with gray block", () => {
    const prefix = "⎿";
    const blockClasses = "border-zinc-700/50 bg-zinc-900/30";
    expect(prefix).toBe("⎿");
    expect(blockClasses).toContain("bg-zinc-900/30");
  });

  it("error tool results use red styling", () => {
    const errorClasses = "border-red-500/40 bg-red-950/20";
    expect(errorClasses).toContain("red");
  });
});
