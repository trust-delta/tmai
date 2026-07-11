// @vitest-environment jsdom
//
// PrRail — the aim-console's PR / Issue rail (S5). A faithful reproduction of
// the destination mock's PR rail in the dev-tool tokens, wired to the REUSED
// unit-scoped, multi-repo hooks (`useUnitPrs` / `useUnitIssues`) and the
// REUSED categorical pill derivation (`prStatusPills` / `issueStatusPills`).
//
// This test mocks the two hooks (so nothing hits the network) and covers the
// contract: per-repo grouping across the whole unit (primary highlighted),
// the group counts, the categorical status pills, the live collapsed-rail
// open-counts, the header repo-count, and the expand/collapse callbacks.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseUnitIssuesResult } from "@/hooks/useUnitIssues";
import type { UseUnitPrsResult } from "@/hooks/useUnitPrs";
import type {
  IssueSummaryWire,
  PrSummaryWire,
  UnitIssuesResponse,
  UnitPrsResponse,
  UnitRepoWire,
} from "@/lib/api";

const useUnitPrsMock = vi.fn();
const useUnitIssuesMock = vi.fn();

vi.mock("@/hooks/useUnitPrs", () => ({
  useUnitPrs: (unit: string | null) => useUnitPrsMock(unit),
}));
vi.mock("@/hooks/useUnitIssues", () => ({
  useUnitIssues: (unit: string | null) => useUnitIssuesMock(unit),
}));

import { PrRail } from "../PrRail";

function pr(overrides: Partial<PrSummaryWire> = {}): PrSummaryWire {
  return {
    number: 100n,
    title: "PR title",
    state: "OPEN",
    head_branch: "feat/x",
    head_sha: "abc1234",
    base_branch: "main",
    url: "https://github.com/o/r/pull/100",
    review_decision: null,
    check_status: null,
    is_draft: false,
    additions: 10n,
    deletions: 1n,
    comments: 0n,
    reviews: 0n,
    author: "me",
    merge_commit_sha: null,
    created_at: null,
    merged_at: null,
    closed_at: null,
    ci_completed_at: null,
    last_synced_at: null,
    ...overrides,
  };
}

function issue(overrides: Partial<IssueSummaryWire> = {}): IssueSummaryWire {
  return {
    number: 500n,
    title: "issue title",
    state: "open",
    url: "https://github.com/o/r/issues/500",
    labels: [],
    assignees: [],
    created_at: null,
    closed_at: null,
    last_synced_at: null,
    ...overrides,
  };
}

// unit `tmai` spans 2 repos: tmai (primary) + tmai-core. PRs interleave across
// both repos; issues likewise. Counts: 3 PRs, 2 issues.
function prsResponse(): UnitPrsResponse {
  return {
    unit: "tmai",
    repos: [
      {
        repo_path: "/home/u/tmai",
        repo_label: "tmai",
        primary: true,
        prs: [
          pr({ number: 790n, title: "aim inline surfacing", review_decision: "REVIEW_REQUIRED" }),
          pr({ number: 788n, title: "gen: sync spec ← core", is_draft: true }),
        ],
      },
      {
        repo_path: "/home/u/tmai-core",
        repo_label: "tmai-core",
        primary: false,
        prs: [pr({ number: 502n, title: "aim write endpoints", state: "MERGED" })],
      },
    ],
  };
}

function issuesResponse(): UnitIssuesResponse {
  return {
    unit: "tmai",
    repos: [
      {
        repo_path: "/home/u/tmai",
        repo_label: "tmai",
        primary: true,
        issues: [issue({ number: 509n, title: "destination layout" })],
      },
      {
        repo_path: "/home/u/tmai-core",
        repo_label: "tmai-core",
        primary: false,
        issues: [issue({ number: 512n, title: "cross-edge propagation" })],
      },
    ],
  };
}

const REPOS: UnitRepoWire[] = [
  { path: "/home/u/tmai", primary: true },
  { path: "/home/u/tmai-core", primary: false },
];

