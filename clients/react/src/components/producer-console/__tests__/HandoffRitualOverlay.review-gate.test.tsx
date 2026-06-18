// @vitest-environment jsdom
//
// Operator review-gate (#547 / tmai-core #549) tests for the
// HandoffRitualOverlay. The `awaiting_review` phase PAUSES the ritual before
// the irreversible kill: the operator must Approve (→ kill + respawn) or
// Request a rewrite (→ the still-alive old Producer is re-prompted, the gate
// re-opens on the regenerated baton).
//
// We mock `@/lib/api` (partial — keep the real `HandoffReviewError` /
// `SUPERVISOR_RITUAL_PREFIX`) so we can assert the exact POSTs the controls
// fire and drive a 409 race deterministically.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffRitualEvent } from "@/lib/api";

const unitHandoffMock = vi.fn();
const approveHandoffMock = vi.fn();
const requestHandoffRewriteMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      unitHandoff: (...args: unknown[]) => unitHandoffMock(...args),
      approveHandoff: (...args: unknown[]) => approveHandoffMock(...args),
      requestHandoffRewrite: (...args: unknown[]) => requestHandoffRewriteMock(...args),
    },
  };
});

import { HandoffReviewError } from "@/lib/api";
import { HandoffRitualOverlay } from "../HandoffRitualOverlay";

const RITUAL = "3f1a2b4c-0000-4d5e-9f00-abcdef012345";

function ev(phase: HandoffRitualEvent["phase"], ritualId = RITUAL): HandoffRitualEvent {
  if (phase === "escalate") {
    return { unit: "tmai", ritual_id: ritualId, phase: "escalate", reason: "timeout" };
  }
  if (phase === "ready") {
    return { unit: "tmai", ritual_id: ritualId, phase: "ready" };
  }
  return { unit: "tmai", ritual_id: ritualId, phase };
}

// phases that land the overlay at the awaiting_review gate.
const AT_GATE = [ev("prompted"), ev("validated"), ev("awaiting_review")];

beforeEach(() => {
  unitHandoffMock.mockReset();
  approveHandoffMock.mockReset();
  requestHandoffRewriteMock.mockReset();
  // Default: baton fetch + decisions resolve cleanly.
  unitHandoffMock.mockResolvedValue({ unit: "tmai", name: "active", content: "baton body" });
  approveHandoffMock.mockResolvedValue(undefined);
  requestHandoffRewriteMock.mockResolvedValue(undefined);
});

