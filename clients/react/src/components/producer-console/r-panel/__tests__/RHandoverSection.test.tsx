// @vitest-environment jsdom
//
// RHandoverSection — the R₁ baton inventory, wired to the operator-side
// handoffs endpoint (tmai-core #473) via `useHandoffs`. We mock
// `api.unitHandoffs` and assert: header count = real baton count; rows
// render in the wire order (active first, then archived) with plain facts;
// a row click selects the baton for R₂ with `{ unit, name }`; `aria-current`
// marks the focused row; and the null-unit / empty states degrade honestly
// rather than fabricate a list.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffsResponse } from "@/lib/api";

const unitHandoffsMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      unitHandoffs: (...args: unknown[]) => unitHandoffsMock(...args),
    },
  };
});

import { RHandoverSection } from "../RHandoverSection";

function response(overrides: Partial<HandoffsResponse> = {}): HandoffsResponse {
  return {
    unit: "u",
    handoffs: [
      { name: "active", status: "active", composed_at: "2026-05-12T18:30:00Z", task: "ship it" },
      {
        name: "2026-05-10T09-00-00.000Z.md",
        status: "archived",
        composed_at: "2026-05-10T09:00:00Z",
        task: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  unitHandoffsMock.mockReset();
});

describe("RHandoverSection", () => {
  it("renders baton rows from the wire (active first, then archived)", async () => {
    unitHandoffsMock.mockResolvedValue(response());
    render(<RHandoverSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("2026-05-10T09-00-00.000Z.md")).toBeTruthy();
    });
    // Wire order is preserved as-is (active first, then archived) — no
    // client re-sort. The active baton's name + status both read "active".
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("active");
    expect(rows[1].textContent).toContain("2026-05-10T09-00-00.000Z.md");
    // The active baton's frontmatter task is shown plainly.
    expect(screen.getByText(/ship it/)).toBeTruthy();
  });

  it("header count reflects the real baton count", async () => {
    unitHandoffsMock.mockResolvedValue(response());
    render(<RHandoverSection unitName="u" expanded={false} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/^2$/)).toBeTruthy();
    });
  });

  it("clicking a baton row selects it for the R₂ viewer with { unit, name }", async () => {
    const onSelectHandoff = vi.fn();
    unitHandoffsMock.mockResolvedValue(response());
    render(
      <RHandoverSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        onSelectHandoff={onSelectHandoff}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/ship it/)).toBeTruthy();
    });
    // Click via the active baton's unique task text — it bubbles to the
    // row button, avoiding the "active" name/status text collision.
    fireEvent.click(screen.getByText(/ship it/));
    expect(onSelectHandoff).toHaveBeenCalledWith({ unit: "u", name: "active" });
  });

  it("marks the focused row with aria-current (and no others)", async () => {
    unitHandoffsMock.mockResolvedValue(response());
    render(
      <RHandoverSection
        unitName="u"
        expanded={true}
        onToggle={vi.fn()}
        selectedKey="u/2026-05-10T09-00-00.000Z.md"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("2026-05-10T09-00-00.000Z.md")).toBeTruthy();
    });
    const archivedRow = screen.getByText("2026-05-10T09-00-00.000Z.md").closest("button");
    expect(archivedRow?.getAttribute("aria-current")).toBe("true");
    const activeRow = screen.getByText(/ship it/).closest("button");
    expect(activeRow?.getAttribute("aria-current")).toBeNull();
  });

  it("shows the honest empty state when the unit has no batons", async () => {
    unitHandoffsMock.mockResolvedValue(response({ handoffs: [] }));
    render(<RHandoverSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("No hand-overs.")).toBeTruthy();
    });
  });

  it("pick-a-project notice when unit is null (no fetch)", () => {
    render(<RHandoverSection unitName={null} expanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/Pick a project/i)).toBeTruthy();
    expect(unitHandoffsMock).not.toHaveBeenCalled();
  });

  it("uses no severity colors", async () => {
    unitHandoffsMock.mockResolvedValue(response());
    const { container } = render(
      <RHandoverSection unitName="u" expanded={true} onToggle={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("2026-05-10T09-00-00.000Z.md")).toBeTruthy();
    });
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });
});
