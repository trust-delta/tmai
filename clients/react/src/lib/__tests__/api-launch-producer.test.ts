// @vitest-environment jsdom
//
// api.launchProducer — (B) Phase 2 engine-composed Producer launch (#566).
// Asserts the wire contract: POST /units/{unit}/producer/launch (unit
// URL-encoded), no request body (the unit in the path is the only input),
// returns the SpawnResponse, and a backend rejection (404 unresolvable unit)
// propagates as an Error. Mirrors the fetch-mock shape of api-aim-write.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub window.location before module import so getConfig() resolves correctly.
Object.defineProperty(window, "location", {
  value: { origin: "http://localhost", search: "?token=tok" },
  writable: true,
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { api, type SpawnResponse } from "../api-http";

const SPAWN: SpawnResponse = { session_id: "claude:abc123", pid: 0, command: "claude" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api.launchProducer", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(jsonResponse(SPAWN));
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /units/{unit}/producer/launch and returns the spawn response", async () => {
    const result = await api.launchProducer("tmai");
    expect(result).toEqual(SPAWN);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/units\/tmai\/producer\/launch$/);
    expect((init as RequestInit).method).toBe("POST");
    // No request body — the unit (in the path) is the only input.
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("URL-encodes the unit name", async () => {
    await api.launchProducer("a/b");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/units\/a%2Fb\/producer\/launch$/);
  });

  it("propagates an unresolvable unit (404) as Error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("no [[unit]] named 'ghost'", { status: 404 }));
    await expect(api.launchProducer("ghost")).rejects.toThrow(/API error 404/);
  });
});
