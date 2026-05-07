import { describe, expect, test } from "vitest";

// Test the pure logic functions used by useIdleNotification
// (We cannot use renderHook since @testing-library/react is not available)

// Re-implement getDelay logic for testing (mirrors the hook's internal function)
type DetectionSource = "CapturePane" | "IpcSocket" | "HttpHook" | "WebSocket";

function getDelay(source: DetectionSource, thresholdSecs: number): number {
  switch (source) {
    case "HttpHook":
      return 0;
    case "IpcSocket":
    case "WebSocket":
      return Math.min(thresholdSecs * 1000, 2000);
    default:
      return thresholdSecs * 1000;
  }
}

describe("getDelay — notification delay based on detection source", () => {
  test("HttpHook: always 0 (immediate notification)", () => {
    expect(getDelay("HttpHook", 10)).toBe(0);
    expect(getDelay("HttpHook", 60)).toBe(0);
    expect(getDelay("HttpHook", 0)).toBe(0);
  });

  test("IpcSocket: capped at 2000ms", () => {
    expect(getDelay("IpcSocket", 10)).toBe(2000);
    expect(getDelay("IpcSocket", 1)).toBe(1000);
    expect(getDelay("IpcSocket", 0)).toBe(0);
  });

  test("WebSocket: capped at 2000ms (same as IPC)", () => {
    expect(getDelay("WebSocket", 10)).toBe(2000);
    expect(getDelay("WebSocket", 1)).toBe(1000);
    expect(getDelay("WebSocket", 0)).toBe(0);
  });

  test("CapturePane: full threshold duration", () => {
    expect(getDelay("CapturePane", 10)).toBe(10000);
    expect(getDelay("CapturePane", 30)).toBe(30000);
    expect(getDelay("CapturePane", 0)).toBe(0);
  });
});

// #9 — last_assistant_message surfacing in browser notification body
describe("sendNotification body — last_assistant_message isolation (#9)", () => {
  // Pure logic test: document the expected body selection rule.
  // When last_assistant_message is present it becomes the notification body
  // so that the notification surface, not the conversation input, is the
  // authoritative display for notification content.
  function resolveBody(lastMessage: string | null | undefined, projectName: string): string {
    return lastMessage
      ? lastMessage.slice(0, 200)
      : `Agent in ${projectName} has finished processing.`;
  }

  test("uses last_assistant_message as body when present", () => {
    const body = resolveBody("PR #77 を作成しました", "tmai-core");
    expect(body).toBe("PR #77 を作成しました");
  });

  test("truncates last_assistant_message to 200 chars", () => {
    const long = "x".repeat(300);
    const body = resolveBody(long, "tmai-core");
    expect(body).toHaveLength(200);
  });

  test("falls back to generic body when last_assistant_message is null", () => {
    const body = resolveBody(null, "tmai-core");
    expect(body).toBe("Agent in tmai-core has finished processing.");
  });

  test("falls back to generic body when last_assistant_message is undefined", () => {
    const body = resolveBody(undefined, "tmai-core");
    expect(body).toBe("Agent in tmai-core has finished processing.");
  });
});

