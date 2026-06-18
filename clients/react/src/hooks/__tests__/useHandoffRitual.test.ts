// @vitest-environment jsdom
//
// State-machine tests for `useHandoffRitual` — the WebUI half of the
// Producer handoff-and-restart ritual landed server-side in
// tmai-core#352 (DR `2026-05-14-handoff-lifecycle-and-kill-ux.md`).
//
// `useSSE` is captured so each test can synthesize wire events in
// place of a real `/api/events` subscription. `api.triggerHandoffRitual`
// is mocked with a resolved/rejected promise per scenario.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffRitualEvent } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      triggerHandoffRitual: vi.fn(),
    },
  };
});

let capturedSSEHandlers: Parameters<typeof import("@/lib/sse-provider").useSSE>[0] | null = null;
vi.mock("@/lib/sse-provider", () => ({
  useSSE: (handlers: unknown) => {
    capturedSSEHandlers = handlers as Parameters<typeof import("@/lib/sse-provider").useSSE>[0];
  },
}));

import { api, HandoffRitualRequestError } from "@/lib/api";
import { useHandoffRitual } from "../useHandoffRitual";

interface PhaseEventOverrides {
  unit?: string;
  message?: string;
  new_agent_id?: string;
  reason?: string;
}

function phasedEvent(
  ritualId: string,
  phase: HandoffRitualEvent["phase"],
  extra: PhaseEventOverrides = {},
): HandoffRitualEvent {
  // We hand-roll the event so the test fixture matches the wire shape
  // exactly. The generated `HandoffRitualEvent` is a discriminated
  // union; `phase: "escalate"` requires `reason`, others don't.
  if (phase === "escalate") {
    return {
      unit: extra.unit ?? "tmai",
      ritual_id: ritualId,
      phase: "escalate",
      reason: extra.reason ?? "no_active_producer",
      ...(extra.message !== undefined ? { message: extra.message } : {}),
    };
  }
  if (phase === "ready") {
    return {
      unit: extra.unit ?? "tmai",
      ritual_id: ritualId,
      phase: "ready",
      ...(extra.new_agent_id !== undefined ? { new_agent_id: extra.new_agent_id } : {}),
    };
  }
  return {
    unit: extra.unit ?? "tmai",
    ritual_id: ritualId,
    phase,
  };
}

beforeEach(() => {
  capturedSSEHandlers = null;
  vi.mocked(api.triggerHandoffRitual).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useHandoffRitual — state machine", () => {
  it("starts in idle state", () => {
    const { result } = renderHook(() => useHandoffRitual());
    expect(result.current.state.kind).toBe("idle");
    expect(result.current.retryCount).toBe(0);
    expect(result.current.retryRefused).toBe(false);
  });

  it("trigger transitions idle → dispatching → in_progress with the returned ritual_id", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());

    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    expect(result.current.state.kind).toBe("in_progress");
    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.ritualId).toBe("r-1");
      expect(result.current.state.phases).toEqual([]);
    }
  });

  it("forwards request body to api.triggerHandoffRitual", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual", reason: "ctx tipping" });
    });

    expect(vi.mocked(api.triggerHandoffRitual)).toHaveBeenCalledWith("tmai", {
      trigger: "manual",
      reason: "ctx tipping",
    });
  });

  it("appends in-order forward phases when ritual_id matches", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    act(() => {
      capturedSSEHandlers?.onEvent?.("handoff_ritual", phasedEvent("r-1", "prompted"));
    });
    act(() => {
      capturedSSEHandlers?.onEvent?.("handoff_ritual", phasedEvent("r-1", "validated"));
    });

    expect(result.current.state.kind).toBe("in_progress");
    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.phases.map((p) => p.phase)).toEqual(["prompted", "validated"]);
    }
  });

  it("ignores events whose ritual_id does not match the live ritual", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    act(() => {
      // Different ritual id — must not append.
      capturedSSEHandlers?.onEvent?.("handoff_ritual", phasedEvent("r-different", "prompted"));
    });

    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.phases).toHaveLength(0);
    } else {
      throw new Error("expected in_progress state");
    }
  });

  it("carries the dispatched unit in the in_progress state", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.unit).toBe("tmai");
    } else {
      throw new Error("expected in_progress state");
    }
  });

  it("transitions to ready on a `ready` phase with the new agent id surfaced", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    act(() => {
      capturedSSEHandlers?.onEvent?.(
        "handoff_ritual",
        phasedEvent("r-1", "ready", { new_agent_id: "claude:abc-123" }),
      );
    });

    expect(result.current.state.kind).toBe("ready");
    if (result.current.state.kind === "ready") {
      expect(result.current.state.newAgentId).toBe("claude:abc-123");
    }
  });

  it("transitions to escalated on a `escalate` phase carrying the reason", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    act(() => {
      capturedSSEHandlers?.onEvent?.(
        "handoff_ritual",
        phasedEvent("r-1", "escalate", {
          reason: "missing_handoff_ready",
          message: "Producer never wrote HANDOFF READY",
        }),
      );
    });

    expect(result.current.state.kind).toBe("escalated");
    if (result.current.state.kind === "escalated") {
      expect(result.current.state.reason).toBe("missing_handoff_ready");
      expect(result.current.state.message).toBe("Producer never wrote HANDOFF READY");
    }
  });

  it("surfaces a HandoffRitualRequestError 404 as an escalated terminal", async () => {
    vi.mocked(api.triggerHandoffRitual).mockRejectedValue(
      new HandoffRitualRequestError(404, "unknown unit"),
    );

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    expect(result.current.state.kind).toBe("escalated");
    if (result.current.state.kind === "escalated") {
      expect(result.current.state.reason).toBe("http_404");
      expect(result.current.state.message).toBe("unknown unit");
    }
  });

  it("dismiss clears state back to idle and resets the retry budget", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.state.kind).toBe("idle");
    expect(result.current.retryCount).toBe(0);
    expect(result.current.retryRefused).toBe(false);
  });
});

