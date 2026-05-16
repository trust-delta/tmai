// @vitest-environment jsdom
//
// ActiveApproachesSection — the Verdict-inbox, wired to
// `useApproaches(unitName)` against `GET /api/units/{unit}/approaches`
// (tmai-core #369). We mock `api.approaches` so each test feeds a
// deterministic active-only payload and asserts on the band routing.
//
// Per the simulated-onboarded posture DR the section must: pick-a-project
// notice on null unit; honest error (no fabricated render); honest empty
// state; honest degradation for engine-only triggers + the settled gap
// (tmai-core#381); single-repo caveat (tmai-core#340).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApproachesResponse, ApproachWire, RepoApproachesWire } from "@/lib/api";

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

import { ActiveApproachesSection } from "../ActiveApproachesSection";

function approachStub(overrides: Partial<ApproachWire> = {}): ApproachWire {
  return {
    slug: "2026-05-16-some-approach",
    title: "Some approach",
    date: "2026-05-16",
    status: "active",
    governs: [],
    serves: ["2026-05-15-protect-scarce-human-judgment"],
    success_signal: "the thing works",
    failure_signal: "the thing does not work",
    review_triggers: [{ kind: "date", value: "2099-01-01" }],
    confidence: "high",
    replaced_by: [],
    excerpt: "…",
    ...overrides,
  };
}

function repoStub(overrides: Partial<RepoApproachesWire> = {}): RepoApproachesWire {
  return {
    repo_label: "tmai-core",
    repo_root: "/home/u/works/tmai-core",
    primary: true,
    repo_head: "abc1234",
    active: [],
    ...overrides,
  };
}

function responseStub(overrides: Partial<ApproachesResponse> = {}): ApproachesResponse {
  return {
    unit: "tmai",
    composed_at: "2026-05-16T01:00:00Z",
    repos: [repoStub()],
    ...overrides,
  };
}

beforeEach(() => {
  approachesMock.mockReset();
});

describe("ActiveApproachesSection", () => {
  it("shows a pick-a-project notice when unitName is null and does not fetch", () => {
    render(<ActiveApproachesSection unitName={null} />);
    expect(screen.getByText(/Pick a project/i)).toBeTruthy();
    expect(approachesMock).not.toHaveBeenCalled();
  });

  it("routes a fired date trigger into ⚡ Your verdict, open, with the verdict criteria", async () => {
    approachesMock.mockResolvedValue(
      responseStub({
        repos: [
          repoStub({
            active: [
              approachStub({
                slug: "2026-05-16-authority-derived-from-act",
                title: "Authority derived from the act",
                review_triggers: [{ kind: "date", value: "2020-01-01" }],
                success_signal: "corpus is clearer",
                failure_signal: "judgment-load is not lower",
              }),
            ],
          }),
        ],
      }),
    );

    render(<ActiveApproachesSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/Your verdict \(1\)/)).toBeTruthy();
    });
    // ⚡ band is open by default — slug + verdict criteria visible without a click.
    expect(screen.getByText(/2026-05-16-authority-derived-from-act/)).toBeTruthy();
    expect(screen.getByText(/date 2020-01-01 has passed/)).toBeTruthy();
    expect(screen.getByText(/corpus is clearer/)).toBeTruthy();
    expect(screen.getByText(/judgment-load is not lower/)).toBeTruthy();
  });

  it("routes a low-confidence approach into 🟡 Watch, collapsed, expands on click", async () => {
    approachesMock.mockResolvedValue(
      responseStub({
        repos: [
          repoStub({
            active: [
              approachStub({
                slug: "2026-05-16-low-conf-thing",
                confidence: "low",
                review_triggers: [{ kind: "date", value: "2099-01-01" }],
              }),
            ],
          }),
        ],
      }),
    );

    render(<ActiveApproachesSection unitName="tmai" />);

    const watchBtn = await screen.findByRole("button", { name: /Watch/ });
    // Collapsed initially.
    expect(screen.queryByText(/2026-05-16-low-conf-thing/)).toBeNull();
    fireEvent.click(watchBtn);
    await waitFor(() => {
      expect(screen.getByText(/2026-05-16-low-conf-thing/)).toBeTruthy();
    });
    expect(screen.getByText(/Producer confidence: low/)).toBeTruthy();
  });

  it("surfaces engine-only triggers honestly under Watch (not fabricated as fired)", async () => {
    approachesMock.mockResolvedValue(
      responseStub({
        repos: [
          repoStub({
            active: [
              approachStub({
                slug: "2026-05-16-manual-only",
                confidence: "high",
                review_triggers: [{ kind: "manual", description: "until codex work begins" }],
              }),
            ],
          }),
        ],
      }),
    );

    render(<ActiveApproachesSection unitName="tmai" />);

    // Lands in the collapsed Watch band (button by role, house pattern).
    const watchBtn = await screen.findByRole("button", { name: /Watch/ });
    expect(watchBtn.textContent).toMatch(/\(1\)/);
    // Not fabricated as fired — no fired date trigger.
    expect(screen.getByText(/⚡ No verdict due/)).toBeTruthy();
    // Honest degradation note references the tracking issue.
    expect(screen.getByText(/tmai-core#381/)).toBeTruthy();
  });

  it("surfaces fetch errors honestly instead of fabricating an empty render", async () => {
    approachesMock.mockRejectedValue(new Error("boom"));

    render(<ActiveApproachesSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load approaches/)).toBeTruthy();
    });
    expect(screen.getByText(/boom/)).toBeTruthy();
    expect(screen.queryByText(/Your verdict/)).toBeNull();
  });

  it("renders an empty-state notice when the unit has no active approaches", async () => {
    approachesMock.mockResolvedValue(responseStub({ repos: [] }));

    render(<ActiveApproachesSection unitName="newunit" />);

    await waitFor(() => {
      expect(screen.getByText(/No active approaches for/i)).toBeTruthy();
    });
  });

  it("shows the single-repo caveat (tmai-core#340)", async () => {
    approachesMock.mockResolvedValue(
      responseStub({ repos: [repoStub({ active: [approachStub()] })] }),
    );

    render(<ActiveApproachesSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/primary repo only/i)).toBeTruthy();
    });
    expect(screen.getByText(/tmai-core#340/)).toBeTruthy();
  });
});
