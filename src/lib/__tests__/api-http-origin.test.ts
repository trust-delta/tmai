// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub window.location before module import so getConfig() resolves correctly.
Object.defineProperty(window, "location", {
  value: { origin: "http://localhost", search: "?token=tok" },
  writable: true,
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after stubs are in place.
import { api, setCallerCwd } from "../api-http";

function okResponse(): Response {
  return new Response(JSON.stringify({}), { status: 200 });
}

function lastOriginHeader(): Record<string, unknown> | null {
  const calls = mockFetch.mock.calls;
  const call = calls.length > 0 ? calls[calls.length - 1] : undefined;
  if (!call) return null;
  const opts = call[1] as RequestInit;
  const headers = opts.headers as Record<string, string>;
  const raw = headers["X-Tmai-Origin"];
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe("X-Tmai-Origin header — state-changing requests", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(okResponse());
    setCallerCwd(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("includes cwd when a project is selected on POST", async () => {
    setCallerCwd("/home/user/project-a");
    await api.approve("agent-1");
    const h = lastOriginHeader();
    expect(h).toEqual({ kind: "Human", interface: "webui", cwd: "/home/user/project-a" });
  });

  it("omits cwd from header when no project is selected", async () => {
    setCallerCwd(null);
    await api.approve("agent-1");
    const h = lastOriginHeader();
    expect(h).toEqual({ kind: "Human", interface: "webui" });
    expect(h?.cwd).toBeUndefined();
  });

  it("reflects project switch between calls", async () => {
    setCallerCwd("/project-1");
    await api.approve("agent-1");
    expect(lastOriginHeader()?.cwd).toBe("/project-1");

    vi.clearAllMocks();
    mockFetch.mockResolvedValue(okResponse());

    setCallerCwd("/project-2");
    await api.approve("agent-1");
    expect(lastOriginHeader()?.cwd).toBe("/project-2");
  });

  it("clears cwd after setCallerCwd(null)", async () => {
    setCallerCwd("/project-x");
    setCallerCwd(null);
    await api.approve("agent-1");
    expect(lastOriginHeader()?.cwd).toBeUndefined();
  });
});

describe("X-Tmai-Origin header — read-only requests", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    setCallerCwd("/some-project");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT inject X-Tmai-Origin on GET requests", async () => {
    await api.listAgents();
    expect(lastOriginHeader()).toBeNull();
  });
});
