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

    // Lock order + count: the *first* listDirectories call must be `/new`.
    // Without `toHaveBeenNthCalledWith` a regression that opens DirBrowser
    // before the refresh finishes — and so loads `/old` first then `/new`
    // on a re-render — would still pass `toHaveBeenCalledWith("/new")`.
    await waitFor(() => {
      expect(vi.mocked(api.getGeneralSettings)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.listDirectories)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.listDirectories)).toHaveBeenNthCalledWith(1, "/new");
    });
  });

  it("spawns the chosen runtime against DirBrowser's currentPath without an intermediate confirm", async () => {
    // Regression for the redundant "Select this" → close → re-open runtime
    // menu flow. The fix inlines the runtime buttons into DirBrowser via
    // `actionSlot`, so clicking `claude` while browsing in `/projects`
    // fires `spawnPty({ command: "claude", cwd: "/projects" })` directly.
    vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: "/projects" });
    vi.mocked(api.listDirectories).mockResolvedValue([]);
    vi.mocked(api.spawnPty).mockResolvedValue({
      session_id: "sess-1",
      pid: 42,
      command: "claude",
    });

    const onSpawned = vi.fn();
    render(<NewAgentLauncher onSpawned={onSpawned} />);
    await waitFor(() => expect(vi.mocked(api.getGeneralSettings)).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /new agent/i }));

    // The runtime buttons mount with DirBrowser, but they're disabled until
    // `currentPath` is hydrated from listDirectories — wait for the path to
    // surface in the path bar before clicking, otherwise the click lands on
    // a disabled button and silently no-ops.
    await screen.findByText("/projects");
    const claudeBtn = await screen.findByRole("button", { name: /^claude$/i });
    fireEvent.click(claudeBtn);

    await waitFor(() => {
      expect(vi.mocked(api.spawnPty)).toHaveBeenCalledWith({
        command: "claude",
        cwd: "/projects",
      });
      expect(onSpawned).toHaveBeenCalledWith("sess-1");
    });
  });
});
