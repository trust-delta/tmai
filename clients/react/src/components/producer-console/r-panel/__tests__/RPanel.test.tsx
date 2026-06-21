// @vitest-environment jsdom
//
// RPanel — accordion shell + section persistence + collapsed rail.
// The artifact-section bodies are mocked so this test only proves the
// container behaviour (default-collapsed accordion, operator-toggled
// expand, localStorage persistence, no severity colors in rendered
// output). The Δ-stream / Calibration / Hand-over sections retired in
// §3-2b (#772), so they are no longer wired or mocked here.

import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";

// The panel itself polls the PR / issue lists for the collapsed rail's
// remote-Δ count (#822) — mocked so no real fetch fires; individual tests
// override the implementation to feed rail data.
const useUnitPrsMock = vi.fn();
const useUnitIssuesMock = vi.fn();
vi.mock("@/hooks/useUnitPrs", () => ({
  useUnitPrs: (unit: string | null) => useUnitPrsMock(unit),
}));
vi.mock("@/hooks/useUnitIssues", () => ({
  useUnitIssues: (unit: string | null) => useUnitIssuesMock(unit),
}));

beforeEach(() => {
  useUnitPrsMock.mockReset();
  useUnitIssuesMock.mockReset();
  useUnitPrsMock.mockReturnValue({ data: null, loading: false, error: null });
  useUnitIssuesMock.mockReturnValue({ data: null, loading: false, error: null });
});

