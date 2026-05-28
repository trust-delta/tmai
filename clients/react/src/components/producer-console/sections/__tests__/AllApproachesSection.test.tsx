// @vitest-environment jsdom
//
// AllApproachesSection — the operator dashboard's task-selection
// surface (sibling to the verdict-inbox).
//
// Asserts on the #462 Amendment 2026-05-28 contract:
//   • Renders every status on the wire (Planned / Partial / Ready /
//     Running / Validated / Rejected / Replaced); the client filters,
//     tmai does not.
//   • Status filter chips toggle visibility client-side, no refetch.
//   • Verification-debt gauge counts `status: running` ONLY — never
//     blends in ready / planned / partial / validated / rejected /
//     replaced (per tmai-core#462 body).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApproachesResponse,
  ApproachStatus,
  ApproachWire,
  RepoApproachesWire,
} from "@/lib/api";

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

import { AllApproachesSection } from "../AllApproachesSection";

function approachStub(overrides: Partial<ApproachWire> = {}): ApproachWire {
  return {
    slug: "2026-05-27-an-approach",
    title: "An approach",
    date: "2026-05-27",
    status: "running",
    governs: [],
    serves: [],
    success_signal: "ok",
    failure_signal: "not ok",
    review_triggers: [{ kind: "date", value: "2099-01-01" }],
    review_history: [],
    confidence: null,
    replaced_by: [],
    excerpt: "…",
    ...overrides,
  };
}

const ALL_STATUSES: readonly ApproachStatus[] = [
  "planned",
  "partial",
  "ready",
  "running",
  "validated",
  "rejected",
  "replaced",
];

function fullRosterRepo(): RepoApproachesWire {
  return {
    repo_label: "tmai-core",
    repo_root: "/home/u/works/tmai-core",
    primary: true,
    repo_head: "abc1234",
    approaches: ALL_STATUSES.map((s) =>
      approachStub({
        slug: `2026-05-27-${s}-row`,
        title: `${s} approach`,
        status: s,
      }),
    ),
  };
}

function responseStub(overrides: Partial<ApproachesResponse> = {}): ApproachesResponse {
  return {
    unit: "tmai",
    composed_at: "2026-05-27T01:00:00Z",
    repos: [fullRosterRepo()],
    ...overrides,
  };
}

beforeEach(() => {
  approachesMock.mockReset();
});

describe("AllApproachesSection", () => {
  it("shows a pick-a-project notice when unitName is null and does not fetch", () => {
    render(<AllApproachesSection unitName={null} />);
    expect(screen.getByText(/Pick a project/i)).toBeTruthy();
    expect(approachesMock).not.toHaveBeenCalled();
  });

  it("renders one row per approach across all 7 statuses", async () => {
    approachesMock.mockResolvedValue(responseStub());
    render(<AllApproachesSection unitName="tmai" />);

    for (const s of ALL_STATUSES) {
      await waitFor(() => {
        expect(screen.getByText(new RegExp(`2026-05-27-${s}-row`))).toBeTruthy();
      });
    }
  });

  it("toggles a status off via its filter chip and back on (client-side, no refetch)", async () => {
    approachesMock.mockResolvedValue(responseStub());
    render(<AllApproachesSection unitName="tmai" />);

    // Wait for first paint then snapshot the fetch count.
    await waitFor(() => {
      expect(screen.getByText(/2026-05-27-rejected-row/)).toBeTruthy();
    });
    const callsBefore = approachesMock.mock.calls.length;

    // Toggle "rejected" off — the row should disappear, no new fetch.
    const rejectedChip = screen.getByRole("button", { name: /^rejected\b/ });
    expect(rejectedChip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(rejectedChip);
    await waitFor(() => {
      expect(screen.queryByText(/2026-05-27-rejected-row/)).toBeNull();
    });
    expect(rejectedChip.getAttribute("aria-pressed")).toBe("false");
    expect(approachesMock.mock.calls.length).toBe(callsBefore);

    // Other statuses remain visible.
    expect(screen.getByText(/2026-05-27-running-row/)).toBeTruthy();
    expect(screen.getByText(/2026-05-27-validated-row/)).toBeTruthy();

    // Toggle back on — the row returns.
    fireEvent.click(rejectedChip);
    await waitFor(() => {
      expect(screen.getByText(/2026-05-27-rejected-row/)).toBeTruthy();
    });
    expect(rejectedChip.getAttribute("aria-pressed")).toBe("true");
  });

  it("verification-debt gauge counts running approaches ONLY (per tmai-core#462)", async () => {
    // 2 running among many other statuses — gauge must read "2", never
    // anything that would bleed in ready / planned / partial.
    approachesMock.mockResolvedValue(
      responseStub({
        repos: [
          {
            repo_label: "tmai-core",
            repo_root: "/home/u/works/tmai-core",
            primary: true,
            repo_head: "abc1234",
            approaches: [
              approachStub({ slug: "2026-05-27-running-1", status: "running" }),
              approachStub({ slug: "2026-05-27-running-2", status: "running" }),
              approachStub({ slug: "2026-05-27-ready-1", status: "ready" }),
              approachStub({ slug: "2026-05-27-ready-2", status: "ready" }),
              approachStub({ slug: "2026-05-27-planned-1", status: "planned" }),
              approachStub({ slug: "2026-05-27-partial-1", status: "partial" }),
              approachStub({ slug: "2026-05-27-validated-1", status: "validated" }),
              approachStub({ slug: "2026-05-27-rejected-1", status: "rejected" }),
              approachStub({ slug: "2026-05-27-replaced-1", status: "replaced" }),
            ],
          },
        ],
      }),
    );

    render(<AllApproachesSection unitName="tmai" />);

    const gauge = await screen.findByTestId("verification-gauge");
    expect(gauge.textContent).toMatch(/Verification debt:\s*2\s*running/);
    // The gauge does NOT pluralise to the full count when other statuses
    // are present — the number is running-only.
    expect(gauge.textContent).not.toMatch(/9\s*running/);
  });

  it("renders an empty-state notice when the unit has no approaches", async () => {
    approachesMock.mockResolvedValue(responseStub({ repos: [] }));
    render(<AllApproachesSection unitName="newunit" />);

    await waitFor(() => {
      expect(screen.getByText(/No approaches for/i)).toBeTruthy();
    });
  });

  it("stays quiet on fetch errors (sibling Verdict-inbox surfaces the error verbatim)", async () => {
    approachesMock.mockRejectedValue(new Error("boom"));
    render(<AllApproachesSection unitName="tmai" />);

    // No "failed" alarm here — we let the sibling Verdict-inbox surface
    // the same fetch failure to avoid double-alarming the operator.
    await waitFor(() => {
      expect(screen.queryByText(/loading…/i)).toBeNull();
    });
    expect(screen.queryByText(/Failed to load/i)).toBeNull();
    expect(screen.queryByText(/All approaches/)).toBeTruthy(); // header still present
  });
});
