// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueueBadge } from "../QueueBadge";

describe("QueueBadge", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(<QueueBadge count={0} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows count when non-zero", () => {
    render(<QueueBadge count={3} onClick={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("3");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<QueueBadge count={1} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("uses custom icon prop", () => {
    render(<QueueBadge count={2} onClick={() => {}} icon="📬" />);
    expect(screen.getByRole("button").textContent).toContain("📬");
  });

  it("applies custom title", () => {
    render(<QueueBadge count={1} onClick={() => {}} title="my custom title" />);
    expect(screen.getByRole("button").title).toBe("my custom title");
  });
});
