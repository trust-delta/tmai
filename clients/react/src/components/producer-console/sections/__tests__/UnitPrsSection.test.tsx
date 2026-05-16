// @vitest-environment jsdom
//
// UnitPrsSection — the Stage-1 in-tmai dev-loop surface, wired to
// `useUnitPrs(unitName)` against `GET /api/units/{unit}/prs` (tmai-core
// PR #389). We mock `api.unitPrs` / `api.prDiff` / `api.mergePr` so each
// test drives a deterministic payload and asserts the three Stage-1
// capabilities + the honest-degradation posture:
//   §A unified cross-repo list (one flat list, repo-tagged, not a
//      switcher); single-repo collapses, multi-repo gets thin headers
//   §B lazy code-diff via DiffViewer
//   §C direct operator merge (POST /api/github/pr/merge), inline-
//      confirmed, fired with fireEvent.click (inside React's act())
//   posture: pick-a-project on null unit (no fetch); honest error; no
//      fabricated empty list.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoPrsWire } from "@/lib/api";

const unitPrsMock = vi.fn();
const prDiffMock = vi.fn();
const mergePrMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      unitPrs: (...args: unknown[]) => unitPrsMock(...args),
      prDiff: (...args: unknown[]) => prDiffMock(...args),
      mergePr: (...args: unknown[]) => mergePrMock(...args),
    },
  };
});

import { UnitPrsSection } from "../UnitPrsSection";

function repoStub(overrides: Partial<RepoPrsWire> = {}): RepoPrsWire {
  return {
    repo_path: "/home/u/works/tmai",
    repo_label: "tmai",
    primary: true,
    prs: [
      {
        number: 707n,
        title: "token lock + light theme",
        state: "OPEN",
        head_branch: "feat/tokens",
        head_sha: "abc1234",
        base_branch: "main",
        url: "https://github.com/trust-delta/tmai/pull/707",
        review_decision: "APPROVED",
        check_status: "SUCCESS",
        is_draft: false,
        additions: 120n,
        deletions: 7n,
        comments: 2n,
        reviews: 1n,
        author: "trust-delta",
        merge_commit_sha: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  unitPrsMock.mockReset();
  prDiffMock.mockReset();
  mergePrMock.mockReset();
});

describe("UnitPrsSection", () => {
  it("shows a pick-a-project notice when unitName is null and does not fetch", () => {
    render(<UnitPrsSection unitName={null} />);
    expect(screen.getByText(/Pick a project/i)).toBeTruthy();
    expect(unitPrsMock).not.toHaveBeenCalled();
  });

  it("surfaces fetch errors honestly instead of a fabricated empty list", async () => {
    unitPrsMock.mockRejectedValue(new Error("gh not authenticated"));
    render(<UnitPrsSection unitName="tmai" />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load PRs/)).toBeTruthy();
    });
    expect(screen.getByText(/gh not authenticated/)).toBeTruthy();
    expect(screen.queryByText(/Merge #/)).toBeNull();
  });

  it("renders an empty-state notice when no repo has open PRs", async () => {
    unitPrsMock.mockResolvedValue({
      unit: "tmai",
      repos: [repoStub({ prs: [] })],
    });
    render(<UnitPrsSection unitName="tmai" />);
    await waitFor(() => {
      expect(screen.getByText(/No open PRs for/i)).toBeTruthy();
    });
  });

  it("renders a single-repo unit as one flat list with no repo header", async () => {
    unitPrsMock.mockResolvedValue({ unit: "tmai", repos: [repoStub()] });
    render(<UnitPrsSection unitName="tmai" />);
    await waitFor(() => {
      expect(screen.getByText(/token lock \+ light theme/)).toBeTruthy();
    });
    expect(screen.getByText("#707")).toBeTruthy();
    expect(screen.getByText(/feat\/tokens → main/)).toBeTruthy();
    // No per-repo header for a single-repo unit (the list is unambiguous).
    expect(screen.queryByText("(primary)")).toBeNull();
  });

  it("tags each PR with its repo when the unit spans multiple repos (one list, not a switcher)", async () => {
    unitPrsMock.mockResolvedValue({
      unit: "tmai",
      repos: [
        repoStub(),
        repoStub({
          repo_path: "/home/u/works/tmai-core",
          repo_label: "tmai-core",
          primary: false,
          prs: [
            {
              number: 389n,
              title: "Stage-1 wire half",
              state: "OPEN",
              head_branch: "feat/stage1-wire",
              head_sha: "f00ba12",
              base_branch: "main",
              url: "https://github.com/o/tmai-core/pull/389",
              review_decision: null,
              check_status: "PENDING",
              is_draft: true,
              additions: 900n,
              deletions: 12n,
              comments: 0n,
              reviews: 0n,
              author: "bob",
              merge_commit_sha: null,
            },
          ],
        }),
      ],
    });
    render(<UnitPrsSection unitName="tmai" />);
    await waitFor(() => {
      expect(screen.getByText("tmai-core")).toBeTruthy();
    });
    // Both repos' PRs are in the same rendered list (unified, not a switcher).
    expect(screen.getByText(/token lock \+ light theme/)).toBeTruthy();
    expect(screen.getByText(/Stage-1 wire half/)).toBeTruthy();
    expect(screen.getByText("(primary)")).toBeTruthy();
  });

  it("lazily loads the code diff via api.prDiff and renders it", async () => {
    unitPrsMock.mockResolvedValue({ unit: "tmai", repos: [repoStub()] });
    prDiffMock.mockResolvedValue({
      repo: "/home/u/works/tmai",
      pr_number: 707n,
      patch: "diff --git a/src/theme.ts b/src/theme.ts\n+const x = 1;\n",
    });
    render(<UnitPrsSection unitName="tmai" />);
    const viewBtn = await screen.findByRole("button", { name: /View diff/ });
    // Not fetched until the drawer opens.
    expect(prDiffMock).not.toHaveBeenCalled();
    fireEvent.click(viewBtn);
    // Exact match → the DiffViewer file-header span only (the raw diff
    // line "a/src/theme.ts b/src/theme.ts" is a different text node).
    await waitFor(() => {
      expect(screen.getByText("src/theme.ts")).toBeTruthy();
    });
    expect(prDiffMock).toHaveBeenCalledWith("/home/u/works/tmai", 707);
  });

  it("merges directly via api.mergePr after an inline confirm (no agent)", async () => {
    unitPrsMock.mockResolvedValue({ unit: "tmai", repos: [repoStub()] });
    mergePrMock.mockResolvedValue({ status: "merged" });
    render(<UnitPrsSection unitName="tmai" />);

    const mergeBtn = await screen.findByRole("button", { name: /Merge #707/ });
    fireEvent.click(mergeBtn);
    // Arms an inline confirm rather than merging immediately.
    expect(mergePrMock).not.toHaveBeenCalled();
    const confirmBtn = await screen.findByRole("button", { name: /Confirm/ });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/✓ Merged #707/)).toBeTruthy();
    });
    expect(mergePrMock).toHaveBeenCalledWith("/home/u/works/tmai", 707, {
      method: "squash",
      deleteBranch: true,
    });
  });

  it("surfaces a merge failure inline instead of swallowing it", async () => {
    unitPrsMock.mockResolvedValue({ unit: "tmai", repos: [repoStub()] });
    mergePrMock.mockRejectedValue(new Error("not mergeable"));
    render(<UnitPrsSection unitName="tmai" />);

    fireEvent.click(await screen.findByRole("button", { name: /Merge #707/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirm/ }));

    await waitFor(() => {
      expect(screen.getByText(/Merge failed: not mergeable/)).toBeTruthy();
    });
  });
});
