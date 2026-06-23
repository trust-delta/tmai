// @vitest-environment jsdom
//
// api.launchProducer — by-PATH engine-composed Producer launch (#581; the rip's
// `+` Add-unit bootstrap fix, superseding the #566 by-name route). Asserts the
// wire contract: POST /producer/launch with a `{ path }` body carrying the
// picked ABSOLUTE PATH (not its basename — the engine derives the unit from the
// path via `unit_for_path`), returns the SpawnResponse, and a backend rejection
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

  it("POSTs to /producer/launch with the picked path body and returns the spawn response", async () => {
    const result = await api.launchProducer("/home/u/works/new-project");
    expect(result).toEqual(SPAWN);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/producer\/launch$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      path: "/home/u/works/new-project",
    });
  });

  it("sends the FULL path, not its basename (the #581 by-path bootstrap)", async () => {
    await api.launchProducer("/home/u/works/conversation-handoff-mcp");
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    // The engine derives the unit from the full path; sending only the basename
    // is exactly the bug #581 fixes (an unconfigured basename 404'd).
    expect(body.path).toBe("/home/u/works/conversation-handoff-mcp");
    expect(body.path).not.toBe("conversation-handoff-mcp");
  });

  it("propagates a backend rejection (400 missing dir) as Error", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Directory does not exist: /nope", { status: 400 }),
    );
    await expect(api.launchProducer("/nope")).rejects.toThrow(/API error 400/);
  });
});
