// @vitest-environment jsdom
//
// useHandoffs / useHandoffContent — the fetch hooks behind the R₂ in-tmai
// Hand-over viewer (operator-side half of tmai-core #473). We mock the
// `api` helpers and assert the shared `{ data, loading, error }` contract:
//
//   - useHandoffs (list, mirrors useDecisions): a `null` unit parks (no
//     fetch), a real unit fetches once and exposes the baton list, errors
//     surface without fabricating data, and switching units re-fetches +
//     clears the previous payload (generation guard).
//   - useHandoffContent (content, mirrors usePrDetail): parks when EITHER
//     arg is null, fetches once when both are set, surfaces errors, and
//     re-fetches + clears on a baton change.

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffContentResponse, HandoffsResponse } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    unitHandoffs: vi.fn(),
    unitHandoff: vi.fn(),
  },
}));

import { api } from "@/lib/api";
import { useHandoffContent, useHandoffs } from "../useHandoffs";

function listResponse(overrides: Partial<HandoffsResponse> = {}): HandoffsResponse {
  return {
    unit: "u",
    handoffs: [
      { name: "active", status: "active", composed_at: "2026-05-12T18:30:00Z", task: "ship it" },
      {
        name: "2026-05-10T09-00-00.000Z.md",
        status: "archived",
        composed_at: "2026-05-10T09:00:00Z",
        task: null,
      },
    ],
    ...overrides,
  };
}

function contentResponse(overrides: Partial<HandoffContentResponse> = {}): HandoffContentResponse {
  return {
    unit: "u",
    name: "active",
    content: "---\ncomposed-at: 2026-05-12T18:30:00Z\ntask: ship it\n---\n\n# Baton body",
    ...overrides,
  };
}

describe("useHandoffs (list)", () => {
  beforeEach(() => {
    vi.mocked(api.unitHandoffs).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks when the unit is null — no fetch, not loading", () => {
    const { result } = renderHook(() => useHandoffs(null));
    expect(api.unitHandoffs).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("fetches the baton list once on a real unit and exposes it", async () => {
    vi.mocked(api.unitHandoffs).mockResolvedValue(listResponse());
    const { result } = renderHook(() => useHandoffs("u"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.unitHandoffs).toHaveBeenCalledWith("u");
    expect(result.current.data?.handoffs).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.unitHandoffs).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useHandoffs("u"));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the unit changes and clears the previous payload", async () => {
    vi.mocked(api.unitHandoffs).mockImplementation((unit: string) =>
      Promise.resolve(listResponse({ unit, handoffs: [] })),
    );
    const { result, rerender } = renderHook(({ u }) => useHandoffs(u), {
      initialProps: { u: "a" },
    });
    await waitFor(() => expect(result.current.data?.unit).toBe("a"));

    rerender({ u: "b" });
    // Cleared synchronously on unit change so the old unit's batons are
    // never shown under the new unit.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.unit).toBe("b"));
  });
});

describe("useHandoffContent (content)", () => {
  beforeEach(() => {
    vi.mocked(api.unitHandoff).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks when the unit is null — no fetch, not loading", () => {
    const { result } = renderHook(() => useHandoffContent(null, "active"));
    expect(api.unitHandoff).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("parks when the name is null — no fetch, not loading", () => {
    const { result } = renderHook(() => useHandoffContent("u", null));
    expect(api.unitHandoff).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("fetches the baton once when both args are set and exposes the content", async () => {
    vi.mocked(api.unitHandoff).mockResolvedValue(contentResponse());
    const { result } = renderHook(() => useHandoffContent("u", "active"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.unitHandoff).toHaveBeenCalledWith("u", "active");
    expect(result.current.data?.content).toMatch(/Baton body/);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.unitHandoff).mockRejectedValue(new Error("kaboom"));
    const { result } = renderHook(() => useHandoffContent("u", "active"));
    await waitFor(() => expect(result.current.error?.message).toBe("kaboom"));
    expect(result.current.data).toBeNull();
  });

  it("re-fetches when the baton name changes and clears the previous payload", async () => {
    vi.mocked(api.unitHandoff).mockImplementation((_unit: string, name: string) =>
      Promise.resolve(contentResponse({ name, content: `body-${name}` })),
    );
    const { result, rerender } = renderHook(({ n }) => useHandoffContent("u", n), {
      initialProps: { n: "active" },
    });
    await waitFor(() => expect(result.current.data?.content).toBe("body-active"));

    rerender({ n: "2026-05-10T09-00-00.000Z.md" });
    expect(result.current.data).toBeNull();
    await waitFor(() =>
      expect(result.current.data?.content).toBe("body-2026-05-10T09-00-00.000Z.md"),
    );
  });
});
