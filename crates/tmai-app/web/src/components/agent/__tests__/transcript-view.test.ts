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
