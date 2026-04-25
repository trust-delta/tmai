import { describe, expect, it, vi } from "vitest";

// Guard against #470-class regressions: if `git_state_changed` disappears
// from the SSE `namedEvents` registry, BranchGraph loses every backend
// git transition (branch create/delete, HEAD advance, remote push) and
// the Git panel silently drifts out of sync. The bug was invisible
// because the handler in BranchGraph is still wired up — the payload
// just never reaches it.
//
// This test exercises the real `subscribeSSE` path against a fake
// `EventSource`, asserting that `git_state_changed` is one of the event
// types the EventSource listens for.

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void): void {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(cb);
  }
  close(): void {}
}

describe("subscribeSSE named-event registration (#470)", () => {
  it("registers a git_state_changed listener on the EventSource", async () => {
    // Shim EventSource + window before importing the module under test.
    // The module reads window.location at import time for the base URL.
    const originalEventSource = globalThis.EventSource;
    const originalWindow = (globalThis as unknown as { window?: unknown }).window;
    vi.stubGlobal("window", {
      location: { origin: "http://localhost", search: "?token=t" },
    } as unknown as Window);
    vi.stubGlobal("EventSource", FakeEventSource);

    try {
      const mod = await import("@/lib/api-http");
      const sub = mod.subscribeSSE({});
      const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
      if (!es) throw new Error("EventSource was not instantiated");
      const events = Object.keys(es.listeners);
      expect(events).toContain("git_state_changed");
      // Sanity: still registers the other core events so this test can't
      // pass vacuously from a rewrite that dropped every listener.
      expect(events).toContain("pr_created");
      expect(events).toContain("agents");
      // Phase 2: entity-update envelope events must be registered (#522)
      expect(events).toContain("AgentUpdate");
      expect(events).toContain("WorktreeUpdate");
      expect(events).toContain("QueueUpdate");
      expect(events).toContain("BootstrapRequired");
      sub.unlisten();
    } finally {
      vi.stubGlobal("EventSource", originalEventSource);
      vi.stubGlobal("window", originalWindow);
    }
  });
});
