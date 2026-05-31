// @vitest-environment jsdom
//
// RRecordViewer — the R₂ shared record content viewer (decisions +
// approaches). The cross-ref index fetchers (useDecisions / useApproaches)
// are mocked so this test proves: the frontmatter table renders the
// kind's fields; the drift indicator shows when `stale_since` is present
// and is absent when null; the approach review-trigger-ready indicator
// fires for a past date and not a future one; success/failure-signal are
// hoisted for approaches; the excerpt renders as markdown; cross-refs
// re-focus R₂ and an unresolved slug stays plain text; governs paths are
// never cross-refs; and status facts carry NO severity tint.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApproachesResponse, ApproachWire, DecisionsResponse, DecisionWire } from "@/lib/api";

const useDecisionsMock = vi.fn();
const useApproachesMock = vi.fn();

vi.mock("@/hooks/useDecisions", () => ({
  useDecisions: (...a: unknown[]) => useDecisionsMock(...a),
}));
vi.mock("@/hooks/useApproaches", () => ({
  useApproaches: (...a: unknown[]) => useApproachesMock(...a),
}));

import { RRecordViewer, type SelectedRecord } from "../RRecordViewer";

// ── wire builders ──

function decision(overrides: Partial<DecisionWire> = {}): DecisionWire {
  return {
    slug: "2026-05-01-the-decision",
    title: "The Decision",
    status: "accepted",
    category: "principle",
    governs: ["src/lib/api.ts"],
    last_verified: "2026-05-01",
    contract_surface: true,
    stale_since: null,
    superseded_by: [],
    strengthened_by: [],
    excerpt: "",
    ...overrides,
  };
}

function approach(overrides: Partial<ApproachWire> = {}): ApproachWire {
  return {
    slug: "2026-05-10-the-approach",
    title: "The Approach",
    date: "2026-05-10",
    status: "running",
    governs: ["doc/decisions/"],
    serves: ["2026-05-01-the-decision"],
    success_signal: "the metric climbs",
    failure_signal: "the metric stalls",
    review_triggers: [{ kind: "date", value: "2099-01-01" }],
    review_history: [],
    confidence: "high",
    replaced_by: [],
    excerpt: "",
    ...overrides,
  };
}

function decisionsResponse(decisions: DecisionWire[] = []): DecisionsResponse {
  return {
    unit: "u",
    composed_at: "2026-05-29T00:00:00Z",
    repos: [
      {
        repo_label: "u",
        repo_root: "/p/u",
        primary: true,
        repo_head: null,
        counts: {
          total: 0,
          in_play: 0,
          warm: 0,
          cold: 0,
          foundations: 0,
          superseded: 0,
          stale_suspect: 0,
        },
        currency_sweep: [],
        foundational_due: [],
        foundations: [],
        in_play: decisions,
        warm: [],
        cold: [],
        superseded: [],
      },
    ],
  };
}

