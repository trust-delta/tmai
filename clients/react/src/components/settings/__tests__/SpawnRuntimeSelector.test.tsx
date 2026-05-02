// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpawnSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      updateSpawnSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { SpawnRuntimeSelector } = await import("../SpawnRuntimeSelector");

const BASE_SETTINGS: SpawnSettings = {
  runtime: "native",
  tmux_available: false,
  tmux_window_name: "tmai",
  worker_permission_mode: "acceptEdits",
};

describe("SpawnRuntimeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects native by default on a fresh load", () => {
    render(<SpawnRuntimeSelector settings={BASE_SETTINGS} onSettingsChange={() => {}} />);
    const nativeRadio = screen.getByRole("radio", { name: /native/i });
    expect((nativeRadio as HTMLInputElement).checked).toBe(true);
  });

  it("renders the tmux option as disabled", () => {
    render(<SpawnRuntimeSelector settings={BASE_SETTINGS} onSettingsChange={() => {}} />);
    const tmuxRadio = screen.getByRole("radio", { name: /tmux/i });
    expect((tmuxRadio as HTMLInputElement).disabled).toBe(true);
  });

  it("shows 'coming soon' badge on the tmux option", () => {
    render(<SpawnRuntimeSelector settings={BASE_SETTINGS} onSettingsChange={() => {}} />);
    expect(screen.getByText("coming soon")).toBeTruthy();
  });

  it("calls updateSpawnSettings with runtime: native when native is selected", async () => {
    vi.mocked(api.updateSpawnSettings).mockResolvedValue(undefined as never);
    const onSettingsChange = vi.fn();
    // Start with runtime: "tmux" so native is not pre-checked; clicking it fires onChange
    const tmuxSettings: SpawnSettings = { ...BASE_SETTINGS, runtime: "tmux" };
    render(<SpawnRuntimeSelector settings={tmuxSettings} onSettingsChange={onSettingsChange} />);
    const nativeRadio = screen.getByRole("radio", { name: /native/i });
    fireEvent.click(nativeRadio);

    await waitFor(() => {
      expect(vi.mocked(api.updateSpawnSettings)).toHaveBeenCalledWith({ runtime: "native" });
    });
  });

  it("calls onSettingsChange with updated runtime after successful PUT", async () => {
    vi.mocked(api.updateSpawnSettings).mockResolvedValue(undefined as never);
    const onSettingsChange = vi.fn();
    // Start with runtime: "tmux" so native is not pre-checked; clicking it fires onChange
    const tmuxSettings: SpawnSettings = { ...BASE_SETTINGS, runtime: "tmux" };
    render(<SpawnRuntimeSelector settings={tmuxSettings} onSettingsChange={onSettingsChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /native/i }));

    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ runtime: "native" }));
    });
  });

  it("renders tmux as selected (but still disabled) when current config has runtime tmux", () => {
    const tmuxSettings: SpawnSettings = { ...BASE_SETTINGS, runtime: "tmux" };
    render(<SpawnRuntimeSelector settings={tmuxSettings} onSettingsChange={() => {}} />);
    const tmuxRadio = screen.getByRole("radio", { name: /tmux/i });
    expect((tmuxRadio as HTMLInputElement).checked).toBe(true);
    expect((tmuxRadio as HTMLInputElement).disabled).toBe(true);
  });
});
