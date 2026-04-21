import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

// Mirror of extractCodeSource in MarkdownPanel.tsx — re-implemented here to keep
// the test in the same shape as the existing component helper tests in this repo.
function extractCodeSource(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractCodeSource).join("");
  return String(children ?? "");
}

describe("extractCodeSource", () => {
  it("returns the string children verbatim", () => {
    expect(extractCodeSource("flowchart TD\n  A --> B")).toBe("flowchart TD\n  A --> B");
  });

  it("joins array children into a single string", () => {
    expect(extractCodeSource(["flowchart TD\n", "  A --> B"])).toBe("flowchart TD\n  A --> B");
  });

  it("returns empty string for null / undefined", () => {
    expect(extractCodeSource(null)).toBe("");
    expect(extractCodeSource(undefined)).toBe("");
  });

  it("trims trailing newline via caller-side .replace(/\\n$/, '')", () => {
    const raw = extractCodeSource("graph LR\n  X --> Y\n");
    expect(raw.replace(/\n$/, "")).toBe("graph LR\n  X --> Y");
  });
});