describe("HandoffRitualOverlay — operator review gate", () => {
  it("renders an Awaiting-review phase row in the operator handoff set", () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={[]} />);
    expect(screen.getByTestId("phase-row-awaiting_review")).toBeTruthy();
  });

  it("renders the Approve + Request-rewrite controls ONLY at awaiting_review", () => {
    const { rerender } = render(
      <HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={[ev("validated")]} />,
    );
    // Earlier phase — no controls.
    expect(screen.queryByTestId("awaiting-review-controls")).toBeNull();

    rerender(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={AT_GATE} />);
    expect(screen.getByTestId("awaiting-review-controls")).toBeTruthy();
    expect(screen.getByTestId("awaiting-review-approve")).toBeTruthy();
    expect(screen.getByTestId("awaiting-review-request-rewrite")).toBeTruthy();

    // Past the gate (killed) — controls gone again.
    rerender(
      <HandoffRitualOverlay
        unitName="tmai"
        ritualId={RITUAL}
        phases={[...AT_GATE, ev("killed")]}
      />,
    );
    expect(screen.queryByTestId("awaiting-review-controls")).toBeNull();
  });

  it("surfaces the proposed baton out-of-band for review", async () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={AT_GATE} />);
    await waitFor(() => expect(unitHandoffMock).toHaveBeenCalledWith("tmai", "active"));
    expect((await screen.findByTestId("awaiting-review-baton")).textContent).toContain(
      "baton body",
    );
  });

  it("Approve fires POST .../handoff/approve with the current ritual_id", async () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={AT_GATE} />);
    fireEvent.click(screen.getByTestId("awaiting-review-approve"));
    await waitFor(() => expect(approveHandoffMock).toHaveBeenCalledWith("tmai", RITUAL));
    expect(requestHandoffRewriteMock).not.toHaveBeenCalled();
  });

  it("Request-rewrite fires POST .../handoff/request-rewrite with { ritual_id, feedback }", async () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={AT_GATE} />);
    const textarea = screen.getByTestId("awaiting-review-feedback") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "tighten the scope section" } });
    fireEvent.click(screen.getByTestId("awaiting-review-request-rewrite"));
    await waitFor(() =>
      expect(requestHandoffRewriteMock).toHaveBeenCalledWith(
        "tmai",
        RITUAL,
        "tighten the scope section",
      ),
    );
    expect(approveHandoffMock).not.toHaveBeenCalled();
  });

  it("blocks an empty-feedback rewrite and clears the textarea after a submit", async () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={AT_GATE} />);
    const submit = screen.getByTestId("awaiting-review-request-rewrite") as HTMLButtonElement;
    // Empty feedback — submit is disabled and firing it is a no-op.
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(requestHandoffRewriteMock).not.toHaveBeenCalled();

    const textarea = screen.getByTestId("awaiting-review-feedback") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  needs more detail  " } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    // Trimmed feedback on the wire…
    await waitFor(() =>
      expect(requestHandoffRewriteMock).toHaveBeenCalledWith("tmai", RITUAL, "needs more detail"),
    );
    // …and the textarea is cleared (re-disabling the submit) after success.
    await waitFor(() => expect(textarea.value).toBe(""));
    expect(submit.disabled).toBe(true);
  });

  it("surfaces a 409 as a non-fatal error rather than crashing", async () => {
    approveHandoffMock.mockRejectedValueOnce(new HandoffReviewError(409, "no armed gate"));
    render(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={AT_GATE} />);
    fireEvent.click(screen.getByTestId("awaiting-review-approve"));
    const alert = await screen.findByTestId("awaiting-review-error");
    expect(alert.textContent ?? "").toMatch(/no review gate is armed/i);
    // The overlay is still mounted (no crash) — controls remain.
    expect(screen.getByTestId("awaiting-review-controls")).toBeTruthy();
    expect(screen.getByTestId("awaiting-review-approve")).toBeTruthy();
  });

  it("falls back gracefully when the baton preview fails to load", async () => {
    unitHandoffMock.mockRejectedValueOnce(new Error("not found"));
    render(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={AT_GATE} />);
    expect(await screen.findByText(/could not load the baton preview/i)).toBeTruthy();
    // Decision controls still work despite the missing preview.
    fireEvent.click(screen.getByTestId("awaiting-review-approve"));
    await waitFor(() => expect(approveHandoffMock).toHaveBeenCalledWith("tmai", RITUAL));
  });
});

describe("HandoffRitualOverlay — review gate regressions", () => {
  it("never shows the review controls for a supervisor crash-respawn", () => {
    const SUP = "slot-supervisor:tmai";
    render(
      <HandoffRitualOverlay
        unitName="tmai"
        ritualId={SUP}
        // Even if an awaiting_review event leaked onto a respawn stream, the
        // respawn phase set has no such row and the gate stays closed.
        phases={[ev("launching", SUP), ev("awaiting_review", SUP)]}
      />,
    );
    expect(screen.queryByTestId("awaiting-review-controls")).toBeNull();
    expect(approveHandoffMock).not.toHaveBeenCalled();
  });

  it("does not fetch the baton or render controls before the gate", () => {
    render(<HandoffRitualOverlay unitName="tmai" ritualId={RITUAL} phases={[ev("prompted")]} />);
    expect(screen.queryByTestId("awaiting-review-controls")).toBeNull();
    expect(unitHandoffMock).not.toHaveBeenCalled();
  });
});
