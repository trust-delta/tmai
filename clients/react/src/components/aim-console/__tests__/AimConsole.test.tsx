// @vitest-environment jsdom
//
// AimConsole S1 shell test. The aim console is a faithful reproduction of
// the destination mock (`origin/mock/aim-ui-sample`): a full-window 3-pane
// console under a sober top bar. S1 reproduces the SHELL — top bar (real
// unit tabs), the 3-pane grid, and the PR-rail expand/collapse transition.
// The pane BODIES are stubs (S2–S4), so this test asserts STRUCTURE +
// the one live interaction (the rail toggle) + the callbacks, not pane
// content.
//
// `useUnitAttention` is mocked so the per-tab attention rollup never hits
// the network (mirrors how UnitTabs tabs poll for the ⚠N badge).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UnitResponse } from "@/lib/api";
import { AimConsole } from "../AimConsole";

vi.mock("@/hooks/useUnitAttention", () => ({
  useUnitAttention: () => ({ data: null, loading: false, error: null }),
}));

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
    ...overrides,
  };
  render(<AimConsole {...props} />);
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

  it("marks the panes as S2–S4 stubs (no worklist/session/PR logic in S1)", () => {
    renderConsole();
    expect(screen.getByTestId("aim-pane-stub-s2")).toBeTruthy();
    expect(screen.getByTestId("aim-pane-stub-s3")).toBeTruthy();
    expect(screen.getByTestId("aim-pane-stub-s4")).toBeTruthy();
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
