// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getNotificationSettings: vi.fn(),
      updateNotificationSettings: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { NotificationSection } = await import("../NotificationSection");

describe("NotificationSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders heading even before settings load (defaults to enabled)", async () => {
    vi.mocked(api.getNotificationSettings).mockReturnValue(new Promise(() => {}));
    render(<NotificationSection />);
    expect(screen.getByText("Notifications")).toBeTruthy();
    // Threshold input is rendered because the default is enabled.
    expect(screen.getByLabelText("Idle threshold seconds")).toBeTruthy();
  });

  it("hides the threshold input when notify_on_idle loads as false", async () => {
    vi.mocked(api.getNotificationSettings).mockResolvedValue({
      notify_on_idle: false,
      notify_idle_threshold_secs: 10,
    });
    render(<NotificationSection />);
    await waitFor(() => {
      expect(screen.queryByLabelText("Idle threshold seconds")).toBeNull();
    });
  });

  it("toggling notify_on_idle persists and rolls back on error", async () => {
    vi.mocked(api.getNotificationSettings).mockResolvedValue({
      notify_on_idle: true,
      notify_idle_threshold_secs: 10,
    });
    vi.mocked(api.updateNotificationSettings).mockRejectedValue(new Error("rejected"));
    render(<NotificationSection />);
    await waitFor(() => screen.getByText("Notifications"));

    fireEvent.click(screen.getByLabelText("Notify on idle"));

    await waitFor(() => {
      expect(vi.mocked(api.updateNotificationSettings)).toHaveBeenCalledWith({
        notify_on_idle: false,
      });
      expect(screen.getByText(/rejected/)).toBeTruthy();
    });
  });
});