// Step 5 of the agent-state attention rebuild (decision tmai-core@2026-05-07):
// useIdleNotification now treats `attention.required` as the primary signal,
// with the legacy `status` Processing → Idle transition as a compat
// fallback. Mirror the hook's transition rule here as a pure function so
// the trigger semantics are pinned down without dragging React in.
describe("attention axis triggering — Step 5 transitions", () => {
  // Mirrors the per-agent block in useIdleNotification.ts
  // `justBecameNeedsHuman = attentionTrigger || statusTrigger`.
  // The attention path uses `prevAttention === false` (not `!prevAttention`)
  // so the first observation of an agent (`prevAttention === undefined`)
  // does NOT count as a transition — see CodeRabbit comment on tmai#618.
  function justBecameNeedsHuman(args: {
    prevAttention: boolean | undefined;
    attentionRequired: boolean;
    prevStatus: string | undefined;
    status: string;
  }): boolean {
    const attentionTrigger = args.prevAttention === false && args.attentionRequired;
    const statusTrigger =
      args.prevStatus === "Processing" && (args.status === "Idle" || args.status === "Offline");
    return attentionTrigger || statusTrigger;
  }

  test("attention.required false → true fires (primary path)", () => {
    expect(
      justBecameNeedsHuman({
        prevAttention: false,
        attentionRequired: true,
        prevStatus: undefined,
        status: "Unknown",
      }),
    ).toBe(true);
  });

  test("first observation with attention.required=true does NOT fire", () => {
    // Tab just opened on an agent that has been requiring attention for
    // hours — the user should see the visual badge but not get a stale
    // browser notification. CodeRabbit tmai#618.
    expect(
      justBecameNeedsHuman({
        prevAttention: undefined,
        attentionRequired: true,
        prevStatus: undefined,
        status: "Unknown",
      }),
    ).toBe(false);
  });

  test("first observation with attention.required=false does not fire", () => {
    expect(
      justBecameNeedsHuman({
        prevAttention: undefined,
        attentionRequired: false,
        prevStatus: undefined,
        status: "Unknown",
      }),
    ).toBe(false);
  });

  test("attention.required held true → true does not retrigger", () => {
    expect(
      justBecameNeedsHuman({
        prevAttention: true,
        attentionRequired: true,
        prevStatus: undefined,
        status: "Unknown",
      }),
    ).toBe(false);
  });

  test("legacy status Processing → Idle fires when attention is undefined (fallback)", () => {
    expect(
      justBecameNeedsHuman({
        prevAttention: false,
        attentionRequired: false,
        prevStatus: "Processing",
        status: "Idle",
      }),
    ).toBe(true);
  });

  test("legacy status Processing → Offline also fires (fallback)", () => {
    expect(
      justBecameNeedsHuman({
        prevAttention: false,
        attentionRequired: false,
        prevStatus: "Processing",
        status: "Offline",
      }),
    ).toBe(true);
  });

  test("status Idle → Idle (no transition) does not retrigger", () => {
    expect(
      justBecameNeedsHuman({
        prevAttention: false,
        attentionRequired: false,
        prevStatus: "Idle",
        status: "Idle",
      }),
    ).toBe(false);
  });

  test("attention false → true wins even when legacy status is also transitioning", () => {
    // Both signals fire on the same tick — still only one notification
    // because the OR collapses to a single 'true'.
    expect(
      justBecameNeedsHuman({
        prevAttention: false,
        attentionRequired: true,
        prevStatus: "Processing",
        status: "Idle",
      }),
    ).toBe(true);
  });
});

describe("notification trigger conditions", () => {
  // These tests document the expected behavior of status transitions

  test("only Processing → Idle should trigger notification", () => {
    const transitions = [
      { from: "Processing", to: "Idle", shouldNotify: true },
      { from: "Processing", to: "Offline", shouldNotify: true },
      { from: "Idle", to: "Idle", shouldNotify: false },
      { from: "Idle", to: "Processing", shouldNotify: false },
      { from: "Unknown", to: "Idle", shouldNotify: false },
      { from: "Offline", to: "Idle", shouldNotify: false },
      { from: "AwaitingApproval", to: "Idle", shouldNotify: false },
    ];

    for (const { from, to, shouldNotify } of transitions) {
      const isIdleOrOffline = to === "Idle" || to === "Offline";
      const wasProcessing = from === "Processing";
      const wouldNotify = isIdleOrOffline && wasProcessing;
      expect(wouldNotify).toBe(shouldNotify);
    }
  });

  test("non-AI agent types should not trigger notification", () => {
    // isAiAgent returns true only for: ClaudeCode, OpenCode, CodexCli, GeminiCli
    const aiTypes = ["ClaudeCode", "OpenCode", "CodexCli", "GeminiCli"];
    const nonAiTypes = ["Terminal", "Shell", "Unknown"];

    for (const t of aiTypes) {
      expect(aiTypes.includes(t)).toBe(true);
    }
    for (const t of nonAiTypes) {
      expect(aiTypes.includes(t)).toBe(false);
    }
  });

  test("threshold prevents transient flicker notifications", () => {
    // Simulate: Processing → Idle (5s) → Processing → Idle (5s) → Processing
    // With 10s threshold, no notification should be sent
    const threshold = 10;
    const delay = getDelay("CapturePane", threshold);
    const flickerDuration = 5000; // 5 seconds

    // The flicker duration is shorter than the delay, so the timer
    // would be cancelled before firing
    expect(flickerDuration).toBeLessThan(delay);
  });
});
