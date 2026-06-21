// @vitest-environment jsdom
//
// api.createAim / api.editAim — the aim-tree write surface (tmai-core #501,
// graduation Stage 2-A; consumed by the WebUI Stage 2-B). Asserts the wire
// contract: create POSTs the body to the collection path, edit PUTs the body to
// the per-node path (slug URL-encoded), each returns the persisted `AimWire`,
// and a backend rejection (409 / 422 / 404) propagates as an Error. Mirrors the
// fetch-mock shape of `api-subscribe-terminal.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub window.location before module import so getConfig() resolves correctly.
Object.defineProperty(window, "location", {
  value: { origin: "http://localhost", search: "?token=tok" },
  writable: true,
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import type { AimWire } from "../api-http";
import { api } from "../api-http";

const NODE: AimWire = {
  slug: "aim-system",
  aim: "records を書く構造に",
  parent: null,
  state: "open",
  depends_on: [],
  serves: [],
  related: [],
  body: "",
  drift: null,
  working_delta: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api.createAim", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(jsonResponse(NODE, 201));
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs the create body to /units/{unit}/aims and returns the node", async () => {
    const body = { slug: "aim-system", aim: "records を書く構造に", parent: null };
    const result = await api.createAim("tmai", body);
    expect(result).toEqual(NODE);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/units\/tmai\/aims$/);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(body);
  });

  it("propagates a duplicate (409) as Error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("aim 'x' already exists", { status: 409 }));
    await expect(api.createAim("tmai", { slug: "x", aim: "a", parent: null })).rejects.toThrow(
      /API error 409/,
    );
  });
});

describe("api.editAim", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(jsonResponse(NODE));
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("PUTs the edit body to /units/{unit}/aims/{slug} and returns the node", async () => {
    const body = { aim: "edited", parent: "aim-system", state: "done" as const };
    const result = await api.editAim("tmai", "attention-backend", body);
    expect(result).toEqual(NODE);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/units\/tmai\/aims\/attention-backend$/);
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(body);
  });

  it("URL-encodes the slug", async () => {
    await api.editAim("tmai", "a/b", { aim: "x", parent: null, state: "open" });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/aims\/a%2Fb$/);
  });

  it("propagates a missing node (404) as Error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(
      api.editAim("tmai", "ghost", { aim: "x", parent: null, state: "open" }),
    ).rejects.toThrow(/API error 404/);
  });
});
