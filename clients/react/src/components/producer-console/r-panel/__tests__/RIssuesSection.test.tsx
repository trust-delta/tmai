// @vitest-environment jsdom
//
// RIssuesSection — open issue inventory (R₁), unit-scoped and grouped by
// repo (the issues twin of RPrsSection, fed by `useUnitIssues` →
// `api.unitIssues`). Each row carries a colour-coded lifecycle status pill
// (open / closed) from the wire `state` (C2, Stage C) — categorical state
// colour, NOT severity appraisal. No github.com link-out — the row is an
// in-tmai select that opens the R₂ viewer with the wire's `repo_path` +
// `repo_label`. The endpoint returns open issues already, so the header
// count is just the sum across repos.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueSummaryWire, RepoIssuesWire, UnitIssuesResponse } from "@/lib/api";

const unitIssuesMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      unitIssues: (...args: unknown[]) => unitIssuesMock(...args),
    },
  };
});

import { RIssuesSection } from "../RIssuesSection";

function issue(overrides: Partial<IssueSummaryWire> = {}): IssueSummaryWire {
  return {
    number: 1n,
    title: "Issue 1",
    state: "open",
    url: "https://github.com/o/r/issues/1",
    labels: [],
    assignees: [],
    created_at: null,
    closed_at: null,
    ...overrides,
  };
}

function repo(overrides: Partial<RepoIssuesWire> = {}): RepoIssuesWire {
  return {
    repo_path: "/p/u",
    repo_label: "u",
    primary: true,
    issues: [],
    ...overrides,
  };
}

function response(repos: RepoIssuesWire[]): UnitIssuesResponse {
  return { unit: "u", repos };
}

beforeEach(() => {
  unitIssuesMock.mockReset();
});

describe("RIssuesSection", () => {
  it("renders open issues from the unit-scoped wire", async () => {
    unitIssuesMock.mockResolvedValue(
      response([repo({ issues: [issue(), issue({ number: 2n, title: "Issue 2" })] })]),
    );
    render(<RIssuesSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Issue 1")).toBeTruthy();
    });
    expect(screen.getByText("Issue 2")).toBeTruthy();
  });

  it("header `N open` sums issue counts across repos from the wire (no client-side filter)", async () => {
    unitIssuesMock.mockResolvedValue(
      response([
        repo({
          repo_path: "/p/core",
          repo_label: "tmai-core",
          issues: [issue({ number: 1n, title: "Core issue" })],
        }),
        repo({
          repo_path: "/p/ui",
          repo_label: "tmai-ui",
          primary: false,
          issues: [
            issue({ number: 2n, title: "UI issue" }),
            issue({ number: 3n, title: "UI issue 2" }),
          ],
        }),
      ]),
    );
    render(<RIssuesSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/3 open/)).toBeTruthy();
    });
    // Grouped by repo: each repo header is the wire `repo_label` (NOT a
    // path-basename derivation) and every repo's issues render under it.
    expect(screen.getByText("tmai-core")).toBeTruthy();
    expect(screen.getByText("tmai-ui")).toBeTruthy();
    expect(screen.getByText("Core issue")).toBeTruthy();
    expect(screen.getByText("UI issue")).toBeTruthy();
    expect(screen.getByText("UI issue 2")).toBeTruthy();
  });

  it("does not render a repo header for a single-repo unit", async () => {
    unitIssuesMock.mockResolvedValue(response([repo({ issues: [issue()] })]));
    render(<RIssuesSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Issue 1")).toBeTruthy();
    });
    // Single repo ⇒ no per-repo grouping header (mirrors RPrsSection).
    expect(screen.queryByText("u")).toBeNull();
  });

  it("empty state — header shows `0 open`", async () => {
    unitIssuesMock.mockResolvedValue(response([repo({ issues: [] })]));
    render(<RIssuesSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/0 open/)).toBeTruthy();
    });
    // findByText (await) not getByText: the header count and the empty-state
    // body can commit in separate ticks, so a sync read here races (flaked CI).
    expect(await screen.findByText(/No issues/i)).toBeTruthy();
  });

  it("renders a colour-coded lifecycle status pill from the wire state (C2)", async () => {
    unitIssuesMock.mockResolvedValue(
      response([
        repo({ issues: [issue(), issue({ number: 2n, title: "Closed", state: "closed" })] }),
      ]),
    );
    render(<RIssuesSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Issue 1")).toBeTruthy());
    // open issue → `open` pill (categorical-`ok`); closed → `closed` (muted).
    const open = screen.getByText("open").closest("[data-testid='status-pill']");
    expect(open?.getAttribute("data-tone")).toBe("ok");
    const closed = screen.getByText("closed").closest("[data-testid='status-pill']");
    expect(closed?.getAttribute("data-tone")).toBe("muted");
  });

  it("renders the EXTERNAL · github framing badge on the section header", async () => {
    unitIssuesMock.mockResolvedValue(response([repo({ issues: [issue()] })]));
    render(<RIssuesSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Issue 1")).toBeTruthy());
    expect(screen.getByTestId("external-source-badge")).toBeTruthy();
  });

  it("has NO github.com link-out — the row is an in-tmai select", async () => {
    unitIssuesMock.mockResolvedValue(response([repo({ issues: [issue()] })]));
    const { container } = render(
      <RIssuesSection unitName="u" expanded={true} onToggle={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Issue 1")).toBeTruthy();
    });
    // The issue number used to be an <a href> to github.com; it is now a
    // button that opens the R₂ viewer in-tmai. No anchor should remain.
    expect(container.querySelector("a[href*='github.com']")).toBeNull();
  });

  it("clicking an issue row selects it for the R₂ viewer with wire repo_path/repo_label", async () => {
    const onSelectIssue = vi.fn();
    unitIssuesMock.mockResolvedValue(
      response([repo({ repo_path: "/p/tmai-core", repo_label: "tmai-core", issues: [issue()] })]),
    );
    render(
      <RIssuesSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        onSelectIssue={onSelectIssue}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Issue 1")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Issue 1"));
    expect(onSelectIssue).toHaveBeenCalledTimes(1);
    const sel = onSelectIssue.mock.calls[0][0];
    // repoPath + repoLabel now come straight from the wire (no path
    // basename derivation).
    expect(sel.repoPath).toBe("/p/tmai-core");
    expect(sel.repoLabel).toBe("tmai-core");
    // bigint wire number narrows to a plain number for `SelectedIssue`.
    expect(sel.issue.number).toBe(1);
    expect(typeof sel.issue.number).toBe("number");
  });

  it("marks the focused row with aria-current (and no others)", async () => {
    unitIssuesMock.mockResolvedValue(
      response([repo({ issues: [issue(), issue({ number: 2n, title: "Issue 2" })] })]),
    );
    render(<RIssuesSection unitName="u" expanded={true} onToggle={vi.fn()} selectedKey="/p/u#2" />);
    await waitFor(() => {
      expect(screen.getByText("Issue 2")).toBeTruthy();
    });
    const row2 = screen.getByText("Issue 2").closest("button");
    expect(row2?.getAttribute("aria-current")).toBe("true");
    const row1 = screen.getByText("Issue 1").closest("button");
    expect(row1?.getAttribute("aria-current")).toBeNull();
  });
});
