// @vitest-environment jsdom
//
// RApproachesSection — status group, date desc within, no
// verification-debt gauge (that's C's layer), no filter chips.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApproachesResponse, ApproachWire } from "@/lib/api";

const approachesMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      approaches: (...args: unknown[]) => approachesMock(...args),
    },
  };
});

import { RApproachesSection } from "../RApproachesSection";
import { type SelectedRecord, selectedRecordKey } from "../r-viewer/RRecordViewer";

function approachStub(overrides: Partial<ApproachWire> = {}): ApproachWire {
  return {
    slug: "2026-05-01-a",
    title: "Approach A",
    date: "2026-05-01",
    status: "running",
    governs: [],
    serves: ["base"],
    success_signal: "works",
    failure_signal: "broken",
    review_triggers: [{ kind: "date", value: "2099-01-01" }],
    review_history: [],
    confidence: "high",
    replaced_by: [],
    excerpt: "",
    ...overrides,
  };
}

function responseStub(approaches: ApproachWire[] = []): ApproachesResponse {
  return {
    unit: "u",
    composed_at: "2026-05-29T00:00:00Z",
    repos: [
      {
        repo_label: "u",
        repo_root: "/p/u",
        primary: true,
        repo_head: null,
        approaches,
      },
    ],
  };
}

beforeEach(() => {
  approachesMock.mockReset();
});

describe("RApproachesSection", () => {
  it("groups by status in fixed order; date desc within each group", async () => {
    approachesMock.mockResolvedValue(
      responseStub([
        approachStub({
          slug: "2026-04-01-r-old",
          title: "R-old",
          date: "2026-04-01",
          status: "running",
        }),
        approachStub({
          slug: "2026-05-15-r-new",
          title: "R-new",
          date: "2026-05-15",
          status: "running",
        }),
        approachStub({ slug: "2026-05-10-v", title: "V", date: "2026-05-10", status: "validated" }),
      ]),
    );

    render(<RApproachesSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("R-new")).toBeTruthy();
    });
    const newRow = screen.getByText("R-new");
    const oldRow = screen.getByText("R-old");
    const vRow = screen.getByText("V");
    // R-new comes before R-old (date desc within running);
    // running group comes before validated group.
    expect(newRow.compareDocumentPosition(oldRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(oldRow.compareDocumentPosition(vRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does NOT render the verification-debt gauge or filter chips (negative space)", async () => {
    approachesMock.mockResolvedValue(responseStub([approachStub()]));
    render(<RApproachesSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Approach A")).toBeTruthy();
    });
    expect(screen.queryByTestId("verification-gauge")).toBeNull();
    expect(screen.queryByText(/verification debt/i)).toBeNull();
    expect(screen.queryByText(/^filter:$/)).toBeNull();
  });

  it("header count is `N running` derived mechanically (no severity styling)", async () => {
    approachesMock.mockResolvedValue(
      responseStub([
        approachStub({ status: "running" }),
        approachStub({ slug: "x", status: "running" }),
        approachStub({ slug: "y", status: "validated" }),
      ]),
    );
    const { container } = render(
      <RApproachesSection unitName="u" expanded={false} onToggle={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/2 running/)).toBeTruthy();
    });
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  // ── Inline attention signals (status, confidence, review-trigger ready) ──

  it("renders status + confidence inline on the row", async () => {
    approachesMock.mockResolvedValue(
      responseStub([
        approachStub({ slug: "with-conf", title: "With Conf", confidence: "low" }),
        approachStub({ slug: "no-conf", title: "No Conf", confidence: null }),
      ]),
    );
    render(<RApproachesSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    const withConf = await screen.findByRole("button", { name: /With Conf/ });
    // status ("running") + confidence ("low") both show inline.
    expect(withConf.textContent).toMatch(/running/);
    expect(withConf.textContent).toMatch(/low/);
    // confidence is present-only — a null-confidence approach shows neither
    // "high" nor "low".
    const noConf = screen.getByRole("button", { name: /No Conf/ });
    expect(noConf.textContent).not.toMatch(/\b(high|low)\b/);
  });

  it("renders the review-trigger-ready marker only when a date trigger is due (plain, no severity)", async () => {
    approachesMock.mockResolvedValue(
      responseStub([
        approachStub({
          slug: "past-trig",
          title: "Past Trigger",
          review_triggers: [{ kind: "date", value: "2020-01-01" }],
        }),
        approachStub({
          slug: "future-trig",
          title: "Future Trigger",
          review_triggers: [{ kind: "date", value: "2099-01-01" }],
        }),
      ]),
    );
    const { container } = render(
      <RApproachesSection unitName="u" expanded={true} onToggle={vi.fn()} />,
    );

    const due = await screen.findByRole("button", { name: /Past Trigger/ });
    expect(due.textContent).toMatch(/review-trigger ready/);
    // Future-dated trigger: silence (no "not due" / "all clear" reassurance).
    const notDue = screen.getByRole("button", { name: /Future Trigger/ });
    expect(notDue.textContent).not.toMatch(/review-trigger ready/);
    // The marker is a plain fact, never a severity alarm.
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  // ── R₂ selection wiring (mirrors RPrsSection's onSelectPr/aria-current) ──

  it("clicking a row calls onSelect with the approach wire object", async () => {
    approachesMock.mockResolvedValue(
      responseStub([approachStub({ slug: "2026-05-01-a", title: "Approach A" })]),
    );
    const onSelect = vi.fn();
    render(
      <RApproachesSection unitName="u" expanded={true} onToggle={vi.fn()} onSelect={onSelect} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Approach A/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0] as SelectedRecord;
    expect(arg.kind).toBe("approach");
    expect(arg.repoPath).toBe("/p/u");
    expect(arg.repoLabel).toBe("u");
    expect(arg.record.slug).toBe("2026-05-01-a");
  });

  it("marks the focused row with aria-current", async () => {
    approachesMock.mockResolvedValue(
      responseStub([approachStub({ slug: "2026-05-01-a", title: "Approach A" })]),
    );
    render(
      <RApproachesSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
        selectedKey={selectedRecordKey("/p/u", "2026-05-01-a")}
      />,
    );

    const row = await screen.findByRole("button", { name: /Approach A/ });
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});
