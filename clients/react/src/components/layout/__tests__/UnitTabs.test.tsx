// @vitest-environment jsdom
//
// UnitTabs (C1) — one tab per configured unit: repo pills (primary
// highlighted), active highlight, ⚠N attention rollup (from the existing
// `useUnitAttention` wire), select + add affordances, and the #540 / #546
// per-unit CLOSE control (confirm-gated kill of the Producer slot).

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionStateResponse, UnitResponse } from "@/lib/api";
import { renderWithProviders } from "@/test/render";

const unitAttentionMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      unitAttention: (...args: unknown[]) => unitAttentionMock(...args),
    },
  };
});

import { UnitTabs } from "../UnitTabs";

function unit(overrides: Partial<UnitResponse> = {}): UnitResponse {
  return {
    name: "tmai",
    repos: [
      { path: "/home/me/works/tmai", primary: true },
      { path: "/home/me/works/tmai-core", primary: false },
    ],
    ...overrides,
  };
}

function attention(entries: AttentionStateResponse["entries"] = []): AttentionStateResponse {
  return { unit: "tmai", entries };
}

beforeEach(() => {
  unitAttentionMock.mockReset();
  unitAttentionMock.mockResolvedValue(attention());
});

describe("UnitTabs", () => {
  it("renders a tab per unit with repo pills, primary highlighted", () => {
    renderWithProviders(
      <UnitTabs
        units={[unit()]}
        activeUnitName="tmai"
        onSelectUnit={vi.fn()}
        onAddUnit={vi.fn()}
        onCloseUnit={vi.fn()}
      />,
    );
    const pills = screen.getAllByTestId("repo-pill");
    expect(pills.map((p) => p.textContent)).toEqual(["tmai", "tmai-core"]);
    // The primary repo carries the highlight flag; the secondary does not.
    expect(pills[0].getAttribute("data-primary")).toBe("true");
    expect(pills[1].getAttribute("data-primary")).toBe("false");
  });

  it("marks the active unit's tab with aria-current", () => {
    renderWithProviders(
      <UnitTabs
        units={[unit(), unit({ name: "infra", repos: [{ path: "/p/infra", primary: true }] })]}
        activeUnitName="infra"
        onSelectUnit={vi.fn()}
        onAddUnit={vi.fn()}
        onCloseUnit={vi.fn()}
      />,
    );
    const active = screen.getByRole("button", { name: /unit: infra/ });
    expect(active.getAttribute("aria-current")).toBe("true");
    const inactive = screen.getByRole("button", { name: /unit: tmai/ });
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });

  it("clicking a tab calls onSelectUnit with that unit", () => {
    const onSelectUnit = vi.fn();
    renderWithProviders(
      <UnitTabs
        units={[unit()]}
        activeUnitName={null}
        onSelectUnit={onSelectUnit}
        onAddUnit={vi.fn()}
        onCloseUnit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unit: tmai/ }));
    expect(onSelectUnit).toHaveBeenCalledTimes(1);
    expect(onSelectUnit.mock.calls[0][0].name).toBe("tmai");
  });

  it("clicking + calls onAddUnit", () => {
    const onAddUnit = vi.fn();
    renderWithProviders(
      <UnitTabs
        units={[unit()]}
        activeUnitName="tmai"
        onSelectUnit={vi.fn()}
        onAddUnit={onAddUnit}
        onCloseUnit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add unit/ }));
    expect(onAddUnit).toHaveBeenCalledTimes(1);
  });

  it("renders a ⚠N rollup of the unit's high-attention markers", async () => {
    unitAttentionMock.mockResolvedValue(
      attention([
        { repo_path: "/home/me/works/tmai", section: "pr", id: "1", level: "high" },
        { repo_path: "/home/me/works/tmai", section: "issue", id: "2", level: "high" },
        { repo_path: "/home/me/works/tmai", section: "pr", id: "3", level: "low" },
      ]),
    );
    renderWithProviders(
      <UnitTabs
        units={[unit()]}
        activeUnitName="tmai"
        onSelectUnit={vi.fn()}
        onAddUnit={vi.fn()}
        onCloseUnit={vi.fn()}
      />,
    );
    const tab = screen.getByRole("button", { name: /unit: tmai/ });
    await waitFor(() => {
      // Only the two `high` markers count toward the owed-attention rollup.
      expect(within(tab).getByTestId("unit-attention-rollup").textContent).toBe("⚠2");
    });
  });

  it("shows no rollup badge when nothing is owed attention", async () => {
    unitAttentionMock.mockResolvedValue(attention([]));
    renderWithProviders(
      <UnitTabs
        units={[unit()]}
        activeUnitName="tmai"
        onSelectUnit={vi.fn()}
        onAddUnit={vi.fn()}
        onCloseUnit={vi.fn()}
      />,
    );
    // Let the (empty) attention fetch resolve, then assert no badge.
    await waitFor(() => expect(unitAttentionMock).toHaveBeenCalled());
    expect(screen.queryByTestId("unit-attention-rollup")).toBeNull();
  });
});

describe("UnitTabs — close affordance (#540 / #546)", () => {
  it("exposes a per-unit close control that opens a confirm dialog", async () => {
    renderWithProviders(
      <UnitTabs
        units={[unit()]}
        activeUnitName="tmai"
        onSelectUnit={vi.fn()}
        onAddUnit={vi.fn()}
        onCloseUnit={vi.fn()}
      />,
    );
    // No confirm dialog until the close control is clicked.
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /close unit tmai/i }));
    // The always-on confirm dialog surfaces with the kill ≠ delete caveat.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/kill, not a delete/i)).toBeTruthy();
    expect(within(dialog).getByText(/worktrees and uncommitted work stay on disk/i)).toBeTruthy();
  });

  it("confirming the close calls onCloseUnit with the unit", async () => {
    const onCloseUnit = vi.fn();
    renderWithProviders(
      <UnitTabs
        units={[unit()]}
        activeUnitName="tmai"
        onSelectUnit={vi.fn()}
        onAddUnit={vi.fn()}
        onCloseUnit={onCloseUnit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close unit tmai/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Close unit" }));
    await waitFor(() => expect(onCloseUnit).toHaveBeenCalledTimes(1));
    expect(onCloseUnit.mock.calls[0][0].name).toBe("tmai");
  });

  it("cancelling the close does nothing", async () => {
    const onCloseUnit = vi.fn();
    renderWithProviders(
      <UnitTabs
        units={[unit()]}
        activeUnitName="tmai"
        onSelectUnit={vi.fn()}
        onAddUnit={vi.fn()}
        onCloseUnit={onCloseUnit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close unit tmai/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    // The dialog closes …
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // … and the slot is never closed.
    expect(onCloseUnit).not.toHaveBeenCalled();
  });
});
