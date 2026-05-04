// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getSpawnSettings: vi.fn(),
      updateSpawnSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { SpawnSection } = await import("../SpawnSection");

function makeSettings(overrides: Partial<SpawnSettings> = {}): SpawnSettings {
  return {
    runtime: "native",
    tmux_available: false,
    tmux_window_name: "tmai",
    ...overrides,
  };
}

describe("SpawnSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while loading", () => {
    vi.mocked(api.getSpawnSettings).mockReturnValue(new Promise(() => {}));
    const { container } = render(<SpawnSection />);
    expect(container.firstChild).toBeNull();
  });

  it("hides the tmux window-name field when runtime is native", async () => {
    vi.mocked(api.getSpawnSettings).mockResolvedValue(makeSettings({ runtime: "native" }));
    render(<SpawnSection />);
    await waitFor(() => screen.getByText("Spawn"));
    expect(screen.queryByLabelText("tmux window name")).toBeNull();
  });

  it("shows the tmux window-name field when runtime is tmux, commits on blur", async () => {
    vi.mocked(api.getSpawnSettings).mockResolvedValue(
      makeSettings({ runtime: "tmux", tmux_window_name: "tmai" }),
    );
    vi.mocked(api.updateSpawnSettings).mockResolvedValue(undefined as never);
    render(<SpawnSection />);
    await waitFor(() => screen.getByText("Spawn"));

    const input = screen.getByLabelText("tmux window name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "claude-pane" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(vi.mocked(api.updateSpawnSettings)).toHaveBeenCalledWith({
        runtime: "tmux",
        tmux_window_name: "claude-pane",
      });
    });
  });
});
