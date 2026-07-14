// @vitest-environment jsdom
//
// useCrossUnitRemoteDelta — fan the remote-Δ read across every live unit
// (aim `cross-unit-remote-delta`). We mock api.unitPrs / api.unitIssues so each
// test drives deterministic per-unit responses and asserts: empty unitNames
// parks, a real set fans out over BOTH endpoints per unit, a transient per-unit
// failure keeps that unit's last-known slice (anti-flicker), and the keyed
// subscription re-fetches only when the SET of units changes (not on a fresh
// array identity from the 10s slots poll).
//
// Timers stay real; the poll is exercised by capturing window.setInterval's
// callback (waitFor cannot progress under fake timers) — same technique as
// useUnitPrs.test.ts.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    unitPrs: vi.fn(),
    unitIssues: vi.fn(),
  },
}));

import type { UnitIssuesResponse, UnitPrsResponse } from "@/lib/api";
import { api } from "@/lib/api";
import { useCrossUnitRemoteDelta } from "../useCrossUnitRemoteDelta";

function prsResponse(unit: string, count: number): UnitPrsResponse {
  return {
    unit,
    repos: [
      {
        repo_path: `/w/${unit}`,
        repo_label: unit,
        primary: true,
        prs: Array.from({ length: count }, (_, i) => ({
          number: BigInt(i + 1),
          title: `PR ${i + 1}`,
          state: "OPEN",
          head_branch: `feat/${i + 1}`,
          head_sha: "deadbee",
          base_branch: "main",
          url: `https://github.com/o/${unit}/pull/${i + 1}`,
          review_decision: null,
          check_status: null,
          is_draft: false,
          additions: 1n,
          deletions: 0n,
          comments: 0n,
          reviews: 0n,
          author: "alice",
          merge_commit_sha: null,
          created_at: null,
          merged_at: null,
          closed_at: null,
          ci_completed_at: null,
          last_synced_at: null,
        })),
      },
    ],
  };
}

function issuesResponse(unit: string, count: number): UnitIssuesResponse {
  return {
    unit,
    repos: [
      {
        repo_path: `/w/${unit}`,
        repo_label: unit,
        primary: true,
        issues: Array.from({ length: count }, (_, i) => ({
          number: BigInt(i + 1),
          title: `Issue ${i + 1}`,
          state: "open",
          url: `https://github.com/o/${unit}/issues/${i + 1}`,
          labels: [],
          assignees: [],
          created_at: null,
          closed_at: null,
          last_synced_at: null,
        })),
      },
    ],
  };
}

describe("useCrossUnitRemoteDelta", () => {
  beforeEach(() => {
    vi.mocked(api.unitPrs).mockReset();
    vi.mocked(api.unitIssues).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parks on empty unitNames — no fetch, empty map", () => {
    const { result } = renderHook(() => useCrossUnitRemoteDelta([]));
    expect(api.unitPrs).not.toHaveBeenCalled();
    expect(api.unitIssues).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });

  it("fans out over both endpoints for every unit", async () => {
    vi.mocked(api.unitPrs).mockImplementation((u: string) => Promise.resolve(prsResponse(u, 2)));
    vi.mocked(api.unitIssues).mockImplementation((u: string) =>
      Promise.resolve(issuesResponse(u, 1)),
    );
    const { result } = renderHook(() => useCrossUnitRemoteDelta(["tmai", "other"]));
    await waitFor(() => {
      expect(Object.keys(result.current).sort()).toEqual(["other", "tmai"]);
    });
    expect(api.unitPrs).toHaveBeenCalledWith("tmai");
    expect(api.unitPrs).toHaveBeenCalledWith("other");
    expect(api.unitIssues).toHaveBeenCalledWith("other");
    expect(result.current.tmai.prs?.[0].prs).toHaveLength(2);
    expect(result.current.tmai.issues?.[0].issues).toHaveLength(1);
  });

  it("keeps a unit's prior slice when a poll transiently fails (anti-flicker)", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    vi.mocked(api.unitIssues).mockResolvedValue(issuesResponse("tmai", 0));
    vi.mocked(api.unitPrs).mockResolvedValueOnce(prsResponse("tmai", 3));
    const { result } = renderHook(() => useCrossUnitRemoteDelta(["tmai"]));
    await waitFor(() => expect(result.current.tmai?.prs?.[0].prs).toHaveLength(3));

    // Second poll: PR fetch rejects → the prior slice must survive so the dot
    // does not flicker off on a transient blip.
    vi.mocked(api.unitPrs).mockRejectedValue(new Error("boom"));
    const tick = setIntervalSpy.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(typeof tick).toBe("function");
    await act(async () => {
      tick?.();
    });
    await waitFor(() => expect(api.unitPrs).toHaveBeenCalledTimes(2));
    expect(result.current.tmai.prs?.[0].prs).toHaveLength(3);
  });

  it("re-fetches only when the SET of units changes, not on array identity", async () => {
    vi.mocked(api.unitPrs).mockImplementation((u: string) => Promise.resolve(prsResponse(u, 1)));
    vi.mocked(api.unitIssues).mockImplementation((u: string) =>
      Promise.resolve(issuesResponse(u, 0)),
    );
    const { result, rerender } = renderHook(({ names }) => useCrossUnitRemoteDelta(names), {
      initialProps: { names: ["tmai"] },
    });
    await waitFor(() => expect(result.current.tmai).toBeDefined());
    const callsAfterFirst = vi.mocked(api.unitPrs).mock.calls.length;

    // Same names, fresh array identity → no re-subscribe / re-fetch.
    rerender({ names: ["tmai"] });
    expect(vi.mocked(api.unitPrs).mock.calls.length).toBe(callsAfterFirst);

    // A new member changes the keyed subscription → re-fetch (now includes it).
    rerender({ names: ["tmai", "other"] });
    await waitFor(() => expect(result.current.other).toBeDefined());
    expect(vi.mocked(api.unitPrs)).toHaveBeenCalledWith("other");
  });
});
