// @vitest-environment jsdom
//
// RObservationsSection — flat per-repo list, summary + plain status badge,
// no record viewer (rows are not clickable), no severity styling. The 5th
// attention-artifact section, local-dimension peer of approaches.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionControls } from "@/hooks/useUnitAttention";
import type { ObservationsResponse, ObservationWire } from "@/lib/api";

const observationsMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      observations: (...args: unknown[]) => observationsMock(...args),
    },
  };
});

import { RObservationsSection } from "../RObservationsSection";

function observationStub(overrides: Partial<ObservationWire> = {}): ObservationWire {
  return {
    slug: "2026-06-01-o",
    summary: "Observation O",
    status: "medium",
    ...overrides,
  };
}

function responseStub(observations: ObservationWire[] = []): ObservationsResponse {
  return {
    unit: "u",
    composed_at: "2026-06-04T00:00:00Z",
    repos: [
      {
        repo_label: "u",
        repo_root: "/p/u",
        primary: true,
        repo_head: null,
        observations,
      },
    ],
  };
}

beforeEach(() => {
  observationsMock.mockReset();
});

describe("RObservationsSection", () => {
  it("renders one row per observation with summary + status badge", async () => {
    observationsMock.mockResolvedValue(
      responseStub([
        observationStub({ slug: "2026-06-02-high", summary: "High one", status: "high" }),
        observationStub({ slug: "2026-06-01-low", summary: "Low one", status: "low" }),
      ]),
    );

    render(<RObservationsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("High one")).toBeTruthy();
    });
    expect(screen.getByText("Low one")).toBeTruthy();
    // The status badge surfaces the appraisal weight inline.
    const badges = screen.getAllByTestId("observation-status");
    const badgeText = badges.map((b) => b.textContent);
    expect(badgeText).toContain("high");
    expect(badgeText).toContain("low");
  });

  it("sorts rows most-recent-first by slug", async () => {
    observationsMock.mockResolvedValue(
      responseStub([
        observationStub({ slug: "2026-05-01-old", summary: "Old note" }),
        observationStub({ slug: "2026-06-15-new", summary: "New note" }),
      ]),
    );

    render(<RObservationsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    const newRow = await screen.findByText("New note");
    const oldRow = screen.getByText("Old note");
    // New (later slug) comes before Old.
    expect(newRow.compareDocumentPosition(oldRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("header count is the plain total (no severity styling)", async () => {
    observationsMock.mockResolvedValue(
      responseStub([
        observationStub({ slug: "a", status: "high" }),
        observationStub({ slug: "b", status: "medium" }),
        observationStub({ slug: "c", status: "low" }),
      ]),
    );
    const { container } = render(
      <RObservationsSection unitName="u" expanded={false} onToggle={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("3")).toBeTruthy();
    });
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });

  it("rows are NOT clickable-to-viewer (no buttons in the body)", async () => {
    observationsMock.mockResolvedValue(
      responseStub([observationStub({ slug: "2026-06-01-o", summary: "Observation O" })]),
    );
    render(<RObservationsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await screen.findByText("Observation O");
    // The only button in the section is the accordion header toggle — the
    // observation row itself is plain text, not a button (no record viewer).
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toMatch(/Observations/);
  });

  it("renders a per-row attention marker keyed by section=observation when controls are threaded", async () => {
    observationsMock.mockResolvedValue(
      responseStub([observationStub({ slug: "2026-06-01-o", summary: "Observation O" })]),
    );
    // The marker only reads `level` for the (repoPath, "observation", slug)
    // triple — the load-bearing wiring this issue adds (the 5th artifact).
    const attention: AttentionControls = {
      levelFor: (repoPath, section, id) =>
        repoPath === "/p/u" && section === "observation" && id === "2026-06-01-o" ? "high" : null,
      setAttention: vi.fn(),
      settingKey: null,
    };
    render(
      <RObservationsSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        attention={attention}
      />,
    );

    await screen.findByText("Observation O");
    const marker = screen.getByTestId("attention-marker");
    expect(marker.getAttribute("data-level")).toBe("high");
  });

  it("shows a placeholder when there are no observations", async () => {
    observationsMock.mockResolvedValue(responseStub([]));
    render(<RObservationsSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("No observations.")).toBeTruthy();
    });
  });

  it("parks with a placeholder when no project is selected", () => {
    render(<RObservationsSection unitName={null} expanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/Pick a project to see observations\./)).toBeTruthy();
    // Parked hook does not fetch.
    expect(observationsMock).not.toHaveBeenCalled();
  });

  it("renders a per-repo label only when the unit spans multiple repos", async () => {
    observationsMock.mockResolvedValue({
      unit: "u",
      composed_at: "2026-06-04T00:00:00Z",
      repos: [
        {
          repo_label: "core",
          repo_root: "/p/core",
          primary: true,
          repo_head: null,
          observations: [observationStub({ slug: "2026-06-01-c", summary: "Core note" })],
        },
        {
          repo_label: "ui",
          repo_root: "/p/ui",
          primary: false,
          repo_head: null,
          observations: [observationStub({ slug: "2026-06-01-u", summary: "Ui note" })],
        },
      ],
    } satisfies ObservationsResponse);

    render(<RObservationsSection unitName="u" expanded={true} onToggle={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Core note")).toBeTruthy();
    });
    expect(screen.getByText("core")).toBeTruthy();
    expect(screen.getByText("ui")).toBeTruthy();
  });
});
