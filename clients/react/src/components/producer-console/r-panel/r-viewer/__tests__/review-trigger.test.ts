import { describe, expect, it } from "vitest";
import type { ApproachWire, ReviewTriggerWire } from "@/lib/api";
import { isDateTriggerReady, isReviewTriggerReady } from "../review-trigger";

const TODAY = "2026-05-31";

function approachStub(triggers: ReviewTriggerWire[]): ApproachWire {
  return {
    slug: "2026-05-01-a",
    title: "A",
    date: "2026-05-01",
    status: "running",
    governs: [],
    serves: ["base"],
    success_signal: "works",
    failure_signal: "broken",
    review_triggers: triggers,
    review_history: [],
    confidence: "high",
    replaced_by: [],
    excerpt: "",
  };
}

describe("isDateTriggerReady", () => {
  it("past-dated date trigger is ready", () => {
    expect(isDateTriggerReady({ kind: "date", value: "2020-01-01" }, TODAY)).toBe(true);
  });
  it("today-dated date trigger is ready (on-or-before today)", () => {
    expect(isDateTriggerReady({ kind: "date", value: TODAY }, TODAY)).toBe(true);
  });
  it("future-dated date trigger is NOT ready", () => {
    expect(isDateTriggerReady({ kind: "date", value: "2099-01-01" }, TODAY)).toBe(false);
  });
  it("non-date kinds are never ready (can't be auto-detected)", () => {
    expect(isDateTriggerReady({ kind: "pr-merged", ref: "#1" }, TODAY)).toBe(false);
    expect(isDateTriggerReady({ kind: "manual", description: "re-check" }, TODAY)).toBe(false);
  });
});

describe("isReviewTriggerReady", () => {
  it("true when any date trigger is past-dated", () => {
    expect(
      isReviewTriggerReady(
        approachStub([
          { kind: "manual", description: "re-check" },
          { kind: "date", value: "2020-01-01" },
        ]),
        TODAY,
      ),
    ).toBe(true);
  });
  it("false when only future date triggers exist", () => {
    expect(isReviewTriggerReady(approachStub([{ kind: "date", value: "2099-01-01" }]), TODAY)).toBe(
      false,
    );
  });
  it("false when no date triggers exist", () => {
    expect(isReviewTriggerReady(approachStub([{ kind: "pr-merged", ref: "#1" }]), TODAY)).toBe(
      false,
    );
  });
});
