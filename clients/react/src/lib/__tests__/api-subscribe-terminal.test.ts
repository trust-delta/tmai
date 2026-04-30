// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub window.location before module import so getConfig() resolves correctly.
Object.defineProperty(window, "location", {
  value: { origin: "http://localhost", search: "?token=tok" },
  writable: true,
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import type { TerminalSubscription } from "../api-http";
import { api } from "../api-http";

const SUBSCRIPTION: TerminalSubscription = {
  agent_id: "provisional:abcd1234-aaaa-bbbb-cccc-ddddeeeeffff",
  token: "ticket-token-xyz",
  issued_at: "2026-04-30T10:00:00Z",
  expires_at: "2026-04-30T10:05:00Z",
  stream_endpoint: "/api/agents/provisional:abcd1234-aaaa-bbbb-cccc-ddddeeeeffff/terminal-stream",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api.subscribeTerminal", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(jsonResponse(SUBSCRIPTION));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /agents/{id}/subscribe-terminal and returns the ticket", async () => {
    const result = await api.subscribeTerminal(SUBSCRIPTION.agent_id);
    expect(result).toEqual(SUBSCRIPTION);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    // Origin/host comes from window.location and varies by test env
    // (jsdom default: http://localhost:3000). Assert path only — that
    // is what the wire contract is.
    expect(url).toMatch(
      /\/api\/agents\/provisional%3Aabcd1234-aaaa-bbbb-cccc-ddddeeeeffff\/subscribe-terminal$/,
    );
    expect((init as RequestInit).method).toBe("POST");
  });

  it("includes a Bearer Authorization header", async () => {
    await api.subscribeTerminal(SUBSCRIPTION.agent_id);
    const [, init] = mockFetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    // The exact token value depends on the URL search captured at module
    // load (impossible to override post-import for ES modules). Just
    // assert the scheme is correct.
    expect(headers.Authorization).toMatch(/^Bearer /);
  });

  it("propagates server errors as Error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("PTY-server unavailable", { status: 503 }));
    await expect(api.subscribeTerminal(SUBSCRIPTION.agent_id)).rejects.toThrow(/API error 503/);
  });
});