describe("useHandoffRitual — retry budget (DR §E)", () => {
  it("retry resets phases and increments the retry counter", async () => {
    vi.mocked(api.triggerHandoffRitual)
      .mockResolvedValueOnce({ ritual_id: "r-1" })
      .mockResolvedValueOnce({ ritual_id: "r-2" });

    const { result } = renderHook(() => useHandoffRitual());

    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });
    act(() => {
      capturedSSEHandlers?.onEvent?.(
        "handoff_ritual",
        phasedEvent("r-1", "escalate", { reason: "timeout" }),
      );
    });
    expect(result.current.state.kind).toBe("escalated");

    await act(async () => {
      await result.current.retry("tmai", { trigger: "manual" });
    });

    expect(result.current.retryCount).toBe(1);
    expect(result.current.state.kind).toBe("in_progress");
    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.ritualId).toBe("r-2");
      expect(result.current.state.phases).toEqual([]);
    }
  });

  it("refuses the 3rd attempt and flips retryRefused", async () => {
    vi.mocked(api.triggerHandoffRitual)
      .mockResolvedValueOnce({ ritual_id: "r-1" })
      .mockResolvedValueOnce({ ritual_id: "r-2" })
      .mockResolvedValueOnce({ ritual_id: "r-3" });

    const { result } = renderHook(() => useHandoffRitual());

    // Initial attempt
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });
    // 1st retry — allowed
    await act(async () => {
      await result.current.retry("tmai", { trigger: "manual" });
    });
    // 2nd retry — allowed (3rd attempt total = 1 initial + 2 retries)
    await act(async () => {
      await result.current.retry("tmai", { trigger: "manual" });
    });
    expect(result.current.retryCount).toBe(2);

    // 3rd retry — refused per DR §E "second rejection is a hard
    // escalate (no further automatic retry)"
    await act(async () => {
      await result.current.retry("tmai", { trigger: "manual" });
    });
    expect(result.current.retryRefused).toBe(true);
    // triggerHandoffRitual called exactly 3 times (initial + 2 retries)
    expect(vi.mocked(api.triggerHandoffRitual).mock.calls.length).toBe(3);
  });

  it("a fresh `trigger` resets retryCount", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-x" });

    const { result } = renderHook(() => useHandoffRitual());

    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });
    await act(async () => {
      await result.current.retry("tmai", { trigger: "manual" });
    });
    expect(result.current.retryCount).toBe(1);

    // Fresh trigger session — counter must reset.
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });
    expect(result.current.retryCount).toBe(0);
  });
});

