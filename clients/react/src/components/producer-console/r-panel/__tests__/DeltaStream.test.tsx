// @vitest-environment jsdom
//
// DeltaStream — gate-fed Δ stream surface at the R panel's top.
// Asserts the negative-space contract (empty → renders NOTHING; no
// severity colors; no aggregation/grouping/badge) and the trigger
// button behaviour. The actual per-item facts wire isn't exposed
// yet — the surface degrades honestly via a TODO marker.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProducerFeedStatus } from "@/lib/api";
import { DeltaStream } from "../DeltaStream";

function fixture(overrides: Partial<ProducerFeedStatus> = {}): ProducerFeedStatus {
  return {
    unit: "u",
    producer_address: "u.producer",
    tip: 0n,
    last_served_cursor: 0n,
    ...overrides,
  };
}

describe("DeltaStream", () => {
  it("renders nothing when no pending delta (empty state = absent)", () => {
    const { container } = render(
      <DeltaStream
        unitName="u"
        data={fixture()}
        onTriggerDeltaPull={vi.fn()}
        producerAvailable={true}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when data is null", () => {
    const { container } = render(
      <DeltaStream
        unitName="u"
        data={null}
        onTriggerDeltaPull={vi.fn()}
        producerAvailable={true}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a single gate-derived fact line when a pending delta exists", () => {
    render(
      <DeltaStream
        unitName="u"
        data={fixture({ has_pending_delta: true, tip: 7n, last_served_cursor: 4n })}
        onTriggerDeltaPull={vi.fn()}
        producerAvailable={true}
      />,
    );
    expect(screen.getByTestId("delta-stream")).toBeTruthy();
    expect(screen.getByText(/3 pending deltas/)).toBeTruthy();
    // The honest-degradation TODO marker is surfaced.
    expect(screen.getByText(/producer-feed items wire/i)).toBeTruthy();
  });

  it("fires the trigger when the →Producer ⚡ button is clicked", () => {
    const onTriggerDeltaPull = vi.fn();
    render(
      <DeltaStream
        unitName="u"
        data={fixture({ has_pending_delta: true, tip: 1n })}
        onTriggerDeltaPull={onTriggerDeltaPull}
        producerAvailable={true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Trigger producer pull/ }));
    expect(onTriggerDeltaPull).toHaveBeenCalledTimes(1);
  });

  it("disables the trigger when no live Producer", () => {
    render(
      <DeltaStream
        unitName="u"
        data={fixture({ has_pending_delta: true, tip: 1n })}
        onTriggerDeltaPull={vi.fn()}
        producerAvailable={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /Trigger producer pull/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("uses NO severity colors in rendered output (negative-space)", () => {
    const { container } = render(
      <DeltaStream
        unitName="u"
        data={fixture({ has_pending_delta: true, tip: 5n })}
        onTriggerDeltaPull={vi.fn()}
        producerAvailable={true}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-warning/);
    expect(html).not.toMatch(/text-destructive/);
    expect(html).not.toMatch(/text-success/);
    expect(html).not.toMatch(/text-primary/);
  });

  it("does NOT render aggregation / count badge / priority styling (negative-space)", () => {
    render(
      <DeltaStream
        unitName="u"
        data={fixture({ has_pending_delta: true, tip: 5n })}
        onTriggerDeltaPull={vi.fn()}
        producerAvailable={true}
      />,
    );
    // Plain text only. No "high priority" / "urgent" / severity rollup.
    expect(screen.queryByText(/urgent/i)).toBeNull();
    expect(screen.queryByText(/high priority/i)).toBeNull();
    expect(screen.queryByText(/severity/i)).toBeNull();
  });
});
