// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProducerFeedStatus } from "@/lib/api";
import { ProducerFeedChip } from "../ProducerFeedChip";

function makeData(overrides: Partial<ProducerFeedStatus> = {}): ProducerFeedStatus {
  return {
    unit: "u",
    producer_address: "u.producer",
    tip: 0n,
    last_served_cursor: 0n,
    has_pending_delta: undefined,
    ...overrides,
  };
}

describe("ProducerFeedChip", () => {
  it("renders nothing when there is no data", () => {
    const { container } = render(<ProducerFeedChip data={null} onClick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when has_pending_delta is false/undefined", () => {
    // Quiet-when-nothing — absent on the wire ⇒ false; no chip, no noise.
    const { container } = render(<ProducerFeedChip data={makeData()} onClick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the pill and fires onClick when has_pending_delta is true", () => {
    const onClick = vi.fn();
    render(
      <ProducerFeedChip data={makeData({ has_pending_delta: true, tip: 3n })} onClick={onClick} />,
    );
    const btn = screen.getByRole("button");
    expect(btn.textContent ?? "").toMatch(/⚡\s*差分/);
    // Informational accent, NOT the destructive alarm styling.
    expect(btn.className).toContain("text-primary");
    expect(btn.className).not.toContain("destructive");

    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