function approachesResponse(approaches: ApproachWire[] = []): ApproachesResponse {
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

function decisionSelection(d: DecisionWire): SelectedRecord {
  return { kind: "decision", repoPath: "/p/u", repoLabel: "u", record: d };
}
function approachSelection(a: ApproachWire): SelectedRecord {
  return { kind: "approach", repoPath: "/p/u", repoLabel: "u", record: a };
}

beforeEach(() => {
  useDecisionsMock.mockReset();
  useApproachesMock.mockReset();
  // Default: empty cross-ref index. Individual tests override.
  useDecisionsMock.mockReturnValue({ data: decisionsResponse([]), loading: false, error: null });
  useApproachesMock.mockReturnValue({ data: approachesResponse([]), loading: false, error: null });
});

describe("RRecordViewer — decision", () => {
  it("renders the header identity facts (repo · kind, title, slug, status, category)", () => {
    const { container } = render(
      <RRecordViewer
        selected={decisionSelection(decision())}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Scope to the header — the category ("principle") also appears in the
    // frontmatter table below, so a global query would match twice.
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    if (header === null) return;
    expect(within(header).getByText("The Decision")).toBeTruthy();
    expect(within(header).getByText("2026-05-01-the-decision")).toBeTruthy();
    expect(within(header).getByText("accepted")).toBeTruthy();
    // Header carries the kind-fact (category) and the repo · kind label.
    expect(within(header).getByText("principle")).toBeTruthy();
    expect(within(header).getByText("u · decision")).toBeTruthy();
  });

  it("renders the decision frontmatter fields (category, contract_surface, governs, supersede chains)", () => {
    render(
      <RRecordViewer
        selected={decisionSelection(
          decision({
            governs: ["src/a.ts", "src/b.ts"],
            superseded_by: ["2026-06-01-newer"],
            strengthened_by: ["2026-05-20-also"],
          }),
        )}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("contract_surface")).toBeTruthy();
    expect(screen.getByText("governs")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
    expect(screen.getByText("src/b.ts")).toBeTruthy();
    expect(screen.getByText("superseded_by")).toBeTruthy();
    expect(screen.getByText("strengthened_by")).toBeTruthy();
  });

  it("shows the drift indicator when stale_since is present", () => {
    render(
      <RRecordViewer
        selected={decisionSelection(
          decision({
            last_verified: "2026-05-01",
            stale_since: {
              path: "src/lib/api.ts",
              change_date: "2026-05-20",
              change_sha: "abc1234",
              change_subject: "rename the field",
            },
          }),
        )}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Drift")).toBeTruthy();
    expect(screen.getByText(/changed 2026-05-20 after last-verified 2026-05-01/)).toBeTruthy();
  });

  it("omits the drift indicator when stale_since is null", () => {
    render(
      <RRecordViewer
        selected={decisionSelection(decision({ stale_since: null }))}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Drift")).toBeNull();
  });

  it("returns to the inventory via the ‹ Inventory back affordance (clears the focus)", () => {
    const onClose = vi.fn();
    render(
      <RRecordViewer
        selected={decisionSelection(decision())}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={onClose}
      />,
    );
    // Focus mode: closing returns to the inventory; still wired to onClose.
    fireEvent.click(screen.getByRole("button", { name: /Back to inventory/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fills the R region — carries no fixed clamp width (focus mode rides the R column)", () => {
    const { container } = render(
      <RRecordViewer
        selected={decisionSelection(decision())}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const root = container.querySelector('[data-testid="r-record-viewer"]');
    expect(root).not.toBeNull();
    expect(root?.className ?? "").not.toMatch(/w-\[/);
    expect(root?.className ?? "").toMatch(/flex-1/);
  });

  it("uses NO severity-color classes on facts (negative space)", () => {
    const { container } = render(
      <RRecordViewer
        selected={decisionSelection(
          decision({
            stale_since: {
              path: "src/lib/api.ts",
              change_date: "2026-05-20",
              change_sha: "abc",
              change_subject: "x",
            },
          }),
        )}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-warning/);
    expect(html).not.toMatch(/text-destructive/);
    expect(html).not.toMatch(/text-success/);
  });
});

describe("RRecordViewer — approach", () => {
  it("renders the approach frontmatter fields (serves, governs, confidence, replaced_by)", () => {
    render(
      <RRecordViewer
        selected={approachSelection(approach({ confidence: "low", replaced_by: ["2026-06-01-x"] }))}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("serves")).toBeTruthy();
    expect(screen.getByText("confidence")).toBeTruthy();
    expect(screen.getByText("low")).toBeTruthy();
    expect(screen.getByText("replaced_by")).toBeTruthy();
  });

  it("hoists success and failure signals for approaches", () => {
    render(
      <RRecordViewer
        selected={approachSelection(approach())}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Success signal")).toBeTruthy();
    expect(screen.getByText("the metric climbs")).toBeTruthy();
    expect(screen.getByText("Failure signal")).toBeTruthy();
    expect(screen.getByText("the metric stalls")).toBeTruthy();
  });

  it("marks a past date trigger ready and leaves a future one unmarked", () => {
    render(
      <RRecordViewer
        selected={approachSelection(
          approach({
            review_triggers: [
              { kind: "date", value: "2020-01-01" },
              { kind: "date", value: "2099-01-01" },
            ],
          }),
        )}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/review-trigger ready: 2020-01-01/)).toBeTruthy();
    expect(screen.queryByText(/review-trigger ready: 2099-01-01/)).toBeNull();
  });

  it("lists a manual trigger plainly (no fired/not-fired claim)", () => {
    render(
      <RRecordViewer
        selected={approachSelection(
          approach({
            review_triggers: [{ kind: "manual", description: "re-check after the migration" }],
          }),
        )}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/manual: re-check after the migration/)).toBeTruthy();
    expect(screen.queryByText(/review-trigger ready/)).toBeNull();
  });
});

describe("RRecordViewer — excerpt + cross-refs", () => {
  it("renders the excerpt as markdown", () => {
    render(
      <RRecordViewer
        selected={decisionSelection(
          decision({ excerpt: "## Decision\n\nWe **commit** to the thing." }),
        )}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // The `## Decision` heading renders (h2) and the bold text is present.
    expect(screen.getByRole("heading", { name: "Decision" })).toBeTruthy();
    expect(screen.getByText("commit")).toBeTruthy();
  });

  it("makes a frontmatter slug that resolves clickable, re-focusing R₂ on it", () => {
    // The serves[] target exists in the decisions set → resolvable.
    const target = decision({ slug: "2026-05-01-the-decision", title: "The Decision" });
    useDecisionsMock.mockReturnValue({
      data: decisionsResponse([target]),
      loading: false,
      error: null,
    });
    const onSelectRecord = vi.fn();
    render(
      <RRecordViewer
        selected={approachSelection(approach({ serves: ["2026-05-01-the-decision"] }))}
        unitName="u"
        onSelectRecord={onSelectRecord}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2026-05-01-the-decision" }));
    expect(onSelectRecord).toHaveBeenCalledTimes(1);
    const arg = onSelectRecord.mock.calls[0][0] as SelectedRecord;
    expect(arg.kind).toBe("decision");
    expect(arg.record.slug).toBe("2026-05-01-the-decision");
  });

  it("leaves an unresolved frontmatter slug as plain, non-clickable text", () => {
    // Nothing in either set resolves the slug.
    const onSelectRecord = vi.fn();
    render(
      <RRecordViewer
        selected={approachSelection(approach({ serves: ["2026-01-01-ghost"] }))}
        unitName="u"
        onSelectRecord={onSelectRecord}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("2026-01-01-ghost")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "2026-01-01-ghost" })).toBeNull();
  });

  it("renders governs entries as plain paths, never cross-refs", () => {
    // Even when a governs path string coincidentally matches a known slug,
    // governs entries are PATHS and must stay plain (never clickable).
    const target = decision({ slug: "doc/decisions/", title: "Edge" });
    useDecisionsMock.mockReturnValue({
      data: decisionsResponse([target]),
      loading: false,
      error: null,
    });
    render(
      <RRecordViewer
        selected={approachSelection(approach({ governs: ["doc/decisions/"] }))}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "doc/decisions/" })).toBeNull();
  });

  it("makes a [[slug]] wiki-link in the excerpt clickable and re-focuses on click", () => {
    const target = approach({ slug: "2026-05-10-the-approach", title: "The Approach" });
    useApproachesMock.mockReturnValue({
      data: approachesResponse([target]),
      loading: false,
      error: null,
    });
    const onSelectRecord = vi.fn();
    render(
      <RRecordViewer
        selected={decisionSelection(
          decision({ excerpt: "See [[2026-05-10-the-approach]] for the experiment." }),
        )}
        unitName="u"
        onSelectRecord={onSelectRecord}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2026-05-10-the-approach" }));
    expect(onSelectRecord).toHaveBeenCalledTimes(1);
    const arg = onSelectRecord.mock.calls[0][0] as SelectedRecord;
    expect(arg.kind).toBe("approach");
    expect(arg.record.slug).toBe("2026-05-10-the-approach");
  });

  it("leaves an unresolved [[slug]] in the excerpt as plain text", () => {
    render(
      <RRecordViewer
        selected={decisionSelection(decision({ excerpt: "See [[2026-01-01-ghost]] (missing)." }))}
        unitName="u"
        onSelectRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("2026-01-01-ghost")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "2026-01-01-ghost" })).toBeNull();
  });
});
