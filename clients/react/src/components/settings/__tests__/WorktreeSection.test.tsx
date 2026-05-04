// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getWorktreeSettings: vi.fn(),
      updateWorktreeSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { WorktreeSection } = await import("../WorktreeSection");

function makeSettings(overrides: Partial<WorktreeSettings> = {}): WorktreeSettings {
  return {
    setup_commands: [],
    setup_timeout_secs: 300,
    branch_depth_warning: 5,
    ...overrides,
  };
}

describe("WorktreeSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while settings are loading", () => {
    vi.mocked(api.getWorktreeSettings).mockReturnValue(new Promise(() => {}));
    const { container } = render(<WorktreeSection />);
    expect(container.firstChild).toBeNull();
  });

  it("loads and renders both numeric tunables + setup commands", async () => {
    vi.mocked(api.getWorktreeSettings).mockResolvedValue(
      makeSettings({ setup_commands: ["pnpm install", "cargo build"] }),
    );
    render(<WorktreeSection />);
    await waitFor(() => screen.getByText("Worktree"));
    expect(screen.getByText("pnpm install")).toBeTruthy();
    expect(screen.getByText("cargo build")).toBeTruthy();
    expect(screen.getByLabelText("Setup timeout")).toBeTruthy();
    expect(screen.getByLabelText("Branch depth warning")).toBeTruthy();
  });

  it("Add command via Enter calls api.updateWorktreeSettings", async () => {
    vi.mocked(api.getWorktreeSettings).mockResolvedValue(makeSettings());
    vi.mocked(api.updateWorktreeSettings).mockResolvedValue(undefined as never);
    render(<WorktreeSection />);
    await waitFor(() => screen.getByText("Worktree"));

    const input = screen.getByLabelText("Add setup command") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "npm install" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(vi.mocked(api.updateWorktreeSettings)).toHaveBeenCalledWith({
        setup_commands: ["npm install"],
      });
    });
    expect(input.value).toBe("");
  });

  it("Remove command rolls back on backend error", async () => {
    vi.mocked(api.getWorktreeSettings).mockResolvedValue(
      makeSettings({ setup_commands: ["pnpm install"] }),
    );
    vi.mocked(api.updateWorktreeSettings).mockRejectedValue(new Error("permission denied"));
    render(<WorktreeSection />);
    await waitFor(() => screen.getByText("Worktree"));

    fireEvent.click(screen.getByLabelText("Remove setup command pnpm install"));

    await waitFor(() => {
      expect(screen.getByText(/permission denied/)).toBeTruthy();
    });
    // The rollback puts the command back in the rendered list.
    expect(screen.getByText("pnpm install")).toBeTruthy();
  });

  it("Setup timeout commits on blur with the at-least-min clamp", async () => {
    vi.mocked(api.getWorktreeSettings).mockResolvedValue(makeSettings({ setup_timeout_secs: 60 }));
    vi.mocked(api.updateWorktreeSettings).mockResolvedValue(undefined as never);
    render(<WorktreeSection />);
    await waitFor(() => screen.getByText("Worktree"));

    const input = screen.getByLabelText("Setup timeout") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "10" } }); // below the 30s min
    fireEvent.blur(input);

    await waitFor(() => {
      expect(vi.mocked(api.updateWorktreeSettings)).toHaveBeenCalledWith({
        setup_timeout_secs: 30,
      });
    });
  });

  it("Add button no-ops on whitespace-only input", async () => {
    vi.mocked(api.getWorktreeSettings).mockResolvedValue(makeSettings());
    render(<WorktreeSection />);
    await waitFor(() => screen.getByText("Worktree"));

    const input = screen.getByLabelText("Add setup command") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(vi.mocked(api.updateWorktreeSettings)).not.toHaveBeenCalled();
  });
});