function prsResult(data: UnitPrsResponse | null): UseUnitPrsResult {
  return { data, loading: false, error: null };
}
function issuesResult(data: UnitIssuesResponse | null): UseUnitIssuesResult {
  return { data, loading: false, error: null };
}

function renderRail(overrides: Partial<Parameters<typeof PrRail>[0]> = {}) {
  const props = {
    unitName: "tmai" as string | null,
    unitLabel: "tmai",
    repos: REPOS,
    open: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    ...overrides,
  };
  render(<PrRail {...props} />);
  return props;
}

beforeEach(() => {
  useUnitPrsMock.mockReset();
  useUnitIssuesMock.mockReset();
  useUnitPrsMock.mockReturnValue(prsResult(prsResponse()));
  useUnitIssuesMock.mockReturnValue(issuesResult(issuesResponse()));
});

describe("PrRail — collapsed rail (live open-counts)", () => {
  it("scopes both hooks to the focused unit", () => {
    renderRail({ unitName: "tmai" });
    expect(useUnitPrsMock).toHaveBeenCalledWith("tmai");
    expect(useUnitIssuesMock).toHaveBeenCalledWith("tmai");
  });

  it("wires the vertical PR / Issue labels to the real totals", () => {
    renderRail();
    const rail = screen.getByRole("button", { name: "Expand PR / Issue rail" });
    // 3 open PRs across both repos, 2 open issues.
    expect(within(rail).getByText("PR 3")).toBeTruthy();
    expect(within(rail).getByText("Issue 2")).toBeTruthy();
    expect(within(rail).getByText("‹ EXTERNAL")).toBeTruthy();
    // The amber `.w` accent is a STATIC dev-tool accent on the PR label, not
    // an attention signal.
    expect(within(rail).getByText("PR 3").className).toContain("w");
  });

  it("shows zero counts when the unit has no open PRs / issues", () => {
    useUnitPrsMock.mockReturnValue(prsResult({ unit: "tmai", repos: [] }));
    useUnitIssuesMock.mockReturnValue(issuesResult({ unit: "tmai", repos: [] }));
    renderRail();
    const rail = screen.getByRole("button", { name: "Expand PR / Issue rail" });
    expect(within(rail).getByText("PR 0")).toBeTruthy();
    expect(within(rail).getByText("Issue 0")).toBeTruthy();
  });
});

describe("PrRail — expanded panel header", () => {
  it("shows `unit {label} · {N} repos` from the unit's repos", () => {
    renderRail({ unitLabel: "tmai", repos: REPOS });
    expect(screen.getByText(/unit tmai · 2 repos/)).toBeTruthy();
  });
});

