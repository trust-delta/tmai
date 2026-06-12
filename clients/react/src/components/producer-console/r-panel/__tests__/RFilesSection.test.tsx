// @vitest-environment jsdom
//
// RFilesSection — repo link list, NOT a file browser. We assert:
// (1) github URL derived from any open PR url; (2) no IDE-like
// embedded file tree / preview; (3) deep-link generator computes
// the expected URL.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrSummaryWire, UnitPrsResponse } from "@/lib/api";

const unitPrsMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      unitPrs: (...args: unknown[]) => unitPrsMock(...args),
    },
  };
});

import { RFilesSection } from "../RFilesSection";

function pr(url: string): PrSummaryWire {
  return {
    number: 100n,
    title: "t",
    state: "OPEN",
    head_branch: "x",
    head_sha: "abc",
    base_branch: "main",
    url,
    review_decision: null,
    check_status: null,
    is_draft: false,
    additions: 0n,
    deletions: 0n,
    comments: 0n,
    reviews: 0n,
    author: "a",
    merge_commit_sha: null,
    created_at: null,
    merged_at: null,
    closed_at: null,
    ci_completed_at: null,
  };
}

function withPrs(prs: PrSummaryWire[]): UnitPrsResponse {
  return {
    unit: "u",
    repos: [{ repo_path: "/p/u", repo_label: "u", primary: true, prs }],
  };
}

beforeEach(() => {
  unitPrsMock.mockReset();
});

describe("RFilesSection", () => {
  it("derives github repo URL from any open PR url and offers a deep-link generator", async () => {
    unitPrsMock.mockResolvedValue(withPrs([pr("https://github.com/o/r/pull/42")]));

    render(
      <RFilesSection currentProjectPath="/p/u" unitName="u" expanded={true} onToggle={vi.fn()} />,
    );

    // Repo URL surfaced.
    await waitFor(() => {
      expect(screen.getByText("https://github.com/o/r")).toBeTruthy();
    });
    // Deep-link generator is offered.
    expect(screen.getByText(/Deep-link generator/i)).toBeTruthy();

    // Type a path → deep link rendered.
    const pathInput = screen.getByPlaceholderText("src/lib/api.ts") as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: "src/foo.ts" } });
    expect(screen.getByText(/https:\/\/github\.com\/o\/r\/blob\/main\/src\/foo\.ts/)).toBeTruthy();
  });

  it("when no PRs to derive github URL, surfaces TODO marker and degrades honestly", async () => {
    unitPrsMock.mockResolvedValue(withPrs([]));

    render(
      <RFilesSection currentProjectPath="/p/u" unitName="u" expanded={true} onToggle={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/repo remote-url wire/i)).toBeTruthy();
    });
    // No deep-link generator (no linkable repo).
    expect(screen.queryByText(/Deep-link generator/i)).toBeNull();
  });

  it("does NOT render an embedded file tree / preview (IDE territory)", async () => {
    unitPrsMock.mockResolvedValue(withPrs([pr("https://github.com/o/r/pull/1")]));

    render(
      <RFilesSection currentProjectPath="/p/u" unitName="u" expanded={true} onToggle={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Deep-link generator/i)).toBeTruthy();
    });
    // No textarea preview, no `<pre>` source view.
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector("pre")).toBeNull();
  });
});
