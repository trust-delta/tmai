// @vitest-environment jsdom
//
// SettledDecisionsSection — wired to `useDecisions(unitName)` against
// the live `GET /api/units/{unit}/decisions` endpoint (tmai-core #359).
//
// We mock `api.decisions` so each test feeds a deterministic response
// shape and asserts on the bucketed render. Per the simulated-onboarded
// posture DR, the section must:
//   - render a "pick a project" notice when unitName is null
//   - render a "Showing this unit's primary repo only" caveat when a
//     single repo is returned (= today's reality until tmai-core#340)
//   - never fabricate decisions on error / empty payload

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionsResponse, RepoDecisionsWire } from "@/lib/api";
import { SettledDecisionsSection } from "../SettledDecisionsSection";

const decisionsMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      decisions: (...args: unknown[]) => decisionsMock(...args),
    },
  };
});

function repoStub(overrides: Partial<RepoDecisionsWire> = {}): RepoDecisionsWire {
  return {
    repo_label: "tmai",
    repo_root: "/home/u/works/tmai",
    primary: true,
    repo_head: "abc1234",
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
    in_play: [],
    warm: [],
    cold: [],
    superseded: [],
    ...overrides,
  };
}

function responseStub(overrides: Partial<DecisionsResponse> = {}): DecisionsResponse {
  return {
    unit: "tmai",
    composed_at: "2026-05-15T01:00:00Z",
    repos: [repoStub()],
    ...overrides,
  };
}

beforeEach(() => {
  decisionsMock.mockReset();
});

describe("SettledDecisionsSection", () => {
  it("shows a pick-a-project notice when unitName is null and does not fetch", () => {
    render(<SettledDecisionsSection unitName={null} />);
    expect(screen.getByText(/Pick a project/i)).toBeTruthy();
    expect(decisionsMock).not.toHaveBeenCalled();
  });

  it("renders the bucketed payload and the single-repo caveat", async () => {
    decisionsMock.mockResolvedValue(
      responseStub({
        repos: [
          repoStub({
            counts: {
              total: 3,
              in_play: 1,
              warm: 0,
              cold: 0,
              foundations: 2,
              superseded: 0,
              stale_suspect: 0,
            },
            foundations: [
              {
                slug: "2026-05-13-tmai-is-a-producer-exoskeleton",
                title: "tmai is a Producer exoskeleton",
                status: "accepted",
                category: "foundational",
                governs: [],
                last_verified: "2026-05-13",
                contract_surface: false,
                stale_since: null,
                superseded_by: [],
                strengthened_by: [],
                excerpt: "tmai is the Producer's external skeleton…",
              },
              {
                slug: "2026-05-12-producer-layer-topology",
                title: "Producer-layer topology",
                status: "accepted",
                category: "foundational",
                governs: [],
                last_verified: "2026-05-12",
                contract_surface: false,
                stale_since: null,
                superseded_by: [],
                strengthened_by: [],
                excerpt: "1 project ⊇ 1+ repos…",
              },
            ],
            in_play: [
              {
                slug: "2026-05-14-handoff-lifecycle-and-kill-ux",
                title: "Handoff lifecycle and kill UX",
                status: "proposed",
                category: "scoped",
                governs: ["crates/tmai-core/src/workbench/"],
                last_verified: "2026-05-14",
                contract_surface: true,
                stale_since: null,
                superseded_by: [],
                strengthened_by: [],
                excerpt: "Atomic 1-set ritual gated on ctx%…",
              },
            ],
          }),
        ],
      }),
    );

    render(<SettledDecisionsSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/2026-05-13-tmai-is-a-producer-exoskeleton/)).toBeTruthy();
    });
    expect(screen.getByText(/2026-05-14-handoff-lifecycle-and-kill-ux/)).toBeTruthy();
    // Single-repo caveat per the posture DR.
    expect(screen.getByText(/primary repo only/i)).toBeTruthy();
    // Counts line.
    expect(screen.getByText(/3 decisions/)).toBeTruthy();
    // Contract-surface marker rendered for the wire-touching decision.
    expect(screen.getByText(/\[contract\]/)).toBeTruthy();
  });

  it("renders the ⚠ Currency sweep callout when items are present", async () => {
    decisionsMock.mockResolvedValue(
      responseStub({
        repos: [
          repoStub({
            counts: {
              total: 1,
              in_play: 0,
              warm: 1,
              cold: 0,
              foundations: 0,
              superseded: 0,
              stale_suspect: 1,
            },
            currency_sweep: [
              {
                slug: "2026-04-21-monorepo-reconsolidation",
                title: "Monorepo re-consolidation",
                stale: {
                  path: "src/web/api.rs",
                  change_date: "2026-05-14",
                  change_sha: "deadbee",
                  change_subject: "feat(api): handoff ritual endpoint",
                },
                last_verified: "2026-04-21",
                remedy: "Re-verify the decision against current `src/web/api.rs`.",
              },
            ],
            warm: [
              {
                slug: "2026-04-21-monorepo-reconsolidation",
                title: "Monorepo re-consolidation",
                status: "accepted",
                category: "scoped",
                governs: ["src/web/api.rs"],
                last_verified: "2026-04-21",
                contract_surface: false,
                stale_since: {
                  path: "src/web/api.rs",
                  change_date: "2026-05-14",
                  change_sha: "deadbee",
                  change_subject: "feat(api): handoff ritual endpoint",
                },
                superseded_by: [],
                strengthened_by: [],
                excerpt: "…",
              },
            ],
          }),
        ],
      }),
    );

    render(<SettledDecisionsSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/Currency sweep \(1\)/)).toBeTruthy();
    });
    expect(
      screen.getByText(/Re-verify the decision against current `src\/web\/api\.rs`\./),
    ).toBeTruthy();
  });

  it("surfaces fetch errors honestly instead of fabricating an empty render", async () => {
    decisionsMock.mockRejectedValue(new Error("boom"));

    render(<SettledDecisionsSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load decisions/)).toBeTruthy();
    });
    expect(screen.getByText(/boom/)).toBeTruthy();
    // No fake bucketed render.
    expect(screen.queryByText(/Foundations/)).toBeNull();
  });

  it("renders an empty-state notice when the unit has no decisions", async () => {
    decisionsMock.mockResolvedValue(responseStub({ repos: [] }));

    render(<SettledDecisionsSection unitName="newunit" />);

    await waitFor(() => {
      expect(screen.getByText(/No decisions resolved for/i)).toBeTruthy();
    });
  });

  it("warm and cold buckets are collapsed by default and expand on click", async () => {
    decisionsMock.mockResolvedValue(
      responseStub({
        repos: [
          repoStub({
            counts: {
              total: 1,
              in_play: 0,
              warm: 0,
              cold: 1,
              foundations: 0,
              superseded: 0,
              stale_suspect: 0,
            },
            cold: [
              {
                slug: "2026-04-01-something-old",
                title: "Something old",
                status: "accepted",
                category: "scoped",
                governs: [],
                last_verified: "2026-04-01",
                contract_surface: false,
                stale_since: null,
                superseded_by: [],
                strengthened_by: [],
                excerpt: "…",
              },
            ],
          }),
        ],
      }),
    );

    render(<SettledDecisionsSection unitName="tmai" />);

    const coldButton = await screen.findByRole("button", { name: /Cold/ });
    // Collapsed initially — the slug should not be in the DOM.
    expect(screen.queryByText(/2026-04-01-something-old/)).toBeNull();
    fireEvent.click(coldButton);
    await waitFor(() => {
      expect(screen.getByText(/2026-04-01-something-old/)).toBeTruthy();
    });
  });
});
