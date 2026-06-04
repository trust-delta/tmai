// @vitest-environment jsdom
//
// useUnitAttention — the per-artifact attention poller + operator-write hook
// (contract `tmai-core:doc/approaches/2026-06-04-attention-as-per-artifact-
// field.md`). We mock `api.unitAttention` (GET) and `api.setUnitAttention`
// (POST) so each test drives a deterministic map and asserts:
//   - the sibling-shaped poll contract (park on null, initial-fetch loading,
//     error surfaced without fabricating data, the 60s poll keeps the last
//     response visible);
//   - `levelFor(section,id)` reads the map and treats absence as `null` (the
//     machine fact pole — the wire never emits it);
//   - `setAttention` POSTs `low`/`high` and re-renders from the RETURNED map,
//     so a server-side demotion (a prior `high` knocked to `low`) lands even
//     though the caller only wrote one artifact;
//   - `settingKey` reports the in-flight artifact for a busy marker.
//
// Timers stay real and the poll is exercised by capturing `window.setInterval`
// directly (waitFor cannot make progress under fake timers) — same approach as
// the useUnitInventory sibling test.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    unitAttention: vi.fn(),
    setUnitAttention: vi.fn(),
  },
}));

import type { AttentionEntryWire, AttentionStateResponse, Level } from "@/lib/api";
import { api } from "@/lib/api";
import { attentionKey, useUnitAttention } from "../useUnitAttention";

function entry(
  section: AttentionEntryWire["section"],
  id: string,
  level: Level,
): AttentionEntryWire {
  return { section, id, level };
}

function response(unit: string, entries: AttentionEntryWire[]): AttentionStateResponse {
  return { unit, entries };
}