describe("useHandoffRitual — supervisor crash-respawn adoption (#540 / #546)", () => {
  const SUP = "slot-supervisor:tmai";

  it("adopts an unsolicited supervisor `launching` from idle", () => {
    const { result } = renderHook(() => useHandoffRitual());
    expect(result.current.state.kind).toBe("idle");

    act(() => {
      capturedSSEHandlers?.onEvent?.("handoff_ritual", phasedEvent(SUP, "launching"));
    });

    expect(result.current.state.kind).toBe("in_progress");
    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.ritualId).toBe(SUP);
      expect(result.current.state.unit).toBe("tmai");
      expect(result.current.state.phases.map((p) => p.phase)).toEqual(["launching"]);
    }
  });

  it("advances an adopted respawn launching → ready", () => {
    const { result } = renderHook(() => useHandoffRitual());
    act(() => {
      capturedSSEHandlers?.onEvent?.("handoff_ritual", phasedEvent(SUP, "launching"));
    });
    act(() => {
      capturedSSEHandlers?.onEvent?.(
        "handoff_ritual",
        phasedEvent(SUP, "ready", { new_agent_id: "claude:fresh" }),
      );
    });

    expect(result.current.state.kind).toBe("ready");
    if (result.current.state.kind === "ready") {
      expect(result.current.state.unit).toBe("tmai");
      expect(result.current.state.newAgentId).toBe("claude:fresh");
    }
  });

  it("adopts a bare `crash_loop_halted` escalate straight from idle", () => {
    const { result } = renderHook(() => useHandoffRitual());
    act(() => {
      capturedSSEHandlers?.onEvent?.(
        "handoff_ritual",
        phasedEvent(SUP, "escalate", { reason: "crash_loop_halted" }),
      );
    });

    expect(result.current.state.kind).toBe("escalated");
    if (result.current.state.kind === "escalated") {
      expect(result.current.state.reason).toBe("crash_loop_halted");
      expect(result.current.state.ritualId).toBe(SUP);
      expect(result.current.state.unit).toBe("tmai");
    }
  });

  it("does NOT adopt a non-supervisor (UUID) event from idle", () => {
    const { result } = renderHook(() => useHandoffRitual());
    act(() => {
      capturedSSEHandlers?.onEvent?.("handoff_ritual", phasedEvent("uuid-r-9", "launching"));
    });
    // A stray operator-ritual event without a live ritual is ignored.
    expect(result.current.state.kind).toBe("idle");
  });

  it("never lets a supervisor respawn clobber a live operator handoff", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });
    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });
    expect(result.current.state.kind).toBe("in_progress");

    act(() => {
      // A concurrent supervisor respawn for another unit must not hijack the
      // operator's live overlay (different ritual_id, prev is in_progress).
      capturedSSEHandlers?.onEvent?.(
        "handoff_ritual",
        phasedEvent("slot-supervisor:other", "launching", { unit: "other" }),
      );
    });

    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.ritualId).toBe("r-1");
      expect(result.current.state.phases).toHaveLength(0);
    } else {
      throw new Error("expected the operator ritual to stay in_progress");
    }
  });
});

describe("useHandoffRitual — SSE event hygiene", () => {
  it("registers an onEvent handler via useSSE", () => {
    renderHook(() => useHandoffRitual());
    expect(capturedSSEHandlers).not.toBeNull();
    expect(typeof capturedSSEHandlers?.onEvent).toBe("function");
  });

  it("ignores non-handoff_ritual events", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    act(() => {
      // Unrelated SSE event with a shape that *would* match if we
      // accidentally dropped the eventName guard.
      capturedSSEHandlers?.onEvent?.("pr_review_feedback", {
        ritual_id: "r-1",
        phase: "ready",
        unit: "tmai",
      });
    });

    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.phases).toHaveLength(0);
    } else {
      throw new Error("expected in_progress state");
    }
  });

  it("ignores malformed handoff_ritual payloads", async () => {
    vi.mocked(api.triggerHandoffRitual).mockResolvedValue({ ritual_id: "r-1" });

    const { result } = renderHook(() => useHandoffRitual());
    await act(async () => {
      await result.current.trigger("tmai", { trigger: "manual" });
    });

    act(() => {
      capturedSSEHandlers?.onEvent?.("handoff_ritual", { not: "a real event" });
    });
    act(() => {
      capturedSSEHandlers?.onEvent?.("handoff_ritual", null);
    });

    if (result.current.state.kind === "in_progress") {
      expect(result.current.state.phases).toHaveLength(0);
    } else {
      throw new Error("expected in_progress state");
    }
  });

  it("waits for trigger to resolve before settling state", async () => {
    let resolve: ((v: { ritual_id: string }) => void) | null = null;
    vi.mocked(api.triggerHandoffRitual).mockReturnValue(
      new Promise<{ ritual_id: string }>((r) => {
        resolve = r;
      }),
    );

    const { result } = renderHook(() => useHandoffRitual());
    let triggerPromise!: Promise<void>;
    act(() => {
      triggerPromise = result.current.trigger("tmai", { trigger: "manual" });
    });

    // Before the API resolves, the hook is in `dispatching`.
    expect(result.current.state.kind).toBe("dispatching");

    await act(async () => {
      resolve?.({ ritual_id: "r-late" });
      await triggerPromise;
    });

    await waitFor(() => expect(result.current.state.kind).toBe("in_progress"));
  });
});
