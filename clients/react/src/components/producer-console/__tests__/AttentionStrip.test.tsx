// @vitest-environment jsdom
//
// AttentionStrip — P1 of the L/C/R co-visible re-layout
// (`doc/decisions/2026-05-14-react-producer-console-rebuild.md`
// §Refinement 2026-05-22). The strip is the dumb status subset (Fork A)
// that reuses four self-contained Producer-console sections. We mock the
// three data hooks (`useHandover` for the client-derived sections,
// `useUnitPrs` / `useApproaches` for the wire-backed ones) so each render
// presents a deterministic, network-free shape and we can assert:
//   - all four attention sections render when expanded;
//   - `attentionOnly` drops the ambient worktree list (strip ≠ digest);
//   - the collapsed rail hides the sections and exposes an expand control;
//   - cross-unit clicks route to onSelectProjectByPath.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoverDigest } from "@/hooks/useHandover";
import type { ApproachesResponse, PrSummaryWire, UnitPrsResponse } from "@/lib/api";
import { AttentionStrip } from "../AttentionStrip";

const useHandoverMock = vi.fn();
const useUnitPrsMock = vi.fn();
const useApproachesMock = vi.fn();

vi.mock("@/hooks/useHandover", () => ({
  useHandover: (path: string | null) => useHandoverMock(path),
}));

vi.mock("@/hooks/useUnitPrs", () => ({
  useUnitPrs: (unit: string | null) => useUnitPrsMock(unit),
}));

vi.mock("@/hooks/useApproaches", () => ({
  useApproaches: (unit: string | null) => useApproachesMock(unit),
}));

function digest(overrides: Partial<HandoverDigest> = {}): HandoverDigest {
  return {
    whereYouLeftOff: overrides.whereYouLeftOff ?? {
      activeProjectPath: null,
      activeProjectName: null,
      worktrees: [],
      attentionAgents: [],
    },
    crossUnit: overrides.crossUnit ?? { units: [] },
    missingPreconditions: overrides.missingPreconditions ?? {
      noLiveAgents: true,
      singleUnitOnly: false,
    },
  };
}

function emptyPrs(): { data: UnitPrsResponse | null; loading: boolean; error: Error | null } {
  const data: UnitPrsResponse = { unit: "stub", repos: [] };
  return { data, loading: false, error: null };
}

function emptyApproaches(): {
  data: ApproachesResponse | null;
  loading: boolean;
  error: Error | null;
} {
  const data: ApproachesResponse = {
    unit: "stub",
    composed_at: "2026-05-22T00:00:00Z",
    repos: [],
  };
  return { data, loading: false, error: null };
}

beforeEach(() => {
  useHandoverMock.mockReset();
  useUnitPrsMock.mockReset();
  useApproachesMock.mockReset();
  useUnitPrsMock.mockReturnValue(emptyPrs());
  useApproachesMock.mockReturnValue(emptyApproaches());
});

function makeProps(overrides: Partial<Parameters<typeof AttentionStrip>[0]> = {}) {
  return {
    currentProjectPath: "/p/alpha",
    unitName: "alpha",
    onSelectProjectByPath: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    ...overrides,
  };
}

describe("AttentionStrip", () => {
  it("renders all four attention sections when expanded", () => {
    useHandoverMock.mockReturnValue(digest());

    render(<AttentionStrip {...makeProps()} />);

    expect(screen.getByRole("heading", { name: /Attention/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Where you left off/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Active approaches/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Open PRs/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Cross-unit status/ })).toBeTruthy();
  });

  it("shows attention agents but NOT the ambient worktree list (attentionOnly)", () => {
    useHandoverMock.mockReturnValue(
      digest({
        whereYouLeftOff: {
          activeProjectPath: "/p/alpha",
          activeProjectName: "alpha",
          // A worktree the centre digest would show — the strip must not.
          worktrees: [
            {
              name: "feature-xyz",
              branch: "feat/xyz",
              path: "/p/alpha-wt",
              isMain: false,
              dirty: true,
              agentCount: 1,
            },
          ],
          attentionAgents: [
            {
              target: "claude:1",
              displayName: "halted-agent",
              attention: "halted",
              cwd: "/p/alpha",
              isOrchestrator: false,
            },
          ],
        },
      }),
    );

    render(<AttentionStrip {...makeProps()} />);

    // The blocked agent is surfaced …
    expect(screen.getByText("halted-agent")).toBeTruthy();
    // … but the worktree row is not (worktrees are ambient, not attention).
    expect(screen.queryByText("feature-xyz")).toBeNull();
  });

  it("renders an open PR row in the strip (reuses UnitPrsSection)", () => {
    useHandoverMock.mockReturnValue(digest());
    const pr: PrSummaryWire = {
      number: 707n,
      title: "token lock + light theme",
      state: "OPEN",
      head_branch: "feat/tokens",
      head_sha: "abc1234",
      base_branch: "main",
      url: "https://example.test/pr/707",
      review_decision: "APPROVED",
      check_status: "SUCCESS",
      is_draft: false,
      additions: 120n,
      deletions: 7n,
      comments: 2n,
      reviews: 1n,
      author: "trust-delta",
      merge_commit_sha: null,
    };
    const data: UnitPrsResponse = {
      unit: "alpha",
      repos: [{ repo_path: "/p/alpha", repo_label: "alpha", primary: true, prs: [pr] }],
    };
    useUnitPrsMock.mockReturnValue({ data, loading: false, error: null });

    render(<AttentionStrip {...makeProps()} />);

    expect(screen.getByText(/token lock \+ light theme/)).toBeTruthy();
    expect(screen.getByText("CI ✓")).toBeTruthy();
  });

  it("routes a cross-unit click to onSelectProjectByPath", () => {
    const onSelect = vi.fn();
    useHandoverMock.mockReturnValue(
      digest({
        crossUnit: {
          units: [
            {
              path: "/p/alpha",
              name: "alpha",
              state: "needs-you",
              agentCount: 2,
              attentionCount: 1,
            },
            { path: "/p/beta", name: "beta", state: "quiet", agentCount: 0, attentionCount: 0 },
          ],
        },
      }),
    );

    const { container } = render(
      <AttentionStrip {...makeProps({ onSelectProjectByPath: onSelect })} />,
    );

    const betaButton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("beta"),
    );
    expect(betaButton).toBeTruthy();
    betaButton?.click();
    expect(onSelect).toHaveBeenCalledWith("/p/beta", "beta");
  });

  it("collapses to a rail that hides the sections and exposes an expand control", () => {
    useHandoverMock.mockReturnValue(digest());
    const onToggle = vi.fn();

    render(<AttentionStrip {...makeProps({ collapsed: true, onToggleCollapsed: onToggle })} />);

    // Sections are gone in the collapsed rail …
    expect(screen.queryByRole("heading", { name: /Active approaches/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Open PRs/ })).toBeNull();

    // … and the strip stays addressable for the layout test.
    const strip = screen.getByTestId("attention-strip");
    expect(strip.getAttribute("data-collapsed")).toBe("true");

    const expandBtn = screen.getByRole("button", { name: /Expand attention strip/i });
    fireEvent.click(expandBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