describe("useUnitAttention", () => {
  beforeEach(() => {
    vi.mocked(api.unitAttention).mockReset();
    vi.mocked(api.setUnitAttention).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks on unit=null — no fetch, not loading, all levels null", () => {
    const { result } = renderHook(() => useUnitAttention(null));
    expect(api.unitAttention).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    // Absence = null even with no data at all.
    expect(result.current.levelFor("pr", "1")).toBeNull();
  });

  it("fetches on a real unit and levelFor reads the map (absence = null)", async () => {
    vi.mocked(api.unitAttention).mockResolvedValue(
      response("tmai", [entry("pr", "123", "high"), entry("decision", "d-slug", "low")]),
    );
    const { result } = renderHook(() => useUnitAttention("tmai"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.unitAttention).toHaveBeenCalledWith("tmai");
    expect(result.current.levelFor("pr", "123")).toBe("high");
    expect(result.current.levelFor("decision", "d-slug")).toBe("low");
    // Not in the map → null (a machine fact, never emitted on the wire).
    expect(result.current.levelFor("issue", "999")).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("surfaces a fetch error without fabricating data", async () => {
    vi.mocked(api.unitAttention).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useUnitAttention("tmai"));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBeNull();
  });

  it("setAttention POSTs low/high and re-renders from the returned map", async () => {
    vi.mocked(api.unitAttention).mockResolvedValue(response("tmai", []));
    vi.mocked(api.setUnitAttention).mockResolvedValue(
      response("tmai", [entry("pr", "123", "high")]),
    );
    const { result } = renderHook(() => useUnitAttention("tmai"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.levelFor("pr", "123")).toBeNull();

    await act(async () => {
      await result.current.setAttention("pr", "123", "high");
    });

    expect(api.setUnitAttention).toHaveBeenCalledWith("tmai", {
      section: "pr",
      id: "123",
      level: "high",
    });
    // Re-rendered straight from the POST response — no extra GET needed.
    expect(result.current.levelFor("pr", "123")).toBe("high");
  });

  it("reflects a server-side demotion carried on the returned map", async () => {
    // A prior `high` (Issue) sits in the remote dimension. Setting a new
    // `high` on a PR makes the backend demote the Issue to `low` to keep
    // `high`≤1/dimension; the POST returns the FULL updated map, so the demoted
    // Issue updates even though the caller only wrote the PR.
    vi.mocked(api.unitAttention).mockResolvedValue(response("tmai", [entry("issue", "7", "high")]));
    vi.mocked(api.setUnitAttention).mockResolvedValue(
      response("tmai", [entry("issue", "7", "low"), entry("pr", "123", "high")]),
    );
    const { result } = renderHook(() => useUnitAttention("tmai"));
    await waitFor(() => expect(result.current.levelFor("issue", "7")).toBe("high"));

    await act(async () => {
      await result.current.setAttention("pr", "123", "high");
    });

    expect(result.current.levelFor("pr", "123")).toBe("high");
    // The other artifact in the dimension demoted — never reset to null.
    expect(result.current.levelFor("issue", "7")).toBe("low");
  });

  it("reports settingKey while a POST is in flight and clears it after", async () => {
    vi.mocked(api.unitAttention).mockResolvedValue(response("tmai", []));
    let resolvePost: (v: AttentionStateResponse) => void = () => {};
    vi.mocked(api.setUnitAttention).mockReturnValue(
      new Promise<AttentionStateResponse>((res) => {
        resolvePost = res;
      }),
    );
    const { result } = renderHook(() => useUnitAttention("tmai"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.setAttention("pr", "123", "low");
    });
    // In flight: the busy key matches the artifact (derived via the exported
    // joiner so this survives any future separator change).
    await waitFor(() => expect(result.current.settingKey).toBe(attentionKey("pr", "123")));

    await act(async () => {
      resolvePost(response("tmai", [entry("pr", "123", "low")]));
      await pending;
    });
    expect(result.current.settingKey).toBeNull();
  });

  it("re-fetches on unit change and clears the previous unit's attention", async () => {
    vi.mocked(api.unitAttention).mockImplementation((u: string) =>
      Promise.resolve(response(u, u === "tmai" ? [entry("pr", "1", "high")] : [])),
    );
    const { result, rerender } = renderHook(({ u }) => useUnitAttention(u), {
      initialProps: { u: "tmai" },
    });
    await waitFor(() => expect(result.current.levelFor("pr", "1")).toBe("high"));

    rerender({ u: "other" });
    // Cleared synchronously so the old unit's attention is never shown under
    // the new unit's rows.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.unit).toBe("other"));
    expect(result.current.levelFor("pr", "1")).toBeNull();
  });

  it("keeps the last response visible across the 60s poll", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    vi.mocked(api.unitAttention).mockResolvedValue(response("tmai", [entry("pr", "1", "high")]));
    const { result } = renderHook(() => useUnitAttention("tmai"));
    await waitFor(() => expect(result.current.levelFor("pr", "1")).toBe("high"));

    const tick = setIntervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(typeof tick).toBe("function");

    await act(async () => {
      tick?.();
    });
    await waitFor(() => expect(api.unitAttention).toHaveBeenCalledTimes(2));
    // Last response stays visible (anti-flicker) — never cleared on a poll.
    expect(result.current.levelFor("pr", "1")).toBe("high");
  });

  it("a GET that resolves after parking (unit→null) does not revive stale data", async () => {
    // The park branch must bump the generation so the previous unit's in-flight
    // GET is invalidated; otherwise it passes its `myGen === generationRef`
    // guard and stamps stale data over the cleared (parked) state.
    let resolveGet: (v: AttentionStateResponse) => void = () => {};
    vi.mocked(api.unitAttention).mockReturnValueOnce(
      new Promise<AttentionStateResponse>((res) => {
        resolveGet = res;
      }),
    );
    const { result, rerender } = renderHook(({ u }) => useUnitAttention(u), {
      initialProps: { u: "tmai" as string | null },
    });
    expect(result.current.loading).toBe(true);

    // Park before the GET resolves.
    rerender({ u: null });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);

    // The previous unit's GET now resolves — it must be dropped, not stamped.
    await act(async () => {
      resolveGet(response("tmai", [entry("pr", "1", "high")]));
    });
    expect(result.current.data).toBeNull();
    expect(result.current.levelFor("pr", "1")).toBeNull();
  });

  it("concurrent same-unit writes: a late older response does not overwrite the newer one", async () => {
    vi.mocked(api.unitAttention).mockResolvedValue(response("tmai", []));
    // Two POSTs in flight at once; capture each resolver so we can answer them
    // OUT OF ORDER (the older one last).
    const deferred: Array<(v: AttentionStateResponse) => void> = [];
    vi.mocked(api.setUnitAttention).mockImplementation(
      () =>
        new Promise<AttentionStateResponse>((res) => {
          deferred.push(res);
        }),
    );
    const { result } = renderHook(() => useUnitAttention("tmai"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let older: Promise<void> = Promise.resolve();
    let newer: Promise<void> = Promise.resolve();
    act(() => {
      older = result.current.setAttention("pr", "1", "low"); // write seq 1
      newer = result.current.setAttention("pr", "1", "high"); // write seq 2
    });
    await waitFor(() => expect(deferred).toHaveLength(2));

    // The NEWER write (seq 2) resolves first and wins.
    await act(async () => {
      deferred[1](response("tmai", [entry("pr", "1", "high")]));
      await newer;
    });
    expect(result.current.levelFor("pr", "1")).toBe("high");
    expect(result.current.settingKey).toBeNull();

    // The OLDER write (seq 1) resolves LATE — it is stale and must be dropped,
    // never rolling the display back to `low`.
    await act(async () => {
      deferred[0](response("tmai", [entry("pr", "1", "low")]));
      await older;
    });
    expect(result.current.levelFor("pr", "1")).toBe("high");
    expect(result.current.settingKey).toBeNull();
  });
});
