// @vitest-environment jsdom
//
// AimConsole shell test. The aim console is a faithful reproduction of the
// destination mock (`origin/mock/aim-ui-sample`): a full-window 3-pane console
// under a sober top bar. This test covers the SHELL — top bar (real unit
// tabs), the 3-pane grid, the PR-rail expand/collapse transition, and the
// callbacks. The Aim (left) pane is now the real S2 worklist (its behaviour is
// covered in AimPane.test.tsx); the Session pane is real (tabs + shead + term +
// the docked S4 bash footer); the PR-rail body remains an S5 stub.
//
// `useUnitAttention` is mocked so the per-tab attention rollup never hits the
// network; `api.aims` is mocked to a pending promise so the embedded AimPane
// parks in its loading state (no network, no act-warning churn) — the shell
// assertions don't depend on aim data.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AimsResponse, UnitResponse } from "@/lib/api";
import { UIPrefsProvider } from "@/lib/ui-prefs-provider";
import { AimConsole } from "../AimConsole";

vi.mock("@/hooks/useUnitAttention", () => ({
  useUnitAttention: () => ({ data: null, loading: false, error: null }),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      // Park the AimPane fetch in flight — the shell tests are data-agnostic.
      aims: () => new Promise<AimsResponse>(() => {}),
    },
  };
});

const UNITS: UnitResponse[] = [
  {
    name: "tmai",
    repos: [
      { path: "/home/u/tmai", primary: true },
      { path: "/home/u/tmai-core", primary: false },
    ],
  },
];

function renderConsole(overrides: Partial<Parameters<typeof AimConsole>[0]> = {}) {
  const props = {
    units: UNITS,
    activeUnitName: "tmai" as string | null,
    onSelectUnit: vi.fn(),
    onAddUnit: vi.fn(),
    onExit: vi.fn(),
    // S3 Session-pane wiring — empty here so the shell tests stay
    // data-agnostic (no live sessions → the pane parks in its empty state,
    // no TerminalPanel / PreviewPanel mount, no SSE). The pane's own
    // behaviour is covered in SessionPane.test.tsx.
    agents: [],
    currentProjectPath: "/home/u/tmai" as string | null,
    trigger: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(
    <UIPrefsProvider>
      <AimConsole {...props} />
    </UIPrefsProvider>,
  );
  return props;
}

describe("AimConsole — S1 shell", () => {
  it("renders the top bar brand and the 3 panes", () => {
    renderConsole();
    // The brand reads "tmai console"; "tmai" alone also appears as a repo
    // pill, so assert the brand via its container's full text.
    const brand = screen.getByText("console").closest(".ac-brand");
    expect(brand?.textContent).toContain("tmai");
    expect(screen.getByLabelText("Aim")).toBeTruthy();
    expect(screen.getByLabelText("Session")).toBeTruthy();
    expect(screen.getByLabelText("PR / Issue rail")).toBeTruthy();
  });

  it("fills the Aim (S2) and Session (S3+S4) panes, leaves the PR-rail as an S5 stub", () => {
    renderConsole();
    // The Aim pane is now the real worklist: no S2 stub, real chrome present.
    expect(screen.queryByTestId("aim-pane-stub-s2")).toBeNull();
    expect(screen.getByTestId("aim-ledger")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Frontier ⚠" })).toBeTruthy();
    // The Session pane is real now (no S3 stub): the session tablist + the
    // real docked S4 bash footer render even with no live sessions.
    expect(screen.queryByTestId("aim-pane-stub-s3")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Sessions" })).toBeTruthy();
    expect(screen.getByTestId("aim-bash-footer")).toBeTruthy();
    // The PR-rail body remains an S5 stub.
    expect(screen.getByTestId("aim-pane-stub-s5")).toBeTruthy();
  });

  it("renders a top-bar unit tab with primary + secondary repo pills", () => {
    renderConsole();
    const tab = screen.getByRole("button", { name: "unit: tmai" });
    const pills = within(tab).getAllByTestId("aim-repo-pill");
    expect(pills.map((p) => p.textContent)).toEqual(["tmai", "tmai-core"]);
    expect(pills[0].getAttribute("data-primary")).toBe("true");
    expect(pills[1].getAttribute("data-primary")).toBe("false");
  });

  it("expands and collapses the PR rail (the S1 transition, via .pr-open)", () => {
    renderConsole();
    const root = screen.getByTestId("aim-console");
    // Collapsed by default.
    expect(root.className).not.toContain("pr-open");

    // Click the collapsed rail → expands.
    fireEvent.click(screen.getByRole("button", { name: "Expand PR / Issue rail" }));
    expect(root.className).toContain("pr-open");

    // The expanded panel's close (✕) → collapses again.
    fireEvent.click(screen.getByRole("button", { name: "Collapse PR / Issue rail" }));
    expect(root.className).not.toContain("pr-open");
  });

  it("calls onSelectUnit / onAddUnit / onExit from the top bar", () => {
    const props = renderConsole();

    fireEvent.click(screen.getByRole("button", { name: "unit: tmai" }));
    expect(props.onSelectUnit).toHaveBeenCalledWith(UNITS[0]);

    fireEvent.click(screen.getByRole("button", { name: "Add unit — launch Producer" }));
    expect(props.onAddUnit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Return to the Producer console" }));
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it("falls back the meta readout to the first unit when none is focused", () => {
    renderConsole({ activeUnitName: null });
    // metaUnit = units[0].name when activeUnitName is null.
    expect(screen.getByText(/unit tmai · opus-4\.8 · max/)).toBeTruthy();
  });
});
