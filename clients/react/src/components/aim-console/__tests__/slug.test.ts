// Aim-console create-modal slug helpers — the client-side mirror of the
// backend's slug rules (tmai-core #501) and the mock's suggest/validate.

import { describe, expect, it } from "vitest";
import { suggestSlug, validateAimSlug } from "../slug";

describe("validateAimSlug", () => {
  it("accepts a lowercase kebab slug (returns null)", () => {
    expect(validateAimSlug("attention-icon-row")).toBeNull();
    expect(validateAimSlug("a")).toBeNull();
    expect(validateAimSlug("aim123")).toBeNull();
  });

  it("treats an empty slug as 'not yet', not an error", () => {
    expect(validateAimSlug("")).toBeNull();
  });

  it("rejects uppercase / spaces / illegal punctuation", () => {
    expect(validateAimSlug("Attention")).not.toBeNull();
    expect(validateAimSlug("two words")).not.toBeNull();
    expect(validateAimSlug("under_score")).not.toBeNull();
  });

  it("rejects leading / trailing / doubled dashes", () => {
    expect(validateAimSlug("-lead")).not.toBeNull();
    expect(validateAimSlug("trail-")).not.toBeNull();
    expect(validateAimSlug("double--dash")).not.toBeNull();
  });

  it("rejects a YYYY-MM-DD dated prefix (aim slugs are dateless)", () => {
    expect(validateAimSlug("2026-06-08-thing")).toBe("日付 prefix 不可");
  });
});

describe("suggestSlug", () => {
  it("derives a kebab slug from the aim prose", () => {
    expect(suggestSlug("Attention level を surface する", new Set())).toBe(
      "attention-level-surface",
    );
  });

  it("falls back to new-aim when the aim has no usable characters", () => {
    expect(suggestSlug("　…！", new Set())).toBe("new-aim");
  });

  it("de-duplicates against existing slugs by appending -2, -3…", () => {
    const existing = new Set(["drift", "drift-2"]);
    expect(suggestSlug("drift", existing)).toBe("drift-3");
  });

  it("caps the base at 40 characters", () => {
    const long = "a".repeat(60);
    expect(suggestSlug(long, new Set())).toHaveLength(40);
  });

  it("never leaves a trailing hyphen when the 40-char cut lands on a separator", () => {
    // Three 19-char words join to "...(19)-...(19)-...(19)"; slice(0, 40) lands
    // exactly on the second separator → a naive cut would end in '-'.
    const aim = `${"a".repeat(19)} ${"b".repeat(19)} ${"c".repeat(19)}`;
    const s = suggestSlug(aim, new Set());
    expect(s.endsWith("-")).toBe(false);
    expect(s.length).toBeLessThanOrEqual(40);
    // The suggestion itself must pass the slug validator.
    expect(validateAimSlug(s)).toBeNull();
  });

  it("keeps the slug ≤40 and valid even after a dedup suffix", () => {
    const base = "a".repeat(40);
    const existing = new Set([base]); // forces a -N suffix on the capped base
    const s = suggestSlug("a".repeat(60), existing);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(existing.has(s)).toBe(false);
    expect(validateAimSlug(s)).toBeNull();
  });
});
