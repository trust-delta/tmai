// @vitest-environment jsdom
//
// CrossUnitStatusSection — the ⬢ Cross-unit status section that
// reconciles configured-unit membership against live agents.
//
// Once `tmai-core #460` (units wire) landed, the section retired its
// `singleUnitOnly` posture-apology block — dormant units are now
// surfaced as real rows by `useHandover`. This file pins:
//   - the retired `singleUnitOnly` notice never renders, even when the
//     caller still forwards a `preconditions` object;
//   - dormant rows render with the quiet pill;
//   - the count line reads "configured / live".
//
// We use `fireEvent.click` (NOT `.click()`) so a future click test
// stays inside React's act() boundary — known gotcha across the suite.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CrossUnitStatus } from "@/hooks/useHandover";
import { CrossUnitStatusSection } from "../CrossUnitStatusSection";

function dormantQuietRow(): CrossUnitStatus["units"][number] {
  return {
    path: "/home/u/proj-dormant",
    name: "proj-dormant",
    state: "quiet",
    agentCount: 0,
    attentionCount: 0,
  };
}

function liveInProgressRow(): CrossUnitStatus["units"][number] {
  return {
    path: "/home/u/proj-a",
    name: "proj-a",
    state: "in-progress",
    agentCount: 1,
    attentionCount: 0,
  };
}

describe("CrossUnitStatusSection", () => {
  it("renders dormant configured units with the quiet pill", () => {
    render(
      <CrossUnitStatusSection
        data={{ units: [dormantQuietRow()] }}
        activePath={null}
        onSelectUnit={vi.fn()}
      />,
    );
    expect(screen.getByText("proj-dormant")).toBeTruthy();
    // ⚪ pill (the quiet variant) carries title="no agents".
    expect(screen.getByTitle("no agents")).toBeTruthy();
  });

  it("reads 'configured / live' on the count line — dormant rows count in 'configured' but not 'live'", () => {
    render(
      <CrossUnitStatusSection
        data={{ units: [liveInProgressRow(), dormantQuietRow()] }}
        activePath={null}
        onSelectUnit={vi.fn()}
      />,
    );
    // Two configured, one with live agents.
    expect(screen.getByText(/2 configured \/ 1 live/i)).toBeTruthy();
  });

  it("does NOT render the retired singleUnitOnly notice even with preconditions still forwarded", () => {
    // Callers (`ProducerConsole`) still forward
    // `preconditions={missingPreconditions}` uniformly across all four
    // sections — the section signature accepts it but must IGNORE the
    // (now retired) `singleUnitOnly` field. We pass a deliberately
    // over-shaped object to verify the old branch is gone for good:
    // even if a stale caller still set `singleUnitOnly: true`, no
    // "Showing one unit only" copy escapes into the DOM.
    render(
      <CrossUnitStatusSection
        data={{ units: [liveInProgressRow()] }}
        activePath="/home/u/proj-a"
        onSelectUnit={vi.fn()}
        preconditions={
          // Cast to placate the type while we verify *runtime* absence
          // of the retired branch (a stale call site couldn't be caught
          // by the type alone — that's what this test pins).
          { noLiveAgents: false, singleUnitOnly: true } as unknown as Parameters<
            typeof CrossUnitStatusSection
          >[0]["preconditions"]
        }
      />,
    );
    expect(screen.queryByText(/Showing one unit only/i)).toBeNull();
  });

  it("routes a row click through onSelectUnit with the row's path + name", () => {
    const onSelect = vi.fn();
    render(
      <CrossUnitStatusSection
        data={{ units: [dormantQuietRow()] }}
        activePath={null}
        onSelectUnit={onSelect}
      />,
    );
    // `fireEvent.click` keeps the click inside React's act() — the
    // bare `element.click()` path has bitten this suite before.
    fireEvent.click(screen.getByRole("button", { name: /proj-dormant/ }));
    expect(onSelect).toHaveBeenCalledWith("/home/u/proj-dormant", "proj-dormant");
  });
});
