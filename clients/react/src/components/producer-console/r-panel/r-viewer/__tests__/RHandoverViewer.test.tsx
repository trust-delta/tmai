// @vitest-environment jsdom
//
// RHandoverViewer — the R₂ in-tmai Hand-over baton viewer (per-unit,
// read-only). The one-shot `useHandoffContent` hook is mocked with
// SYNTHETIC fixtures so this test never touches real baton data.
//
// It proves: header facts render (name / active|archived marker /
// composed_at + task parsed from the baton's frontmatter); the baton
// markdown renders; archived/blank-frontmatter batons render bare; empty /
// loading / error states; NO severity classes anywhere (plain-everything);
// the viewer fills the R region (no `w-[` clamp, has `flex-1`); and the
// ‹ Inventory back affordance calls `onClose`.

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Type-only import from the mocked hook module — erased at runtime, so it
// does not collide with the `vi.mock` factory below.
import type { UseHandoffContentResult } from "@/hooks/useHandoffs";
import type { HandoffContentResponse } from "@/lib/api";

const useHandoffContentMock = vi.fn();

vi.mock("@/hooks/useHandoffs", () => ({
  useHandoffContent: (...a: unknown[]) => useHandoffContentMock(...a),
}));

import { RHandoverViewer, type SelectedHandoff } from "../RHandoverViewer";

// ── synthetic fixtures (NO real baton data) ──

const ACTIVE_BATON = [
  "---",
  "composed-at: 2026-05-12T18:30:00Z",
  'task: "ship the R₂ hand-over viewer"',
  "---",
  "",
  "# Where you left off",
  "",
  "- wired R₁ to the #473 endpoint",
].join("\n");

function content(overrides: Partial<HandoffContentResponse> = {}): HandoffContentResponse {
  return { unit: "tmai", name: "active", content: ACTIVE_BATON, ...overrides };
}

function result(overrides: Partial<UseHandoffContentResult> = {}): UseHandoffContentResult {
  return { data: content(), loading: false, error: null, ...overrides };
}

const selected: SelectedHandoff = { unit: "tmai", name: "active" };

beforeEach(() => {
  useHandoffContentMock.mockReset();
  useHandoffContentMock.mockReturnValue(result());
});

describe("RHandoverViewer", () => {
  it("fetches the baton for exactly the selected unit + name (selection-driven)", () => {
    render(<RHandoverViewer selected={selected} onClose={vi.fn()} />);
    expect(useHandoffContentMock).toHaveBeenCalledWith("tmai", "active");
  });

  it("renders header facts (unit / baton name / active marker / composed_at / task)", () => {
    const { container } = render(<RHandoverViewer selected={selected} onClose={vi.fn()} />);
    // Scope to the header: the baton content is rendered verbatim below
    // (frontmatter included), so the task value also appears in the body —
    // header-fact assertions must target the header to stay unambiguous.
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    const h = header as HTMLElement;
    expect(within(h).getByText(/tmai · hand-over/)).toBeTruthy();
    // For the active baton the name sentinel and the active/archived marker
    // are both the literal "active" — the name in the title, the marker
    // beside it (two matches in the header).
    expect(within(h).getAllByText("active")).toHaveLength(2);
    expect(within(h).getByText(/composed 2026-05-12T18:30:00Z/)).toBeTruthy();
    expect(within(h).getByText("ship the R₂ hand-over viewer")).toBeTruthy();
  });

  it("derives the archived marker from a non-'active' baton name", () => {
    const archivedName = "2026-05-10T09-00-00.000Z.md";
    useHandoffContentMock.mockReturnValue(
      result({ data: content({ name: archivedName, content: "# bare body" }) }),
    );
    render(<RHandoverViewer selected={{ unit: "tmai", name: archivedName }} onClose={vi.fn()} />);
    expect(screen.getByText("archived")).toBeTruthy();
    // Frontmatter-less baton: composed/task lines are simply absent.
    expect(screen.queryByText(/composed /)).toBeNull();
  });

  it("renders the baton markdown body", () => {
    render(<RHandoverViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText("Where you left off")).toBeTruthy();
    expect(screen.getByText(/wired R₁ to the #473 endpoint/)).toBeTruthy();
  });

  it("shows the empty-baton state for blank content", () => {
    useHandoffContentMock.mockReturnValue(result({ data: content({ content: "   " }) }));
    render(<RHandoverViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText("Empty baton.")).toBeTruthy();
  });

  it("renders the loading and error states plainly", () => {
    useHandoffContentMock.mockReturnValue(result({ data: null, loading: true }));
    const { rerender, container } = render(
      <RHandoverViewer selected={selected} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();

    useHandoffContentMock.mockReturnValue(
      result({ data: null, loading: false, error: new Error("boom") }),
    );
    rerender(<RHandoverViewer selected={selected} onClose={vi.fn()} />);
    expect(screen.getByText(/Failed to load hand-over: boom/)).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/text-(warning|destructive|success)/);
  });

  it("uses NO severity-color classes anywhere (plain-everything)", () => {
    const { container } = render(<RHandoverViewer selected={selected} onClose={vi.fn()} />);
    expect(container.innerHTML).not.toMatch(/text-(warning|destructive|success)/);
  });

  it("fills the R region — no fixed clamp width, carries flex-1 (focus mode rides the R column)", () => {
    const { container } = render(<RHandoverViewer selected={selected} onClose={vi.fn()} />);
    const root = container.querySelector('[data-testid="r-handover-viewer"]');
    expect(root).not.toBeNull();
    expect(root?.className ?? "").not.toMatch(/w-\[/);
    expect(root?.className ?? "").toMatch(/flex-1/);
  });

  it("returns to the inventory via the ‹ Inventory back affordance (clears the focus)", () => {
    const onClose = vi.fn();
    render(<RHandoverViewer selected={selected} onClose={onClose} />);
    screen.getByRole("button", { name: /Back to inventory/ }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
