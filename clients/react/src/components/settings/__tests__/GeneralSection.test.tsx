// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getGeneralSettings: vi.fn(),
      updateGeneralSettings: vi.fn(),
      listDirectories: vi.fn(),
    },
  };
});

const { api } = await import("@/lib/api");
const { GeneralSection } = await import("../GeneralSection");

describe("GeneralSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while loading", () => {
    vi.mocked(api.getGeneralSettings).mockReturnValue(new Promise(() => {}));
    const { container } = render(<GeneralSection />);
    expect(container.firstChild).toBeNull();
  });

  it("loads existing default_project_root into the input", async () => {
    vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: "/home/works" });
    render(<GeneralSection />);
    const input = (await waitFor(() =>
      screen.getByLabelText("Default project root"),
    )) as HTMLInputElement;
    expect(input.value).toBe("/home/works");
  });

  it("blurring after edit commits the new value", async () => {
    vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: null });
    vi.mocked(api.updateGeneralSettings).mockResolvedValue(undefined as never);
    render(<GeneralSection />);
    const input = (await waitFor(() =>
      screen.getByLabelText("Default project root"),
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "/home/works" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(vi.mocked(api.updateGeneralSettings)).toHaveBeenCalledWith({
        default_project_root: "/home/works",
      });
    });
  });

  it("clearing the input sends null so the backend removes the key", async () => {
    vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: "/home/works" });
    vi.mocked(api.updateGeneralSettings).mockResolvedValue(undefined as never);
    render(<GeneralSection />);
    const input = (await waitFor(() =>
      screen.getByLabelText("Default project root"),
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(vi.mocked(api.updateGeneralSettings)).toHaveBeenCalledWith({
        default_project_root: null,
      });
    });
  });

  it("blurring with no change is a no-op", async () => {
    vi.mocked(api.getGeneralSettings).mockResolvedValue({ default_project_root: "/home/works" });
    vi.mocked(api.updateGeneralSettings).mockResolvedValue(undefined as never);
    render(<GeneralSection />);
    const input = (await waitFor(() =>
      screen.getByLabelText("Default project root"),
    )) as HTMLInputElement;

    fireEvent.blur(input);
    // Give react/promise queue a tick so a stray PUT would have landed.
    await Promise.resolve();
    expect(vi.mocked(api.updateGeneralSettings)).not.toHaveBeenCalled();
  });
});
