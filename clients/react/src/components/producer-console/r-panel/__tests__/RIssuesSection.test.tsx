// @vitest-environment jsdom
//
// RIssuesSection — `N open` count from a new fetch (useIssues
// fans out to api.listIssues for the focused repo).

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueInfo } from "@/lib/api";

const listIssuesMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      listIssues: (...args: unknown[]) => listIssuesMock(...args),
    },
  };
});

import { RIssuesSection } from "../RIssuesSection";

function issue(overrides: Partial<IssueInfo> = {}): IssueInfo {
  return {
    number: 1,
    title: "Issue 1",
    state: "open",
    url: "https://github.com/o/r/issues/1",
    labels: [],
    assignees: [],
    ...overrides,
  };
}

beforeEach(() => {
  listIssuesMock.mockReset();
});

describe("RIssuesSection", () => {
  it("renders open issues from the focused repo path", async () => {
    listIssuesMock.mockResolvedValue([issue(), issue({ number: 2, title: "Issue 2" })]);
    render(<RIssuesSection currentProjectPath="/p/u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Issue 1")).toBeTruthy();
    });
    expect(screen.getByText("Issue 2")).toBeTruthy();
  });

  it("header `N open` counts only open issues; closed issues hidden from count AND body", async () => {
    listIssuesMock.mockResolvedValue([
      issue({ state: "open", title: "Open one" }),
      issue({ number: 2, state: "closed", title: "Closed issue" }),
      issue({ number: 3, state: "open", title: "Open three" }),
    ]);
    render(<RIssuesSection currentProjectPath="/p/u" expanded={true} onToggle={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/2 open/)).toBeTruthy();
    });
    // Negative assertion: closed issue must not leak into the body
    // either (the header/body source-of-truth must agree).
    expect(screen.queryByText("Closed issue")).toBeNull();
    expect(screen.getByText("Open one")).toBeTruthy();
    expect(screen.getByText("Open three")).toBeTruthy();
  });

  it("uses no severity colors", async () => {
    listIssuesMock.mockResolvedValue([issue()]);
    const { container } = render(
      <RIssuesSection currentProjectPath="/p/u" expanded={true} onToggle={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText("Issue 1")).toBeTruthy();
    });
    expect(container.innerHTML).not.toMatch(/text-warning|text-destructive|text-success/);
  });
});
