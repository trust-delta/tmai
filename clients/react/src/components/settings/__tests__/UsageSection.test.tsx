// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSettings } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getUsageSettings: vi.fn(),
      updateUsageSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { UsageSection } = await import("../UsageSection");

function makeSettings(overrides: Partial<UsageSettings> = {}): UsageSettings {
  return { enabled: true, auto_refresh_min: 30, ...overrides };
}

describe("UsageSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while loading", () => {
    vi.mocked(api.getUsageSettings).mockReturnValue(new Promise(() => {}));
    const { container } = render(<UsageSection />);
    expect(container.firstChild).toBeNull();
  });

  it("hides the interval input when disabled", async () => {
    vi.mocked(api.getUsageSettings).mockResolvedValue(makeSettings({ enabled: false }));
    render(<UsageSection />);
    await waitFor(() => screen.getByText("Usage Monitoring"));
    expect(screen.queryByLabelText("Usage auto-refresh interval")).toBeNull();
  });

  it("toggling enabled triggers updateUsageSettings and rolls back on error", async () => {
    vi.mocked(api.getUsageSettings).mockResolvedValue(makeSettings({ enabled: true }));
    vi.mocked(api.updateUsageSettings).mockRejectedValue(new Error("boom"));
    render(<UsageSection />);
    await waitFor(() => screen.getByText("Usage Monitoring"));

    fireEvent.click(screen.getByLabelText("Usage auto-refresh"));

    await waitFor(() => {
      expect(vi.mocked(api.updateUsageSettings)).toHaveBeenCalledWith({ enabled: false });
      expect(screen.getByText(/boom/)).toBeTruthy();
    });
  });

  it("commits the interval on blur with the at-least-min clamp", async () => {
    vi.mocked(api.getUsageSettings).mockResolvedValue(
      makeSettings({ enabled: true, auto_refresh_min: 10 }),
    );
    vi.mocked(api.updateUsageSettings).mockResolvedValue(undefined as never);
    render(<UsageSection />);
    await waitFor(() => screen.getByText("Usage Monitoring"));

    const input = screen.getByLabelText("Usage auto-refresh interval") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1" } }); // below the 5-minute min
    fireEvent.blur(input);

    await waitFor(() => {
      expect(vi.mocked(api.updateUsageSettings)).toHaveBeenCalledWith({ auto_refresh_min: 5 });
    });
  });
});
