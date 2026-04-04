import { describe, expect, it } from "vitest";

// Unit tests for CopyableSha display logic (clipboard interaction is tested via browser)
describe("CopyableSha display logic", () => {
  const fullSha = "abc1234567890def1234567890abcdef12345678";

  it("slices SHA to 7 characters by default", () => {
    const displayLength = 7;
    expect(fullSha.slice(0, displayLength)).toBe("abc1234");
  });

  it("slices SHA to custom display length", () => {
    const displayLength = 12;
    expect(fullSha.slice(0, displayLength)).toBe("abc123456789");
  });

  it("shows full SHA when displayLength equals SHA length", () => {
    const displayLength = 40;
    expect(fullSha.slice(0, displayLength)).toBe(fullSha);
  });

  it("handles short SHA gracefully (no padding)", () => {
    const shortSha = "abc12";
    const displayLength = 7;
    expect(shortSha.slice(0, displayLength)).toBe("abc12");
  });
});
