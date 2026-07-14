// unit-signal — pure precedence-collapse for the per-unit cross-unit tab
// signal. Pins the operator-chosen ordering (owed > fresh > idle > none) and
// the one wired source (handoff `awaiting_review` ⇒ owed).

import { describe, expect, it } from "vitest";
import { handoffOwesReview, resolveUnitSignal } from "../unit-signal";

describe("resolveUnitSignal — precedence owed > fresh > idle > none", () => {
  it("is null when no source is live (quiet unit)", () => {
    expect(resolveUnitSignal({})).toBeNull();
    expect(resolveUnitSignal({ owed: false, fresh: false, idle: false })).toBeNull();
  });

  it("returns each single live source unchanged", () => {
    expect(resolveUnitSignal({ owed: true })).toBe("owed");
    expect(resolveUnitSignal({ fresh: true })).toBe("fresh");
    expect(resolveUnitSignal({ idle: true })).toBe("idle");
  });

  it("owed wins over fresh and idle (the only progress-blocking lane)", () => {
    expect(resolveUnitSignal({ owed: true, fresh: true, idle: true })).toBe("owed");
    expect(resolveUnitSignal({ owed: true, fresh: true })).toBe("owed");
    expect(resolveUnitSignal({ owed: true, idle: true })).toBe("owed");
  });

  it("fresh wins over idle when owed is absent (freshness resurfaces once owe clears)", () => {
    expect(resolveUnitSignal({ fresh: true, idle: true })).toBe("fresh");
  });
});

describe("handoffOwesReview — the wired owed source", () => {
  it("owes only at the review gate", () => {
    expect(handoffOwesReview("awaiting_review")).toBe(true);
  });

  it("does not owe at any other phase (owe clears mechanically as phase advances)", () => {
    for (const phase of ["prompted", "validated", "killed", "launching", "ready", "escalate"]) {
      expect(handoffOwesReview(phase)).toBe(false);
    }
  });

  it("does not owe when the unit has never emitted a phase", () => {
    expect(handoffOwesReview(undefined)).toBe(false);
  });
});
