// @vitest-environment jsdom
//
// status-pills — the pure PR/Issue → pill derivation + the pill / EXTERNAL
// badge rendering (C2). Categorical lifecycle / review / CI colour, NOT
// severity appraisal.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { IssueSummaryWire, PrSummaryWire } from "@/lib/api";
import { ExternalSourceBadge, issueStatusPills, prStatusPills, StatusPills } from "../status-pills";

function pr(overrides: Partial<PrSummaryWire> = {}): PrSummaryWire {
  return {
    number: 1n,
    title: "t",
    state: "OPEN",
    head_branch: "feat/x",
    head_sha: "abc",
    base_branch: "main",
    url: "u",
    review_decision: null,
    check_status: null,
    is_draft: false,
    additions: 0n,
    deletions: 0n,
    comments: 0n,
    reviews: 0n,
    author: "me",
    merge_commit_sha: null,
    created_at: null,
    merged_at: null,
    closed_at: null,
    ci_completed_at: null,
    ...overrides,
  };
}

function issue(overrides: Partial<IssueSummaryWire> = {}): IssueSummaryWire {
  return {
    number: 1n,
    title: "t",
    state: "open",
    url: "u",
    labels: [],
    assignees: [],
    created_at: null,
    closed_at: null,
    ...overrides,
  };
}

describe("prStatusPills", () => {
  it("open PR with no review / CI → a single `open` (ok) pill", () => {
    expect(prStatusPills(pr())).toEqual([{ key: "lifecycle", label: "open", tone: "ok" }]);
  });

  it("draft takes precedence over the open lifecycle", () => {
    expect(prStatusPills(pr({ is_draft: true }))[0]).toEqual({
      key: "lifecycle",
      label: "draft",
      tone: "muted",
    });
  });

  it("merged lifecycle from state OR a merge_commit_sha → info (accent) tone", () => {
    expect(prStatusPills(pr({ state: "MERGED" }))[0].label).toBe("merged");
    expect(prStatusPills(pr({ state: "OPEN", merge_commit_sha: "deadbeef" }))[0]).toEqual({
      key: "lifecycle",
      label: "merged",
      tone: "info",
    });
  });

  it("closed lifecycle → muted", () => {
    expect(prStatusPills(pr({ state: "CLOSED" }))[0]).toEqual({
      key: "lifecycle",
      label: "closed",
      tone: "muted",
    });
  });

  it("maps the raw gh review_decision strings to short labels + tones", () => {
    const tone = (d: string) =>
      prStatusPills(pr({ review_decision: d })).find((p) => p.key === "review");
    expect(tone("APPROVED")).toEqual({ key: "review", label: "approved", tone: "ok" });
    expect(tone("CHANGES_REQUESTED")).toEqual({
      key: "review",
      label: "changes requested",
      tone: "warn",
    });
    expect(tone("REVIEW_REQUIRED")).toEqual({ key: "review", label: "review", tone: "warn" });
    // Unknown values pass through lowercased + muted (no lockstep with gh).
    expect(tone("DISMISSED")).toEqual({ key: "review", label: "dismissed", tone: "muted" });
  });

  it("maps the raw gh check_status strings to CI pill tones", () => {
    const ci = (s: string) => prStatusPills(pr({ check_status: s })).find((p) => p.key === "ci");
    expect(ci("SUCCESS")).toEqual({ key: "ci", label: "CI pass", tone: "ok" });
    expect(ci("FAILURE")).toEqual({ key: "ci", label: "CI fail", tone: "danger" });
    expect(ci("PENDING")).toEqual({ key: "ci", label: "CI pending", tone: "warn" });
  });

  it("emits at most one pill per category (lifecycle, review, CI)", () => {
    const pills = prStatusPills(pr({ review_decision: "APPROVED", check_status: "SUCCESS" }));
    expect(pills.map((p) => p.key)).toEqual(["lifecycle", "review", "ci"]);
  });
});

describe("issueStatusPills", () => {
  it("open → ok, closed → muted (case-insensitive)", () => {
    expect(issueStatusPills(issue())).toEqual([{ key: "lifecycle", label: "open", tone: "ok" }]);
    expect(issueStatusPills(issue({ state: "CLOSED" }))).toEqual([
      { key: "lifecycle", label: "closed", tone: "muted" },
    ]);
  });
});

describe("StatusPills / ExternalSourceBadge rendering", () => {
  it("renders each pill with its tone and label; nothing for an empty set", () => {
    const { rerender, container } = render(
      <StatusPills pills={[{ key: "lifecycle", label: "open", tone: "ok" }]} />,
    );
    const pill = screen.getByTestId("status-pill");
    expect(pill.getAttribute("data-tone")).toBe("ok");
    expect(pill.textContent).toBe("open");
    expect(pill.className).toMatch(/text-success/);

    rerender(<StatusPills pills={[]} />);
    expect(container.querySelector("[data-testid='status-pill']")).toBeNull();
  });

  it("ExternalSourceBadge states github = source of truth", () => {
    render(<ExternalSourceBadge />);
    const badge = screen.getByTestId("external-source-badge");
    expect(badge.getAttribute("title")).toMatch(/source of truth/i);
    expect(badge.textContent).toMatch(/github/i);
  });
});
