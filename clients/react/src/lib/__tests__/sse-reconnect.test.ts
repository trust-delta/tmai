// Integration test: subscribeSSE reconnect behaviour (#522)
//
// Verifies that:
//   1. After an SSE error, the connection reopens with ?since=<lastSeq>
//   2. BootstrapRequired triggers the consumer's handler
//   3. Entity-Update events update lastSeq tracked inside subscribeSSE

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Fake EventSource ─────────────────────────────────────────────────────────

type ESListener = (e: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: Record<string, ESListener[]> = {};
  onerror: ((e: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: ESListener): void {
    this.listeners[type] ??= [];
    this.listeners[type].push(cb);
  }
  close(): void {}

  // Test helper: fire a named event (BigInt → string so JSON.stringify works)
  emit(type: string, data: unknown): void {
    const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data, replacer) });
    }
  }
  // Test helper: simulate connection error
  triggerError(): void {
    this.onerror?.(new Event("error"));
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

let originalEventSource: typeof globalThis.EventSource;
let originalWindow: unknown;

beforeEach(() => {
  FakeEventSource.instances = [];
  originalEventSource = globalThis.EventSource;
  originalWindow = (globalThis as unknown as Record<string, unknown>).window;

  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("window", {
    location: { origin: "http://localhost", search: "?token=t" },
  } as unknown as Window);
  // Use fake timers so setTimeout in the reconnect path is controlled
  vi.useFakeTimers();
});

afterEach(() => {
  vi.stubGlobal("EventSource", originalEventSource);
  vi.stubGlobal("window", originalWindow);
  vi.useRealTimers();
  vi.resetModules();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("subscribeSSE reconnect with ?since= (#522)", () => {
  it("initial connection has no ?since= parameter", async () => {
    const mod = await import("@/lib/api-http");
    const sub = mod.subscribeSSE({});
    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    expect(es).toBeDefined();
    expect(es.url).not.toContain("since=");
    sub.unlisten();
  });

  it("reconnects with ?since=<lastSeq> after SSE error", async () => {
    const mod = await import("@/lib/api-http");
    const sub = mod.subscribeSSE({});

    const firstEs = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    expect(firstEs.url).not.toContain("since=");

    // Fire an AgentUpdate event to establish lastSeq = 42 (number after JSON round-trip)
    firstEs.emit("AgentUpdate", {
      v: 1,
      event: "AgentUpdate",
      change: "Upserted",
      entity: "Agent",
      id: "abc",
      snapshot: {},
      seq: 42,
      ts: new Date().toISOString(),
    });

    // Simulate connection error → subscribeSSE schedules a reconnect
    firstEs.triggerError();

    // Advance fake timers past the 3 s backoff
    vi.advanceTimersByTime(3100);

    const secondEs = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    expect(secondEs).not.toBe(firstEs);
    expect(secondEs.url).toContain("since=42");

    sub.unlisten();
  });

  it("does not reconnect after unlisten()", async () => {
    const mod = await import("@/lib/api-http");
    const sub = mod.subscribeSSE({});

    const firstEs = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    sub.unlisten(); // stop before the error

    firstEs.triggerError();
    vi.advanceTimersByTime(3100);

    // No new EventSource should have been created
    expect(FakeEventSource.instances[FakeEventSource.instances.length - 1]).toBe(firstEs);
  });

  it("calls onBootstrapRequired with the parsed event", async () => {
    const onBootstrapRequired = vi.fn();
    const mod = await import("@/lib/api-http");
    const sub = mod.subscribeSSE({ onBootstrapRequired });

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    // seq comes back as number after JSON round-trip (JSON doesn't support BigInt)
    es.emit("BootstrapRequired", { event: "BootstrapRequired", seq: 99 });

    expect(onBootstrapRequired).toHaveBeenCalledOnce();
    expect(onBootstrapRequired.mock.calls[0][0].seq).toBe(99);

    sub.unlisten();
  });

  it("calls onEntityUpdate for AgentUpdate events and tracks seq", async () => {
    const onEntityUpdate = vi.fn();
    const mod = await import("@/lib/api-http");
    const sub = mod.subscribeSSE({ onEntityUpdate });

    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    // seq is number after JSON round-trip
    const envelope = {
      v: 1,
      event: "AgentUpdate",
      change: "Upserted",
      entity: "Agent",
      id: "abc",
      snapshot: { id: "abc" },
      seq: 7,
      ts: new Date().toISOString(),
    };
    es.emit("AgentUpdate", envelope);

    expect(onEntityUpdate).toHaveBeenCalledOnce();
    expect(onEntityUpdate.mock.calls[0][0].seq).toBe(7);

    // After error, reconnect uses ?since=7
    es.triggerError();
    vi.advanceTimersByTime(3100);
    const secondEs = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    expect(secondEs.url).toContain("since=7");

    sub.unlisten();
  });
});
