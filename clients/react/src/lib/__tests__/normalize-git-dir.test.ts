// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizeGitDir } from "../api-http";

describe("normalizeGitDir", () => {
  it("strips a trailing /.git", () => {
    expect(normalizeGitDir("/home/user/repo/.git")).toBe("/home/user/repo");
  });

  it("strips a trailing /.git/", () => {
    expect(normalizeGitDir("/home/user/repo/.git/")).toBe("/home/user/repo");
  });

  it("trims trailing slashes when there is no /.git suffix", () => {
    expect(normalizeGitDir("/home/user/repo/")).toBe("/home/user/repo");
    expect(normalizeGitDir("/home/user/repo///")).toBe("/home/user/repo");
  });

  it("returns the path unchanged when no trailing artefacts exist", () => {
    expect(normalizeGitDir("/home/user/repo")).toBe("/home/user/repo");
  });

  it("handles long runs of trailing slashes in linear time (CodeQL alert #1)", () => {
    // The previous `/+$` regex backtracked super-linearly on inputs like
    // this; the linear scan finishes in microseconds. We assert a generous
    // wall-clock budget rather than a tight one so the test stays stable
    // under CI noise — the polynomial version would have blown past
    // seconds, not the 250 ms allowance.
    const path = `/home/user/repo${"/".repeat(50_000)}`;
    const start = performance.now();
    expect(normalizeGitDir(path)).toBe("/home/user/repo");
    expect(performance.now() - start).toBeLessThan(250);
  });

  it("matches the previous behaviour when /.git is followed by multiple slashes", () => {
    // Both old and new implementations strip the trailing slash run but
    // leave `/.git` in place — the first regex only matches when there's
    // either nothing or a single slash between `.git` and end-of-string.
    // Documenting the parity here so a future "tighten the regex" pass
    // doesn't silently change semantics.
    expect(normalizeGitDir("/home/user/repo/.git///")).toBe("/home/user/repo/.git");
  });
});
