// @vitest-environment jsdom
//
// RHandoverSection — honest-degradation: no archive wire yet, so
// the section shows `(0)` count + TODO marker rather than fabricate
// content.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RHandoverSection } from "../RHandoverSection";

describe("RHandoverSection", () => {
  it("renders header with count `0` (honest about missing archive wire)", () => {
    render(<RHandoverSection unitName="u" expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/^0$/)).toBeTruthy();
  });

  it("body explains the missing wire via TODO marker (simulated-onboarded posture)", () => {
    render(<RHandoverSection unitName="u" expanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/handoff archive wire/i)).toBeTruthy();
    // Path hint is shown so the operator can open the dir directly.
    expect(screen.getByText(/~\/.tmai\/handoffs/)).toBeTruthy();
  });

  it("pick-a-project notice when unit is null", () => {
    render(<RHandoverSection unitName={null} expanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/Pick a project/i)).toBeTruthy();
  });
});
