import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../useDeepLink";

describe("parseDeepLink", () => {
  it("parses a valid claude deep-link", () => {
    const result = parseDeepLink("/agents/claude/ea760770-c137-46f6-8fd8-a00d9691c1fb");
    expect(result).toEqual({
      scheme: "claude",
      id: "ea760770-c137-46f6-8fd8-a00d9691c1fb",
      knownScheme: true,
      canonicalId: "claude:ea760770-c137-46f6-8fd8-a00d9691c1fb",
    });
  });

  it("parses codex, gemini, opencode schemes as known", () => {
    for (const scheme of ["codex", "gemini", "opencode"]) {
      const result = parseDeepLink(`/agents/${scheme}/some-id-value`);
      expect(result?.knownScheme).toBe(true);
      expect(result?.scheme).toBe(scheme);
    }
  });

  it("marks provisional scheme as unknown", () => {
    const result = parseDeepLink("/agents/provisional/ea760770-c137-46f6-8fd8-a00d9691c1fb");
    expect(result).not.toBeNull();
    expect(result?.knownScheme).toBe(false);
  });

  it("marks an arbitrary unknown scheme as unknown", () => {
    const result = parseDeepLink("/agents/mystery/some-id");
    expect(result?.knownScheme).toBe(false);
  });

  it("returns null for the root path", () => {
    expect(parseDeepLink("/")).toBeNull();
  });

  it("returns null for /agents with no scheme or id", () => {
    expect(parseDeepLink("/agents")).toBeNull();
    expect(parseDeepLink("/agents/")).toBeNull();
  });

  it("returns null when id segment is missing", () => {
    expect(parseDeepLink("/agents/claude")).toBeNull();
    expect(parseDeepLink("/agents/claude/")).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(parseDeepLink("/settings")).toBeNull();
    expect(parseDeepLink("/agents/claude/uuid/extra")).toBeNull();
  });

  it("builds canonicalId correctly", () => {
    const result = parseDeepLink("/agents/gemini/opaque-session-abc123");
    expect(result?.canonicalId).toBe("gemini:opaque-session-abc123");
  });
});