vi.mock("../RPrsSection", () => ({
  RPrsSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button type="button" data-testid="prs-section" data-expanded={expanded} onClick={onToggle}>
      PRs
    </button>
  ),
}));
vi.mock("../RIssuesSection", () => ({
  RIssuesSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button type="button" data-testid="issues-section" data-expanded={expanded} onClick={onToggle}>
      Issues
    </button>
  ),
}));
vi.mock("../RDecisionsSection", () => ({
  RDecisionsSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="decisions-section"
      data-expanded={expanded}
      onClick={onToggle}
    >
      Decisions
    </button>
  ),
}));
vi.mock("../RApproachesSection", () => ({
  RApproachesSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button
      type="button"
      data-testid="approaches-section"
      data-expanded={expanded}
      onClick={onToggle}
    >
      Approaches
    </button>
  ),
}));
vi.mock("../RAimsSection", () => ({
  RAimsSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button type="button" data-testid="aims-section" data-expanded={expanded} onClick={onToggle}>
      Aims
    </button>
  ),
}));
vi.mock("../RFilesSection", () => ({
  RFilesSection: ({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) => (
    <button type="button" data-testid="files-section" data-expanded={expanded} onClick={onToggle}>
      Files
    </button>
  ),
}));

import { RPanel, type RPanelResize } from "../RPanel";

function makeResize(overrides: Partial<RPanelResize> = {}): RPanelResize {
  return {
    width: 320,
    isResizing: false,
    ratio: 0.5,
    onMouseDown: vi.fn(),
    onDoubleClick: vi.fn(),
    onAdjust: vi.fn(),
    ...overrides,
  };
}

function makeProps(overrides: Partial<Parameters<typeof RPanel>[0]> = {}) {
  return {
    currentProjectPath: "/p/u",
    unitName: "u",
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    resize: makeResize(),
    ...overrides,
  };
}

describe("RPanel — accordion shell", () => {
  it("renders the artifact sections, all collapsed by default (no tmai-side expand pick)", () => {
    // Use a fresh localStorage by setting the key to empty before mount.
    localStorage.setItem("tmai:ui:prefs", JSON.stringify({ rPanelExpandedSections: [] }));

    renderWithProviders(<RPanel {...makeProps()} />);

    const ids = [
      "prs-section",
      "issues-section",
      "decisions-section",
      "approaches-section",
      "aims-section",
      "files-section",
    ];
    for (const id of ids) {
      const el = screen.getByTestId(id);
      expect(el.getAttribute("data-expanded")).toBe("false");
    }
  });

  it("click on a section toggles + persists via localStorage", () => {
    localStorage.setItem("tmai:ui:prefs", JSON.stringify({ rPanelExpandedSections: [] }));

    renderWithProviders(<RPanel {...makeProps()} />);

    fireEvent.click(screen.getByTestId("decisions-section"));
    expect(screen.getByTestId("decisions-section").getAttribute("data-expanded")).toBe("true");

    const raw = localStorage.getItem("tmai:ui:prefs") ?? "{}";
    const parsed = JSON.parse(raw) as { rPanelExpandedSections: string[] };
    expect(parsed.rPanelExpandedSections).toContain("decisions");
  });

  it("restores expanded sections from persisted prefs on mount", () => {
    localStorage.setItem(
      "tmai:ui:prefs",
      JSON.stringify({ rPanelExpandedSections: ["prs", "files"] }),
    );

    renderWithProviders(<RPanel {...makeProps()} />);

    expect(screen.getByTestId("prs-section").getAttribute("data-expanded")).toBe("true");
    expect(screen.getByTestId("files-section").getAttribute("data-expanded")).toBe("true");
    expect(screen.getByTestId("decisions-section").getAttribute("data-expanded")).toBe("false");
  });

  it("collapses to a rail that hides the sections and exposes an expand control", () => {
    const onToggle = vi.fn();
    renderWithProviders(
      <RPanel {...makeProps({ collapsed: true, onToggleCollapsed: onToggle })} />,
    );

    const panel = screen.getByTestId("r-panel");
    expect(panel.getAttribute("data-collapsed")).toBe("true");
    expect(screen.queryByTestId("prs-section")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Expand R panel/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("focus mode: renders the viewer in place of the inventory (toggles, never stacks)", () => {
    // A focus is set → RPanel renders the R₂ viewer node IN the same column
    // (same drag-set width) instead of the R₁ inventory body. There is no
    // additive second column — the load-bearing C-width invariant.
    renderWithProviders(
      <RPanel {...makeProps({ viewer: <div data-testid="r2-viewer-stub">viewer</div> })} />,
    );

    const panel = screen.getByTestId("r-panel");
    // The viewer rides the SAME R panel column slot…
    expect(within(panel).getByTestId("r2-viewer-stub")).toBeTruthy();
    // …and the inventory sections are NOT additionally rendered (swap, not stack).
    expect(screen.queryByTestId("prs-section")).toBeNull();
    expect(screen.queryByTestId("decisions-section")).toBeNull();
    expect(screen.queryByTestId("files-section")).toBeNull();
    // Drag-resize machinery is preserved on the focused column.
    expect(within(panel).getByRole("separator", { name: /Resize R panel/ })).toBeTruthy();
  });

  it("uses NO severity-color classes in the rendered output (negative-space)", () => {
    const { container } = renderWithProviders(<RPanel {...makeProps()} />);
    const html = container.innerHTML;
    // Negative space: R must not surface warning / destructive / success
    // / primary saliency — the operator's appraisal is the only one.
    expect(html).not.toMatch(/text-warning/);
    expect(html).not.toMatch(/text-destructive/);
    expect(html).not.toMatch(/text-success/);
  });

  it("does NOT render priority / sort / needs-you filter controls (negative-space)", () => {
    renderWithProviders(<RPanel {...makeProps()} />);
    // No "needs you" filter chip / no "sort" affordance / no "priority" pill.
    expect(screen.queryByText(/needs you/i)).toBeNull();
    expect(screen.queryByText(/sort by/i)).toBeNull();
    expect(screen.queryByText(/priority/i)).toBeNull();
  });
});

// ── Remote-Δ freshness — close-act cursor (#822) ──
//
// Exactly TWO acts advance a cursor: the panel collapse (`panel`) and a
// PRs/Issues section collapse (`prs`/`issues`). The cursor is CLIENT STATE
// ONLY (ui-prefs blob) — never sent to any endpoint, never read by the
// Producer; there is no per-row read-marking and no mute affordance.

function readStoredCursors(): Record<string, Record<string, string>> {
  const raw = localStorage.getItem("tmai:ui:prefs") ?? "{}";
  return (
    (JSON.parse(raw) as { remoteDeltaCursors?: Record<string, Record<string, string>> })
      .remoteDeltaCursors ?? {}
  );
}

function freshPrefs(extra: Record<string, unknown> = {}): void {
  localStorage.setItem(
    "tmai:ui:prefs",
    JSON.stringify({ rPanelExpandedSections: [], remoteDeltaCursors: {}, ...extra }),
  );
}

describe("RPanel — remote-Δ close-act cursor (#822)", () => {
  it("the panel collapse button stamps the unit's `panel` cursor", () => {
    freshPrefs();
    const onToggle = vi.fn();
    renderWithProviders(<RPanel {...makeProps({ onToggleCollapsed: onToggle })} />);

    fireEvent.click(screen.getByRole("button", { name: /Collapse R panel/ }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    const cursors = readStoredCursors();
    expect(typeof cursors.u?.panel).toBe("string");
    expect(Number.isNaN(Date.parse(cursors.u.panel))).toBe(false);
  });

  it("a close act never leaves the client — it fires no fetch", () => {
    freshPrefs();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    try {
      renderWithProviders(<RPanel {...makeProps()} />);
      // Unrelated sections fetch on mount (RInventorySection is not stubbed
      // here) — snapshot the count, then prove the close act adds nothing.
      const callsBeforeAct = fetchSpy.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: /Collapse R panel/ }));
      // The cursor landed in localStorage only — no endpoint receives it
      // (core stays states-facts; the Producer never reads it).
      const stamped = readStoredCursors().u?.panel;
      expect(stamped).toBeTruthy();
      expect(fetchSpy.mock.calls.length).toBe(callsBeforeAct);
      // And no request so far ever carried the cursor.
      for (const call of fetchSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(stamped);
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("collapsing the PRs section stamps `prs`; re-expanding does NOT advance", () => {
    freshPrefs({ rPanelExpandedSections: ["prs"] });
    renderWithProviders(<RPanel {...makeProps()} />);

    // Close act → stamp.
    fireEvent.click(screen.getByTestId("prs-section"));
    const stamped = readStoredCursors().u?.prs;
    expect(typeof stamped).toBe("string");

    // Re-expand = the start of looking, not the end — cursor unchanged.
    fireEvent.click(screen.getByTestId("prs-section"));
    expect(readStoredCursors().u?.prs).toBe(stamped);
  });

  it("collapsing the Issues section stamps `issues` (and only that key)", () => {
    freshPrefs({ rPanelExpandedSections: ["issues"] });
    renderWithProviders(<RPanel {...makeProps()} />);

    fireEvent.click(screen.getByTestId("issues-section"));
    const cursors = readStoredCursors();
    expect(typeof cursors.u?.issues).toBe("string");
    expect(cursors.u?.prs).toBeUndefined();
    expect(cursors.u?.panel).toBeUndefined();
  });

  it("collapsing a non-PR/Issue section advances NO cursor", () => {
    freshPrefs({ rPanelExpandedSections: ["decisions"] });
    renderWithProviders(<RPanel {...makeProps()} />);

    fireEvent.click(screen.getByTestId("decisions-section"));
    expect(readStoredCursors()).toEqual({});
  });

  it("the collapsed rail's EXPAND button advances NO cursor (open ≠ close act)", () => {
    freshPrefs();
    const onToggle = vi.fn();
    renderWithProviders(
      <RPanel {...makeProps({ collapsed: true, onToggleCollapsed: onToggle })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Expand R panel/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(readStoredCursors()).toEqual({});
  });
});

describe("RPanel — collapsed-rail Δ count (#822)", () => {
  // Minimal wire rows: the rail count only reads the vocab timestamps.
  const railData = {
    prs: {
      data: {
        unit: "u",
        repos: [
          {
            repo_path: "/p/u",
            repo_label: "u",
            primary: true,
            prs: [
              {
                created_at: "2026-06-13T01:00:00Z",
                merged_at: null,
                closed_at: null,
                ci_completed_at: null,
              },
              {
                created_at: "2026-06-10T00:00:00Z",
                merged_at: null,
                closed_at: null,
                ci_completed_at: null,
              },
            ],
          },
        ],
      },
      loading: false,
      error: null,
    },
    issues: {
      data: {
        unit: "u",
        repos: [
          {
            repo_path: "/p/u",
            repo_label: "u",
            primary: true,
            issues: [{ created_at: "2026-06-13T02:00:00Z", closed_at: null }],
          },
        ],
      },
      loading: false,
      error: null,
    },
  };

  it("shows the unit total of unobserved PR + issue rows on the rail", () => {
    // Cursor at 2026-06-12: the 06-13 PR and the 06-13 issue are unobserved,
    // the 06-10 PR is observed → Δ2.
    freshPrefs({ remoteDeltaCursors: { u: { panel: "2026-06-12T00:00:00Z" } } });
    useUnitPrsMock.mockReturnValue(railData.prs);
    useUnitIssuesMock.mockReturnValue(railData.issues);

    renderWithProviders(<RPanel {...makeProps({ collapsed: true })} />);

    const badge = screen.getByTestId("r-rail-unobserved");
    expect(badge.textContent).toBe("Δ2");
    // Info-tone (cyan family) — a freshness fact, never the owed amber.
    expect(badge.className).toContain("text-info");
    expect(badge.className).not.toMatch(/warning/);
    // The rail polls the unit itself while the sections are unmounted.
    expect(useUnitPrsMock).toHaveBeenCalledWith("u");
    expect(useUnitIssuesMock).toHaveBeenCalledWith("u");
  });

  it("first run (no cursor) — every row is unobserved on the rail", () => {
    freshPrefs();
    useUnitPrsMock.mockReturnValue(railData.prs);
    useUnitIssuesMock.mockReturnValue(railData.issues);

    renderWithProviders(<RPanel {...makeProps({ collapsed: true })} />);
    expect(screen.getByTestId("r-rail-unobserved").textContent).toBe("Δ3");
  });

  it("renders no badge when everything has been observed", () => {
    freshPrefs({ remoteDeltaCursors: { u: { panel: "2026-06-14T00:00:00Z" } } });
    useUnitPrsMock.mockReturnValue(railData.prs);
    useUnitIssuesMock.mockReturnValue(railData.issues);

    renderWithProviders(<RPanel {...makeProps({ collapsed: true })} />);
    expect(screen.queryByTestId("r-rail-unobserved")).toBeNull();
  });

  it("parks the rail polls (null unit) while the panel is expanded — no double-fetch", () => {
    freshPrefs();
    renderWithProviders(<RPanel {...makeProps({ collapsed: false })} />);
    expect(useUnitPrsMock).toHaveBeenCalledWith(null);
    expect(useUnitIssuesMock).toHaveBeenCalledWith(null);
  });
});
