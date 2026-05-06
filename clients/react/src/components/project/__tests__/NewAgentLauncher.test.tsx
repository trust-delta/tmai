// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getGeneralSettings: vi.fn(),
      listDirectories: vi.fn().mockResolvedValue([]),
      spawnPty: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { NewAgentLauncher } = await import("../NewAgentLauncher");

describe("NewAgentLauncher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-fetches default_project_root every time the picker opens", async () => {
    // Initial mount sees one value, the user then edits it in Settings
    // (which lives in a different mount tree), then comes back and clicks
    // `+ New agent`. Without the on-click refresh, the picker would still
    // open at the stale initial value.
    vi.mocked(api.getGeneralSettings)
      .mockResolvedValueOnce({ default_project_root: "/old" })
      .mockResolvedValueOnce({ default_project_root: "/new" });

    render(<NewAgentLauncher onSpawned={() => {}} />);

    // Wait for the initial fetch so the second click is the second call,
    // not the first.
    await waitFor(() => expect(vi.mocked(api.getGeneralSettings)).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /new agent/i }));

    await waitFor(() => {
      expect(vi.mocked(api.getGeneralSettings)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.listDirectories)).toHaveBeenCalledWith("/new");
    });
  });
});
