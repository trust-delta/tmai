// @vitest-environment jsdom
//
// WorkingWithThisHumanSection — wired to `useWorkingWithHuman(unitName)`
// against the live `GET /api/units/{unit}/working-with-human` endpoint
// (tmai-core #360).

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkingWithHumanResponse } from "@/lib/api";
import { WorkingWithThisHumanSection } from "../WorkingWithThisHumanSection";

const workingWithHumanMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      workingWithHuman: (...args: unknown[]) => workingWithHumanMock(...args),
    },
  };
});

function responseStub(overrides: Partial<WorkingWithHumanResponse> = {}): WorkingWithHumanResponse {
  return {
    unit: "tmai",
    dir: "/home/u/.claude/projects/-home-u-works-tmai/memory",
    memory_index: null,
    ...overrides,
  };
}

beforeEach(() => {
  workingWithHumanMock.mockReset();
});

describe("WorkingWithThisHumanSection", () => {
  it("shows the pick-a-project notice when unitName is null and does not fetch", () => {
    render(<WorkingWithThisHumanSection unitName={null} />);
    expect(
      screen.getByText(/this unit's memory index and working-with-human context/i),
    ).toBeTruthy();
    expect(workingWithHumanMock).not.toHaveBeenCalled();
  });

  it("renders the no-memory-dir notice when the unit has no resolvable memory dir", async () => {
    workingWithHumanMock.mockResolvedValue(responseStub({ dir: null, memory_index: null }));

    render(<WorkingWithThisHumanSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/No memory directory configured for/i)).toBeTruthy();
    });
    // Honest opt-in hint, not fabricated content.
    expect(screen.getByText(/\[\[unit\]\]\.memory_dir/)).toBeTruthy();
  });

  it("renders the memory index inside a collapsible details when present", async () => {
    workingWithHumanMock.mockResolvedValue(
      responseStub({
        memory_index: "# Memory index\n\n- entry 1\n- entry 2\n",
      }),
    );

    render(<WorkingWithThisHumanSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/Cross-conversation memory index lives at/i)).toBeTruthy();
    });
    // Summary line shows the line count of the index for at-a-glance scan.
    const summary = await screen.findByText(/Memory index \(\d+ lines\)/);
    expect(summary).toBeTruthy();
    // Markdown rendered inside — the heading from the index ends up
    // in the DOM (even if collapsed by default).
    const heading = await screen.findByRole("heading", { name: /Memory index/ });
    expect(heading).toBeTruthy();
  });

  it("renders an empty-state notice when memory_index is missing", async () => {
    workingWithHumanMock.mockResolvedValue(responseStub({ memory_index: null }));

    render(<WorkingWithThisHumanSection unitName="tmai" />);

    // The notice text is broken up by a `<code>MEMORY.md</code>` element,
    // so match on the parent paragraph's full textContent.
    await waitFor(() => {
      const para = Array.from(document.querySelectorAll("p")).find((p) =>
        /no .*MEMORY\.md.* found in this dir yet/i.test(p.textContent ?? ""),
      );
      expect(para).toBeDefined();
    });
  });

  it("surfaces fetch errors honestly", async () => {
    workingWithHumanMock.mockRejectedValue(new Error("kaboom"));

    render(<WorkingWithThisHumanSection unitName="tmai" />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load working-with-human view/i)).toBeTruthy();
    });
    expect(screen.getByText(/kaboom/)).toBeTruthy();
  });
});
