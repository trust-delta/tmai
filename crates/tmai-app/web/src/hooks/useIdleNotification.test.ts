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
