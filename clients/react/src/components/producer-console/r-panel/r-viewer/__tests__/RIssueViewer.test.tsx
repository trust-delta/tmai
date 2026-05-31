// @vitest-environment jsdom
//
// RIssueViewer — the R₂ in-tmai issue content viewer (per-repo, full body
// + comments, read-only). The single detail fetcher is mocked so this
// test proves: header identity renders immediately from the selection;
// the body markdown / labels / assignees / timestamps / comment count
// render from the detail fetch; comments render in chronological (wire)
// order; labels + assignees show their empty states; mechanical status
// facts stay PLAIN (no severity tint — viewer-approach negative space);
// and the viewer is selection-driven (it fetches exactly the selected
// issue, never auto-opening an arbitrary one).

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail, IssueInfo } from "@/lib/api";

const getIssueDetail = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    getIssueDetail: (...a: unknown[]) => getIssueDetail(...a),
  },
}));

import { RIssueViewer, type SelectedIssue } from "../RIssueViewer";

function issue(overrides: Partial<IssueInfo> = {}): IssueInfo {
  return {
    number: 7,
    title: "Fix the bug",
    state: "open",
    url: "https://github.com/o/r/issues/7",
    labels: [],
    assignees: [],
    ...overrides,
  };
}

function selected(overrides: Partial<IssueInfo> = {}): SelectedIssue {
  return { repoPath: "/p/u", repoLabel: "u", issue: issue(overrides) };
}

function detail(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    number: 7,
    title: "Fix the bug",
    state: "open",
    url: "https://github.com/o/r/issues/7",
    body: "## Body heading\n\nbody text",
    labels: [{ name: "bug", color: "ff0000" }],
    // Assignee distinct from comment authors so the `@name` lookups are
    // unambiguous below.
    assignees: ["dave"],
    created_at: "2026-05-20T10:00:00Z",
    updated_at: "2026-05-21T12:00:00Z",
    comments: [
      {
        author: "alice",
        body: "first comment",
        created_at: "2026-05-20T11:00:00Z",
        url: "https://github.com/o/r/issues/7#c1",
      },
      {
        author: "bob",
        body: "second comment",
        created_at: "2026-05-20T12:00:00Z",
        url: "https://github.com/o/r/issues/7#c2",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  getIssueDetail.mockReset();
  getIssueDetail.mockResolvedValue(detail());
});

describe("RIssueViewer", () => {
  it("renders header identity immediately from the selection", () => {
    render(<RIssueViewer selected={selected()} onClose={vi.fn()} />);
    expect(screen.getByText("Fix the bug")).toBeTruthy();
    expect(screen.getByText("#7")).toBeTruthy();
  });

  it("is selection-driven: fetches detail for exactly the selected issue", () => {
    // The viewer renders only because it was handed a selection, and it
    // fetches that selection's number — it never auto-opens an arbitrary
    // issue (the parent gates the mount; here we prove the fetch is keyed
    // to the selection).
    render(<RIssueViewer selected={selected()} onClose={vi.fn()} />);
    expect(screen.getByTestId("r-issue-viewer")).toBeTruthy();
    expect(getIssueDetail).toHaveBeenCalledWith("/p/u", 7);
  });

  it("renders body markdown, labels, assignees, timestamps and comment count from the detail fetch", async () => {
    render(<RIssueViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Body heading")).toBeTruthy());
    expect(screen.getByText("bug")).toBeTruthy();
    // Assignee (distinct from the comment authors).
    expect(screen.getByText("@dave")).toBeTruthy();
    // Detail-only header facts.
    expect(screen.getByText(/created 2026-05-20/)).toBeTruthy();
    expect(screen.getByText(/updated 2026-05-21/)).toBeTruthy();
    expect(screen.getByText(/2 comments/)).toBeTruthy();
  });

  it("renders comments in chronological (wire) order", async () => {
    const { container } = render(<RIssueViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("first comment")).toBeTruthy());
    expect(screen.getByText("@alice")).toBeTruthy();
    expect(screen.getByText("@bob")).toBeTruthy();
    const text = container.textContent ?? "";
    // Wire order preserved: comment 1 appears before comment 2 in the DOM.
    expect(text.indexOf("first comment")).toBeLessThan(text.indexOf("second comment"));
  });

  it("shows empty states for an issue with no body / labels / assignees / comments", async () => {
    getIssueDetail.mockResolvedValue(detail({ body: "", labels: [], assignees: [], comments: [] }));
    render(<RIssueViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("No description.")).toBeTruthy());
    expect(screen.getByText("No labels.")).toBeTruthy();
    expect(screen.getByText("Unassigned.")).toBeTruthy();
    expect(screen.getByText("No comments.")).toBeTruthy();
  });

  it("uses NO severity-color classes on any status fact (negative-space)", async () => {
    // The issue viewer has no action layer — the WHOLE viewer (state,
    // labels, assignees, timestamps, counts) must stay plain.
    const { container } = render(<RIssueViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Body heading")).toBeTruthy());
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-warning/);
    expect(html).not.toMatch(/text-destructive/);
    expect(html).not.toMatch(/text-success/);
  });

  it("has NO github.com link-out anywhere in the viewer (in-tmai)", async () => {
    const { container } = render(<RIssueViewer selected={selected()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Body heading")).toBeTruthy());
    expect(container.querySelector("a[href*='github.com']")).toBeNull();
  });

  it("returns to the inventory via the ‹ Inventory back affordance (clears the focus)", () => {
    const onClose = vi.fn();
    render(<RIssueViewer selected={selected()} onClose={onClose} />);
    // Focus mode: closing returns to the inventory; still wired to onClose.
    screen.getByRole("button", { name: /Back to inventory/ }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fills the R region — carries no fixed clamp width (focus mode rides the R column)", () => {
    const { container } = render(<RIssueViewer selected={selected()} onClose={vi.fn()} />);
    const root = container.querySelector('[data-testid="r-issue-viewer"]');
    expect(root).not.toBeNull();
    expect(root?.className ?? "").not.toMatch(/w-\[/);
    expect(root?.className ?? "").toMatch(/flex-1/);
  });
});