describe("PrRail — expanded panel groups", () => {
  it("groups Pull Requests · N across the whole unit, each row tagged with its repo pill", () => {
    renderRail();
    const group = screen.getByTestId("ac-pr-group");
    expect(within(group).getByText("Pull Requests · 3")).toBeTruthy();

    // All three PRs render, in primary-first repo order.
    const rows = within(group).getAllByTestId("ac-pi");
    expect(rows).toHaveLength(3);
    const repoOf = (i: number) => within(rows[i]).getByTestId("ac-pi-repo").textContent;
    expect(rows.map((_, i) => repoOf(i))).toEqual(["tmai", "tmai", "tmai-core"]);

    // The primary repo's pill is highlighted; the secondary's is not.
    expect(within(rows[0]).getByTestId("ac-pi-repo").dataset.primary).toBe("true");
    expect(within(rows[2]).getByTestId("ac-pi-repo").dataset.primary).toBe("false");

    // The number is mono `#{n}`; the title is present.
    expect(within(rows[0]).getByText("#790")).toBeTruthy();
    expect(within(rows[0]).getByText("aim inline surfacing")).toBeTruthy();
  });

  it("groups Issues · N the same way", () => {
    renderRail();
    const group = screen.getByTestId("ac-issue-group");
    expect(within(group).getByText("Issues · 2")).toBeTruthy();
    const rows = within(group).getAllByTestId("ac-pi");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("#509")).toBeTruthy();
    expect(within(rows[0]).getByTestId("ac-pi-repo").dataset.primary).toBe("true");
    expect(within(rows[1]).getByTestId("ac-pi-repo").textContent).toBe("tmai-core");
  });

  it("renders categorical status pills (reused prStatusPills / issueStatusPills)", () => {
    renderRail();
    // #790 OPEN + REVIEW_REQUIRED → open (ok) + review (warn).
    const reviewPill = screen.getByText("review");
    expect(reviewPill.dataset.tone).toBe("warn");
    expect(reviewPill.className).toContain("r");
    // #788 draft → muted.
    const draftPill = screen.getByText("draft");
    expect(draftPill.dataset.tone).toBe("muted");
    expect(draftPill.className).toContain("d");
    // #502 merged → info (violet).
    const mergedPill = screen.getByText("merged");
    expect(mergedPill.dataset.tone).toBe("info");
    expect(mergedPill.className).toContain("m");
    // Issues are open → ok (green).
    const openPills = screen
      .getAllByTestId("ac-status-pill")
      .filter((p) => p.textContent === "open");
    expect(openPills.length).toBeGreaterThan(0);
    for (const p of openPills) expect(p.dataset.tone).toBe("ok");
  });

  it("shows an empty message per group when the unit has none", () => {
    useUnitPrsMock.mockReturnValue(prsResult({ unit: "tmai", repos: [] }));
    useUnitIssuesMock.mockReturnValue(issuesResult({ unit: "tmai", repos: [] }));
    renderRail();
    expect(within(screen.getByTestId("ac-pr-group")).getByText("No open PRs.")).toBeTruthy();
    expect(within(screen.getByTestId("ac-issue-group")).getByText("No open issues.")).toBeTruthy();
  });
});

