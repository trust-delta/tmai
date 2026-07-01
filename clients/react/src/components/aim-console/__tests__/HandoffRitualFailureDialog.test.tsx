// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { HandoffRitualFailureDialog } from "../HandoffRitualFailureDialog";

function makeProps(
  overrides: Partial<ComponentProps<typeof HandoffRitualFailureDialog>> = {},
): ComponentProps<typeof HandoffRitualFailureDialog> {
  return {
    unitName: "tmai",
    reason: "missing_handoff_ready",
    message: "Producer never wrote HANDOFF READY",
    producerAgentId: "claude:abc-123",
    retryCount: 0,
    retryRefused: false,
    onForceKill: vi.fn(),
    onRetry: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

describe("HandoffRitualFailureDialog", () => {
  it("renders the unit name, reason, and detail", () => {
    render(<HandoffRitualFailureDialog {...makeProps()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("tmai")).toBeTruthy();
    expect(screen.getByText("missing_handoff_ready")).toBeTruthy();
    expect(screen.getByText(/Producer never wrote HANDOFF READY/)).toBeTruthy();
  });

  it("invokes onForceKill when Force kill is clicked", () => {
    const onForceKill = vi.fn();
    render(<HandoffRitualFailureDialog {...makeProps({ onForceKill })} />);
    fireEvent.click(screen.getByRole("button", { name: /Force kill/ }));
    expect(onForceKill).toHaveBeenCalledTimes(1);
  });

  it("disables Force kill when producerAgentId is null", () => {
    render(<HandoffRitualFailureDialog {...makeProps({ producerAgentId: null })} />);
    const btn = screen.getByRole("button", { name: /Force kill/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("invokes onRetry when Retry is clicked", () => {
    const onRetry = vi.fn();
    render(<HandoffRitualFailureDialog {...makeProps({ onRetry })} />);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the retry attempt counter once retryCount > 0", () => {
    render(<HandoffRitualFailureDialog {...makeProps({ retryCount: 1 })} />);
    expect(screen.getByText(/Retry \(1\/2\)/)).toBeTruthy();
  });

  it("disables Retry when retryRefused is true", () => {
    render(<HandoffRitualFailureDialog {...makeProps({ retryCount: 2, retryRefused: true })} />);
    const btn = screen.getByRole("button", { name: /Retry/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("disables Retry when retryCount has reached 2 even before refused flag flips", () => {
    render(<HandoffRitualFailureDialog {...makeProps({ retryCount: 2 })} />);
    const btn = screen.getByRole("button", { name: /Retry/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("invokes onDismiss when Continue with stale is clicked", () => {
    const onDismiss = vi.fn();
    render(<HandoffRitualFailureDialog {...makeProps({ onDismiss })} />);
    fireEvent.click(screen.getByRole("button", { name: /Continue with stale/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("reveals the resume UUID command on Resume in CC click", () => {
    render(<HandoffRitualFailureDialog {...makeProps()} />);
    expect(screen.queryByText(/claude --resume/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Resume in CC/ }));
    // The scheme prefix `claude:` is stripped; only the UUID half is shown.
    expect(screen.getByText(/claude --resume abc-123/)).toBeTruthy();
  });

  it("disables Resume in CC when no canonical scheme is parseable", () => {
    // An agent id without a `:` separator can't yield a UUID half.
    render(<HandoffRitualFailureDialog {...makeProps({ producerAgentId: "no-scheme" })} />);
    const btn = screen.getByRole("button", { name: /Resume in CC/ });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("omits the detail row when message is null", () => {
    render(<HandoffRitualFailureDialog {...makeProps({ message: null })} />);
    expect(screen.queryByText(/detail:/)).toBeNull();
  });

  // Default mode is the operator handoff — the existing copy + Retry are
  // unchanged (regression guard for the crash-loop generalization).
  it("uses the operator-rejected copy + enabled Retry by default", () => {
    render(<HandoffRitualFailureDialog {...makeProps()} />);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Handoff ritual rejected");
    expect(screen.getByText(/Producer rejected the handoff ritual/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /Continue with stale/ })).toBeTruthy();
  });
});

describe("HandoffRitualFailureDialog — crash-loop (mode=crash_loop)", () => {
  it("surfaces the manual-relaunch failure message", () => {
    render(
      <HandoffRitualFailureDialog
        {...makeProps({
          mode: "crash_loop",
          reason: "crash_loop_halted",
          message: null,
          // No live Producer after a crash-loop halt.
          producerAgentId: null,
        })}
      />,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(
      "Producer crash-loop halted",
    );
    expect(screen.getByText(/Producer crash-loop halted/)).toBeTruthy();
    expect(screen.getByText(/Manual relaunch required/i)).toBeTruthy();
    expect(screen.getByText(/health recovery resets the crash-loop budget/i)).toBeTruthy();
  });

  it("disables Retry — re-POSTing a handoff can't recover a crash-loop", () => {
    render(
      <HandoffRitualFailureDialog
        {...makeProps({ mode: "crash_loop", reason: "crash_loop_halted", producerAgentId: null })}
      />,
    );
    expect(screen.getByRole("button", { name: /Retry/ })).toHaveProperty("disabled", true);
  });

  it("offers Dismiss (not 'Continue with stale') since the Producer is gone", () => {
    const onDismiss = vi.fn();
    render(
      <HandoffRitualFailureDialog
        {...makeProps({
          mode: "crash_loop",
          reason: "crash_loop_halted",
          producerAgentId: null,
          onDismiss,
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Continue with stale/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