describe("PrRail — remote-Δ freshness (#822 / #606 §1)", () => {
  const CURSOR = "2026-06-20T00:00:00Z";
  const NEWER = "2026-06-25T00:00:00Z"; // after the cursor → unobserved
  const OLDER = "2026-06-10T00:00:00Z"; // before the cursor → observed

  it("renders no Δ accent when no cursor is wired (undefined ⇒ accent-free)", () => {
    // The default render passes no cursor props — existing isolation behaviour.
    renderRail();
    expect(screen.queryByTestId("ac-unobserved")).toBeNull();
    expect(screen.queryByTestId("ac-rail-unobserved")).toBeNull();
  });

  it("marks only the rows whose vocab ts is newer than the section cursor", () => {
    useUnitPrsMock.mockReturnValue(
      prsResult({
        unit: "tmai",
        repos: [
          {
            repo_path: "/home/u/tmai",
            repo_label: "tmai",
            primary: true,
            prs: [
              pr({ number: 1n, title: "fresh", created_at: NEWER }),
              pr({ number: 2n, title: "stale", created_at: OLDER }),
              pr({ number: 3n, title: "no vocab" }), // all-null vocab → observed
            ],
          },
        ],
      }),
    );
    useUnitIssuesMock.mockReturnValue(issuesResult({ unit: "tmai", repos: [] }));
    renderRail({ prsCursor: CURSOR, issuesCursor: CURSOR });

    // Exactly one row (the NEWER one) carries the Δ accent.
    const group = screen.getByTestId("ac-pr-group");
    const rows = within(group).getAllByTestId("ac-pi");
    const hasDelta = (i: number) => within(rows[i]).queryByTestId("ac-unobserved") !== null;
    expect(hasDelta(0)).toBe(true); // #1 fresh
    expect(hasDelta(1)).toBe(false); // #2 stale
    expect(hasDelta(2)).toBe(false); // #3 no vocab
  });

  it("treats every row as unobserved on the first run (null cursor)", () => {
    useUnitPrsMock.mockReturnValue(
      prsResult({
        unit: "tmai",
        repos: [
          {
            repo_path: "/home/u/tmai",
            repo_label: "tmai",
            primary: true,
            prs: [pr({ number: 1n, created_at: OLDER }), pr({ number: 2n, created_at: NEWER })],
          },
        ],
      }),
    );
    useUnitIssuesMock.mockReturnValue(issuesResult({ unit: "tmai", repos: [] }));
    renderRail({ prsCursor: null, issuesCursor: null });
    // null = "no close act recorded yet" → the honest 一度も見ていない: both rows.
    expect(screen.getAllByTestId("ac-unobserved")).toHaveLength(2);
  });

  it("shows the unit-total Δ on the collapsed rail (PR + Issue unobserved)", () => {
    useUnitPrsMock.mockReturnValue(
      prsResult({
        unit: "tmai",
        repos: [
          {
            repo_path: "/home/u/tmai",
            repo_label: "tmai",
            primary: true,
            prs: [pr({ number: 1n, created_at: NEWER }), pr({ number: 2n, created_at: OLDER })],
          },
        ],
      }),
    );
    useUnitIssuesMock.mockReturnValue(
      issuesResult({
        unit: "tmai",
        repos: [
          {
            repo_path: "/home/u/tmai",
            repo_label: "tmai",
            primary: true,
            issues: [issue({ number: 9n, created_at: NEWER })],
          },
        ],
      }),
    );
    renderRail({ prsCursor: CURSOR, issuesCursor: CURSOR });
    // 1 unobserved PR + 1 unobserved issue = Δ 2.
    const rail = screen.getByTestId("ac-rail-unobserved");
    expect(rail.textContent).toContain("2");
  });

  it("omits the collapsed-rail Δ when nothing is unobserved", () => {
    useUnitPrsMock.mockReturnValue(
      prsResult({
        unit: "tmai",
        repos: [
          {
            repo_path: "/home/u/tmai",
            repo_label: "tmai",
            primary: true,
            prs: [pr({ number: 1n, created_at: OLDER })],
          },
        ],
      }),
    );
    useUnitIssuesMock.mockReturnValue(issuesResult({ unit: "tmai", repos: [] }));
    renderRail({ prsCursor: CURSOR, issuesCursor: CURSOR });
    expect(screen.queryByTestId("ac-rail-unobserved")).toBeNull();
  });
});

describe("PrRail — expand / collapse (S1 mechanism, threaded callbacks)", () => {
  it("clicking the collapsed rail calls onExpand", () => {
    const props = renderRail({ open: false });
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    expect(props.onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows the ✕ ONLY when docked (the overlay closes by clicking outside)", () => {
    // Overlay (open, not docked) — no ✕.
    const { rerender } = render(
      <PrRail
        unitName="tmai"
        unitLabel="tmai"
        repos={REPOS}
        open={true}
        docked={false}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onToggleDock={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Collapse PR / Issue rail" })).toBeNull();

    // Docked — the ✕ appears and calls onCollapse.
    const onCollapse = vi.fn();
    rerender(
      <PrRail
        unitName="tmai"
        unitLabel="tmai"
        repos={REPOS}
        open={true}
        docked={true}
        onExpand={vi.fn()}
        onCollapse={onCollapse}
        onToggleDock={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse PR / Issue rail" }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("shows the dock ⊟/⊞ toggle and calls onToggleDock", () => {
    const onToggleDock = vi.fn();
    render(
      <PrRail
        unitName="tmai"
        unitLabel="tmai"
        repos={REPOS}
        open={true}
        docked={false}
        onExpand={vi.fn()}
        onCollapse={vi.fn()}
        onToggleDock={onToggleDock}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dock the Remote panel" }));
    expect(onToggleDock).toHaveBeenCalledTimes(1);
  });

  it("reflects the open state on the rail's aria-expanded", () => {
    renderRail({ open: true });
    expect(
      screen.getByRole("button", { name: "Expand PR / Issue rail" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
